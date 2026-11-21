<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  anyTeamHasAnswer,
  ApiError,
  BLANK_IN_FILE_NAME,
  CellValue,
  deserialize,
  divisionTitle,
  endsRound,
  fillOts,
  firstOvertimeQuestion,
  foldName,
  lastQuestionThroughRound,
  FOULS_TO_FOUL_OUT,
  MeetRole,
  NewerFileVersionError,
  ODS_TWENTY_ONLY,
  odsSupportsFormat,
  parseQuizFile,
  parseQuizFileAttempt,
  quizFileStem,
  quizName,
  readOds,
  resultKey,
  sameDivision,
  scheduleQuizMeta,
  QuestionCategory,
  QuestionType,
  QuizFormat,
  QUIZZERS_PER_TEAM,
  startsOtRound,
  ValidationCode,
  validationMessage,
  type DeserializeResult,
  type QuizFile,
} from '@qzr/shared'
import { useScoresheet } from '../composables/useScoresheet'
import { useCellSelector } from '../composables/useCellSelector'
import { useKeyboardNav } from '../composables/useKeyboardNav'
import { useDragReorder } from '../composables/useDragReorder'
import { useTheme } from '../composables/useTheme'
import { canonicalQuizFile, serializeStore, storeToQuizFile } from '../persistence/quizFile'
import {
  saveQuizToFile,
  openAnyQuizFile,
  confirmAction,
  exportOdsFile,
  openOtsTemplate,
} from '../persistence/fileIO'
import {
  getMeetName,
  getPublishedSchedule,
  getRevision,
  getScheduledQuiz,
  getStoredQuizzes,
  getTeamQuizzers,
  joinMeet,
  joinMeetGuest,
  type MeetSummary,
  type MeetTeam,
  type MeetTeamQuizzer,
  type ScheduledQuizDetails,
  type PublishedSchedule,
  type StoredQuiz,
  getMeetTemplate,
} from '../api'
import { teamsByName } from '../meetTeams'
import {
  ChoiceDialog,
  RoomCodeDialog,
  askAlreadySubmitted,
  chooseRoom,
  guestStateRef,
  joinedSession,
  sessionLabel,
  upgradeOnSignIn,
  withRoomCode,
  type OnExisting,
  type RoomCodeOptions,
  type Sender,
  DivisionInput,
  type HistoryCommand,
} from '@qzr/ui'
import { useAuth } from '../composables/useAuth'
import {
  quizzersConfirmTeam,
  teamNamed,
  teamsNearName,
  useMeetSession,
  scheduledQuizGone,
  type ScheduledQuizCopy,
  type SlotSession,
} from '../composables/useMeetSession'
import { renewedSenderOf, useSubmitToMeet } from '../composables/useSubmitToMeet'
import { useTeamNames } from '../composables/useTeamNames'
import { useTutorial } from '../composables/useTutorial'
import MeetPickerDialog from './MeetPickerDialog.vue'
import MeetWarningsDialog, { type MeetWarning } from './MeetWarningsDialog.vue'
import StoredQuizPickerDialog from './StoredQuizPickerDialog.vue'
import RecentQuizzesDialog from './RecentQuizzesDialog.vue'
import {
  findMatch,
  startNotes,
  takeDropped,
  type Opened,
  type QuizRecord,
  type RecordClaim,
  type StateKind,
} from '../persistence/autoSave'
import SchedulePickerDialog from './SchedulePickerDialog.vue'
import SignInWidget from './SignInWidget.vue'
import TutorialOverlay from './TutorialOverlay.vue'
import { portalLink } from '../portalLink'

const { theme, toggleTheme } = useTheme()

const meetSession = useMeetSession()
const meetPickerRef = ref<InstanceType<typeof MeetPickerDialog> | null>(null)
const schedulePickerRef = ref<InstanceType<typeof SchedulePickerDialog> | null>(null)
const storedPickerRef = ref<InstanceType<typeof StoredQuizPickerDialog> | null>(null)
const recentRef = ref<InstanceType<typeof RecentQuizzesDialog> | null>(null)
const warningsDialogRef = ref<InstanceType<typeof MeetWarningsDialog> | null>(null)
const waitingDialogRef = ref<HTMLDialogElement | null>(null)
const openPickerSlot = ref<number | null>(null)
const pickerPos = ref({ top: 0, left: 0 })

function toggleTeamPicker(teamIdx: number, event: MouseEvent) {
  if (openPickerSlot.value === teamIdx) {
    openPickerSlot.value = null
    return
  }
  const trigger = event.currentTarget as HTMLElement
  const rect = (trigger.closest('.name-main') ?? trigger).getBoundingClientRect()
  pickerPos.value = { top: rect.bottom + 4, left: rect.left }
  openPickerSlot.value = teamIdx
}

function pickFromOpenPicker(teamId: number) {
  if (openPickerSlot.value !== null) pickTeam(openPickerSlot.value, teamId)
}

onMounted(() => {
  // The quiz takes the meet's scoring when linked and before it is sent, not here: a quiz opened
  // from a link only to look at keeps the way it was scored
  void meetSession.refresh()
  void loadFromUrlParams()
  const { offer, waiting, dropped } = startNotes()
  if (offer.length > 0) recentRef.value?.offer(offer)
  waitingQuizzes.value = waiting
  droppedQuizzes.value = dropped
})

// ---- Recent quizzes ----

/** Unsaved quizzes from closed tabs, said on a tab opened by a link, which offers none */
const waitingQuizzes = ref(0)
/** Unsaved quizzes dropped to stay within the limits, named once */
const droppedQuizzes = ref<string[]>([])

function seeRecentQuizzes() {
  waitingQuizzes.value = 0
  void listRecentQuizzes()
}

/** List the recent quizzes, and name the unsaved ones the limits dropped since they were last named */
async function listRecentQuizzes() {
  void recentRef.value?.list()
  droppedQuizzes.value = [...droppedQuizzes.value, ...(await takeDropped())]
}

function openRecentQuizzes() {
  closeMenus()
  void listRecentQuizzes()
}

/** A recent quiz the tab has claimed replaces the one it shows, which goes to the recent quizzes */
function restoreRecent(record: QuizRecord, claim: RecordClaim, state: StateKind) {
  meetSession.restoreSession(restoreQuiz(record, claim, state))
}

/** A newer version's quiz opens as a copy, read as well as this version can; it stays listed */
async function openNewerRecent(record: QuizRecord): Promise<boolean> {
  if (!(await confirmAction(TRY_NEWER_PROMPT))) return false
  try {
    const data = parseQuizFileAttempt(record.newerRaw!)
    replaceQuiz()
    loadFile(data, { fromNewerFile: true })
    meetSession.restoreSession(record.link)
    return true
  } catch (e) {
    alert(`Failed to open the quiz: ${e instanceof Error ? e.message : e}`)
    return false
  }
}

/** An Open matched a quiz open in another tab, and opened as a separate one */
const openedElsewhere = ref(false)

/**
 * Show an opened quiz: as the recent quiz it came from, continued in the matched state with its link
 * and history, or else as a new quiz. True when it continued a recent quiz.
 */
async function showOpened(
  data: DeserializeResult,
  { fromNewerFile = false, fromMeet }: { fromNewerFile?: boolean; fromMeet?: Opened['fromMeet'] },
): Promise<boolean> {
  const match = await findMatch({ file: canonicalQuizFile(data), fromMeet })
  openedElsewhere.value = match === 'held'
  if (match && match !== 'held') {
    restoreRecent(match.record, match.claim, match.state)
    return true
  }
  replaceQuiz()
  loadFile(data, { fromNewerFile })
  return false
}

// ---- Waiting on the meet ----

/** What the sheet is waiting on the meet for, while it is; null otherwise */
const waitingFor = ref<string | null>(null)
let waitTurn = 0

/**
 * Wait on the meet for something the official asked for, named as what the sheet is doing
 * ("Starting the quiz"). Until it arrives the sheet takes nothing but Cancel. Undefined when it was
 * cancelled or the meet couldn't be reached, which is said; either way nothing has changed, since
 * callers apply what arrives only once it has.
 */
async function waitOnMeet<T>(
  what: string,
  fetch: (stillWanted: () => boolean) => Promise<T>,
): Promise<{ arrived: T } | undefined> {
  const turn = ++waitTurn
  const stillWanted = () => turn === waitTurn
  waitingFor.value = what
  try {
    const arrived = await fetch(stillWanted)
    return stillWanted() ? { arrived } : undefined
  } catch (e) {
    if (stillWanted()) alert(`${what} didn't finish: ${outOfReach(e)}`)
    return undefined
  } finally {
    if (stillWanted()) waitingFor.value = null
  }
}

/** Give up on what the sheet is waiting for: it arrives to nobody, and the sheet is as it was */
function cancelWaiting() {
  waitTurn++
  waitingFor.value = null
}

/** Why a request failed, as the official is told: the server's own reason, or that there was none */
function outOfReach(e: unknown): string {
  return e instanceof ApiError || !(e instanceof TypeError)
    ? (e as Error).message
    : "the meet can't be reached"
}

// ---- Linking ----

/** The names and numbers a link is worked out from: the sheet's, or a quiz's about to be on it */
interface SheetNames {
  division: string
  consolation: boolean
  quizNumber: string
  /** In slot order, each with its quizzers in seat order */
  teams: { name: string; quizzers: string[] }[]
  /** The picks made for these names, when it is the sheet as it stands; a quiz new to it has none */
  picks?: (SlotSession | undefined)[]
}

const BLANK_SHEET: SheetNames = { division: '', consolation: false, quizNumber: '', teams: [] }

function sheetOf(data: Pick<DeserializeResult, 'quiz' | 'teams' | 'quizzers'>): SheetNames {
  const bySeat = <T extends { seatOrder: number }>(a: T, b: T) => a.seatOrder - b.seatOrder
  return {
    division: data.quiz.division,
    consolation: data.quiz.consolation ?? false,
    quizNumber: data.quiz.quizNumber,
    teams: [...data.teams].sort(bySeat).map((team) => ({
      name: team.name,
      quizzers: data.quizzers
        .filter((quizzer) => quizzer.teamId === team.id)
        .sort(bySeat)
        .map((quizzer) => quizzer.name),
    })),
  }
}

function sheetNow(): SheetNames {
  return {
    ...sheetOf({ quiz: quiz.value, teams: store.teams, quizzers: store.quizzers }),
    picks: [0, 1, 2].map((slotIdx) => meetSession.getSlot(slotIdx)),
  }
}

/** What to link: a meet, and one of its scheduled quizzes or none */
interface LinkTarget {
  meetId: number
  /** Needed only when no scheduled quiz is there to give it */
  meetName?: string
  quizId: string | null
}

const NOT_IN_SCHEDULE = "this quiz isn't in the meet's published schedule"

/** A link worked out and not yet made: everything `applyLink` writes, and nothing fetched after */
interface LinkPlan {
  meetId: number
  meetName: string
  meet: Awaited<ReturnType<typeof meetSession.fetchMeet>>
  quizId: string | null
  scheduledQuiz: ScheduledQuizCopy | null
  slots: (SlotSession | undefined)[]
  /** The blanks the scheduled quiz fills */
  quiz: { division?: string; consolation?: boolean; quizNumber?: string }
  /** Per slot picked: the team's name where it is taken, and the quizzer for each blank seat */
  names: { slotIdx: number; teamName?: string; seats: (string | undefined)[] }[]
}

/**
 * Work out a link of `sheet` to a meet or one of its scheduled quizzes, fetching what it needs
 * and changing nothing. This is the one place that decides what linking does:
 *
 * - a slot the sheet has picked against the same meet keeps its pick;
 * - a slot with a name is picked as the roster team the name names, and never as the schedule's;
 * - a blank slot takes the team the scheduled quiz seats there, unless it is on the sheet already;
 * - a blank division, with its consolation flag, and a blank quiz number take the schedule's;
 * - blank seats of a newly picked team take its roster's quizzers.
 *
 * Nothing typed or scored is touched. New from schedule, opening a stored quiz and the refresh
 * symbol are all this, over a blank sheet, an opened file, and the sheet as it is. What a caller
 * has fetched already, the scheduled quiz or the published schedule, isn't fetched again.
 */
async function planLink(
  target: LinkTarget,
  sheet: SheetNames,
  known: { scheduled?: ScheduledQuizDetails | null; schedule?: PublishedSchedule } = {},
): Promise<LinkPlan> {
  const { meetId, quizId } = target
  const sameMeet = meetSession.meetId.value === meetId
  const nameKnown = target.meetName || (sameMeet ? meetSession.meetName.value : null) || undefined
  const [meet, scheduled, nameFetched] = await Promise.all([
    meetSession.fetchMeet(meetId),
    quizId === null
      ? null
      : known.scheduled !== undefined
        ? known.scheduled
        : getScheduledQuiz(meetId, quizId, { schedule: known.schedule }),
    quizId === null && !nameKnown ? getMeetName(meetId) : null,
  ])
  // A quiz the schedule has dropped can stay linked, marked as gone, but can't be linked anew
  const linkedToIt = sameMeet && quizId !== null && meetSession.quizId.value === quizId
  const held = linkedToIt ? meetSession.scheduledQuiz.value : null
  if (quizId !== null && !scheduled && !linkedToIt) throw new Error(NOT_IN_SCHEDULE)
  const meetName =
    scheduled?.quiz.meetName ??
    nameKnown ??
    nameFetched?.meet.name ??
    (await getMeetName(meetId)).meet.name

  const fill: LinkPlan['quiz'] = {}
  let division = given(sheet.division)
  let consolation = sheet.consolation
  if (!division && scheduled) {
    division = fill.division = scheduled.quiz.division
    consolation = fill.consolation = scheduled.quiz.consolation
  }
  if (!given(sheet.quizNumber) && scheduled) fill.quizNumber = scheduled.quiz.quizNumber
  // The division a lone-division meet will give the quiz once it is linked
  if (!division && meet.meetDivisions.length === 1) division = meet.meetDivisions[0]!
  const inDivision = meet.teams.filter(
    (team) => team.division === division && team.consolation === consolation,
  )

  const slots: (SlotSession | undefined)[] =
    sameMeet && sheet.picks ? [...sheet.picks] : [undefined, undefined, undefined]
  /** A slot's candidates: teams no other slot has taken */
  const freeFor = (slotIdx: number, teams: MeetTeam[]) =>
    teamsByName(
      teams.filter((team) => !slots.some((slot, i) => i !== slotIdx && slot?.teamId === team.id)),
    )
  const typedOf = (slotIdx: number) => sheet.teams[slotIdx]?.name ?? ''
  const seatedIn = (slotIdx: number) =>
    scheduled?.seats.find((seat) => seat.seatNumber === slotIdx + 1)?.team ?? undefined

  // Every roster a slot could need, fetched together rather than slot by slot
  const rosters = new Map<number, MeetTeamQuizzer[]>()
  for (const seat of scheduled?.seats ?? []) {
    if (seat.team && seat.quizzers.length > 0) rosters.set(seat.team.id, seat.quizzers)
  }
  // A kept pick is seated again from its roster as it now is, so a name fixed there reaches it
  const wanted = new Set<number>(
    slots.flatMap((slot) => (slot && !rosters.has(slot.teamId) ? [slot.teamId] : [])),
  )
  for (let slotIdx = 0; slotIdx < 3; slotIdx++) {
    if (slots[slotIdx]) continue
    const typed = typedOf(slotIdx)
    const named = typed.trim()
      ? (teamNamed(typed, teamsByName(inDivision)) ?? teamNamed(typed, teamsByName(meet.teams)))
      : undefined
    // A misspelt name's near teams only when the name names none outright that is free to take
    const heldElsewhere = slots.some((slot, i) => i !== slotIdx && slot?.teamId === named)
    const ids = !typed.trim()
      ? [seatedIn(slotIdx)?.id]
      : named !== undefined && !heldElsewhere
        ? [named]
        : teamsNearName(typed, teamsByName(inDivision))
    for (const id of ids) if (id !== undefined && !rosters.has(id)) wanted.add(id)
  }
  // A roster that can't be had leaves its team unpicked, or a kept pick as it was, not the link
  const unavailable = new Set<number>()
  await Promise.all(
    [...wanted].map((id) =>
      getTeamQuizzers(meetId, id).then(
        ({ quizzers }) => rosters.set(id, quizzers),
        () => unavailable.add(id),
      ),
    ),
  )
  const rosterOf = (teamId: number) => rosters.get(teamId) ?? []

  /** The roster team a typed name names, and whether the slot takes the roster's name for it */
  const teamForTyped = (slotIdx: number, typed: string, seatNames: string[]) => {
    // The quiz's division is looked in first, since two divisions can each have a team of that
    // name; the rest of the meet only after, where a match shows up flagged as out of its division
    const named = teamNamed(typed, freeFor(slotIdx, inDivision))
    if (named !== undefined) return { teamId: named, takeName: true }
    // The division has a team of this name and another slot holds it. A name typed twice is a
    // slip, not a call for another division's namesake: leave it to the misspelt-name path
    if (teamNamed(typed, teamsByName(inDivision)) === undefined) {
      const elsewhere = teamNamed(typed, freeFor(slotIdx, meet.teams))
      if (elsewhere !== undefined) return { teamId: elsewhere, takeName: true }
    }
    // The name stays as typed, flagged against the roster's, since the roster may be wrong
    return { teamId: misspeltTeam(typed, seatNames, freeFor(slotIdx, inDivision), rosterOf) }
  }
  /** The team the schedule seats in a blank slot, unless it is on the sheet already */
  const teamForBlank = (slotIdx: number) => {
    const seated = seatedIn(slotIdx)
    const onSheet =
      seated &&
      (slots.some((slot) => slot?.teamId === seated.id) ||
        sheet.teams.some((team) => teamNamed(team.name, teamsByName([seated])) !== undefined))
    return { teamId: seated && !onSheet ? seated.id : undefined, takeName: true }
  }

  slots.forEach((slot, slotIdx) => {
    if (!slot) return
    const team = meet.teams.find((candidate) => candidate.id === slot.teamId)
    // A team the roster no longer has can't stay picked: the slot is held by its name again
    if (!team) {
      slots[slotIdx] = undefined
      return
    }
    if (unavailable.has(team.id)) return
    slots[slotIdx] = meetSession.slotFor(
      team,
      rosterOf(team.id),
      sheet.teams[slotIdx]?.quizzers ?? [],
    )
  })

  const names: LinkPlan['names'] = []
  for (let slotIdx = 0; slotIdx < 3; slotIdx++) {
    if (slots[slotIdx]) continue
    const typed = typedOf(slotIdx)
    const seatNames = sheet.teams[slotIdx]?.quizzers ?? []
    const { teamId, takeName } = typed.trim()
      ? teamForTyped(slotIdx, typed, seatNames)
      : teamForBlank(slotIdx)
    const team = meet.teams.find((candidate) => candidate.id === teamId)
    if (!team || unavailable.has(team.id)) continue
    const slot = meetSession.slotFor(team, rosterOf(team.id), seatNames)
    slots[slotIdx] = slot
    names.push({
      slotIdx,
      teamName: takeName ? slot.dbLabelFull : undefined,
      seats: slot.quizzers.map((quizzer, seatIdx) =>
        seatNames[seatIdx]?.trim() ? undefined : quizzer.dbName,
      ),
    })
  }

  return {
    meetId,
    meetName,
    meet,
    quizId,
    scheduledQuiz: scheduled
      ? meetSession.scheduledQuizCopy(scheduled)
      : linkedToIt
        ? scheduledQuizGone(held)
        : null,
    slots,
    quiz: fill,
    names,
  }
}

