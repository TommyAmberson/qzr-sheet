import { ref, computed } from 'vue'
import { getMeetTeams, getTeamQuizzers, type MeetTeam } from '../api'
import { QUIZZERS_PER_TEAM } from '../types/scoresheet'

const STORAGE_KEY = 'qzr-meet-session'

export interface SlotSession {
  teamId: number
  dbLabel: string // short: "FC 1"
  dbLabelFull: string // full:  "First Church 1"
  /** Fixed-length (QUIZZERS_PER_TEAM). Empty seats have dbName: ''. */
  quizzers: Array<{ quizzerId: number; dbName: string }>
}

export interface MeetSessionData {
  meetId: number
  meetName: string
  /** Index = team slot (0–2), undefined = slot not yet assigned */
  slots: (SlotSession | undefined)[]
  /** All teams available in the meet for the dropdowns */
  teamList: MeetTeam[]
}

const session = ref<MeetSessionData | null>(loadFromStorage())

export function useMeetSession() {
  const isActive = computed(() => session.value !== null)
  const meetName = computed(() => session.value?.meetName ?? null)
  const teamList = computed(() => session.value?.teamList ?? [])

  /** Short label for dropdowns: "{shortName} {number}" */
  function teamLabel(team: MeetTeam): string {
    return `${team.churchShortName} ${team.number}`
  }

  /** Full label for display: "{churchName} {number}" */
  function teamLabelFull(team: MeetTeam): string {
    return `${team.churchName} ${team.number}`
  }

  /** Load all teams for a meet and activate quizmeet mode */
  async function loadMeet(meetId: number, meetName: string): Promise<void> {
    const { teams } = await getMeetTeams(meetId)
    session.value = {
      meetId,
      meetName,
      slots: [undefined, undefined, undefined],
      teamList: teams,
    }
    persist()
  }

  /** Assign a team to a slot and fetch its quizzers */
  async function assignTeam(slotIdx: number, teamId: number, storeNames: string[]): Promise<void> {
    if (!session.value) return
    const team = session.value.teamList.find((t) => t.id === teamId)
    if (!team) return

    const { quizzers } = await getTeamQuizzers(teamId)

    session.value.slots[slotIdx] = {
      teamId,
      dbLabel: teamLabel(team),
      dbLabelFull: teamLabelFull(team),
      quizzers: matchQuizzers(storeNames, quizzers),
    }
    // Trigger reactivity — slots is a plain array inside a ref
    session.value = { ...session.value, slots: [...session.value.slots] }
    persist()
  }

  /** Clear the team assignment for a slot */
  function clearSlot(slotIdx: number): void {
    if (!session.value) return
    const slots = [...session.value.slots]
    slots[slotIdx] = undefined
    session.value = { ...session.value, slots }
    persist()
  }

  /** Mirror a drag-reorder into the slot's quizzer array so divergence detection stays correct */
  function reorderSlotQuizzers(slotIdx: number, fromSeat: number, toSeat: number): void {
    if (fromSeat === toSeat) return
    const slot = session.value?.slots[slotIdx]
    if (!slot) return
    const quizzers = [...slot.quizzers]
    const [moved] = quizzers.splice(fromSeat, 1)
    quizzers.splice(toSeat, 0, moved!)
    session.value = {
      ...session.value!,
      slots: session.value!.slots.map((s, i) => (i === slotIdx && s ? { ...s, quizzers } : s)),
    }
    persist()
  }

  /** Get the slot data for a given team slot index */
  function getSlot(slotIdx: number): SlotSession | undefined {
    return session.value?.slots[slotIdx]
  }

  /** Whether a name diverges from the DB value (empty seats have dbName ''). */
  function isQuizzerDiverged(slotIdx: number, quizzerIdx: number, currentName: string): boolean {
    const slot = session.value?.slots[slotIdx]
    if (!slot) return false
    const dbName = slot.quizzers[quizzerIdx]?.dbName
    if (dbName === undefined) return false
    return currentName.trim() !== dbName.trim()
  }

  function getDbName(slotIdx: number, quizzerIdx: number): string | undefined {
    return session.value?.slots[slotIdx]?.quizzers[quizzerIdx]?.dbName
  }

  /** Disconnect from meet — called by clearNames / newQuiz */
  function clearSession(): void {
    session.value = null
    persist()
  }

  /** Re-fetch the team list (e.g. after a page restore, to pick up roster changes) */
  async function refresh(): Promise<void> {
    if (!session.value) return
    try {
      const { teams } = await getMeetTeams(session.value.meetId)
      session.value = { ...session.value, teamList: teams }
      persist()
    } catch {
      // Silently ignore — offline or session expired; existing data stays usable
    }
  }

  return {
    isActive,
    meetName,
    teamList,
    teamLabel,
    teamLabelFull,
    loadMeet,
    assignTeam,
    clearSlot,
    getSlot,
    reorderSlotQuizzers,
    isQuizzerDiverged,
    getDbName,
    clearSession,
    refresh,
  }
}

