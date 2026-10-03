import { ref } from 'vue'
import { foldName, type DivisionTeamNames } from '@qzr/shared'
import { getTeamNames } from '../api'

const STORAGE_KEY = 'qzr-team-names'

/** A meet's team names, as last fetched */
interface KnownNames {
  meetId: number
  lists: DivisionTeamNames[]
}

const known = ref<KnownNames | null>(loadFromStorage())
let fetches = 0

/**
 * Fetch the team names of the meet the sheet works with (Story 6), or forget them when there's no
 * meet. Kept on the device, so a sheet that goes offline still offers the names it last had.
 */
async function refreshTeamNames(meetId: number | null): Promise<void> {
  const run = ++fetches
  if (meetId === null) return keep(null)
  try {
    const lists = await getTeamNames(meetId)
    if (run === fetches) keep({ meetId, lists })
  } catch {
    // No answer, offline or refused: keep the names known for this meet, but not another meet's
    if (run === fetches && known.value?.meetId !== meetId) keep(null)
  }
}

/** The team names listed for a division, matched ignoring case and spaces */
function teamNamesFor(division: string): string[] {
  const key = foldName(division)
  return known.value?.lists.find((list) => foldName(list.division) === key)?.names ?? []
}

function keep(names: KnownNames | null) {
  known.value = names
  try {
    if (names) localStorage.setItem(STORAGE_KEY, JSON.stringify(names))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage unavailable: the names last until the page closes
  }
}

function loadFromStorage(): KnownNames | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as KnownNames) : null
  } catch {
    return null
  }
}

/** The team names a meet's admin listed for its scoresheets to offer, by division */
export function useTeamNames() {
  return { refreshTeamNames, teamNamesFor }
}