/**
 * The roster team a typed name misspells, when the typed quizzers bear it out. The name only
 * shortlists teams, since a church's teams are an edit apart; the quizzers say which one, and it
 * is taken only if they say exactly one.
 */
function misspeltTeam(
  typedName: string,
  typedQuizzers: string[],
  candidates: ReturnType<typeof teamsByName>,
  rosterOf: (teamId: number) => MeetTeamQuizzer[],
): number | undefined {
  const confirmed = teamsNearName(typedName, candidates).filter((teamId) =>
    quizzersConfirmTeam(
      typedQuizzers,
      rosterOf(teamId).map((quizzer) => quizzer.name),
    ),
  )
  return confirmed.length === 1 ? confirmed[0] : undefined
}

/**
 * A quiz worked on with the meet scores level teams the meet's way (FR-023b), as the session
 * knows it once a link is committed; a sheet that couldn't read it keeps its own
 */
function takeMeetScoring() {
  const levelTeams = meetSession.levelTeams.value
  if (levelTeams === undefined || quiz.value.placementFormula === levelTeams) return
  // A change the sheet makes, so undone like the rest once something was done by hand
  editBySheet(() => (quiz.value.placementFormula = levelTeams))
}

/** Make a link that `planLink` worked out, in one step */
function applyLink(plan: LinkPlan) {
  meetSession.commitLink({
    meetId: plan.meetId,
    meetName: plan.meetName,
    ...plan.meet,
    slots: plan.slots,
    quizId: plan.quizId,
    scheduledQuiz: plan.scheduledQuiz,
  })
  // Names a link fills in on a quiz with nothing done by hand are its start, not an edit
  editBySheet(() => {
    takeMeetScoring()
    if (plan.quiz.division !== undefined) quiz.value.division = plan.quiz.division
    if (plan.quiz.consolation !== undefined) quiz.value.consolation = plan.quiz.consolation
    if (plan.quiz.quizNumber !== undefined) quiz.value.quizNumber = plan.quiz.quizNumber
    for (const { slotIdx, teamName, seats } of plan.names) {
      if (teamName !== undefined) setTeamName(slotIdx, teamName)
      seats.forEach((name, seatIdx) => {
        if (name !== undefined) setQuizzerName(slotIdx, seatIdx, name)
      })
    }
  })
}

/** Link what is on the sheet. False when it was cancelled or the meet was out of reach. */
async function linkTo(target: LinkTarget): Promise<boolean> {
  const plan = await waitOnMeet('Linking the meet', () => planLink(target, sheetNow()))
  if (plan) applyLink(plan.arrived)
  return plan !== undefined
}

/** Link a meet; the same meet again keeps its scheduled quiz, which is how a link is refreshed */
function linkMeet(meetId: number, meetName: string) {
  const quizId = meetSession.meetId.value === meetId ? meetSession.quizId.value : null
  return linkTo({ meetId, meetName, quizId })
}

/** Fetch the meet afresh and link again what is linked: the refresh symbol */
function doRefreshLink() {
  closeMenus()
  const meetId = meetSession.meetId.value
  if (meetId !== null) void linkMeet(meetId, meetSession.meetName.value ?? '')
}

function linkPickedMeet(meet: MeetSummary) {
  void linkMeet(meet.meetId, meet.meetName)
}

async function openPickedStored(meetId: number, meetName: string, quizFile: QuizFile) {
  return openStored(meetId, quizFile, { meetName })
}

function doUnlinkQuiz() {
  closeMenus()
  meetSession.unlinkQuiz()
}

/** What the linked display calls the scheduled quiz; a link kept from before copies has no label */
const linkedQuizLabel = computed(() =>
  meetSession.quizId.value === null
    ? ''
    : meetSession.scheduledQuiz.value?.label || 'scheduled quiz',
)

// The waiting dialog is modal, so that it sits above the pickers a wait is started from and
// nothing behind it can be reached
watch(waitingFor, (what) => {
  const dialog = waitingDialogRef.value
  if (!dialog) return
  if (what === null) dialog.close?.()
  else if (!dialog.open) dialog.showModal?.()
})

// ---- New from schedule, and opening what the meet holds ----

/** The stored quiz that is a scheduled quiz: the one sharing its name, as the meet stores quizzes */
function storedFor(
  stored: StoredQuiz[],
  scheduled: Parameters<typeof resultKey>[0] | null,
): StoredQuiz | undefined {
  if (!scheduled) return undefined
  const key = resultKey(scheduled)
  return stored.find((candidate) => resultKey(candidate.quizFile.quiz) === key)
}

/**
 * The scheduled quiz a stored quiz is, by the name they share, with the schedule it was found in;
 * null when the meet has no published schedule or it has no such quiz
 */
async function scheduleEntryOf(
  meetId: number,
  stored: QuizFile['quiz'],
): Promise<{ quizId: string; schedule: PublishedSchedule } | null> {
  let schedule: PublishedSchedule
  try {
    schedule = await getPublishedSchedule(meetId)
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null
    throw e
  }
  const key = resultKey(stored)
  const quizId = schedule.document.quizzes.find((q) => resultKey(scheduleQuizMeta(q)) === key)?.id
  return quizId === undefined ? null : { quizId, schedule }
}

/**
 * Start a scheduled quiz on a blank sheet, linked to it, as the portal's schedule links do too.
 * Asks first when the meet already holds a result for it. Nothing changes
 * until the schedule has arrived.
 */
async function startScheduled(meetId: number, quizId: string): Promise<boolean> {
  const fetched = await waitOnMeet('Starting the quiz', async () => {
    const [plan, stored] = await Promise.all([
      planLink({ meetId, quizId }, BLANK_SHEET),
      // A list that can't be had, refused or out of reach, leaves nothing to ask about: the quiz
      // starts, and sending it meets the meet's own "already submitted" question
      getStoredQuizzes(meetId).catch(() => []),
    ])
    return { plan, stored: storedFor(stored, plan.scheduledQuiz) }
  })
  if (!fetched) return false
  const { plan, stored } = fetched.arrived
  if (stored) {
    const choice = await choiceDialog.value?.ask(
      `${quizName(stored.quizFile.quiz)} already has a result`,
      'The meet holds a stored result for this quiz.',
      [
        { label: 'Open it', value: 'open', primary: true },
        { label: 'Start a new one', value: 'new' },
        { label: 'Cancel', value: null },
      ],
    )
    if (!choice) return false
    if (choice === 'open') return openStored(meetId, stored.quizFile, { quizId })
  }
  replaceQuiz()
  resetStore(QuizFormat.TwentyQuestion)
  applyLink(plan)
  return true
}

/**
 * Open a quiz the meet holds, exactly as if its file had been opened and then linked: to the
 * meet, and to its scheduled quiz when it has one. Nothing changes until the meet has answered;
 * the quiz it replaces then goes to the recent quizzes.
 */
async function openStored(
  meetId: number,
  quizFile: QuizFile,
  {
    meetName,
    quizId,
    scheduled,
  }: { meetName?: string; quizId?: string; scheduled?: ScheduledQuizDetails } = {},
): Promise<boolean> {
  let opened: Awaited<ReturnType<typeof parseForOpen>>
  try {
    opened = await parseForOpen(JSON.stringify(quizFile))
  } catch (e) {
    alert(`Could not open the quiz from the meet: ${(e as Error).message}`)
    return false
  }
  if (!opened) return false
  const { data, fromNewerFile } = opened
  const plan = await waitOnMeet('Opening the quiz', async () => {
    if (quizId !== undefined)
      return planLink({ meetId, meetName, quizId }, sheetOf(data), { scheduled })
    const entry = await scheduleEntryOf(meetId, quizFile.quiz)
    return planLink({ meetId, meetName, quizId: entry?.quizId ?? null }, sheetOf(data), {
      schedule: entry?.schedule,
    })
  })
  if (!plan) return false
  const fromMeet = { meetId, quizId: plan.arrived.quizId }
  await showOpened(data, { fromNewerFile, fromMeet })
  applyLink(plan.arrived)
  // Opened as the meet holds it: as submitted, to the scheduled quiz it is linked to
  markSubmitted(meetId, meetSession.quizId.value)
  return true
}

/** Open the stored quiz of a scheduled quiz; with none stored, offer to start it instead */
async function openFromSchedule(meetId: number, quizId: string): Promise<boolean> {
  const found = await waitOnMeet('Opening the quiz', async () => {
    const [scheduled, stored] = await Promise.all([
      getScheduledQuiz(meetId, quizId),
      // Refused, there is nothing stored that this user can open: the quiz can still be started
      getStoredQuizzes(meetId).catch((e) => {
        if (e instanceof ApiError && e.status === 403) return []
        throw e
      }),
    ])
    if (!scheduled) throw new Error(NOT_IN_SCHEDULE)
    return { scheduled, stored: storedFor(stored, scheduled.quiz) }
  })
  if (!found) return false
  const { scheduled, stored } = found.arrived
  if (stored) return openStored(meetId, stored.quizFile, { quizId, scheduled })
  const startIt = await choiceDialog.value?.ask(
    `Nothing is stored for ${scheduled.quiz.label}`,
    'The meet holds no result for this quiz that you can open.',
    [
      { label: 'Start it as a new quiz', value: true, primary: true },
      { label: 'Cancel', value: null },
    ],
  )
  return startIt ? startScheduled(meetId, quizId) : false
}

/** Open one version of a stored quiz: what the portal's stored quiz links do */
async function openStoredVersion(meetId: number, resultId: number, revision: number) {
  const fetched = await waitOnMeet('Opening the quiz', () =>
    getRevision(meetId, resultId, revision),
  )
  if (fetched) await openStored(meetId, fetched.arrived.quizFile)
}

/** Open what a portal link names, then take the link off the address so a reload doesn't open it again */
async function loadFromUrlParams() {
  const link = portalLink(window.location.search)
  if (!link) return
  try {
    if ('quizId' in link) await startScheduled(link.meetId, link.quizId)
    else await openStoredVersion(link.meetId, link.resultId, link.revision)
  } finally {
    history.replaceState(null, '', window.location.pathname)
  }
}

function openMeetPicker() {
  closeMenus()
  meetPickerRef.value?.open()
}

function openStoredPicker() {
  closeMenus()
  storedPickerRef.value?.open()
}

/** What picking a quiz in the schedule picker does, set by the menu item that opened it */
const SCHEDULE_PICKS = {
  new: { title: 'New from schedule', pick: startScheduled },
  open: { title: 'Open from the schedule', pick: openFromSchedule },
  link: {
    title: 'Link a scheduled quiz',
    pick: (meetId: number, quizId: string) => linkTo({ meetId, quizId }),
  },
}
const schedulePickUse = ref<keyof typeof SCHEDULE_PICKS>('new')

function openSchedulePicker(use: keyof typeof SCHEDULE_PICKS) {
  closeMenus()
  schedulePickUse.value = use
  schedulePickerRef.value?.open()
}

function pickScheduledQuiz(meetId: number, quizId: string): Promise<boolean> {
  return SCHEDULE_PICKS[schedulePickUse.value].pick(meetId, quizId)
}

/**
 * Pick a roster team for a slot, seating its quizzers around the names already typed. The team's
 * name replaces the typed one unless `keepName`, for a pick made on the sheet's behalf.
 */
async function pickTeam(slotIdx: number, teamId: number, keepName = false) {
  openPickerSlot.value = null
  if (!teamId) {
    meetSession.clearSlot(slotIdx)
    return
  }

  const storeTeamId = teams.value[slotIdx]!.id
  const storeNames = store.quizzersByTeam(storeTeamId).map((q) => q.name)
  // No pick made, as when another quiz took the sheet while the roster loaded: leave its names
  if (!(await meetSession.assignTeam(slotIdx, teamId, storeNames))) return

  // Fill empty store seats with the DB names that were matched to those positions
  const slot = meetSession.getSlot(slotIdx)
  if (!slot) return
  edit(() => {
    if (!keepName) setTeamName(slotIdx, slot.dbLabelFull)
    for (let seatIdx = 0; seatIdx < QUIZZERS_PER_TEAM; seatIdx++) {
      if (!store.quizzersByTeam(storeTeamId)[seatIdx]?.name.trim()) {
        setQuizzerName(slotIdx, seatIdx, slot.quizzers[seatIdx]!.dbName)
      }
    }
  })
}

const filteredTeamList = computed(() =>
  meetSession.teamsForDivision(quiz.value.division ?? '', quiz.value.consolation ?? false),
)

/** What an empty name shows; the sizer measures it too, so the box fits it */
const TEAM_PLACEHOLDER = 'Team name'
const PICK_TEAM_PLACEHOLDER = 'Pick team'
function awaitsTeamPick(slotIdx: number): boolean {
  return picksTeam(slotIdx) && !meetSession.getSlot(slotIdx)
}
function teamPlaceholder(slotIdx: number): string {
  return awaitsTeamPick(slotIdx) ? PICK_TEAM_PLACEHOLDER : TEAM_PLACEHOLDER
}
const quizzerPlaceholder = (seatIdx: number) => `Seat ${seatIdx + 1}`

/** A click anywhere in a name cell types into its name, not only on the input's own width (#144) */
function focusName(e: MouseEvent) {
  if ((e.target as HTMLElement).closest('input, button, .drag-handle')) return
  ;(e.currentTarget as HTMLElement).querySelector<HTMLInputElement>('input.editable-name')?.focus()
}

/**
 * Once a quizzer's name is typed in, not at each keystroke: a name half typed can be another's.
 * Every seat of the team is looked at, since a name cleared from one seat frees its quizzer for the
 * seat that already bears the name.
 */
function relinkSeats(slotIdx: number) {
  const seatNames = teamQuizzers.value[slotIdx]?.map((quizzer) => quizzer.name) ?? []
  seatNames.forEach((_, seatIdx) => meetSession.relinkSeatByName(slotIdx, seatIdx, seatNames))
}

function restoreQuizzerName(slotIdx: number, seatIdx: number) {
  setQuizzerName(slotIdx, seatIdx, meetSession.getDbName(slotIdx, seatIdx) ?? '')
}

function restoreTeamName(slotIdx: number) {
  const pickedName = meetSession.pickedTeamName(slotIdx)
  if (pickedName !== undefined) setTeamName(slotIdx, pickedName)
}

type TeamNameIssue =
  | { kind: 'unnamed' | 'unpicked' | 'division' }
  | { kind: 'renamed'; pickedName: string }

/**
 * How a slot's team name disagrees with the linked meet's roster, if it does. The name stays as
 * typed either way: the sheet records what happened in the room, and an admin sorts out the
 * roster afterwards.
 */
function teamNameIssue(slotIdx: number, name: string): TeamNameIssue | undefined {
  if (!picksTeam(slotIdx)) return undefined
  if (!meetSession.getSlot(slotIdx)) {
    return { kind: name.trim() ? 'unpicked' : 'unnamed' }
  }
  if (meetSession.isTeamNameDiverged(slotIdx, name)) {
    return { kind: 'renamed', pickedName: meetSession.pickedTeamName(slotIdx) ?? '' }
  }
  if (isTeamDivisionDiverged(slotIdx)) return { kind: 'division' }
  return undefined
}

/** Why a team's name cell is flagged, if it is. A slot nobody has named yet isn't */
function teamNameWarning(slotIdx: number, name: string): string | undefined {
  const issue = teamNameIssue(slotIdx, name)
  switch (issue?.kind) {
    case 'unpicked':
      return "Not picked from the meet's teams"
    case 'renamed':
      return `Picked team: ${issue.pickedName}`
    case 'division':
      return "Picked team isn't in this division"
    default:
      return undefined
  }
}

/** A team name's disagreement as the warning list words it */
function teamNameIssueLine(issue: TeamNameIssue): string {
  switch (issue.kind) {
    case 'unnamed':
      return 'no team picked'
    case 'unpicked':
      return "not picked from the meet's teams"
    case 'renamed':
      return `picked team is ${issue.pickedName}`
    case 'division':
      return "picked team isn't in this division"
  }
}

function isTeamDivisionDiverged(slotIdx: number): boolean {
  if (!meetSession.isActive.value || !quiz.value.division) return false
  const slot = meetSession.getSlot(slotIdx)
  if (!slot) return false
  const team = meetSession.teamList.value.find((t) => t.id === slot.teamId)
  if (!team) return false
  return team.division !== quiz.value.division || team.consolation !== quiz.value.consolation
}

const {
  columns,
  quiz,
  teams,
  teamQuizzers,
  cells,
  noJumps,
  scoring,
  setCell,
  toggleNoJump,
  isEmptySeat,
  isBonusForTeam,
  isGreyedOut,
  isInvalid,
  cellValidationMessages,
  columnHasErrors,
  columnValidationMessages,
  quizzerHasErrors,
  quizzerValidationMessages,
  teamValidationMessages,
  isAfterOut,
  isFouledOnQuestion,
  toggleOnTime,
  teamHasErrors,
  hasAnyErrors,
  colAnswerValue,
  noJumpHasConflict,
  visibleColumns,
  visibleOtRounds,
  rules,
  openedFromNewerFile,
  allQuestionsComplete,
  validationErrors,
  timeoutValidationErrors,
  tooManyTimeoutsTeams,
  placements,
  placementPoints,
  setTeamName,
  setQuizzerName,
  swapTeams,
  editAsOne,
  moveQuizzer,
  setQuestionType,
  store,
  noJumpMap,
  timeoutMap,
  isTimeoutAllowed,
  toggleTimeout,
  hasTimeoutAt,
  hasTimeoutAfterCol,
  pauseAutoSave,
  keepFailed,
  loadFile,
  resetStore,
  clearAnswers,
  clearNames,
  canUndo,
  canRedo,
  unsaved,
  edit,
  editBySheet,
  setQuizField,
  markSubmitted,
  replaceQuiz,
  restoreQuiz,
  stateToMark,
  undo,
  redo,
  markSaved,
  setAside,
  bringBack,
} = useScoresheet()

const tutorial = useTutorial({
  store,
  noJumpMap,
  timeoutMap,
  pauseAutoSave,
  cells,
  teams,
  teamQuizzers,
  columns,
  quiz,
  setQuizzerName,
  setTeamName,
  setCell,
  toggleNoJump,
  toggleTimeout,
  toggleOnTime,
  moveQuizzer,
  resetStore,
  setAside,
  bringBack,
})

/** What a warning calls a team: its name, or its place on the sheet while it has none */
function teamCalled(slotIdx: number, name: string): string {
  return name.trim() || `Team ${slotIdx + 1}`
}

