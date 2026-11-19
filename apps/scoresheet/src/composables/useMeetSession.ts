import { ref, computed } from 'vue'
import {
  getMeetTeams,
  getScheduledQuiz,
  getStatsSettings,
  getTeamQuizzers,
  type MeetTeam,
  type MeetTeamQuizzer,
  type ScheduledQuizDetails,
} from '../api'
import {
  QUIZZERS_PER_TEAM,
  editDistance,
  foldName,
  teamDisplayName,
  teamNamed as rosterTeamNamed,
  teamsNearName as rosterTeamsNearName,
  type PlacementFormula,
} from '@qzr/shared'
import type { Sender } from '@qzr/ui'
import { senderOf } from './useSubmitToMeet'
import { currentTab, setTabLink } from '../persistence/autoSave'

export interface SlotSession {
  teamId: number
  dbLabel: string // short: "FC 1"
  dbLabelFull: string // full:  "First Church 1"
  /** Fixed-length (QUIZZERS_PER_TEAM). Empty seats have dbName: ''. */
  quizzers: Array<{ quizzerId: number; dbName: string }>
}

/** The linked scheduled quiz as the schedule last had it: what the sheet's quiz is compared with */
export interface ScheduledQuizCopy {
  /** What the schedule calls the quiz */
  label: string
  division: string
  consolation: boolean
  quizNumber: string
  /**
   * Per team slot, in the schedule's seat order: the roster team's id, or null for a seat the
   * schedule hasn't decided
   */
  seats: (number | null)[]
  /** False once the published schedule no longer has the quiz */
  inSchedule: boolean
}

export interface MeetSessionData {
  meetId: number
  meetName: string
  /** Index = team slot (0–2), undefined = slot not yet assigned */
  slots: (SlotSession | undefined)[]
  /** All teams available in the meet for the dropdowns */
  teamList: MeetTeam[]
  /** The meet's canonical division list, e.g. ["1", "2", "3"] */
  meetDivisions: string[]
  /** The linked scheduled quiz, by its id in the published schedule; null when none is linked */
  quizId: string | null
  /**
   * The copy of the linked scheduled quiz. Absent while `quizId` is set only in a session saved
   * before copies were kept, until the next fetch fills it in.
   */
  scheduledQuiz?: ScheduledQuizCopy | null
  /** Set when the user may send quizzes to this meet, and for which rooms */
  sender: Sender | null
  /**
   * How the meet scores teams level in a quiz, which a quiz worked on with it takes (FR-023b).
   * Absent where the meet's settings couldn't be read: the sheet keeps its own then.
   */
  levelTeams?: PlacementFormula
}

// The tab's own link, which it started with
const session = ref<MeetSessionData | null>(currentTab()?.link ?? null)

/**
 * Counts the quizzes the session has stood for: stepped whenever its picks are replaced wholesale
 * (a meet linked or unlinked, a new or scheduled quiz), so a pick still waiting on its roster can
 * tell that the quiz it was made for is gone.
 */
let quizEpoch = 0

