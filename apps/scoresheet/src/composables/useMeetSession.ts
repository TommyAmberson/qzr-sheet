import { ref, computed } from 'vue'
import { getMeetTeams, getTeamQuizzers, type MeetTeam } from '../api'

const STORAGE_KEY = 'qzr-meet-session'

export interface SlotSession {
  teamId: number
  /** Team label as it appears in the dropdown: "{shortName} {number}" */
  dbLabel: string
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

  /** Human-readable label for a team: "{shortName} {number}" */
  function teamLabel(team: MeetTeam): string {
    return `${team.churchShortName} ${team.number}`
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
  async function assignTeam(slotIdx: number, teamId: number): Promise<void> {
    if (!session.value) return
    const team = session.value.teamList.find((t) => t.id === teamId)
    if (!team) return

    const { quizzers } = await getTeamQuizzers(teamId)

    session.value.slots[slotIdx] = {
      teamId,
      dbLabel: teamLabel(team),
      quizzers: quizzers.map((q) => ({ quizzerId: q.quizzerId, dbName: q.name })),
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

  /** Get the slot data for a given team slot index */
  function getSlot(slotIdx: number): SlotSession | undefined {
    return session.value?.slots[slotIdx]
  }

  /**
   * Whether a name diverges from the DB value.
   * Returns false if not in quizmeet mode or no quizzer record found.
   */
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
    loadMeet,
    assignTeam,
    clearSlot,
    getSlot,
    isQuizzerDiverged,
    getDbName,
    clearSession,
    refresh,
  }
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