/** A division as a warning names it, with its consolation flag, which is part of which quiz it is */
function divisionCalled(division: string, consolation: boolean): string {
  return `${division}${consolation ? ' consolation' : ''}`
}

/** Whether a slot holds a roster team: picked as it, or bearing its name while unpicked */
function slotIsTeam(slotIdx: number, name: string, team: MeetTeam): boolean {
  const slot = meetSession.getSlot(slotIdx)
  return slot ? slot.teamId === team.id : teamNamed(name, teamsByName([team])) !== undefined
}

/**
 * Swap two slots' picks, as their teams swap, while the meet the swap was made in is still the one
 * linked: undone after another meet is linked, the teams swap back and that meet's picks stay put
 */
function swapPicksIn(meetId: number | null, slotA: number, slotB: number) {
  return () => {
    if (meetSession.meetId.value === meetId) meetSession.swapSlots(slotA, slotB)
  }
}

/** What an edit does to the meet's picks, undone and redone only while its meet is still linked */
function inThisMeet(change: HistoryCommand): HistoryCommand {
  const meetId = meetSession.meetId.value
  const guarded = (run: () => void) => () => {
    if (meetSession.meetId.value === meetId) run()
  }
  return { undo: guarded(change.undo), redo: guarded(change.redo) }
}

/**
 * Put a roster team in a slot in place of what is there: its name and pick, and its quizzers into
 * the blank seats. Quizzer names already typed stay, and are held against the new team's roster.
 * One edit, which undo takes back.
 */
async function replaceTeam(slotIdx: number, team: MeetTeam) {
  const meetId = meetSession.meetId.value
  if (meetId === null) return
  const roster = await waitOnMeet('Seating the team', () => getTeamQuizzers(meetId, team.id))
  if (!roster) return
  const seatNames = teamQuizzers.value[slotIdx]?.map((quizzer) => quizzer.name) ?? []
  const slot = meetSession.slotFor(team, roster.arrived.quizzers, seatNames)
  const seated = seatNames.map((name, seatIdx) =>
    name.trim() ? name : (slot.quizzers[seatIdx]?.dbName ?? ''),
  )
  const before = { name: teams.value[slotIdx]?.name ?? '', slot: meetSession.getSlot(slotIdx) }
  const write = (
    name: string,
    pick: SlotSession | undefined,
    over: SlotSession | undefined,
    seats: string[],
  ) => {
    setTeamName(slotIdx, name)
    // A pick belongs to its meet and its moment: undone or redone after another meet is linked, or
    // the slot picked afresh by a link, only the names change
    const current = meetSession.getSlot(slotIdx)
    if (meetSession.meetId.value === meetId && current?.teamId === over?.teamId) {
      meetSession.setSlot(slotIdx, pick)
    }
    seats.forEach((seat, seatIdx) => setQuizzerName(slotIdx, seatIdx, seat))
  }
  editAsOne({
    redo: () => write(slot.dbLabelFull, slot, before.slot, seated),
    undo: () => write(before.name, before.slot, slot, seatNames),
  })
}

/**
 * What doesn't agree with the linked meet, an entry each: the quiz's division and number, its
 * teams against the scheduled quiz's when one is linked, and the names against the roster.
 * Warnings, not errors: the sheet records what the room typed, which may be righter than the meet,
 * so they never stop a quiz being sent. They are shown, and asked about once before it goes. Where
 * the meet says what it expected, the entry carries the step that takes its word. With no meet
 * linked there is nothing to disagree with, and none.
 */
const meetWarningEntries = computed<MeetWarning[]>(() => {
  const warnings: MeetWarning[] = []
  const linkedQuiz = meetSession.scheduledQuiz.value
  // The scheduled quiz as the schedule has it, when there is one to hold the sheet against
  const scheduled = linkedQuiz?.inSchedule ? linkedQuiz : null
  if (meetSession.isActive.value) {
    if (linkedQuiz && !linkedQuiz.inSchedule) {
      warnings.push({
        line: "Quiz: no longer in the meet's schedule",
        fix: { label: 'Unlink quiz', run: () => meetSession.unlinkQuiz() },
      })
    }
    const division = given(quiz.value.division)
    const consolation = quiz.value.consolation ?? false
    const quizNumber = given(quiz.value.quizNumber)
    if (scheduled) {
      // Whether it is a consolation quiz is part of which division's quiz it is: one warning
      const theirs = divisionCalled(scheduled.division, scheduled.consolation)
      if (!sameDivision(division, scheduled.division) || consolation !== scheduled.consolation) {
        warnings.push({
          line: division
            ? `${divisionTitle(divisionCalled(division, consolation))}: schedule has ${theirs}`
            : `Division: none chosen, schedule has ${theirs}`,
          fix: {
            label: `Set division to ${theirs}`,
            run: () =>
              edit(() => {
                quiz.value.division = scheduled.division
                quiz.value.consolation = scheduled.consolation
              }),
          },
        })
      }
      if (foldName(quizNumber) !== foldName(scheduled.quizNumber)) {
        warnings.push({
          line: quizNumber
            ? `Quiz ${quizNumber}: schedule has ${scheduled.quizNumber}`
            : `Quiz: no number given, schedule has ${scheduled.quizNumber}`,
          fix: {
            label: `Set quiz to ${scheduled.quizNumber}`,
            run: () => edit(() => (quiz.value.quizNumber = scheduled.quizNumber)),
          },
        })
      }
    } else {
      if (meetSession.lacksDivision(division)) {
        warnings.push({
          line: division
            ? `${divisionTitle(division)}: not one of the meet's divisions`
            : 'Division: none chosen',
        })
      }
      // The meet files a quiz under its division and number, and has no quiz called nothing
      if (!quizNumber) warnings.push({ line: 'Quiz: no number given' })
    }
  }
  teams.value.forEach((team, slotIdx) => {
    const called = teamCalled(slotIdx, team.name)
    const place = `Team ${slotIdx + 1}`
    // The team the schedule seats here. A seat it hasn't decided, or whose team the roster no
    // longer has, is held against nothing
    const seatedId = scheduled?.seats[slotIdx] ?? null
    const seated = meetSession.teamList.value.find((candidate) => candidate.id === seatedId)
    const differs = seated !== undefined && !slotIsTeam(slotIdx, team.name, seated)
    if (seated && differs) {
      const theirs = meetSession.teamLabelFull(seated)
      const typed = team.name.trim()
      // Slots are compared one by one, so the right team in another slot is moved, whole
      const from = teams.value.findIndex(
        (other, i) => i !== slotIdx && slotIsTeam(i, other.name, seated),
      )
      const label =
        from !== -1
          ? `Move ${theirs} to ${place}${typed ? ` (swaps with ${typed})` : ''}`
          : typed
            ? `Replace ${typed} with ${theirs}`
            : `Put ${theirs} in ${place}`
      warnings.push({
        line: `${place}: ${typed || 'blank'}, schedule has ${theirs}`,
        fix: {
          label,
          run: () =>
            from !== -1
              ? swapTeams(slotIdx, from, swapPicksIn(meetSession.meetId.value, slotIdx, from))
              : void replaceTeam(slotIdx, seated),
        },
      })
    }
    if (!picksTeam(slotIdx)) return
    const issue = teamNameIssue(slotIdx, team.name)
    // One blank, one warning: the schedule's line already says what belongs in the slot
    if (issue && !(issue.kind === 'unnamed' && differs)) {
      warnings.push({ line: `${called}: ${teamNameIssueLine(issue)}` })
    }
    // No team picked, so no roster to hold the quizzers against
    if (!meetSession.getSlot(slotIdx)) return
    teamQuizzers.value[slotIdx]?.forEach((quizzer, seatIdx) => {
      // A seat emptied of its roster quizzer is an absence, not a disagreement
      if (!quizzer.name.trim()) return
      if (!meetSession.isQuizzerDiverged(slotIdx, seatIdx, quizzer.name)) return
      const rosterName = meetSession.getDbName(slotIdx, seatIdx)
      warnings.push({
        line: rosterName
          ? `${called}, ${quizzer.name.trim()}: roster has ${rosterName}`
          : `${called}, ${quizzer.name.trim()}: not on the roster`,
      })
    })
  })
  return warnings
})

/** The warnings as lines, for the count's hover and the submit question */
const meetWarnings = computed(() => meetWarningEntries.value.map((warning) => warning.line))

/** The warnings as a question lists them */
function warningList(warnings: string[]): string {
  return `Check these:\n${warnings.join('\n')}`
}

/** The list a hover shows, with each warning's fix: a touch screen has no hover */
function showMeetWarnings(event: MouseEvent) {
  // Keys score the sheet, so the count mustn't keep the focus a click gave it
  ;(event.currentTarget as HTMLElement).blur()
  warningsDialogRef.value?.open()
}

/** All unique validation messages for the status tooltip */
const allValidationMessages = computed(() => {
  const msgs = new Set<string>()
  if (timeoutValidationErrors.value.size > 0) {
    msgs.add(validationMessage(ValidationCode.TimeoutAfterErrorPoints))
  }
  if (tooManyTimeoutsTeams.value.size > 0) {
    msgs.add(validationMessage(ValidationCode.TooManyTimeouts))
  }
  for (const col of validationErrors.value.values()) {
    for (const codes of col.values()) {
      for (const code of codes) msgs.add(validationMessage(code))
    }
  }
  return [...msgs]
})

/**
 * What to ask about before a quiz goes to a meet: its scoring errors, then what disagrees with the
 * linked meet, when that is the meet it goes to. Neither stops it going. The room may have no time
 * to put it right, and the meet's admin can: a quiz with scoring errors is stored and goes unplaced
 * until a corrected one is sent.
 */
function submitConcerns(targetMeetId: number): string | undefined {
  const sections: string[] = []
  if (hasAnyErrors.value) {
    sections.push(
      `Scoring errors (the meet can't place this quiz until they're fixed):\n` +
        allValidationMessages.value.join('\n'),
    )
  }
  const warnings = meetSession.meetId.value === targetMeetId ? meetWarnings.value : []
  if (warnings.length > 0) sections.push(warningList(warnings))
  return sections.length > 0 ? sections.join('\n\n') : undefined
}

/**
 * Show individual score if the quizzer has one: they jumped (correct or error) or fouled out, before
 * overtime. Overtime marks give a quizzer nothing, so a foul-out there leaves no score to show.
 */
function quizzerScoreLabel(teamIdx: number, seatIdx: number): string | null {
  const q = scoring.value[teamIdx]?.quizzers[seatIdx]
  if (!q) return null
  if (q.correctCount === 0 && q.errorCount === 0 && q.foulCount < FOULS_TO_FOUL_OUT) return null
  return `${q.points}`
}

/**
 * Column indices at which a round-boundary running total should always be shown.
 * The last regulation question (regulation→OT) and the last question of each OT round.
 * Only relevant when OT is active.
 */
const boundaryColIndices = computed<Set<number>>(() => {
  const s = new Set<number>()
  if (visibleOtRounds.value === 0) return s
  const boundaryQs = Array.from({ length: visibleOtRounds.value }, (_, r) =>
    lastQuestionThroughRound(rules.value, r),
  )
  for (const q of boundaryQs) {
    const idx = columns.value.findIndex((c) => c.key === `${q}`)
    if (idx !== -1) s.add(idx)
  }
  return s
})

/** Running total at or before colIdx for a team (walks back to find last non-null). */
function boundaryTotal(teamIdx: number, colIdx: number): number | null {
  const totals = scoring.value[teamIdx]?.runningTotals
  if (!totals) return null
  for (let i = colIdx; i >= 0; i--) {
    if (totals[i] !== null && totals[i] !== undefined) return totals[i]!
  }
  return scoring.value[teamIdx]?.onTimeBonus ?? null
}

/** Columns actually rendered — entering columns start collapsed, then expand */
const displayColumns = ref(visibleColumns.value.map((vc) => ({ ...vc, entering: false })))

const trailingTotalIndices = computed<Set<number>>(() => {
  const s = new Set<number>()
  const dc = displayColumns.value
  const c = cells.value
  const nj = noJumps.value
  const lastVisible = lastVisibleColIdx.value
  const isComplete = (colIdx: number) => nj[colIdx] || anyTeamHasAnswer(c, colIdx)
  for (let i = 0; i < dc.length; i++) {
    const { idx } = dc[i]!
    const nextIdx = dc[i + 1]?.idx
    if (
      idx === lastVisible ||
      (isComplete(idx) && (nextIdx === undefined || !isComplete(nextIdx)))
    ) {
      s.add(idx)
    }
  }
  return s
})

// Last visible column for each round-ending question number.
// Covers the last regulation question (regulation→OT boundary) and each OT round's last question.
// When A/B sub-columns are visible, the border belongs on the last sub-column,
// not on the Normal column.
const roundEndIndices = computed<Set<number>>(() => {
  const s = new Set<number>()
  const dc = displayColumns.value
  const cols = columns.value
  for (let i = 0; i < dc.length; i++) {
    const col = cols[dc[i]!.idx]
    if (!col) continue
    if (!endsRound(rules.value, col.number)) continue
    const nextCol = cols[dc[i + 1]?.idx ?? -1]
    if (!nextCol || nextCol.number !== col.number) {
      s.add(dc[i]!.idx)
    }
  }
  return s
})

let prevVisibleKeys = new Set(visibleColumns.value.map(({ col }) => col.key))

watch(visibleColumns, (curr) => {
  const prev = prevVisibleKeys
  prevVisibleKeys = new Set(curr.map(({ col }) => col.key))

  const enteringKeys = new Set<string>()
  for (const { col } of curr) {
    if (!prev.has(col.key)) enteringKeys.add(col.key)
  }

  displayColumns.value = curr.map((vc) => ({
    ...vc,
    entering: enteringKeys.has(vc.col.key),
  }))

  // Double-rAF: let the collapsed state render before transitioning to natural size
  if (enteringKeys.size > 0) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        displayColumns.value = displayColumns.value.map((dc) => ({ ...dc, entering: false }))
      })
    })
  }
})

const {
  selector,
  selectorFocusIdx,
  selectorOptions,
  registerCellEl,
  openFromClick: openSelectorFromClick,
  openFromCell: openSelectorOnCell,
  selectValue,
  confirmFocusedOption,
  close: closeSelector,
} = useCellSelector(columns, isBonusForTeam, setCell)

const { focusedCell, focusCell, isNoJumpFocus, keyboardMode, deactivateKeyboardMode } =
  useKeyboardNav({
    blocked: computed(() => waitingFor.value !== null),
    columns,
    teams,
    teamQuizzers,
    noJumps,
    displayColumns,
    selector,
    selectorFocusIdx,
    selectorOptions,
    openSelectorOnCell,
    confirmFocusedOption,
    closeSelector,
    setCell,
    toggleNoJump,
    isBonusForTeam,
    isAfterOut,
    isFouledOnQuestion,
    undo: undoEdit,
    redo: redoEdit,
  })

/**
 * Undo and redo change the names as typing them back would, and the meet's picks follow them as
 * they follow typing: each seat is held against its quizzer by name, as on leaving a name field,
 * and a team's pick stays, flagged when the name no longer names it. Steps made in this session
 * also put their own picks back, so this changes nothing for them.
 */
function undoEdit() {
  undo()
  relinkAllSeats()
}

function redoEdit() {
  redo()
  relinkAllSeats()
}

function relinkAllSeats() {
  teams.value.forEach((_, slotIdx) => relinkSeats(slotIdx))
}

function moveQuizzerAndSync(teamIdx: number, from: number, to: number) {
  // A swap of seats is its own undoing
  const reorder = () => meetSession.reorderSlotQuizzers(teamIdx, from, to)
  moveQuizzer(teamIdx, from, to, inThisMeet({ undo: reorder, redo: reorder }))
}
const { dragState, dropTarget, dropIndicatorWidth, registerRowEl, onPointerDown } = useDragReorder(
  teamQuizzers,
  moveQuizzerAndSync,
)

function onCellClick(teamIdx: number, seatIdx: number, colIdx: number, event: MouseEvent) {
  deactivateKeyboardMode()
  focusCell(teamIdx, seatIdx, colIdx)
  openSelectorFromClick(teamIdx, seatIdx, colIdx, event)
}

function onNoJumpClick(colIdx: number) {
  deactivateKeyboardMode()
  focusCell(-1, -1, colIdx)
  toggleNoJump(colIdx)
}

/** Hovered column index for crosshair highlight */
const hoverCol = ref<number | null>(null)

/** Sticky baseline score — shows the team score entering the first visible question */
const wrapperRef = ref<HTMLElement | null>(null)
const nameColRef = ref<HTMLElement | null>(null)
const stickyAreaRef = ref<HTMLElement | null>(null)
const colHeaderEls = new Map<number, HTMLElement>()
function registerColHeader(idx: number, el: HTMLElement | null) {
  if (el) colHeaderEls.set(idx, el)
  else colHeaderEls.delete(idx)
}
const firstVisibleColIdx = ref(0)
const lastVisibleColIdx = ref(0)
let scrollRaf = 0

function updateVisibleCols() {
  scrollRaf = 0
  const stickyEl = stickyAreaRef.value ?? nameColRef.value
  const wrapper = wrapperRef.value
  if (!stickyEl || !wrapper || colHeaderEls.size === 0) return
  const stickyRight = stickyEl.getBoundingClientRect().right
  const wrapperRight = wrapper.getBoundingClientRect().right

  let first: number | null = null
  let last = 0
  for (const { idx } of displayColumns.value) {
    const el = colHeaderEls.get(idx)
    if (!el) continue
    const rect = el.getBoundingClientRect()
    const mid = (rect.left + rect.right) / 2
    if (first === null && mid >= stickyRight) first = idx
    if (mid <= wrapperRight) last = idx
  }
  const f = first ?? 0
  if (firstVisibleColIdx.value !== f) firstVisibleColIdx.value = f
  if (lastVisibleColIdx.value !== last) lastVisibleColIdx.value = last
}

function onWrapperScroll() {
  if (!scrollRaf) scrollRaf = requestAnimationFrame(updateVisibleCols)
}

function baselineScore(teamIdx: number): number {
  const idx = firstVisibleColIdx.value
  if (idx === 0) return scoring.value[teamIdx]?.onTimeBonus ?? 0
  return boundaryTotal(teamIdx, idx - 1) ?? scoring.value[teamIdx]?.onTimeBonus ?? 0
}

onMounted(() => {
  wrapperRef.value?.addEventListener('scroll', onWrapperScroll, { passive: true })
  updateVisibleCols()
})
onUnmounted(() => {
  wrapperRef.value?.removeEventListener('scroll', onWrapperScroll)
  if (scrollRaf) cancelAnimationFrame(scrollRaf)
})

const teamColors = ['team--red', 'team--white', 'team--blue']

/** The header menu that is open, one at a time */
const openMenu = ref<'save' | 'open' | 'new' | 'link' | null>(null)

function toggleMenu(menu: NonNullable<typeof openMenu.value>) {
  openMenu.value = openMenu.value === menu ? null : menu
}

function closeMenus() {
  openMenu.value = null
  openPickerSlot.value = null
}