export function useMeetSession() {
  const isActive = computed(() => session.value !== null)
  const meetId = computed(() => session.value?.meetId ?? null)
  const meetName = computed(() => session.value?.meetName ?? null)
  const teamList = computed(() => session.value?.teamList ?? [])
  const quizId = computed(() => session.value?.quizId ?? null)
  const scheduledQuiz = computed(() => session.value?.scheduledQuiz ?? null)
  const levelTeams = computed(() => session.value?.levelTeams)

  /** Division options for the scoresheet dropdown — the meet's canonical division list. */
  const divisionOptions = computed((): string[] => session.value?.meetDivisions ?? [])

  /**
   * Whether the linked meet lists divisions and this isn't one of them. Blank isn't: the meet has
   * no division called nothing, the way its roster has no team called nothing.
   */
  function lacksDivision(division: string): boolean {
    return divisionOptions.value.length > 0 && !divisionOptions.value.includes(division)
  }

  /**
   * The teams of a division, consolation or not. A quiz with no division yet has none: offering
   * the whole meet would let a team be picked with nothing to say it's in the wrong division.
   */
  function teamsForDivision(division: string, consolation: boolean): MeetTeam[] {
    const all = session.value?.teamList ?? []
    return all.filter((t) => t.division === division && t.consolation === consolation)
  }

  /** Short label for dropdowns: "{shortName} {number}" */
  function teamLabel(team: MeetTeam): string {
    return teamDisplayName({ shortName: team.churchShortName, number: team.number })
  }

  /** Full label for display: "{churchName} {number}" */
  function teamLabelFull(team: MeetTeam): string {
    return `${team.churchName} ${team.number}`
  }

  /** Link a meet afresh: its teams and divisions, with no picks and no scheduled quiz */
  async function loadMeet(meetId: number, meetName: string): Promise<void> {
    commitLink({
      meetId,
      meetName,
      ...(await fetchMeet(meetId)),
      slots: [undefined, undefined, undefined],
      quizId: null,
      scheduledQuiz: null,
    })
  }

  /**
   * What a meet gives the sheet to link against, fetched and not yet kept: a link is worked out
   * from this and committed in one step, so one that is cancelled or fails changes nothing.
   */
  async function fetchMeet(meetId: number): Promise<{
    teams: MeetTeam[]
    meetDivisions: string[]
    sender: Sender | null | undefined
    levelTeams: PlacementFormula | undefined
  }> {
    const [{ teams, meetDivisions }, sender, settings] = await Promise.all([
      getMeetTeams(meetId),
      senderOf(meetId),
      // The meet's way of scoring level teams is the sheet's to take, not to wait for
      getStatsSettings(meetId).catch(() => null),
    ])
    return { teams, meetDivisions, sender, levelTeams: settings?.settings.levelTeams }
  }

  /**
   * Commit a link in one step: the meet, what was fetched of it, every slot's pick, and the
   * scheduled quiz with its copy, or none.
   */
  function commitLink(link: {
    meetId: number
    meetName: string
    teams: MeetTeam[]
    meetDivisions: string[]
    /** Undefined when who the user is there couldn't be told: what was known is kept */
    sender: Sender | null | undefined
    /** Undefined when the meet's settings couldn't be read: what was known is kept */
    levelTeams: PlacementFormula | undefined
    slots: (SlotSession | undefined)[]
    quizId: string | null
    scheduledQuiz: ScheduledQuizCopy | null
  }): void {
    const same = session.value?.meetId === link.meetId
    const known = same ? session.value!.sender : null
    quizEpoch++
    session.value = {
      meetId: link.meetId,
      meetName: link.meetName,
      slots: link.slots,
      teamList: link.teams,
      meetDivisions: link.meetDivisions,
      quizId: link.quizId,
      scheduledQuiz: link.scheduledQuiz,
      sender: link.sender === undefined ? known : link.sender,
      levelTeams: link.levelTeams ?? (same ? session.value!.levelTeams : undefined),
    }
    persist()
  }

  /** Forget the scheduled quiz and keep the meet and the picks */
  function unlinkQuiz(): void {
    if (!session.value) return
    session.value = { ...session.value, quizId: null, scheduledQuiz: null }
    persist()
  }

  /** Who the user is when sending to the meet, and the rooms they may send for */
  const sender = computed(() => session.value?.sender ?? null)

  /**
   * The pick of a roster team for a slot, its seats tied to the team's quizzers around the names
   * already there. Builds it only; committing it is the caller's.
   */
  function slotFor(team: MeetTeam, quizzers: MeetTeamQuizzer[], storeNames: string[]): SlotSession {
    return {
      teamId: team.id,
      dbLabel: teamLabel(team),
      dbLabelFull: teamLabelFull(team),
      quizzers: matchQuizzers(storeNames, quizzers),
    }
  }

  /** Pick a roster team for a slot. False when the pick wasn't made. */
  async function assignTeam(
    slotIdx: number,
    teamId: number,
    storeNames: string[],
  ): Promise<boolean> {
    if (!session.value) return false
    const team = session.value.teamList.find((t) => t.id === teamId)
    if (!team) return false

    const epoch = quizEpoch
    const before = session.value.slots[slotIdx]?.teamId
    const { quizzers } = await getTeamQuizzers(session.value.meetId, teamId)
    // The roster took a while to arrive: the meet may have been unlinked, another quiz begun, or
    // the slot given another team meanwhile
    // A slot re-seated with the same team, as dragging a quizzer does, still takes the pick
    if (!session.value || quizEpoch !== epoch || session.value.slots[slotIdx]?.teamId !== before) {
      return false
    }

    session.value.slots[slotIdx] = {
      teamId,
      dbLabel: teamLabel(team),
      dbLabelFull: teamLabelFull(team),
      quizzers: matchQuizzers(storeNames, quizzers),
    }
    // Trigger reactivity — slots is a plain array inside a ref
    session.value = { ...session.value, slots: [...session.value.slots] }
    persist()
    return true
  }

  /** Set a slot's pick, or with none clear it */
  function setSlot(slotIdx: number, slot: SlotSession | undefined): void {
    if (!session.value) return
    const slots = [...session.value.slots]
    slots[slotIdx] = slot
    session.value = { ...session.value, slots }
    persist()
  }

  /** Clear the team assignment for a slot */
  function clearSlot(slotIdx: number): void {
    setSlot(slotIdx, undefined)
  }

  /** Mirror a drag-reorder into the slot's quizzer array so divergence detection stays correct */
  function reorderSlotQuizzers(slotIdx: number, fromSeat: number, toSeat: number): void {
    if (fromSeat === toSeat) return
    const slot = session.value?.slots[slotIdx]
    if (!slot) return
    const quizzers = [...slot.quizzers]
    ;[quizzers[fromSeat]!, quizzers[toSeat]!] = [quizzers[toSeat]!, quizzers[fromSeat]!]
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

  /**
   * Tie a seat to the roster quizzer whose name was typed into it, when another seat of the team
   * holds that quizzer and doesn't bear the name itself: the two seats swap quizzers. So a team
   * seated in another order than the roster's can be typed in as it sits, with nothing left
   * disagreeing. A seat that bears its own quizzer's name keeps them, and the typed one stays a
   * disagreement, since one quizzer can't sit twice.
   */
  function relinkSeatByName(slotIdx: number, seatIdx: number, seatNames: string[]): void {
    const slot = session.value?.slots[slotIdx]
    const typed = seatNames[seatIdx]?.trim()
    if (!slot || !typed || slot.quizzers[seatIdx]?.dbName.trim() === typed) return
    const holder = slot.quizzers.findIndex(
      (quizzer, seat) => seat !== seatIdx && quizzer.dbName.trim() === typed,
    )
    if (holder === -1 || seatNames[holder]?.trim() === typed) return
    reorderSlotQuizzers(slotIdx, seatIdx, holder)
  }

  /** Whether a name diverges from the DB value (empty seats have dbName ''). */
  function isQuizzerDiverged(slotIdx: number, seatIdx: number, currentName: string): boolean {
    const slot = session.value?.slots[slotIdx]
    if (!slot) return false
    const dbName = slot.quizzers[seatIdx]?.dbName
    if (dbName === undefined) return false
    return currentName.trim() !== dbName.trim()
  }

  /**
   * The picked team's full name as the roster has it now. The slot keeps the name from when the
   * team was picked, but the roster is reloaded since and may have been corrected: a room types
   * the right name over a wrong one, and the meet's admin fixes the roster afterwards.
   */
  function pickedTeamName(slotIdx: number): string | undefined {
    const slot = session.value?.slots[slotIdx]
    if (!slot) return undefined
    const team = session.value?.teamList.find((t) => t.id === slot.teamId)
    return team ? teamLabelFull(team) : slot.dbLabelFull
  }

  /**
   * Whether a slot's typed name was edited away from the team picked for it. Only the full label
   * counts as the team's own name: it's the typed name that is submitted, and the short label
   * would be recorded as another team. Case and spacing don't tell teams apart anywhere else.
   */
  function isTeamNameDiverged(slotIdx: number, currentName: string): boolean {
    const pickedName = pickedTeamName(slotIdx)
    if (pickedName === undefined) return false
    return foldName(currentName) !== foldName(pickedName)
  }

  function getDbName(slotIdx: number, seatIdx: number): string | undefined {
    return session.value?.slots[slotIdx]?.quizzers[seatIdx]?.dbName
  }

  /** Start the next quiz in the same meet: forget this quiz's teams, keep the meet */
  function startNewQuiz(): void {
    if (!session.value) return
    quizEpoch++
    session.value = {
      ...session.value,
      slots: [undefined, undefined, undefined],
      quizId: null,
      scheduledQuiz: null,
    }
    persist()
  }

  /** Disconnect from meet — called by Unlink meet and sign-out */
  function clearSession(): void {
    quizEpoch++
    session.value = null
    persist()
  }

  /** The link as it stands, to put back later with restoreSession */
  function currentLink(): MeetSessionData | null {
    return session.value
  }

  /** Put back a link kept with a quiz (or clear it, for null) */
  function restoreSession(data: MeetSessionData | null): void {
    quizEpoch++
    session.value = data
    persist()
  }

  /**
   * Fetch afresh what the meet gives the sheet: its teams, divisions and who the user is there,
   * and the linked scheduled quiz. Only the copies are renewed; picks and the sheet are the
   * caller's. False when the meet couldn't be reached, which leaves the copies held as they were;
   * also when `stillWanted` says the fetch was given up on, and what it brought is dropped.
   */
  async function refresh(stillWanted: () => boolean = () => true): Promise<boolean> {
    if (!session.value) return false
    // Captured at call time: a link or a new quiz made while this waits must not be written over
    // with what was fetched for the meet and the quiz before it
    const { meetId: fetchedMeetId, quizId: fetchedQuizId, scheduledQuiz: held } = session.value
    try {
      const [{ teams, meetDivisions }, sender, settings, scheduled] = await Promise.all([
        getMeetTeams(fetchedMeetId),
        senderOf(fetchedMeetId),
        getStatsSettings(fetchedMeetId).catch(() => null),
        // The schedule failing leaves its copy held; the roster is still renewed
        fetchedQuizId === null
          ? null
          : scheduledQuizNow(fetchedMeetId, fetchedQuizId, held).catch(() => null),
      ])
      if (!stillWanted()) return false
      if (!session.value || session.value.meetId !== fetchedMeetId) return false
      const sameQuiz = session.value.quizId === fetchedQuizId
      session.value = {
        ...session.value,
        teamList: teams,
        meetDivisions,
        sender: sender === undefined ? session.value.sender : sender,
        levelTeams: settings?.settings.levelTeams ?? session.value.levelTeams,
        ...(sameQuiz && scheduled ? { scheduledQuiz: scheduled } : {}),
      }
      persist()
      return true
    } catch {
      // Offline or the session has ended: what is held stays usable
      return false
    }
  }

  /** Two team slots' picks change places, as their teams do on the sheet */
  function swapSlots(slotA: number, slotB: number): void {
    if (!session.value || slotA === slotB) return
    // A pick still waiting on its roster was made for a slot whose team has just moved
    quizEpoch++
    const slots = [...session.value.slots]
    ;[slots[slotA], slots[slotB]] = [slots[slotB], slots[slotA]]
    session.value = { ...session.value, slots }
    persist()
  }

  /** The scheduled quiz the sheet is linked to, said only to the meet it is linked to */
  function scheduleQuizIdFor(targetMeetId: number): string | null {
    return meetId.value === targetMeetId ? quizId.value : null
  }

  return {
    isActive,
    meetId,
    sender,
    levelTeams,
    meetName,
    teamList,
    quizId,
    scheduleQuizIdFor,
    scheduledQuiz,
    divisionOptions,
    lacksDivision,
    teamsForDivision,
    teamLabel,
    teamLabelFull,
    loadMeet,
    fetchMeet,
    commitLink,
    slotFor,
    scheduledQuizCopy,
    unlinkQuiz,
    swapSlots,
    assignTeam,
    setSlot,
    clearSlot,
    getSlot,
    reorderSlotQuizzers,
    relinkSeatByName,
    isQuizzerDiverged,
    pickedTeamName,
    isTeamNameDiverged,
    getDbName,
    clearSession,
    currentLink,
    startNewQuiz,
    restoreSession,
    refresh,
  }
}

/** The copy of a scheduled quiz the session keeps: what the sheet's quiz is compared with */
function scheduledQuizCopy(details: ScheduledQuizDetails): ScheduledQuizCopy {
  const seats: (number | null)[] = [null, null, null]
  for (const seat of details.seats) {
    if (seat.seatNumber >= 1 && seat.seatNumber <= 3)
      seats[seat.seatNumber - 1] = seat.team?.id ?? null
  }
  const { label, division, consolation, quizNumber } = details.quiz
  return { label, division, consolation, quizNumber, seats, inSchedule: true }
}

/**
 * A scheduled quiz the published schedule no longer has: the copy held, if any, marked as gone. It
 * stays linked, so the sheet can say so, but is held against nothing.
 */
export function scheduledQuizGone(held: ScheduledQuizCopy | null | undefined): ScheduledQuizCopy {
  return {
    ...(held ?? { label: '', division: '', consolation: false, quizNumber: '', seats: [] }),
    inSchedule: false,
  }
}

/** The linked scheduled quiz as the published schedule has it now. Rosters aren't kept, so not fetched */
async function scheduledQuizNow(
  meetId: number,
  quizId: string,
  held: ScheduledQuizCopy | null | undefined,
): Promise<ScheduledQuizCopy> {
  const details = await getScheduledQuiz(meetId, quizId, { rosters: false })
  return details ? scheduledQuizCopy(details) : scheduledQuizGone(held)
}

/** How many typed quizzers must be on a team's roster before a misspelt name is taken for it */
const QUIZZERS_TO_CONFIRM = 2

/**
 * The roster team a typed name names outright, by its full name before its short one, and as
 * written before punctuation is set aside, as the meet matches names on its side. The first listed
 * wins, so list the likelier teams first.
 */
export function teamNamed(
  typedName: string,
  teams: { id: number; name: string; shortName: string }[],
): number | undefined {
  return rosterTeamNamed(typedName, teams)?.id
}

/**
 * The roster teams whose name, full or short, is a typo away from the typed one. Often more than
 * one: a church's second team is a single edit from its first, so the name alone never settles
 * which is meant.
 */
export function teamsNearName(
  typedName: string,
  teams: { id: number; name: string; shortName: string }[],
): number[] {
  return rosterTeamsNearName(typedName, teams).map((team) => team.id)
}

/**
 * Whether the typed quizzers show a misspelt team name to be this roster's team. Stricter than
 * seating a picked team's quizzers: a name that matches no team exactly is more likely a team the
 * roster lacks than a typo, so every typed quizzer has to be on the roster by full name, and at least two of them.
 */
export function quizzersConfirmTeam(typedQuizzers: string[], rosterQuizzers: string[]): boolean {
  // A set, so one quizzer typed into two seats doesn't count twice
  const typed = new Set(typedQuizzers.map(foldName).filter((name) => name !== ''))
  const roster = new Set(rosterQuizzers.map(foldName))
  return typed.size >= QUIZZERS_TO_CONFIRM && [...typed].every((name) => roster.has(name))
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
    let bestDist = editDistance(storeNames[i]!.toLowerCase(), pool[0]!.name.toLowerCase())
    for (let k = 1; k < pool.length; k++) {
      const d = editDistance(storeNames[i]!.toLowerCase(), pool[k]!.name.toLowerCase())
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

function persist() {
  setTabLink(session.value)
}