function matchQuizzers(
  storeNames: string[],
  dbQuizzers: { quizzerId: number; name: string }[],
): { quizzerId: number; dbName: string }[] {
  const result: ({ quizzerId: number; dbName: string } | null)[] =
    Array(QUIZZERS_PER_TEAM).fill(null)
  const pool = [...dbQuizzers]

  // Pass 1: exact match (case-insensitive, trimmed)
  for (let i = 0; i < QUIZZERS_PER_TEAM; i++) {
    const name = storeNames[i]?.trim().toLowerCase()
    if (!name) continue
    const j = pool.findIndex((q) => q.name.trim().toLowerCase() === name)
    if (j !== -1) {
      result[i] = { quizzerId: pool[j]!.quizzerId, dbName: pool[j]!.name }
      pool.splice(j, 1)
    }
  }

  // Pass 2: first-name match (first space-separated token)
  for (let i = 0; i < QUIZZERS_PER_TEAM; i++) {
    if (result[i] !== null) continue
    const firstName = storeNames[i]?.trim().split(' ')[0]?.toLowerCase()
    if (!firstName) continue
    const j = pool.findIndex((q) => q.name.trim().split(' ')[0]?.toLowerCase() === firstName)
    if (j !== -1) {
      result[i] = { quizzerId: pool[j]!.quizzerId, dbName: pool[j]!.name }
      pool.splice(j, 1)
    }
  }

  // Pass 3: fuzzy match for non-empty unmatched — before filling empty seats so edited
  // names aren't crowded out by blank seats consuming the best remaining DB quizzers
  for (let i = 0; i < QUIZZERS_PER_TEAM; i++) {
    if (result[i] !== null) continue
    if (!storeNames[i]?.trim()) continue
    if (pool.length === 0) break
    let best = 0
    let bestDist = levenshtein(storeNames[i]!.toLowerCase(), pool[0]!.name.toLowerCase())
    for (let k = 1; k < pool.length; k++) {
      const d = levenshtein(storeNames[i]!.toLowerCase(), pool[k]!.name.toLowerCase())
      if (d < bestDist) {
        bestDist = d
        best = k
      }
    }
    result[i] = { quizzerId: pool[best]!.quizzerId, dbName: pool[best]!.name }
    pool.splice(best, 1)
  }

  // Pass 4: empty seats — fill with whatever DB quizzers remain
  for (let i = 0; i < QUIZZERS_PER_TEAM; i++) {
    if (result[i] !== null) continue
    if (pool.length === 0) break
    result[i] = { quizzerId: pool[0]!.quizzerId, dbName: pool[0]!.name }
    pool.shift()
  }

  // Pass 5: remainder (pool exhausted — any still-null seats become empty)
  let pi = 0
  for (let i = 0; i < QUIZZERS_PER_TEAM; i++) {
    if (result[i] !== null) continue
    result[i] =
      pi < pool.length
        ? { quizzerId: pool[pi]!.quizzerId, dbName: pool[pi]!.name }
        : { quizzerId: 0, dbName: '' }
    pi++
  }

  return result as { quizzerId: number; dbName: string }[]
}

function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => i || j),
  )
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i]![j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1]![j - 1]!
          : 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!)
  return dp[m]![n]!
}

function persist() {
  if (session.value === null) {
    localStorage.removeItem(STORAGE_KEY)
  } else {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session.value))
  }
}

function loadFromStorage(): MeetSessionData | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as MeetSessionData
  } catch {
    return null
  }
}