async function saveFile() {
  const json = serializeStore(store, noJumpMap.value, timeoutMap.value)
  // Saved as it was when the save began, whatever was scored while the dialog was open
  const state = stateToMark()
  const filename = `${quizFileStem(quiz.value)}.json`
  const saved = await saveQuizToFile(json, filename)
  if (saved) markSaved(state)
}

async function openFile() {
  const result = await openAnyQuizFile()
  if (!result) return
  try {
    if (result.type === 'ods') {
      const data = deserialize(readOds(result.content))
      // A file stands by itself, unless it continues a recent quiz, which keeps its link
      if (!(await showOpened(data, {}))) meetSession.clearSession()
      markSaved()
    } else {
      await openJsonQuiz(result.content)
    }
  } catch (e) {
    alert(`Failed to open file: ${e instanceof Error ? e.message : e}`)
  }
}

const TRY_NEWER_PROMPT =
  'This file was saved by a newer version of the scoresheet. Update to open it reliably. ' +
  'Try to open it anyway? Scores may be wrong.'

/** A quiz file read for opening; undefined when it is from a newer version and the user declines */
async function parseForOpen(
  json: string,
): Promise<{ data: DeserializeResult; fromNewerFile: boolean } | undefined> {
  try {
    return { data: parseQuizFile(json), fromNewerFile: false }
  } catch (e) {
    if (!(e instanceof NewerFileVersionError)) throw e
    if (!(await confirmAction(TRY_NEWER_PROMPT))) return undefined
    return { data: parseQuizFileAttempt(json), fromNewerFile: true }
  }
}

/**
 * Open a quiz file. A file stands by itself: the sheet is linked to no meet afterwards, unless it
 * continues a recent quiz, which keeps its link.
 */
async function openJsonQuiz(json: string) {
  const opened = await parseForOpen(json)
  if (!opened) return
  if (!(await showOpened(opened.data, opened))) meetSession.clearSession()
  markSaved()
}

// A Record, so a new format fails type-checking until it has labels of its own
const FORMAT_LABELS: Record<QuizFormat, { badge: string; name: string }> = {
  [QuizFormat.TwentyQuestion]: { badge: '20 Q', name: '20-question quiz' },
  [QuizFormat.FifteenQuestion]: { badge: '15 Q', name: '15-question quiz' },
}
const QUIZ_FORMATS = Object.values(QuizFormat)

/**
 * Every way to start a new quiz (menu, Ctrl+N) comes here, so the meet forgets the last one's
 * teams. With no format (Ctrl+N), repeat the current quiz's: practice meets run many in a row.
 */
async function newQuiz(format = quiz.value.format) {
  replaceQuiz()
  resetStore(format)
  meetSession.startNewQuiz()
}

async function doSaveFile() {
  closeMenus()
  await saveFile()
}

async function doExportOds(pickTemplate = false) {
  closeMenus()
  await exportOds(pickTemplate)
}

const choiceDialog = ref<InstanceType<typeof ChoiceDialog> | null>(null)
const roomCodeDialog = ref<InstanceType<typeof RoomCodeDialog> | null>(null)

/**
 * A division or quiz number as given: none when blank, and none when it is the "_" a file name
 * puts in a blank's place, so a value copied back off a file name is no more a division than a
 * blank is
 */
function given(value: string): string {
  const trimmed = value.trim()
  return trimmed === BLANK_IN_FILE_NAME ? '' : trimmed
}

const submitter = useSubmitToMeet()
const { session: authSession } = useAuth()
// Signing in, or starting signed in, upgrades the account with the guest sessions' codes
upgradeOnSignIn(
  () => authSession.value.data?.user.id,
  () => ({ joinMeet, dialog: roomCodeDialog.value }),
)

/** How a guest official's ended session is renewed: through the room-code dialog, unless signed in */
function roomCodeOptions(): RoomCodeOptions {
  return {
    join: joinMeetGuest,
    dialog: roomCodeDialog.value,
    signedIn: !!authSession.value.data?.user,
  }
}
// Signing in or out, or joining or leaving a room with a code, changes the meets the user may submit to
watch(
  [
    () => authSession.value.data?.user.id,
    () =>
      guestStateRef.value.joined
        .filter((j) => j.role === MeetRole.Official)
        .map((j) => j.meetId)
        .join(),
  ],
  () => void submitter.refreshTargets(),
  { immediate: true },
)

const { refreshTeamNames, teamNamesFor } = useTeamNames()
/** Whether the linked meet's roster has teams for the quiz's division, to pick from */
const rosterHasTeams = computed(() => filteredTeamList.value.length > 0)
// A new quiz has no division, and teams are only picked within one. A meet with a single division
// leaves nothing to choose, so it is chosen. Sync, so that the team menus and warnings, which
// go by the division, have it as soon as a meet is linked
watch(
  [() => meetSession.divisionOptions.value, () => quiz.value.division],
  ([divisions, division]) => {
    if (!given(division) && divisions.length === 1) quiz.value.division = divisions[0]!
  },
  { immediate: true, flush: 'sync' },
)
/**
 * A team can be picked from the roster when it has teams for the division, or when the team is
 * already picked, so a pick made in another division can still be seen and cleared. The name can
 * be typed over either way.
 */
function picksTeam(teamIdx: number): boolean {
  return rosterHasTeams.value || !!meetSession.getSlot(teamIdx)
}
/**
 * The meet whose team names a typed name is offered: the linked one, else the one last submitted
 * to. Not fetched while teams are picked from the roster instead.
 */
watch(
  [() => meetSession.meetId.value ?? submitter.lastMeetId.value, rosterHasTeams],
  ([meetId, fromRoster]) => {
    if (!fromRoster) void refreshTeamNames(meetId)
  },
  { immediate: true },
)
const offeredTeamNames = computed(() => teamNamesFor(quiz.value.division ?? ''))

/**
 * The meet to submit to, and who the user is there: the linked meet when they may send to it, else
 * the one meet they may send to, or the one chosen in the meet picker, where a code can be joined.
 * It's checked again here, so a guest official whose session has ended is asked for the room code
 * before the room is confirmed. Another meet's room code entered then offers to send there instead,
 * and a linked sheet is linked to that meet. Undefined when the user cancels or may not send.
 */
async function chooseMeet(): Promise<{ id: number; name: string; sender: Sender } | undefined> {
  const linkedId = meetSession.sender.value ? meetSession.meetId.value : null
  const linked = linkedId !== null
  // One meet the user may send to takes it; otherwise the meet picker asks, offering a code join
  const [only, ...others] = submitter.targets.value
  const picked = linked
    ? { meetId: linkedId, meetName: meetSession.meetName.value ?? 'the meet' }
    : only && others.length === 0
      ? only
      : await meetPickerRef.value?.chooseForSubmit(submitter.lastMeetId.value)
  if (!picked) return undefined
  const answer = await renewedSenderOf(picked.meetId, {
    ...roomCodeOptions(),
    otherMeet: (session) => ({
      message:
        `That code is for ${sessionLabel(session)}. ` +
        `Submit to ${session.meetName} instead?` +
        (linked ? ` The sheet will use ${session.meetName}'s team names from now on.` : ''),
      accept: `Submit to ${session.meetName}`,
    }),
  })
  // The official cancelled the room-code dialog
  if (answer === false) return undefined
  const { meetId: id, sender } = answer
  const name = id === picked.meetId ? picked.meetName : (joinedSession(id)?.meetName ?? 'the meet')
  if (!sender) {
    alert(
      sender === null
        ? `You can't submit to ${name}: you aren't one of its admins or officials, or your room code has expired.`
        : `Couldn't reach ${name}. Try again, or save the quiz as a file.`,
    )
    return undefined
  }
  if (linked && id !== picked.meetId) {
    try {
      await meetSession.loadMeet(id, name)
      takeMeetScoring()
    } catch {
      alert(`Couldn't reach ${name}. Try again, or save the quiz as a file.`)
      return undefined
    }
  }
  if (!linked) submitter.rememberMeet(id)
  return { id, name, sender }
}

/** Send the quiz to a meet; the sheet itself is untouched whether or not it arrives */
async function doSubmitToMeet() {
  closeMenus()
  const target = await chooseMeet()
  if (!target) return
  // The question lists warnings as the meet stands now. Only the copies are renewed: nothing is
  // picked or filled on the way to sending, though the quiz takes the meet's way of scoring
  if (target.id === meetSession.meetId.value) {
    const checked = await waitOnMeet('Checking the quiz against the meet', (stillWanted) =>
      meetSession.refresh(stillWanted),
    )
    if (!checked) return
    takeMeetScoring()
  }
  // Asked once the meet is settled: the names are held against the roster of the meet it goes to
  const concerns = submitConcerns(target.id)
  if (concerns && !(await confirmAction(`${concerns}\n\nSubmit anyway?`))) return
  const meet = target.name
  const scheduled = meetSession.scheduleQuizIdFor(target.id)
    ? meetSession.scheduledQuiz.value
    : null
  // A quiz the schedule has dropped is placed nowhere now
  const placed =
    scheduled?.inSchedule && scheduled.roomId !== undefined
      ? { roomId: scheduled.roomId, quizLabel: scheduled.label }
      : undefined
  const roomId = await chooseRoom(choiceDialog.value, target.sender, meet, 'Submit', placed)
  if (roomId === undefined) return
  const quizFile = storeToQuizFile(store, noJumpMap.value, timeoutMap.value)
  // Submitted as it was sent, whatever was scored while the meet answered
  const sent = stateToMark()
  const scheduleQuizId = meetSession.scheduleQuizIdFor(target.id)
  // A guest official whose session ends on the way is asked for the room code, and the send
  // retried; the room is confirmed by now, so only its code will do
  const send = (onExisting?: OnExisting) =>
    withRoomCode(
      target.id,
      () => submitter.submitQuiz(target.id, quizFile, roomId, onExisting, scheduleQuizId),
      {
        ...roomCodeOptions(),
        sameRoom: true,
      },
    )
  try {
    let outcome = await send()
    if (!outcome) return
    if (!outcome.stored) {
      const choice = await askAlreadySubmitted(choiceDialog.value, outcome.existing)
      if (!choice) return
      outcome = await send(choice)
    }
    if (!outcome?.stored) return
    markSubmitted(
      target.id,
      target.id === meetSession.meetId.value ? meetSession.quizId.value : null,
      sent,
    )
    // Name the room it was stored for
    const room = target.sender.rooms.find((r) => r.id === roomId)?.name
    const where = room ? `${meet}, ${room}` : meet
    if (outcome.created) alert(`Submitted to ${where}.`)
    else if (outcome.unchanged)
      alert(`${where} already has this quiz as revision ${outcome.revision}; nothing changed.`)
    else if (outcome.keptCurrent) {
      alert(
        `Saved to ${where} as revision ${outcome.revision}; the earlier revision stays current.`,
      )
    } else alert(`Submitted to ${where} as revision ${outcome.revision}.`)
  } catch (e) {
    alert(
      `Not submitted: ${(e as Error).message}\nThe quiz is unchanged. Try again, or save it as a file.`,
    )
  }
}

function doOpenFile() {
  closeMenus()
  void openFile()
}

async function doNewQuiz(format: QuizFormat) {
  closeMenus()
  await newQuiz(format)
}

async function doClearAnswers() {
  closeMenus()
  if (unsaved.value && !(await confirmAction('Clear all answers?'))) return
  clearAnswers()
}

async function doClearNames() {
  closeMenus()
  if (!(await confirmAction('Clear all names?'))) return
  // Blank names name no team: a linked sheet's picks go with them, and come back with an undo
  const picks = [0, 1, 2].map((slotIdx) => meetSession.getSlot(slotIdx))
  clearNames(
    inThisMeet({
      redo: () => picks.forEach((_, slotIdx) => meetSession.clearSlot(slotIdx)),
      undo: () => picks.forEach((pick, slotIdx) => meetSession.setSlot(slotIdx, pick)),
    }),
  )
}

function doUnlinkMeet() {
  closeMenus()
  meetSession.clearSession()
}

// fillOts refuses other formats; disabling the menu item spares a pointless template dialog
const canExportOds = computed(() => odsSupportsFormat(quiz.value.format))

/**
 * Export the quiz to .ods. A quiz linked to a meet fills the meet's own template; with none, no
 * link, or no network, or when asked for another, the official picks a template.
 */
async function exportOds(pickTemplate = false) {
  const meetId = meetSession.meetId.value
  const meetTemplate = !pickTemplate && meetId !== null ? await getMeetTemplate(meetId) : null
  const otsBytes = meetTemplate ?? (await openOtsTemplate())
  if (!otsBytes) return
  const quizFile = storeToQuizFile(store, noJumpMap.value, timeoutMap.value)
  try {
    const odsBytes = fillOts(otsBytes, quizFile)
    const filename = `${quizFileStem(quiz.value)}.ods`
    const saved = await exportOdsFile(odsBytes, filename)
    if (saved)
      alert('ODS exported.\n\nOpen in LibreOffice and press Ctrl+Shift+F9 to recalculate formulas.')
  } catch (e) {
    alert(`Failed to export ODS: ${e instanceof Error ? e.message : e}`)
  }
}

/** What App.vue's shortcuts reach: nothing while the sheet waits on the meet, which takes only Cancel */
function unlessWaiting<A extends unknown[], R>(action: (...args: A) => R) {
  return (...args: A): R | undefined => (waitingFor.value === null ? action(...args) : undefined)
}

defineExpose({
  saveFile: unlessWaiting(saveFile),
  openFile: unlessWaiting(openFile),
  newQuiz: unlessWaiting(newQuiz),
  exportOds: unlessWaiting(exportOds),
})

const cellDisplay: Record<CellValue, string> = {
  [CellValue.Correct]: 'C',
  [CellValue.Error]: 'E',
  [CellValue.Foul]: 'F',
  [CellValue.Bonus]: 'B',
  [CellValue.MissedBonus]: 'MB',
  [CellValue.Empty]: '',
}

const cellClass: Record<CellValue, string> = {
  [CellValue.Correct]: 'cell--correct',
  [CellValue.Error]: 'cell--error',
  [CellValue.Foul]: 'cell--foul',
  [CellValue.Bonus]: 'cell--bonus',
  [CellValue.MissedBonus]: 'cell--missed-bonus',
  [CellValue.Empty]: '',
}

const headerAnswerClass: Record<CellValue, string> = {
  [CellValue.Correct]: 'col--header-correct',
  [CellValue.Error]: 'col--header-error',
  [CellValue.Foul]: '',
  [CellValue.Bonus]: 'col--header-bonus',
  [CellValue.MissedBonus]: 'col--header-missed-bonus',
  [CellValue.Empty]: '',
}

function headerClass(colIdx: number): string {
  const classes: string[] = []
  const answer = headerAnswerClass[colAnswerValue(colIdx)]
  if (answer) classes.push(answer)
  else if (noJumps.value[colIdx]) classes.push('col--header-no-jump')
  if (columnHasErrors(colIdx)) classes.push('col--header-invalid')
  return classes.join(' ')
}

// Class string per column, called from 7 template sections per render.
// Memoize once per column-list change instead of recomputing for each section.
const colGroupClassMap = computed<Map<number, string>>(() => {
  const map = new Map<number, string>()
  const dc = displayColumns.value
  const cols = columns.value
  const roundEnds = roundEndIndices.value
  const firstOt = firstOvertimeQuestion(rules.value)
  const lastIdx = dc[dc.length - 1]?.idx
  for (const { idx } of dc) {
    const col = cols[idx]
    if (!col) continue
    const classes: string[] = []
    if (idx === lastIdx) classes.push('col--last')
    if (!col.isOvertime && roundEnds.has(idx)) classes.push('col--reg-last')
    if (col.isOvertime) {
      if (col.type === QuestionType.Normal && startsOtRound(rules.value, col.number)) {
        classes.push(
          col.number === firstOt
            ? 'col--overtime col--ot-start'
            : 'col--overtime col--ot-round-start',
        )
      } else if (roundEnds.has(idx)) {
        classes.push('col--overtime col--ot-round-end')
      } else {
        classes.push('col--overtime')
      }
    } else if (col.isAB && col.isErrorPoints) {
      classes.push('col--ab')
    }
    map.set(idx, classes.join(' '))
  }
  return map
})

function colGroupClass(colIdx: number): string {
  return colGroupClassMap.value.get(colIdx) ?? ''
}

declare const __APP_VERSION__: string
const appVersion: string = __APP_VERSION__
</script>

<template>
  <div class="scoresheet-outer">
    <div
      ref="wrapperRef"
      class="scoresheet-wrapper"
      :class="{ 'is-dragging': dragState }"
      @dragstart.prevent
    >
      <div
        v-if="openMenu !== null || openPickerSlot !== null"
        class="menu-backdrop"
        @click="closeMenus"
      />
      <Teleport to="body">
        <div
          v-if="openPickerSlot !== null"
          class="team-picker-menu"
          :style="{ top: pickerPos.top + 'px', left: pickerPos.left + 'px' }"
          @click.stop
        >
          <button
            v-for="t in filteredTeamList"
            :key="t.id"
            class="team-picker-option"
            :class="{ 'is-selected': meetSession.getSlot(openPickerSlot)?.teamId === t.id }"
            @click="pickFromOpenPicker(t.id)"
          >
            {{ meetSession.teamLabel(t) }}
          </button>
          <button
            v-if="meetSession.getSlot(openPickerSlot)"
            class="team-picker-option team-picker-option--clear"
            @click="pickFromOpenPicker(0)"
          >
            Clear
          </button>
        </div>
      </Teleport>
      <div class="scoresheet-content">
        <div class="meta-row">
          <div class="col--left-spacer" />
          <div class="meta-row-inner">
            <div
              :class="[
                'quiz-meta quiz-meta--left',
                {
                  'quiz-meta--error': hasAnyErrors,
                  'quiz-meta--complete': allQuestionsComplete && !hasAnyErrors,
                },
              ]"
            >
              <div class="meta-group">
                <label class="meta-field">
                  <span class="meta-label">Division</span>
                  <select
                    v-if="
                      meetSession.isActive.value && meetSession.divisionOptions.value.length > 0
                    "
                    :value="quiz.division"
                    class="division-select"
                    @change="setQuizField('division', ($event.target as HTMLSelectElement).value)"
                  >
                    <!-- A lone division is chosen for the quiz, so there is no "none" to go back to -->
                    <option v-if="meetSession.divisionOptions.value.length !== 1" value="">
                      —
                    </option>
                    <option
                      v-for="opt in meetSession.divisionOptions.value"
                      :key="opt"
                      :value="opt"
                    >
                      {{ opt }}
                    </option>
                  </select>
                  <DivisionInput
                    v-else
                    :model-value="quiz.division"
                    class="division-text"
                    bare
                    type="text"
                    aria-label="Division"
                    @update:model-value="setQuizField('division', $event ?? '')"
                  />
                </label>
                <span
                  class="consolation-toggle"
                  :class="{ 'consolation-toggle--active': quiz.consolation }"
                  @click="setQuizField('consolation', !quiz.consolation)"
                >
                  <span class="on-time-box">✓</span>
                  <span class="on-time-label" title="Consolation bracket">c</span>
                </span>
                <span class="meta-group-sep" />
                <label class="meta-field">
                  <span class="meta-label">Quiz</span>
                  <input
                    :value="quiz.quizNumber"
                    type="text"
                    @input="setQuizField('quizNumber', ($event.target as HTMLInputElement).value)"
                  />
                </label>
              </div>
              <div class="meta-field meta-field--undo">
                <button :disabled="!canUndo" title="Undo (Ctrl+Z)" @click="undoEdit">↶</button>
                <button :disabled="!canRedo" title="Redo (Ctrl+Shift+Z)" @click="redoEdit">
                  ↷
                </button>
              </div>
              <span
                :class="[
                  'meta-field meta-field--status',
                  {
                    'meta-field--status--complete': allQuestionsComplete && !hasAnyErrors,
                    'meta-field--status--error': hasAnyErrors,
                  },
                ]"
                :title="hasAnyErrors ? allValidationMessages.join('\n') : undefined"
              >
                <span v-if="hasAnyErrors" class="meta-status meta-status--error">⚠</span>
                <span v-else-if="allQuestionsComplete" class="meta-status meta-status--complete"
                  >✓</span
                >
                <span v-else class="meta-status meta-status--pending">○</span>
                <span class="meta-label">{{
                  hasAnyErrors ? 'Invalid' : allQuestionsComplete ? 'Complete' : '…'
                }}</span>
              </span>
              <button
                v-if="meetWarnings.length > 0"
                type="button"
                class="meta-field meta-meet-warnings"
                :title="meetWarnings.join('\n')"
                :aria-label="`Warnings (${meetWarnings.length}): ${meetWarnings.join('; ')}`"
                @click="showMeetWarnings"
              >
                ⚠ {{ meetWarnings.length }}
              </button>
              <div class="meta-field file-menu link-menu">
                <button
                  class="meta-session-pill"
                  :class="{ 'meta-session-pill--unlinked': !meetSession.isActive.value }"
                  title="Link to a meet or one of its scheduled quizzes"
                  @click="toggleMenu('link')"
                >
                  <template v-if="meetSession.isActive.value">
                    🔗 {{ meetSession.meetName.value }}
                    <template v-if="linkedQuizLabel"> · {{ linkedQuizLabel }}</template>
                  </template>
                  <template v-else>🔗 Link…</template>
                </button>
                <button
                  v-if="meetSession.isActive.value"
                  class="link-refresh"
                  title="Refetch names from the meet and schedule"
                  aria-label="Refetch names from the meet and schedule"
                  @click="doRefreshLink"
                >
                  ⟳
                </button>
                <div v-if="openMenu === 'link'" class="file-menu__dropdown">
                  <button @click="openMeetPicker">🔗 Link a meet…</button>
                  <button @click="openSchedulePicker('link')">📅 Link a scheduled quiz…</button>
                  <template v-if="meetSession.isActive.value">
                    <hr class="file-menu__divider" />
                    <button v-if="meetSession.quizId.value !== null" @click="doUnlinkQuiz">
                      ⚡ Unlink quiz
                    </button>
                    <button @click="doUnlinkMeet">⚡ Unlink meet</button>
                  </template>
                </div>
              </div>
              <span class="meta-divider" />
              <div class="meta-field meta-field--file">
                <div class="file-menu">
                  <button title="Save / Export (Ctrl+S)" @click="toggleMenu('save')">
                    ⤓ Save ▾
                  </button>
                  <div v-if="openMenu === 'save'" class="file-menu__dropdown">
                    <button @click="doSaveFile">⤓ Save as JSON</button>
                    <button @click="doSubmitToMeet">⇪ Submit to meet</button>
                    <button
                      :disabled="!canExportOds"
                      :title="canExportOds ? undefined : ODS_TWENTY_ONLY"
                      @click="doExportOds()"
                    >
                      ⬡ Export ODS
                    </button>
                    <button
                      v-if="meetSession.meetId.value !== null"
                      :disabled="!canExportOds"
                      :title="canExportOds ? undefined : ODS_TWENTY_ONLY"
                      @click="doExportOds(true)"
                    >
                      ⬡ Export ODS, another template…
                    </button>
                  </div>
                </div>
                <div class="file-menu">
                  <button title="Open a quiz (Ctrl+O opens a file)" @click="toggleMenu('open')">
                    ⤒ Open ▾
                  </button>
                  <div v-if="openMenu === 'open'" class="file-menu__dropdown">
                    <button @click="doOpenFile">⤒ From file…</button>
                    <button @click="openStoredPicker">🔗 From the meet…</button>
                    <button @click="openSchedulePicker('open')">📅 From the schedule…</button>
                    <button @click="openRecentQuizzes">🕘 Recent quizzes…</button>
                  </div>
                </div>
                <div class="file-menu">
                  <button title="New quiz (Ctrl+N)" @click="toggleMenu('new')">✦ New ▾</button>
                  <div v-if="openMenu === 'new'" class="file-menu__dropdown">
                    <button v-for="format in QUIZ_FORMATS" :key="format" @click="doNewQuiz(format)">
                      ✦ New {{ FORMAT_LABELS[format].name }}
                    </button>
                    <button @click="openSchedulePicker('new')">📅 New from schedule…</button>
                    <hr class="file-menu__divider" />
                    <button @click="doClearAnswers">✕ Clear answers</button>
                    <button @click="doClearNames">✕ Clear names</button>
                  </div>
                </div>
                <button class="help-toggle" title="Interactive tutorial" @click="tutorial.start">
                  ?
                </button>
              </div>
            </div>
            <div class="quiz-meta quiz-meta--right">
              <span class="meta-format" :title="FORMAT_LABELS[quiz.format].name">{{
                FORMAT_LABELS[quiz.format].badge
              }}</span>
              <label class="meta-field meta-field--toggle" data-tutorial="overtime-toggle">
                <input
                  :checked="quiz.overtime"
                  type="checkbox"
                  @change="setQuizField('overtime', ($event.target as HTMLInputElement).checked)"
                />
                <span class="toggle-track"><span class="toggle-thumb" /></span>
                <span class="meta-label">Overtime</span>
              </label>
              <button
                class="theme-toggle"
                :title="`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`"
                @click="toggleTheme"
              >
                {{ theme === 'light' ? '🌙' : '☀️' }}
              </button>
              <SignInWidget />
            </div>
          </div>
        </div>

        <div
          v-if="
            openedFromNewerFile ||
            openedElsewhere ||
            waitingQuizzes ||
            droppedQuizzes.length ||
            keepFailed
          "
          class="notice-row"
        >
          <div class="col--left-spacer" />
          <div class="notice-row-inner">
            <p v-if="keepFailed" class="notice">
              {{
                keepFailed === 'full'
                  ? "This quiz can't be kept on this device: it is full. Save it to a file."
                  : "This quiz couldn't be kept on this device. Save it to a file."
              }}
              <button class="notice-action" aria-label="Close" @click="keepFailed = null">×</button>
            </p>
            <p v-if="waitingQuizzes" class="notice">
              {{ waitingQuizzes }} unsaved {{ waitingQuizzes === 1 ? 'quiz' : 'quizzes' }} from
              closed tabs.
              <button class="notice-action" @click="seeRecentQuizzes">See them</button>
              <button class="notice-action" aria-label="Close" @click="waitingQuizzes = 0">
                ×
              </button>
            </p>
            <p v-if="droppedQuizzes.length" class="notice">
              {{ droppedQuizzes.join(', ') }} {{ droppedQuizzes.length === 1 ? 'was' : 'were' }}
              removed from recent quizzes to make room.
              <button class="notice-action" aria-label="Close" @click="droppedQuizzes = []">
                ×
              </button>
            </p>
            <p v-if="openedFromNewerFile" class="notice">
              Opened from a newer file; may be scored wrong.
            </p>
            <p v-if="openedElsewhere" class="notice">
              This quiz is open in another tab. It opened here as a separate quiz.
              <button class="notice-action" aria-label="Close" @click="openedElsewhere = false">
                ×
              </button>
            </p>
          </div>
        </div>

        <table class="scoresheet" :style="{ '--drop-indicator-width': dropIndicatorWidth } as any">
          <!-- Question header row -->
          <thead>
            <tr>
              <th class="col--left-spacer" />
              <th ref="nameColRef" class="col--name sticky-col" />
              <th class="col--ontime-header" />
              <th
                v-for="{ col, idx, entering } in displayColumns"
                :key="col.key"
                :ref="(el: any) => registerColHeader(idx, el as HTMLElement | null)"
                :data-tutorial="`col-header-${idx}`"
                :class="[
                  'col--question',
                  colGroupClass(idx),
                  headerClass(idx),
                  { 'timeout-after': hasTimeoutAfterCol(col.key) },
                  {
                    'col--entering': entering,
                    'col--hover': !dragState && (hoverCol === idx || selector?.colIdx === idx),
                    'col--focus': keyboardMode && focusedCell?.colIdx === idx,
                  },
                ]"
                :title="columnHasErrors(idx) ? columnValidationMessages(idx).join('\n') : undefined"
              >
                <div class="col-header-inner">
                  <span class="col-header-number">{{ col.label }}</span>
                  <span v-if="quiz.questionTypes.get(col.key)" class="col-header-type">{{
                    quiz.questionTypes.get(col.key)
                  }}</span>
                  <span v-else class="col-header-type">&nbsp;</span>
                  <select
                    class="question-type-select"
                    :aria-label="`Question ${col.label} type`"
                    :value="quiz.questionTypes.get(col.key) ?? ''"
                    @change="
                      setQuestionType(
                        idx,
                        ($event.target as HTMLSelectElement).value
                          ? (($event.target as HTMLSelectElement).value as QuestionCategory)
                          : null,
                      )
                    "
                  >
                    <option value="" />
                    <option v-for="cat in QuestionCategory" :key="cat" :value="cat">
                      {{ cat }}
                    </option>
                  </select>
                </div>
              </th>
              <th class="col--total col--total-header" />
            </tr>
          </thead>

          <tbody>
            <template v-for="(team, teamIdx) in teams" :key="team.id">
              <!-- Team header row -->
              <tr :class="['row--team-header', teamColors[teamIdx]]">
                <td class="col--left-spacer" />
                <td class="col--name sticky-col team-name" colspan="2">
                  <div class="name-cell-inner" @click="focusName">
                    <span class="name-main">
                      <span
                        class="name-input-sizer name-input-sizer--team"
                        :data-value="team.name || teamPlaceholder(teamIdx)"
                      >
                        <input
                          :class="[
                            'editable-name',
                            'editable-name--team',
                            { 'editable-name--diverged': teamNameWarning(teamIdx, team.name) },
                          ]"
                          :data-tutorial="`team-name-${teamIdx}`"
                          :list="rosterHasTeams ? undefined : 'team-name-options'"
                          :placeholder="teamPlaceholder(teamIdx)"
                          :title="teamNameWarning(teamIdx, team.name)"
                          :value="team.name"
                          @input="setTeamName(teamIdx, ($event.target as HTMLInputElement).value)"
                          @focus="($event.target as HTMLInputElement).select()"
                          @keydown.enter="($event.target as HTMLInputElement).blur()"
                        />
                      </span>
                      <template v-if="picksTeam(teamIdx)">
                        <button
                          v-if="meetSession.isTeamNameDiverged(teamIdx, team.name)"
                          class="name-restore"
                          :title="`Restore: ${meetSession.pickedTeamName(teamIdx)}`"
                          :aria-label="`Restore: ${meetSession.pickedTeamName(teamIdx)}`"
                          @click.stop="restoreTeamName(teamIdx)"
                        >
                          ↺
                        </button>
                        <button
                          class="team-picker-trigger"
                          :class="{ 'is-open': openPickerSlot === teamIdx }"
                          title="Pick a team from the meet"
                          aria-label="Pick a team from the meet"
                          @click.stop="toggleTeamPicker(teamIdx, $event)"
                          @keydown.escape.stop="openPickerSlot = null"
                        >
                          <svg
                            class="team-picker-chevron"
                            viewBox="0 0 10 6"
                            width="8"
                            height="8"
                            aria-hidden="true"
                          >
                            <path d="M0 0l5 6 5-6z" fill="currentColor" />
                          </svg>
                        </button>
                      </template>
                    </span>
                    <span class="team-stats">
                      <span
                        v-if="(scoring[teamIdx]?.uniqueCorrectQuizzers ?? 0) >= 3"
                        class="stat-badge stat-badge--unique"
                        :title="`${scoring[teamIdx]!.uniqueCorrectQuizzers} quizzers jumped (+10 each from 3rd)`"
                        >{{
                          scoring[teamIdx]!.uniqueCorrectQuizzers >= 5
                            ? '5th'
                            : scoring[teamIdx]!.uniqueCorrectQuizzers >= 4
                              ? '4th'
                              : '3rd'
                        }}</span
                      >
                    </span>
                  </div>
                </td>
                <td
                  v-for="{ col, idx, entering } in displayColumns"
                  :key="col.key"
                  :data-tutorial="`timeout-${teamIdx}-${idx}`"
                  :class="[
                    'team-header-spacer',
                    'timeout-toggle',
                    colGroupClass(idx),
                    { 'col--entering': entering },
                    { 'timeout-after': hasTimeoutAfterCol(col.key) },
                    { 'has-timeout': hasTimeoutAt(team.id, col.key) },
                    {
                      'timeout-invalid':
                        hasTimeoutAt(team.id, col.key) &&
                        (!isTimeoutAllowed(col.key) || tooManyTimeoutsTeams.has(teamIdx)),
                    },
                  ]"
                  :title="
                    hasTimeoutAt(team.id, col.key) && !isTimeoutAllowed(col.key)
                      ? validationMessage(ValidationCode.TimeoutAfterErrorPoints)
                      : hasTimeoutAt(team.id, col.key) && tooManyTimeoutsTeams.has(teamIdx)
                        ? validationMessage(ValidationCode.TooManyTimeouts)
                        : undefined
                  "
                  @click.stop="toggleTimeout(team.id, col.key)"
                />
                <td class="col--name team-score-label">Score</td>
              </tr>

              <!-- Quizzer rows -->
              <tr
                v-for="(quizzer, seatIdx) in teamQuizzers[teamIdx]"
                :key="quizzer.id"
                :ref="(el: any) => registerRowEl(teamIdx, seatIdx, el as HTMLElement)"
                :data-tutorial="`quizzer-row-${teamIdx}-${seatIdx}`"
                :class="[
                  'row--quizzer',
                  { 'row--quizzed-out': scoring[teamIdx]?.quizzers[seatIdx]?.quizzedOut },
                  {
                    'row--errored-out':
                      scoring[teamIdx]?.quizzers[seatIdx]?.erroredOut &&
                      !scoring[teamIdx]?.quizzers[seatIdx]?.fouledOut,
                  },
                  { 'row--fouled-out': scoring[teamIdx]?.quizzers[seatIdx]?.fouledOut },
                  {
                    'row--dragging':
                      dragState?.teamIdx === teamIdx && dragState?.seatIdx === seatIdx,
                  },
                  {
                    'row--drop-target':
                      dropTarget?.teamIdx === teamIdx &&
                      dropTarget?.seatIdx === seatIdx &&
                      !(dragState?.teamIdx === teamIdx && dragState?.seatIdx === seatIdx),
                  },
                ]"
              >
                <td class="col--left-spacer" />
                <td
                  colspan="2"
                  :class="[
                    'col--name',
                    'sticky-col',
                    {
                      'cell--invalid': quizzerHasErrors(teamIdx, seatIdx),
                      'col--name--active':
                        !dragState &&
                        selector?.teamIdx === teamIdx &&
                        selector?.seatIdx === seatIdx,
                      'col--name--focused':
                        !dragState &&
                        keyboardMode &&
                        focusedCell?.teamIdx === teamIdx &&
                        focusedCell?.seatIdx === seatIdx,
                    },
                  ]"
                  :title="
                    quizzerHasErrors(teamIdx, seatIdx)
                      ? quizzerValidationMessages(teamIdx, seatIdx).join('\n')
                      : undefined
                  "
                >
                  <div class="name-cell-inner" @click="focusName">
                    <span class="name-main">
                      <span
                        class="drag-handle"
                        @pointerdown="onPointerDown(teamIdx, seatIdx, $event)"
                        >⠿</span
                      >
                      <span
                        class="name-input-sizer name-input-sizer--quizzer"
                        :data-value="quizzer.name || quizzerPlaceholder(seatIdx)"
                      >
                        <input
                          :class="[
                            'editable-name',
                            'editable-name--quizzer',
                            {
                              'editable-name--diverged': meetSession.isQuizzerDiverged(
                                teamIdx,
                                seatIdx,
                                quizzer.name,
                              ),
                            },
                          ]"
                          :data-tutorial="`quizzer-name-${teamIdx}-${seatIdx}`"
                          :placeholder="quizzerPlaceholder(seatIdx)"
                          :value="quizzer.name"
                          @input="
                            setQuizzerName(
                              teamIdx,
                              seatIdx,
                              ($event.target as HTMLInputElement).value,
                            )
                          "
                          @change="relinkSeats(teamIdx)"
                          @focus="($event.target as HTMLInputElement).select()"
                          @keydown.enter="($event.target as HTMLInputElement).blur()"
                        />
                      </span>
                      <button
                        v-if="meetSession.isQuizzerDiverged(teamIdx, seatIdx, quizzer.name)"
                        class="name-restore"
                        :title="`Restore: ${meetSession.getDbName(teamIdx, seatIdx)}`"
                        @click.stop="restoreQuizzerName(teamIdx, seatIdx)"
                      >
                        ↺
                      </button>
                      <button
                        v-else-if="quizzer.name"
                        class="name-clear"
                        :data-tutorial="`name-clear-${teamIdx}-${seatIdx}`"
                        title="Clear name (empty seat)"
                        @click.stop="setQuizzerName(teamIdx, seatIdx, '')"
                      >
                        ×
                      </button>
                    </span>
                    <span v-if="scoring[teamIdx]?.quizzers[seatIdx]" class="quizzer-stats">
                      <span
                        v-if="scoring[teamIdx]!.quizzers[seatIdx]!.quizzedOut"
                        :class="[
                          'stat-badge',
                          'stat-badge--quizout',
                          {
                            'stat-badge--quizout-bonus':
                              scoring[teamIdx]!.quizzers[seatIdx]!.teamQuizoutBonus,
                          },
                        ]"
                        :title="
                          scoring[teamIdx]!.quizzers[seatIdx]!.teamQuizoutBonus
                            ? 'Quiz-out with bonus (+10)'
                            : 'Quiz-out'
                        "
                        ><span class="stat-badge__label">Q</span></span
                      >
                      <span
                        v-else-if="
                          scoring[teamIdx]!.quizzers[seatIdx]!.erroredOut &&
                          !scoring[teamIdx]!.quizzers[seatIdx]!.fouledOut
                        "
                        class="stat-badge stat-badge--errorout"
                        title="Errored out"
                        >E</span
                      >
                      <span
                        v-else-if="scoring[teamIdx]!.quizzers[seatIdx]!.fouledOut"
                        class="stat-badge stat-badge--foulout"
                        title="Fouled out"
                        >F</span
                      >
                      <span
                        v-if="
                          scoring[teamIdx]!.quizzers[seatIdx]!.out.correct > 0 &&
                          !scoring[teamIdx]!.quizzers[seatIdx]!.quizzedOut
                        "
                        class="stat-count stat-count--correct"
                        :title="`${scoring[teamIdx]!.quizzers[seatIdx]!.out.correct} correct`"
                        >{{ scoring[teamIdx]!.quizzers[seatIdx]!.out.correct }}c</span
                      >
                      <span
                        v-if="
                          scoring[teamIdx]!.quizzers[seatIdx]!.out.errors > 0 &&
                          !(
                            scoring[teamIdx]!.quizzers[seatIdx]!.erroredOut &&
                            !scoring[teamIdx]!.quizzers[seatIdx]!.fouledOut
                          )
                        "
                        class="stat-count stat-count--error"
                        :title="`${scoring[teamIdx]!.quizzers[seatIdx]!.out.errors} error(s)`"
                        >{{ scoring[teamIdx]!.quizzers[seatIdx]!.out.errors }}e</span
                      >
                      <span
                        v-if="
                          scoring[teamIdx]!.quizzers[seatIdx]!.out.fouls > 0 &&
                          !scoring[teamIdx]!.quizzers[seatIdx]!.fouledOut
                        "
                        class="stat-count stat-count--foul"
                        :title="`${scoring[teamIdx]!.quizzers[seatIdx]!.out.fouls} foul(s)`"
                        >{{ scoring[teamIdx]!.quizzers[seatIdx]!.out.fouls }}f</span
                      >
                      <span
                        v-if="
                          !isEmptySeat(teamIdx, seatIdx) &&
                          quizzerScoreLabel(teamIdx, seatIdx) !== null
                        "
                        class="stat-count stat-count--individual"
                        title="Individual score"
                        >{{ quizzerScoreLabel(teamIdx, seatIdx) }}</span
                      >
                    </span>
                  </div>
                </td>
                <td
                  v-for="{ col, idx, entering } in displayColumns"
                  :key="col.key"
                  :ref="
                    (el: any) => registerCellEl(teamIdx, seatIdx, idx, el as HTMLElement | null)
                  "
                  :data-tutorial="`cell-${teamIdx}-${seatIdx}-${idx}`"
                  :class="[
                    'cell',
                    cellClass[cells[teamIdx]?.[seatIdx]?.[idx] ?? CellValue.Empty],
                    colGroupClass(idx),
                    { 'timeout-after': hasTimeoutAfterCol(col.key) },
                    {
                      'cell--greyed':
                        (isEmptySeat(teamIdx, seatIdx) &&
                          cells[teamIdx]?.[seatIdx]?.[idx] === '') ||
                        ((isGreyedOut(teamIdx, seatIdx, idx) || noJumps[idx]) &&
                          cells[teamIdx]?.[seatIdx]?.[idx] === '') ||
                        isAfterOut(teamIdx, seatIdx, idx) ||
                        (isFouledOnQuestion(teamIdx, seatIdx, idx) &&
                          cells[teamIdx]?.[seatIdx]?.[idx] === ''),
                    },
                    { 'cell--invalid': isInvalid(teamIdx, seatIdx, idx) },
                    { 'col--entering': entering },
                    { 'col--hover': !dragState && hoverCol === idx },
                    {
                      'cell--focused':
                        keyboardMode &&
                        focusedCell?.teamIdx === teamIdx &&
                        focusedCell?.seatIdx === seatIdx &&
                        focusedCell?.colIdx === idx,
                    },
                  ]"
                  :title="
                    isInvalid(teamIdx, seatIdx, idx)
                      ? cellValidationMessages(teamIdx, seatIdx, idx).join('\n')
                      : undefined
                  "
                  @click="onCellClick(teamIdx, seatIdx, idx, $event)"
                  @mouseenter="hoverCol = idx"
                  @mouseleave="hoverCol = null"
                >
                  {{ cellDisplay[cells[teamIdx]?.[seatIdx]?.[idx] ?? CellValue.Empty] }}
                </td>
                <!-- Team total spans quizzer rows only -->
                <td
                  v-if="seatIdx === 0"
                  :data-tutorial="`team-total-${teamIdx}`"
                  :class="[
                    'col--total',
                    'team-total-value',
                    { 'cell--invalid': teamHasErrors(teamIdx) },
                  ]"
                  :rowspan="teamQuizzers[teamIdx]?.length ?? 5"
                  :title="
                    teamHasErrors(teamIdx) ? teamValidationMessages(teamIdx).join('\n') : undefined
                  "
                >
                  <span v-if="placements[teamIdx]" class="placement-medal">{{
                    Math.floor(placements[teamIdx]!) === 1
                      ? '🥇'
                      : Math.floor(placements[teamIdx]!) === 2
                        ? '🥈'
                        : '🥉'
                  }}</span>
                  {{ scoring[teamIdx]?.total ?? 0 }}
                  <span v-if="placementPoints[teamIdx] !== null" class="placement-points">
                    {{ placementPoints[teamIdx] }} pts
                  </span>
                </td>
              </tr>

              <!-- Team running total row -->
              <tr class="row--team-total">
                <td class="col--left-spacer" />
                <td
                  :ref="
                    teamIdx === 0 ? (el: any) => (stickyAreaRef = el as HTMLElement) : undefined
                  "
                  class="col--name sticky-col running-total-label"
                  colspan="2"
                >
                  <span
                    class="on-time"
                    :class="{ 'on-time--active': team.onTime }"
                    :data-tutorial="`on-time-${teamIdx}`"
                    @click.stop="toggleOnTime(teamIdx)"
                  >
                    <span class="on-time-box">✓</span>
                    <span class="on-time-label">on time</span>
                  </span>
                  Score
                  <span class="baseline-score">{{ baselineScore(teamIdx) }}</span>
                </td>
                <td
                  v-for="{ col, idx, entering } in displayColumns"
                  :key="col.key"
                  :class="[
                    'cell--total',
                    colGroupClass(idx),
                    { 'col--entering': entering, 'timeout-after': hasTimeoutAfterCol(col.key) },
                  ]"
                  style="position: relative"
                >
                  {{
                    scoring[teamIdx]?.runningTotals[idx] ??
                    (boundaryColIndices.has(idx) || trailingTotalIndices.has(idx)
                      ? boundaryTotal(teamIdx, idx)
                      : '')
                  }}
                  <span
                    v-if="scoring[teamIdx]?.uniqueQuizzerBonusCols.has(idx)"
                    class="running-total-badge running-total-badge--unique"
                    >{{
                      scoring[teamIdx]!.uniqueQuizzerBonusCols.get(idx) === 3
                        ? '3rd'
                        : scoring[teamIdx]!.uniqueQuizzerBonusCols.get(idx) === 4
                          ? '4th'
                          : '5th'
                    }}</span
                  >
                  <span
                    v-if="scoring[teamIdx]?.quizoutBonusCols.has(idx)"
                    class="running-total-badge running-total-badge--quizout"
                    >Q</span
                  >
                  <span
                    v-if="scoring[teamIdx]?.freeErrorCols.has(idx)"
                    class="running-total-badge running-total-badge--free-error"
                    title="Free error (no deduction)"
                    >≈</span
                  >
                  <span
                    v-if="scoring[teamIdx]?.foulDeductCols.has(idx)"
                    class="running-total-badge running-total-badge--foul-deduct"
                    title="Foul deduction (-10)"
                    >F</span
                  >
                </td>
                <td class="running-total-spacer" />
              </tr>

              <!-- Spacer between teams -->
              <tr v-if="teamIdx < teams.length - 1" class="spacer-row spacer-row--team">
                <td class="col--left-spacer" />
                <td class="sticky-col" colspan="2" />
                <td
                  v-for="{ col, idx, entering } in displayColumns"
                  :key="col.key"
                  :class="[
                    'spacer-cell',
                    colGroupClass(idx),
                    { 'col--entering': entering, 'timeout-after': hasTimeoutAfterCol(col.key) },
                  ]"
                />
                <td />
              </tr>
            </template>
          </tbody>

          <!-- No-jump row at bottom -->
          <tfoot>
            <tr class="spacer-row">
              <td class="col--left-spacer" />
              <td class="sticky-col" colspan="2" />
              <td
                v-for="{ col, idx, entering } in displayColumns"
                :key="col.key"
                :class="[
                  'spacer-cell',
                  colGroupClass(idx),
                  { 'col--entering': entering, 'timeout-after': hasTimeoutAfterCol(col.key) },
                ]"
              />
              <td />
            </tr>
            <tr class="row--no-jump">
              <td class="col--left-spacer" />
              <td class="col--name sticky-col no-jump-label" colspan="2">No Jump</td>
              <td
                v-for="{ col, idx, entering } in displayColumns"
                :key="col.key"
                :data-tutorial="`no-jump-${idx}`"
                :class="[
                  'cell cell--no-jump',
                  colGroupClass(idx),
                  {
                    'cell--no-jump-active': noJumps[idx] && colAnswerValue(idx) === CellValue.Empty,
                    'cell--no-jump-answered': colAnswerValue(idx) !== CellValue.Empty,
                    'cell--invalid': noJumpHasConflict(idx),
                    'col--entering': entering,
                    'cell--focused': keyboardMode && isNoJumpFocus() && focusedCell?.colIdx === idx,
                  },
                ]"
                :title="
                  noJumpHasConflict(idx) ? columnValidationMessages(idx).join('\n') : undefined
                "
                @click="onNoJumpClick(idx)"
                @mouseenter="hoverCol = idx"
                @mouseleave="hoverCol = null"
              >
                <span :style="{ visibility: noJumps[idx] ? 'visible' : 'hidden' }">✗</span>
              </td>
              <td class="col--total no-jump-total" />
            </tr>
          </tfoot>
        </table>
        <div class="table-footer">
          <span>v{{ appVersion }}</span>
          <span class="table-footer__sep">·</span>
          <a href="https://github.com/TommyAmberson/qzr-sheet" target="_blank" rel="noopener"
            >GitHub</a
          >
          <span class="table-footer__sep">·</span>
          <a href="https://github.com/TommyAmberson/qzr-sheet/issues" target="_blank" rel="noopener"
            >Issues &amp; feature requests</a
          >
        </div>
      </div>
      <!-- Cell selector popup -->
      <Teleport to="body">
        <MeetPickerDialog ref="meetPickerRef" @picked="linkPickedMeet" />
        <StoredQuizPickerDialog ref="storedPickerRef" :on-pick="openPickedStored" />
        <RecentQuizzesDialog
          ref="recentRef"
          :on-restore="restoreRecent"
          :on-open-newer="openNewerRecent"
        />
        <MeetWarningsDialog ref="warningsDialogRef" :warnings="meetWarningEntries" />
        <ChoiceDialog ref="choiceDialog" />
        <RoomCodeDialog ref="roomCodeDialog" />
        <datalist id="team-name-options">
          <option v-for="name in offeredTeamNames" :key="name" :value="name" />
        </datalist>
        <SchedulePickerDialog
          ref="schedulePickerRef"
          :title="SCHEDULE_PICKS[schedulePickUse].title"
          :on-pick="pickScheduledQuiz"
        />
        <!-- Above every other dialog while the sheet waits on the meet: nothing but Cancel -->
        <dialog
          ref="waitingDialogRef"
          class="waiting-dialog"
          @cancel.prevent="cancelWaiting"
          @keydown.stop
        >
          <template v-if="waitingFor">
            <p class="waiting-dialog__text">{{ waitingFor }}…</p>
            <button class="waiting-dialog__cancel" @click="cancelWaiting">Cancel</button>
          </template>
        </dialog>
        <div
          v-if="selector"
          :class="[
            'selector-backdrop',
            { 'selector-elevated': tutorial.currentStep.value?.allowSelectorPopup },
          ]"
          @click="closeSelector"
        >
          <div
            :class="[
              'selector-popup',
              { 'selector-elevated': tutorial.currentStep.value?.allowSelectorPopup },
            ]"
            :style="{ left: selector.x + 'px', top: selector.y + 'px' }"
            @click.stop
          >
            <button
              v-for="(opt, oi) in selectorOptions"
              :key="opt.label"
              :class="[
                'selector-opt',
                opt.cls,
                { 'selector-opt--focused': oi === selectorFocusIdx },
              ]"
              @click="selectValue(opt.value)"
              @mouseenter="selectorFocusIdx = oi"
            >
              {{ opt.label }}
            </button>
          </div>
        </div>
      </Teleport>
    </div>

    <TutorialOverlay
      v-if="tutorial.active.value && tutorial.currentStep.value"
      :step="tutorial.currentStep.value"
      :step-index="tutorial.currentStepIndex.value"
      :total-steps="tutorial.totalSteps"
      :target-els="tutorial.targetEls.value"
      :completed="tutorial.stepCompleted.value"
      @next="tutorial.onNext()"
      @skip="tutorial.finish()"
    />
  </div>
</template>

<style scoped>
.scoresheet-outer {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.scoresheet-wrapper {
  overflow: auto;
  flex: 1;
  min-height: 0;
  padding: 0 0 1rem 0;
  box-sizing: border-box;
  touch-action: pan-x pan-y;
  -webkit-overflow-scrolling: touch;
}

.scoresheet-content {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  min-width: min-content;
  padding-right: 1rem;
}

.meta-row {
  display: flex;
  align-items: flex-start;
  gap: 0;
  margin-bottom: 0.75rem;
  padding-top: 1rem;
  min-width: max-content;
  flex-shrink: 0;
}

.notice-row {
  display: flex;
  margin-bottom: 0.75rem;
  min-width: max-content;
}

.notice-row-inner {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.notice {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
  padding: 0.35rem 0.6rem;
  border: 1px solid var(--color-invalid);
  border-radius: 4px;
  /* The header's own surface: the red border is the warning */
  background: var(--color-meta-bg);
  color: var(--color-invalid-text);
  font-size: 0.8rem;
  font-weight: 600;
}

.notice-action {
  padding: 0.1rem 0.5rem;
  border: 1px solid var(--color-invalid);
  border-radius: 4px;
  background: var(--color-bg);
  color: var(--color-text);
  font-size: 0.75rem;
  cursor: pointer;
}

.meta-row-inner {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  flex: 1;
}

.quiz-meta {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  padding: 0.5rem 0.85rem;
  background: var(--color-meta-bg);
  border: 1px solid var(--color-meta-accent);
  border-left: 3px solid var(--color-meta-border);
  border-radius: 6px;
  color: var(--color-text);
  font-family: 'Segoe UI', system-ui, sans-serif;
  font-size: 0.8rem;
  transition:
    background 0.4s,
    color 0.4s,
    border-color 0.4s;
}

.quiz-meta--error {
  border-color: var(--color-invalid);
  border-left-color: var(--color-invalid);
}
.quiz-meta--error .meta-label {
  color: var(--color-invalid-text);
}

.quiz-meta--complete {
  border-left-color: var(--color-accent);
}

.meta-status {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.2rem;
  height: 1.2rem;
  border-radius: 50%;
  font-size: 0.7rem;
  font-weight: 800;
  margin-left: 0.25rem;
  flex-shrink: 0;
  transition: all 0.3s;
}
.meta-status--pending {
  color: var(--color-meta-accent);
  font-size: 1rem;
}
.meta-status--complete {
  background: var(--color-accent);
  color: var(--color-bg);
}
.meta-status--error {
  background: var(--color-invalid);
  color: var(--color-bg);
  border-radius: 3px;
  font-size: 0.8rem;
}

.meta-field--status {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.15rem 0.45rem 0.15rem 0.35rem;
  border: 1px solid var(--color-meta-accent);
  border-left: 2px solid var(--color-meta-accent);
  border-radius: 4px;
  font-size: 0.75rem;
}
.meta-field--status--complete {
  border-left-color: var(--color-accent);
}
.meta-field--status--error {
  border-left-color: var(--color-invalid);
}
.meta-field--status .meta-label {
  text-transform: none;
  letter-spacing: normal;
}
.meta-status--complete + .meta-label {
  color: var(--color-accent);
}
.meta-status--error + .meta-label {
  color: var(--color-invalid-text);
}

.meta-sep {
  color: var(--color-meta-accent);
  font-size: 0.9rem;
  user-select: none;
}
.meta-divider {
  width: 1px;
  height: 1.25rem;
  background: var(--color-meta-accent);
  align-self: center;
  margin: 0 0.1rem;
  opacity: 0.6;
}
.meta-group {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0 0.35rem;
  border: 1px solid var(--color-meta-accent);
  border-radius: 4px;
  background: color-mix(in srgb, var(--color-meta-accent) 15%, transparent);
}
.meta-group-sep {
  width: 1px;
  height: 1rem;
  background: var(--color-meta-accent);
  align-self: center;
  opacity: 0.5;
  margin: 0 0.1rem;
}

.meta-field {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.meta-format {
  padding: 0.15rem 0.4rem;
  border: 1px solid var(--color-meta-accent);
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-text);
  white-space: nowrap;
}

.meta-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.meta-field input[type='text'] {
  width: 3rem;
  padding: 0.2rem 0.3rem;
  border: 1px solid var(--color-meta-accent);
  border-radius: 4px;
  /* Form controls don't inherit the bar's font, so they'd fall back to the browser's */
  font-family: inherit;
  font-size: 0.8rem;
  font-weight: 600;
  text-align: center;
  background: var(--color-bg);
  color: var(--color-text);
}
/* Wide enough for a name such as `Junior` */
.meta-field input.division-text {
  width: 4rem;
}
.meta-field input[type='text']:focus {
  outline: 1px solid var(--color-accent);
  outline-offset: 0;
  border-color: var(--color-accent);
}
.meta-field .division-select {
  width: 3.5rem;
  padding: 0.2rem 1.2rem 0.2rem 0.3rem;
  border: 1px solid var(--color-meta-accent);
  border-radius: 4px;
  font-family: inherit;
  font-size: 0.8rem;
  font-weight: 600;
  background: var(--color-bg)
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8' viewBox='0 0 8 8'%3E%3Cpath fill='%23888' d='M0 2l4 4 4-4z'/%3E%3C/svg%3E")
    no-repeat right 0.3rem center;
  color: var(--color-text);
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
}
.consolation-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  cursor: pointer;
  padding: 0.15rem 0.4rem 0.15rem 0.25rem;
  border-radius: 4px;
  transition: background 0.15s;
}
.consolation-toggle:hover {
  background: var(--color-border-alt);
}
.consolation-toggle--active .on-time-box {
  background: var(--color-text);
  border-color: var(--color-text);
  color: var(--color-bg);
}
.consolation-toggle--active .on-time-label {
  color: var(--color-text-muted);
}
.meta-field .division-select:focus {
  outline: 1px solid var(--color-accent);
  outline-offset: 0;
  border-color: var(--color-accent);
}

/* Toggle switch */
.meta-field--toggle {
  gap: 0.35rem;
  cursor: pointer;
}
.meta-field--toggle input[type='checkbox'] {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}
.toggle-track {
  display: inline-block;
  width: 1.75rem;
  height: 1rem;
  background: var(--color-meta-accent);
  border-radius: 999px;
  position: relative;
  transition: background 0.2s;
}
.meta-field--toggle input:checked + .toggle-track {
  background: var(--color-accent);
}
.toggle-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: calc(1rem - 4px);
  height: calc(1rem - 4px);
  background: var(--color-bg);
  border-radius: 50%;
  transition: transform 0.2s;
}
.meta-field--toggle input:checked + .toggle-track .toggle-thumb {
  transform: translateX(calc(1.75rem - 1rem));
}
.meta-field--toggle .meta-label {
  font-size: 0.75rem;
  color: var(--color-text-muted);
}
.meta-field--toggle input:checked ~ .meta-label {
  color: var(--color-text);
  font-weight: 600;
}

/* Undo/redo buttons — joined pill */
.meta-field--undo {
  display: inline-flex;
  border: 1px solid var(--color-meta-accent);
  border-radius: 4px;
  background: color-mix(in srgb, var(--color-meta-accent) 8%, transparent);
  overflow: hidden;
  gap: 0;
}
.meta-field--undo button {
  background: none;
  border: none;
  border-right: 1px solid var(--color-meta-accent);
  border-radius: 0;
  cursor: pointer;
  color: var(--color-text-muted);
  font-size: 1rem;
  line-height: 1;
  padding: 0.15rem 0.5rem;
  transition: color 0.15s;
}
.meta-field--undo button:last-child {
  border-right: none;
}
.meta-field--undo button:not(:disabled):hover {
  color: var(--color-text);
  background: color-mix(in srgb, var(--color-meta-accent) 18%, transparent);
}
.meta-field--undo button:disabled {
  opacity: 0.3;
  cursor: default;
}

/* File action buttons (save, open, new) */
.meta-field--file {
  display: inline-flex;
  gap: 0.35rem;
}
.meta-field--file button {
  background: color-mix(in srgb, var(--color-meta-accent) 20%, transparent);
  border: 1px solid var(--color-meta-accent);
  cursor: pointer;
  color: var(--color-text-muted);
  font-size: 0.75rem;
  font-weight: 600;
  line-height: 1;
  padding: 0.3rem 0.5rem;
  border-radius: 4px;
  transition:
    color 0.15s,
    border-color 0.15s,
    background 0.15s;
}
.meta-field--file button:hover {
  color: var(--color-text);
  border-color: var(--color-text-faint);
  background: var(--color-border-alt);
}

.menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10; /* above sticky cols (4) but below file-menu (50) and team picker (9999) */
}

.file-menu {
  position: relative;
}

.file-menu__dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 50;
  display: flex;
  flex-direction: column;
  min-width: 9rem;
  background: var(--color-bg);
  border: 1px solid var(--color-border-alt);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  padding: 3px;
  gap: 1px;
}

.file-menu__dropdown button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.file-menu__dropdown button {
  width: 100%;
  text-align: left !important;
  border-radius: 4px !important;
  border-color: transparent !important;
  padding: 0.35rem 0.6rem !important;
  white-space: nowrap;
}

.file-menu__divider {
  border: none;
  border-top: 1px solid var(--color-border-alt);
  margin: 2px 0;
}

.link-menu {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
}

.meta-session-pill {
  font: inherit;
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--color-accent);
  background: color-mix(in srgb, var(--color-accent) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-accent) 30%, transparent);
  border-radius: 999px;
  padding: 0.15rem 0.5rem;
  white-space: nowrap;
  cursor: pointer;
}

/* Nothing linked: an offer to link, quieter than a link that is there */
.meta-session-pill--unlinked {
  color: var(--color-text-faint);
  background: none;
  border-color: var(--color-border-alt);
}

.link-refresh {
  font: inherit;
  font-size: 0.85rem;
  line-height: 1;
  color: var(--color-accent);
  background: none;
  border: none;
  border-radius: 999px;
  padding: 0.1rem 0.25rem;
  cursor: pointer;
}

.link-refresh:hover {
  background: color-mix(in srgb, var(--color-accent) 12%, transparent);
}

.waiting-dialog {
  border: 1px solid var(--color-border-alt);
  border-radius: 10px;
  background: var(--color-bg);
  color: var(--color-text);
  padding: 1.25rem;
  width: min(22rem, 90vw);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  inset: 0;
  margin: auto;
  text-align: center;
}

.waiting-dialog::backdrop {
  background: rgba(0, 0, 0, 0.4);
}

.waiting-dialog__text {
  font-size: 0.85rem;
  margin: 0 0 1rem;
}

.waiting-dialog__cancel {
  background: none;
  border: 1px solid var(--color-border-alt);
  border-radius: 6px;
  padding: 0.4rem 0.8rem;
  font: inherit;
  font-size: 0.8rem;
  color: var(--color-text);
  cursor: pointer;
}

.meta-meet-warnings {
  font: inherit;
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--palette-warning, #b45309);
  white-space: nowrap;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
}

.team-picker-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  border-radius: 50%;
  color: inherit;
  cursor: pointer;
  flex-shrink: 0;
  width: 1rem;
  height: 1rem;
  padding: 0;
  opacity: 0.85;
}

.team-picker-trigger:hover,
.team-picker-trigger.is-open {
  background: var(--color-border-alt);
  opacity: 1;
}

.team-picker-chevron {
  flex-shrink: 0;
  opacity: 0.45;
  transition: transform 0.15s ease;
}

.team-picker-trigger.is-open .team-picker-chevron {
  transform: rotate(180deg);
}

@keyframes picker-enter {
  from {
    opacity: 0;
    transform: translateY(-3px) scale(0.985);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.team-picker-menu {
  position: fixed;
  z-index: 9999;
  background: var(--color-bg);
  border: 1px solid var(--color-border-alt);
  border-radius: 6px;
  box-shadow:
    0 2px 8px rgba(0, 0, 0, 0.12),
    0 8px 24px rgba(0, 0, 0, 0.2);
  min-width: 130px;
  max-height: 240px;
  overflow-y: auto;
  padding: 3px;
  transform-origin: top left;
  animation: picker-enter 0.12s ease-out;
}

.team-picker-option {
  display: block;
  width: 100%;
  background: none;
  border: none;
  border-radius: 4px;
  color: var(--color-text);
  cursor: pointer;
  font-family: inherit;
  font-size: 0.8rem;
  padding: 0.35rem 0.6rem;
  text-align: left;
  white-space: nowrap;
}

.team-picker-option:hover {
  background: var(--color-border-alt);
}

.team-picker-option.is-selected {
  color: var(--color-accent);
  font-weight: 600;
}

.team-picker-option--clear {
  border-top: 1px solid var(--color-border-alt);
  color: var(--color-text-muted);
  margin-top: 3px;
  padding-top: 0.35rem;
}

.team-picker-option--clear:hover {
  color: var(--color-text);
}

.editable-name--diverged {
  border-bottom: 1.5px solid var(--palette-warning, #b45309) !important;
}

.name-restore {
  display: none;
  align-items: center;
  justify-content: center;
  border: none;
  background: none;
  color: var(--palette-warning, #b45309);
  font-size: 0.75rem;
  line-height: 1;
  width: 1rem;
  height: 1rem;
  border-radius: 50%;
  cursor: pointer;
  flex-shrink: 0;
  padding: 0;
  margin-left: 0.1rem;
}

.name-main:hover .name-restore {
  display: inline-flex;
}

.name-restore:hover {
  background: var(--color-border-alt);
}

/* Theme toggle — styled like file action buttons */
.theme-toggle {
  background: color-mix(in srgb, var(--color-meta-accent) 20%, transparent);
  border: 1px solid var(--color-meta-accent);
  cursor: pointer;
  font-size: 1rem;
  line-height: 1;
  padding: 0.15rem 0.55rem;
  border-radius: 4px;
  transition:
    background 0.15s,
    border-color 0.15s;
}
.theme-toggle:hover {
  background: var(--color-border-alt);
  border-color: var(--color-text-faint);
}
.help-toggle {
  background: color-mix(in srgb, var(--color-meta-accent) 20%, transparent);
  border: 1px solid var(--color-meta-accent);
  cursor: pointer;
  font-size: 0.95rem;
  font-weight: 700;
  line-height: 1;
  padding: 0.15rem 0.6rem;
  border-radius: 4px;
  color: var(--color-text);
  transition:
    background 0.15s,
    border-color 0.15s;
}
.help-toggle:hover {
  background: var(--color-border-alt);
  border-color: var(--color-text-faint);
}

.scoresheet {
  border-collapse: separate;
  border-spacing: 0;
  font-family: 'Segoe UI', system-ui, sans-serif;
  font-size: 0.8rem;
  white-space: nowrap;
  width: 100%;
  table-layout: auto;
  flex-shrink: 0;
}

.scoresheet th,
.scoresheet td {
  border-right: 1px solid var(--color-border);
  border-bottom: 1px solid var(--color-border);
  padding: 0.25rem 0.4rem;
  text-align: center;
  min-width: 2rem;
  min-height: 1.8rem;
  height: auto;
  background: var(--color-bg);
}

/* Left and top outer edges */
.scoresheet tr th:first-child,
.scoresheet tr td:first-child {
  border-left: 1px solid var(--color-border);
}
.scoresheet thead tr:first-child th,
.scoresheet tbody tr:first-child td {
  border-top: 1px solid var(--color-border);
}

/* Left spacer column — scrolls away to give breathing room at rest */
.col--left-spacer {
  width: 1rem;
  min-width: 1rem !important;
  max-width: 1rem !important;
  padding: 0 !important;
  border: none !important;
  background: transparent !important;
  box-shadow: none !important;
}

/* Sticky first column — above sticky header row */
.sticky-col {
  position: sticky;
  left: 0;
  z-index: 3;
  background: var(--color-bg);
  box-shadow: 1px 0 0 var(--color-border);
}

/* Sticky header row — below sticky column */
thead tr th {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--color-bg-warm);
  box-shadow: 0 1px 0 var(--color-border);
}

/* Top-left corner: sticky on both axes — highest z-index, fully invisible */
thead tr th.sticky-col {
  z-index: 4;
  background: transparent !important;
  box-shadow: none;
  border: none !important;
}

.scoresheet .col--name {
  text-align: left;
  min-width: 10rem;
  max-width: 10rem;
  font-weight: 500;
}

.col--total {
  min-width: 3rem;
  font-weight: 600;
  background: var(--color-border-alt);
}
.col--total-header {
  background: transparent !important;
  border-right: none !important;
  border-bottom: none !important;
  border-top: none !important;
  box-shadow: none !important;
}

/* Column group shading */

/* Spacer row — half-height transparent gap */
.spacer-row td {
  height: 0.35rem;
  padding: 0 !important;
  border: none !important;
  background: transparent !important;
}
.spacer-row--team td {
  height: 1rem;
}
.spacer-row .spacer-cell {
  border-right: 1px solid var(--color-border-alt) !important;
}
.spacer-row .sticky-col {
  background: var(--color-bg-warm) !important;
  box-shadow: 1px 0 0 var(--color-border);
}

/* Question header row — empty name cell blends with background */
/* Question number label inside header cell */
.scoresheet .col--question {
  font-weight: 700;
  background: var(--color-bg-warm);
  color: var(--color-text);
  font-size: 0.75rem;
}
.col--question.col--ab {
  box-shadow:
    0 1px 0 var(--color-border),
    inset 0 2px 0 var(--color-ab-border);
}
.col--question.col--overtime {
  box-shadow:
    0 1px 0 var(--color-border),
    inset 0 2px 0 var(--color-ot-border);
}

/* Dotted boundary borders on light-border rows.
 * Use box-shadow for left edge (avoids doubling with border-separate)
 * and border-right for right edge. */
.col--question.col--ot-start,
.col--question.col--ot-round-start {
  border-left: none !important;
}
.spacer-cell.col--ot-start,
.spacer-cell.col--ot-round-start,
.team-header-spacer.col--ot-start,
.team-header-spacer.col--ot-round-start,
.row--team-total .col--ot-start,
.row--team-total .col--ot-round-start,
.row--team-total .cell--total.col--ot-start,
.row--team-total .cell--total.col--ot-round-start {
  border-left: none !important;
  box-shadow: none !important;
}

/* Question header colours based on answer */
.col--header-correct {
  color: var(--color-correct) !important;
}
.col--header-error {
  color: var(--color-error) !important;
}
.col--header-bonus {
  color: var(--color-bonus) !important;
}
.col--header-missed-bonus {
  color: var(--color-missed-bonus) !important;
}
.col--header-no-jump {
  color: var(--palette-no-jump) !important;
}
.col--header-invalid {
  outline: 2px solid var(--color-invalid);
  outline-offset: -2px;
  animation: pulse-invalid 1.5s ease-in-out infinite;
}

/* Team header row */
.row--team-header {
  background: transparent;
  color: var(--color-team-white);
}
.team-header-spacer {
  background: transparent !important;
  border-top: none !important;
  border-left: none !important;
  border-right: 1px solid var(--color-border-alt) !important;
  border-bottom: 1px solid var(--color-border) !important;
}
.team-score-label {
  background: transparent !important;
  color: var(--color-text);
  font-weight: 800;
  font-size: 1rem;
  text-align: center !important;
  border-top: none !important;
  border-right: none !important;
  border-bottom: 1px solid var(--color-border) !important;
}
.running-total-spacer {
  background: transparent !important;
  border: none !important;
}
.row--team-header .team-name {
  font-weight: 700;
  font-size: 0.85rem;
  background: var(--color-text-muted);
  color: var(--color-bg-warm);
  text-align: left;
  padding-left: 0.5rem;
  border: 1px solid var(--color-text-muted) !important;
  border-bottom: 1px solid var(--color-border) !important;
}
.row--team-header .team-name .name-cell-inner::before {
  content: '';
  display: block;
  width: 0.85rem;
  height: 0.85rem;
  border-radius: 3px;
  margin-right: 0.4rem;
  flex-shrink: 0;
  border: 1px solid var(--color-text-faint);
}
.row--team-header.team--red .team-name .name-cell-inner::before {
  background: var(--color-team-red);
}
.row--team-header.team--white .team-name .name-cell-inner::before {
  background: var(--color-team-white);
}
.row--team-header.team--blue .team-name .name-cell-inner::before {
  background: var(--color-team-blue);
}

/* Team total row */
.row--team-total {
  background: transparent;
  font-weight: 600;
  font-size: 0.75rem;
  font-style: italic;
  color: var(--color-text-muted);
}
.row--team-total td {
  background: transparent !important;
  border: none !important;
}
.row--team-total .cell--total {
  border-left: none !important;
  border-right: 1px solid var(--color-border-alt) !important;
}
.row--team-total .sticky-col {
  background: transparent;
  box-shadow: none;
}
.row--team-total .running-total-label {
  background: var(--color-bg-warm) !important;
  box-shadow: 1px 0 0 var(--color-border);
}
.team-total-value {
  font-size: 2.5rem;
  vertical-align: middle;
  position: relative;
  border-top: none !important;
}

/* Boundary border rules — must come after all row-specific overrides */
/* Question header: solid ot-border colour on all boundaries */
.col--question.col--last,
.col--question.col--reg-last,
.col--question.col--ot-round-end {
  border-right: 1px solid var(--color-border) !important;
}
/* Spacer/team-header/running-total: dotted plain border */
.spacer-cell.col--last,
.team-header-spacer.col--last,
.row--team-total .col--last,
.row--team-total .cell--total.col--last,
.spacer-cell.col--reg-last,
.team-header-spacer.col--reg-last,
.row--team-total .col--reg-last,
.row--team-total .cell--total.col--reg-last,
.spacer-cell.col--ot-round-end,
.team-header-spacer.col--ot-round-end,
.row--team-total .col--ot-round-end,
.row--team-total .cell--total.col--ot-round-end {
  border-right: 2px dotted var(--color-border) !important;
}
/* Answer/no-jump cells: same as normal cell borders */
.cell.col--last,
.cell.col--reg-last,
.cell.col--ot-round-end {
  border-right: 1px solid var(--color-border) !important;
}

.placement-medal {
  position: absolute;
  top: 0.15rem;
  right: 0.2rem;
  font-size: 1.1rem;
  line-height: 1;
}

/* Placement points */
.placement-points {
  display: block;
  font-size: 0.7rem;
  font-weight: 700;
  font-style: normal;
  color: var(--color-text-muted);
  line-height: 1;
  margin-top: 0.2rem;
}

/* On-time tick */
.on-time {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  cursor: pointer;
  vertical-align: middle;
  padding: 0.15rem 0.4rem 0.15rem 0.25rem;
  border-radius: 4px;
  transition: background 0.15s;
}
.on-time:hover {
  background: var(--color-border-alt);
}
.on-time-box {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1rem;
  height: 1rem;
  border-radius: 3px;
  font-size: 0.65rem;
  border: 1.5px solid var(--color-text-faint);
  color: transparent;
  background: var(--color-bg);
  transition: all 0.15s;
}
.on-time--active .on-time-box {
  background: var(--color-text);
  border-color: var(--color-text);
  color: var(--color-bg);
}
.on-time-label {
  font-size: 0.65rem;
  font-weight: 600;
  color: var(--color-text-faint);
  text-transform: lowercase;
  transition: color 0.15s;
}
.on-time--active .on-time-label {
  color: var(--color-text-muted);
}

/* No-jump row */
.row--no-jump {
  border-top: none;
}
.row--no-jump .sticky-col {
  border: none !important;
}
.no-jump-label {
  font-weight: 600;
  color: var(--color-text-muted);
  font-size: 0.75rem;
  text-align: right !important;
  background: var(--color-bg-warm) !important;
  border-top: 1px solid var(--color-border) !important;
}
.no-jump-total {
  background: transparent !important;
  border: none !important;
}
.cell--no-jump {
  cursor: pointer;
  user-select: none;
  color: var(--color-text-muted);
  font-size: 0.9rem;
  font-weight: 700;
  border-top: 1px solid var(--color-border);
}
.cell--no-jump:hover {
  outline: 2px solid var(--color-text-faint);
  outline-offset: -2px;
}
.cell--no-jump-active {
  background: var(--color-no-jump-alt) !important;
  color: var(--color-no-jump) !important;
  opacity: 1;
}
.cell--no-jump-answered {
  background: repeating-linear-gradient(
    -45deg,
    var(--color-grey-stripe-a),
    var(--color-grey-stripe-a) 3px,
    var(--color-grey-stripe-b) 3px,
    var(--color-grey-stripe-b) 6px
  ) !important;
  cursor: default;
}
.cell--no-jump-answered:hover {
  outline: none;
}

/* Question header inner — number + type stacked, select covers entire cell */
.col-header-inner {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0;
}
.col-header-number {
  line-height: 1.2;
  pointer-events: none;
}
.col-header-type {
  font-size: 0.6rem;
  font-weight: 700;
  color: inherit;
  opacity: 0.7;
  line-height: 1;
  margin-top: 0.15rem;
  pointer-events: none;
}
.question-type-select {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
  border: none;
  background: transparent;
  font-size: 0.75rem;
  appearance: none;
  -webkit-appearance: none;
}
.question-type-select option {
  background: var(--color-bg);
  color: var(--color-text);
  text-align: center;
}

/* Cell values */
.cell {
  cursor: pointer;
  user-select: none;
  font-weight: 700;
  outline-offset: -2px;
}
.cell:focus {
  outline: none;
}
.cell:hover {
  outline: 2px solid var(--color-border);
  outline-offset: -2px;
}

/* Crosshair highlight — quizzer name + question header only */
.row--quizzer:hover > .col--name,
.col--name--active {
  outline: 2px solid var(--color-border);
  outline-offset: -2px;
}
/* Drop the grey hover outline during drag — the drop-target's blue
   indicator is a box-shadow on every td (see .row--drop-target rules
   below), so suppressing the col--name outline here doesn't fight it. */
.is-dragging .row--quizzer:hover > .col--name {
  outline: none;
}
.col--question.col--hover {
  outline: 2px solid var(--color-border);
  outline-offset: -2px;
}

/* A quizzer who is out: their name in the colour of how they went out, as the answer cells show it,
 * readable from across the room (#243). The badge inverts to stand out on it, and the score keeps a
 * chip of the sheet's own background. A quizzer can be out two ways (quizzed out, then fouled out on
 * bonuses): the colour follows the badge shown, quiz-out first, so the later rule wins. An error-out
 * row is never also a foul-out row. */
.row--errored-out > .col--name {
  --out: var(--color-error);
  --out-light: var(--color-badge-circle-error);
}
.row--fouled-out > .col--name {
  --out: var(--color-foul);
  --out-light: var(--color-badge-circle-foul);
}
.row--quizzed-out > .col--name {
  --out: var(--color-correct);
  --out-light: var(--color-badge-circle-correct);
}
:is(.row--quizzed-out, .row--errored-out, .row--fouled-out) > .col--name {
  background: var(--out);
  color: var(--out-light);
}
:is(.row--quizzed-out, .row--errored-out, .row--fouled-out)
  > .col--name
  :is(.drag-handle, .name-clear) {
  color: var(--out-light);
}
/* Hovered, they invert as the badge does, so they don't vanish into a light hover background */
:is(.row--quizzed-out, .row--errored-out, .row--fouled-out)
  > .col--name
  :is(.drag-handle, .name-clear):hover {
  background: var(--out-light);
  color: var(--out);
}
/* The hover and selected outline, in a shade that shows on the fill */
:is(.row--quizzed-out, .row--errored-out, .row--fouled-out):hover > .col--name,
:is(.row--quizzed-out, .row--errored-out, .row--fouled-out) > .col--name.col--name--active {
  outline-color: var(--out-light);
}
/* A name that differs from the meet's roster keeps its amber warning, heavier, since amber is
 * harder to see on the fill (the foul colour especially): a thicker underline, and a bold restore
 * button edged in the fill's light shade, which is what catches the eye */
:is(.row--quizzed-out, .row--errored-out, .row--fouled-out) > .col--name .editable-name--diverged {
  /* Over the warning underline's own !important */
  border-bottom-width: 2.5px !important;
}
:is(.row--quizzed-out, .row--errored-out, .row--fouled-out) > .col--name .name-restore {
  font-weight: 800;
  -webkit-text-stroke: 0.6px currentColor;
  text-shadow:
    0 0 1px var(--out-light),
    0 0 1px var(--out-light),
    0 0 2px var(--out-light);
}
:is(.row--quizzed-out, .row--errored-out, .row--fouled-out) > .col--name .stat-badge {
  background: var(--out-light);
  color: var(--out);
}
:is(.row--quizzed-out, .row--errored-out, .row--fouled-out) > .col--name .stat-count--individual {
  background: var(--color-bg);
  color: var(--color-text);
}

/* Sticky quizzer name cell needs explicit border-top so it shows
 * through the sticky layer above the team-header's border-bottom */
.row--quizzer > .col--name {
  border-top: 1px solid var(--color-border);
  border-left: 1px solid var(--color-text-muted) !important;
  border-right: none;
}

/* Focus — blue always overrides grey hover */
.cell.cell--focused {
  outline: 2px solid var(--color-accent);
  outline-offset: -2px;
}
.row--quizzer > .col--name.col--name--focused {
  outline: 2px solid var(--color-accent);
  outline-offset: -2px;
}
.col--question.col--focus {
  outline: 2px solid var(--color-accent);
  outline-offset: -2px;
}

.cell--correct {
  color: var(--color-correct-alt);
  background-color: var(--color-correct) !important;
}
.cell--error {
  color: var(--color-error-alt);
  background-color: var(--color-error) !important;
}
.cell--foul {
  color: var(--color-foul-alt);
  background-color: var(--color-foul) !important;
}
.cell--bonus {
  color: var(--color-bonus-alt);
  background-color: var(--color-bonus) !important;
}
.cell--missed-bonus {
  color: var(--color-missed-bonus-alt);
  background-color: var(--color-missed-bonus) !important;
}

/* Column enter transition — col--entering is the collapsed initial state,
 * removed on the next frame so the cell transitions to its natural size.
 * Leaving columns are removed from the DOM instantly (no leave animation).
 */
.col--entering {
  width: 0 !important;
  max-width: 0 !important;
  min-width: 0 !important;
  padding: 0 !important;
  border: none !important;
  overflow: hidden;
  opacity: 0;
  font-size: 0 !important;
  line-height: 0 !important;
}

/* Shared transition for column enter/leave animation + cell background */
.scoresheet th,
.scoresheet td {
  transition:
    width 0.3s ease,
    max-width 0.3s ease,
    min-width 0.3s ease,
    padding 0.3s ease,
    opacity 0.3s ease,
    border 0.3s ease,
    font-size 0.3s ease,
    line-height 0.3s ease,
    background-color 0.1s;
}

.cell--greyed {
  background: repeating-linear-gradient(
    -45deg,
    var(--color-grey-stripe-a),
    var(--color-grey-stripe-a) 3px,
    var(--color-grey-stripe-b) 3px,
    var(--color-grey-stripe-b) 6px
  ) !important;
  cursor: default;
}
.cell--greyed:hover {
  outline: none;
}
.cell.cell--greyed.cell--focused {
  outline: 2px solid var(--color-accent);
  outline-offset: -2px;
}

.cell--invalid {
  outline: 2px solid var(--color-invalid);
  outline-offset: -2px;
  animation: pulse-invalid 1.5s ease-in-out infinite;
}
@keyframes pulse-invalid {
  0%,
  100% {
    outline-color: var(--color-invalid);
  }
  50% {
    outline-color: var(--color-invalid-alt);
  }
}

/* Running total badges */
/* On-time bonus column */
.running-total-label {
  font-weight: 600 !important;
  font-style: normal !important;
  color: var(--color-text-muted);
  font-size: 0.75rem;
  text-align: right !important;
  padding-right: 0.6rem !important;
}
.running-total-label .on-time {
  position: absolute;
  left: 0.4rem;
  top: 50%;
  transform: translateY(-50%);
}
.baseline-score {
  font-weight: 700;
  font-size: 0.8rem;
  color: var(--color-text);
  margin-left: 0.35rem;
}

.col--ontime-header {
  background: var(--color-bg-warm) !important;
  border-top: none !important;
  border-bottom: none !important;
  box-shadow: 0 1px 0 var(--color-border);
}
.cell--total-ontime {
  border-left: 1px solid var(--color-border-alt) !important;
  border-right: 1px solid var(--color-border-alt) !important;
}

.running-total-badge {
  position: absolute;
  top: 0;
  right: 0;
  font-size: 0.6rem;
  font-weight: 700;
  padding: 0.05rem 0.2rem;
  border-radius: 3px;
  line-height: 1.3;
  color: var(--color-bg);
  pointer-events: none;
}
.running-total-badge--unique {
  background: var(--color-correct);
}
.running-total-badge--quizout {
  background: var(--color-correct);
}
.running-total-badge--free-error {
  background: var(--color-bg-warm);
  color: var(--color-error);
}
.running-total-badge--foul-deduct {
  background: var(--color-foul);
  right: auto;
  left: 0;
}

/* Team status indicators */
.team-stats {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  flex-shrink: 0;
  margin-left: auto;
}

/* Name cell inner wrapper — flex row; wraps only when badges don't fit.
 * .name-main keeps drag handle + sizer as one unbreakable unit. */
.name-cell-inner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  width: 100%;
  gap: 0.2rem;
}
.name-main {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  flex-shrink: 0;
}

/* Drag handle */
.drag-handle {
  cursor: grab;
  color: var(--color-text-faint);
  font-size: 0.75rem;
  line-height: 1;
  padding: 0.1rem;
  margin-right: 0.2rem;
  border-radius: 3px;
  flex-shrink: 0;
  user-select: none;
  touch-action: none;
  opacity: 0;
  transition:
    opacity 0.15s,
    color 0.15s;
}
.row--quizzer:hover .drag-handle,
.row--dragging .drag-handle,
.drag-handle:focus {
  opacity: 1;
}
.drag-handle:hover {
  color: var(--color-text-muted);
  background: var(--color-border-alt);
}
.drag-handle:active {
  cursor: grabbing;
}

/* Drag-and-drop row states */
.row--dragging > td {
  opacity: 0.4;
}
/* Drop target: outline the entire row in accent. Inset box-shadow
   on every cell stitches a continuous border across the whole row;
   the first/last cells add the left/right ends. Outline doesn't work
   here because adjacent cells' outlines leave a visible gap pattern
   (outline-offset: -2px puts each cell's edge 2px inside).
   Note: this temporarily overrides .sticky-col's right-edge shadow
   on .col--name during drag — fine, the blue ring is what matters. */
.row--drop-target > td {
  box-shadow:
    inset 0 2px 0 0 var(--color-accent),
    inset 0 -2px 0 0 var(--color-accent);
}
.row--drop-target > td:first-child {
  box-shadow:
    inset 0 2px 0 0 var(--color-accent),
    inset 0 -2px 0 0 var(--color-accent),
    inset 2px 0 0 0 var(--color-accent);
}
.row--drop-target > td:last-child {
  box-shadow:
    inset 0 2px 0 0 var(--color-accent),
    inset 0 -2px 0 0 var(--color-accent),
    inset -2px 0 0 0 var(--color-accent);
}
/* col--name keeps its own 1px border-top to bridge the sticky-layer
   gap, which pushes the padding box (where inset box-shadow paints)
   1px lower than its neighbours. Recolour that border to accent and
   shrink the top box-shadow to 1px so the visible blue stays 2px
   tall and aligns continuously with the rest of the row's top edge. */
.row--drop-target > .col--name {
  border-top-color: var(--color-accent);
  box-shadow:
    inset 0 1px 0 0 var(--color-accent),
    inset 0 -2px 0 0 var(--color-accent);
}

/* Editable name inputs */
.editable-name {
  border: none;
  background: transparent;
  font-family: inherit;
  color: inherit;
  padding: 0;
  margin: 0;
  outline: none;
  height: 100%;
}
/* A prompt, not a name: small and pale enough that a blank seat can't pass for a filled one */
.editable-name::placeholder {
  color: var(--color-text-faint);
  font-size: 0.8em;
  font-weight: 400;
  font-style: italic;
  opacity: 0.6;
}
.editable-name:focus {
  border-bottom: 1.5px solid var(--color-accent);
}
.editable-name--team {
  font-weight: 700;
  font-size: 0.85rem;
}
.editable-name--quizzer {
  font-weight: 500;
  font-size: 0.8rem;
}

/* Sizer span: invisible mirror of the input value that drives the width.
 * The input is overlaid on top via position:absolute, filling the span. */
.name-input-sizer {
  position: relative;
  display: inline-block;
}
.name-input-sizer::after {
  content: attr(data-value);
  visibility: hidden;
  white-space: pre;
  pointer-events: none;
  display: block;
  font-family: inherit;
  padding: 0;
}
.name-input-sizer .editable-name {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.name-input-sizer--team::after {
  font-weight: 700;
  font-size: 0.85rem;
}
/* A team name longer than its cell is cut short with an ellipsis rather than running under the
 * score columns, which keeps the restore and pick-team buttons beside it in reach. */
.team-name .name-main {
  max-width: 100%;
  min-width: 0;
}
.name-input-sizer--team {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
}
.editable-name--team {
  text-overflow: ellipsis;
}
.name-input-sizer--quizzer::after {
  font-weight: 500;
  font-size: 0.8rem;
}

/* Clear name button */
.name-clear {
  display: none;
  align-items: center;
  justify-content: center;
  border: none;
  background: none;
  color: var(--color-text-faint);
  font-size: 0.7rem;
  line-height: 1;
  width: 1rem;
  height: 1rem;
  border-radius: 50%;
  cursor: pointer;
  flex-shrink: 0;
  padding: 0;
  margin-left: 0.1rem;
}
.name-main:hover .name-clear {
  display: inline-flex;
}
.name-clear:hover {
  background: var(--color-border-alt);
  color: var(--color-error);
}

/* Quizzer status indicators */
.quizzer-stats {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  flex-shrink: 0;
  margin-left: auto;
}

/* Out badges (Q, E, F) */
.stat-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.1rem;
  height: 1.1rem;
  border-radius: 50%;
  font-size: 0.6rem;
  font-weight: 800;
  line-height: 1;
}
.stat-badge--quizout {
  background: var(--color-correct);
  color: var(--color-badge-circle-correct);
}
.stat-badge--quizout-bonus {
  background: var(--color-correct);
  color: var(--color-badge-circle-correct);
  border-radius: 3px;
  transform: rotate(45deg);
  /* Turned, its corners reach past its box: room so they don't touch the score beside it */
  margin-inline: 0.25rem;
}
.stat-badge--quizout-bonus .stat-badge__label {
  transform: rotate(-45deg);
  display: inline-block;
}
.stat-badge--errorout {
  background: var(--color-error);
  color: var(--color-badge-circle-error);
}
.stat-badge--foulout {
  background: var(--color-foul);
  color: var(--color-badge-circle-foul);
}
.stat-badge--unique {
  background: var(--color-correct);
  color: var(--color-badge-circle-correct);
  border-radius: 4px;
  width: auto;
  padding: 0 0.3rem;
  font-size: 0.55rem;
}

/* Running count chips (1c, 2e, 1f) */
.stat-count {
  font-size: 0.6rem;
  font-weight: 700;
  padding: 0.05rem 0.25rem;
  border-radius: 3px;
  line-height: 1.2;
}
.stat-count--correct {
  color: var(--color-badge-correct-text);
  background: var(--color-badge-correct-bg);
}
.stat-count--error {
  color: var(--color-badge-error-text);
  background: var(--color-badge-error-bg);
}
.stat-count--foul {
  color: var(--color-badge-foul-text);
  background: var(--color-badge-foul-bg);
}

.row--table-footer td {
  border: none !important;
  background: transparent !important;
  padding: 0 !important;
}

.row--table-footer .sticky-col {
  box-shadow: none !important;
}

.table-footer {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 1.5rem 0 0.75rem;
  font-size: 0.65rem;
  color: var(--color-text-faint);
  margin-top: auto;
  align-self: flex-end;
}

.table-footer a {
  color: var(--color-text-faint);
  text-decoration: none;
}
.table-footer a:hover {
  color: var(--color-text-muted);
  text-decoration: underline;
}

.table-footer__sep {
  user-select: none;
}

<style>
/* Cell selector popup (unscoped for Teleport) */
.selector-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
}

.selector-popup {
  position: fixed;
  transform: translate(-50%, -50%);
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2px;
  padding: 3px;
  background: var(--color-bg);
  border: 1px solid var(--color-border-alt);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 101;
}

.selector-opt {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 1.8rem;
  border: none;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.1s;
  background: var(--color-bg);
}
.selector-opt:hover,
.selector-opt--focused {
  transform: scale(1.1);
}

.opt--correct {
  color: var(--color-correct);
}
.opt--correct:hover,
.opt--correct.selector-opt--focused {
  background: var(--color-correct);
  color: var(--color-bg);
}
.opt--error {
  color: var(--color-error);
}
.opt--error:hover,
.opt--error.selector-opt--focused {
  background: var(--color-error);
  color: var(--color-bg);
}
.opt--foul {
  color: var(--color-foul);
}
.opt--foul:hover,
.opt--foul.selector-opt--focused {
  background: var(--color-foul);
  color: var(--color-bg);
}
.opt--bonus {
  color: var(--color-bonus);
}
.opt--bonus:hover,
.opt--bonus.selector-opt--focused {
  background: var(--color-bonus);
  color: var(--color-bg);
}
.opt--missed-bonus {
  color: var(--color-missed-bonus);
}
.opt--missed-bonus:hover,
.opt--missed-bonus.selector-opt--focused {
  background: var(--color-missed-bonus);
  color: var(--color-bg);
}
.opt--clear {
  color: var(--color-text);
}
.opt--clear:hover,
.opt--clear.selector-opt--focused {
  background: var(--color-border-alt);
}

/* ---- Touch devices ---- */

@media (hover: none) {
  .drag-handle {
    opacity: 1;
  }
  .name-main:not(:only-child) .name-restore {
    display: inline-flex;
  }
  .name-clear {
    display: none !important;
  }
}

@media (pointer: coarse) {
  .meta-field--undo button {
    padding: 0.4rem 0.6rem;
  }
  .consolation-toggle {
    padding: 0.35rem 0.5rem 0.35rem 0.4rem;
  }
  .theme-toggle {
    padding: 0.35rem 0.65rem;
  }
  .drag-handle {
    padding: 0.4rem;
  }
  .meta-field--file button {
    padding: 0.4rem 0.6rem;
  }
  .selector-opt {
    width: 2.75rem;
    height: 2.75rem;
    font-size: 0.85rem;
  }
}

/* ---- Timeout column border ---- */
.timeout-after,
.row--team-total .cell--total.timeout-after,
.team-header-spacer.timeout-after,
.spacer-row .spacer-cell.timeout-after {
  border-right: 2px dotted var(--color-border) !important;
}
.cell.timeout-after {
  border-right: 1px solid var(--color-border) !important;
}

/* ---- Timeout T in team header spacer ---- */
.timeout-toggle {
  cursor: pointer;
  position: relative;
}
.timeout-toggle::after {
  content: 'T';
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 800;
  font-size: 0.7rem;
  font-family: 'Segoe UI', system-ui, sans-serif;
  letter-spacing: -0.5px;
  color: var(--color-text-muted);
  opacity: 0;
  transition: opacity 0.12s;
  pointer-events: none;
}
.timeout-toggle:hover::after {
  opacity: 0.3;
}
.timeout-toggle.has-timeout::after {
  opacity: 1;
  color: var(--color-text);
}
.timeout-toggle.timeout-invalid::after {
  opacity: 1;
  color: var(--color-invalid-text);
}
.timeout-toggle.timeout-invalid {
  background: color-mix(in srgb, var(--color-invalid) 10%, transparent);
}

/* Elevate cell selector above tutorial overlay during allowSelectorPopup steps */
.selector-backdrop.selector-elevated {
  z-index: 10002 !important;
}
.selector-popup.selector-elevated {
  z-index: 10003 !important;
}
</style>
