import { ref, computed, onScopeDispose, shallowRef, watch } from 'vue'
import { type HistoryCommand, useHistory } from '@qzr/ui'
import {
  assessQuiz,
  buildColumns,
  CellValue,
  type Column,
  computeVisibleColumns,
  type DeserializeResult,
  type GreyedOutResult,
  isBonusSituation,
  isTimeoutAllowed as isTimeoutAllowedBy,
  parseQuizFile,
  QuestionCategory,
  QuestionType,
  type Quiz,
  QuizFormat,
  quizJumpedComplete,
  quizRules,
  type QuizRules,
  scoreTeam,
  type Team,
  type TeamScoring,
  type TeamSeat,
  teamSeatKey,
  type Timeout,
  toSeatIdx,
  toTeamIdx,
  ValidationCode,
  validationMessage,
  answerLookup,
  emptySeatKeys,
  overtimeRoundsNeeded,
} from '@qzr/shared'
import { createQuizStore } from '../stores/quizStore'
import { applyStep, mergeSteps, recordEdit, type UndoStep } from './undoSteps'
import type { MeetSessionData } from './useMeetSession'
import { canonicalStoreFile } from '../persistence/quizFile'
import {
  currentTab,
  onTabLinkChange,
  type QuizRecord,
  type QuizState,
  type SubmittedState,
  moveTab,
  newRecordId,
  type StateKind,
  type RecordClaim,
  deleteOwnRecord,
  discardRecent,
  isKept,
  storageFailedAtStart,
  type Tab,
  untouched,
  writeRecord,
} from '../persistence/autoSave'

/**
 * Seat vs. Quizzer: the positional indices used throughout this composable
 * (`teamIdx`, `seatIdx`, `colIdx`) are 0-based slots. A "seat" is a position on
 * a team's bench — the occupant can change after a substitution — distinct
 * from a "quizzer," which is a stable person with an immutable `id`. The
 * branded `TeamIdx` / `SeatIdx` / `ColIdx` types live in the scoring/store
 * layers; see `../types/indices.ts` for the full explanation.
 */
/**
 * A quiz is saved when its state, however it got there, is the one it was last saved to a file in,
 * or the one it was last submitted in while still linked to the scheduled quiz it went to
 */
function isSaved(
  file: string,
  saved: QuizState | undefined,
  submitted: SubmittedState | undefined,
  link: MeetSessionData | null,
): boolean {
  if (saved?.file === file) return true
  if (submitted?.file !== file) return false
  const quizId = link?.quizId ?? null
  return quizId === submitted.quizId && (quizId === null || link?.meetId === submitted.meetId)
}

/** Undo steps the sheet keeps: up to this many, the oldest falling off */
const UNDO_LIMIT = 1000

/** The quiz's settings an official sets on the sheet */
type QuizField = 'division' | 'quizNumber' | 'consolation' | 'overtime'

/** A state to mark saved or submitted, and which quiz shown it was taken from */
type MarkedState = QuizState & { of: number }

/** A quiz as a record keeps it, apart from which record it is and its link */
type SheetState = Pick<
  QuizRecord,
  'current' | 'start' | 'saved' | 'submitted' | 'ahead' | 'fromNewerFile'
>

/**
 * An undo step in the session: the step as data, and what it does outside the quiz (the meet picks
 * a team swap moves), which is not kept beyond the page
 */
interface SheetStep extends HistoryCommand {
  step: UndoStep
}

export function useScoresheet() {
  const store = createQuizStore()
  const history = useHistory<SheetStep>(UNDO_LIMIT)

  // --- Reactive wrappers around store data ---
  // store.quiz is a reactive proxy; ref() wraps it so consumer call sites
  // keep their `quiz.value.x` shape and reads track the proxy natively.
  const quiz = ref<Quiz>(store.quiz)

  // The tab this sheet writes to. Before startTab, as in tests that start none, there is none.
  const tab = currentTab()
  /** The record the tab started with: its own quiz, on a reload or a restored session */
  const startRecord = tab?.record

  /** The current quiz came from a newer scoresheet's file and may be scored wrong */
  const openedFromNewerFile = ref(startRecord?.fromNewerFile ?? false)

  /** Structural rules for the quiz's format */
  const rules = computed<QuizRules>(() => quizRules(quiz.value.format))

  /**
   * Internally tracked overtime round count.
   * Starts at 1 when OT is enabled, auto-grows when content is added.
   */
  const internalOtRounds = ref(1)

  /** No-jump flags — grows/shrinks with columns */
  const noJumpMap = ref(new Map<string, boolean>())

  /** Timeouts per team — 0 to MAX_TIMEOUTS_PER_TEAM entries per team */
  const timeoutMap = ref(new Map<number, Timeout[]>())

  const undoTarget = { store, noJumps: noJumpMap, timeouts: timeoutMap }

  // Writes made while a step is recorded, undone or redone are part of that step, not steps of their own
  let quiet = 0
  function quietly<T>(run: () => T): T {
    quiet++
    try {
      return run()
    } finally {
      quiet--
    }
  }

  /** A step as the session runs it: its changes written back, then whatever runs alongside */
  function sheetStep(step: UndoStep, alongside?: HistoryCommand): SheetStep {
    return {
      step,
      undo: () =>
        quietly(() => {
          applyStep(undoTarget, step, 'undo')
          alongside?.undo()
        }),
      redo: () =>
        quietly(() => {
          applyStep(undoTarget, step, 'redo')
          alongside?.redo()
        }),
    }
  }

  /**
   * Make `change` as one undoable step, with `alongside` run with it, and on each undo and redo,
   * for what it writes outside the quiz. The step pushed, if any.
   */
  function edit(
    change: () => void,
    alongside?: HistoryCommand,
  ): { step: UndoStep; split: string | undefined } | undefined {
    if (quiet > 0) {
      change()
      alongside?.redo()
      return undefined
    }
    typing = null
    // The state before the edit, read only while a later state is held, which the edit may leave
    const before = aheadState.value ? currentState.value : undefined
    const step = quietly(() =>
      recordEdit(undoTarget, () => {
        change()
        alongside?.redo()
      }),
    )
    if (step.changes.length === 0 && !alongside) return undefined
    const split = before !== undefined ? splitAhead(before) : undefined
    history.push(sheetStep(step, alongside))
    return { step, split }
  }

  const lastStep = () => history.undoSteps.value[history.undoSteps.value.length - 1]

  /** The step a visit to a typed field is making, while the visit lasts */
  let typing: {
    field: string
    step: UndoStep
    /** As the visit found the history, to put back if it ends where it began */
    before: {
      undo: readonly SheetStep[]
      redo: readonly SheetStep[]
      ahead: QuizState | undefined
      split: string | undefined
    }
  } | null = null

  /**
   * Make `change` to typed field `field`: a visit to the field, from entering it until leaving it
   * or another edit, is one step. A visit that ends where it began leaves none.
   */
  function editTyped(field: string, change: () => void) {
    if (quiet > 0) return change()
    const top = lastStep()
    const visiting = typing
    if (visiting?.field !== field || top?.step !== visiting.step || history.canRedo.value) {
      const redo = history.redoSteps.value
      const undo = history.undoSteps.value
      const ahead = aheadState.value
      const made = edit(change)
      typing = made
        ? { field, step: made.step, before: { undo, redo, ahead, split: made.split } }
        : null
      return
    }
    mergeSteps(
      visiting.step,
      quietly(() => recordEdit(undoTarget, change)),
    )
    if (visiting.step.changes.length > 0) return
    // A visit that ends where it began changed nothing: what its first keystroke dropped comes back
    const { undo, redo, ahead, split } = visiting.before
    history.setStacks(undo, redo)
    typing = null
    if (!split) {
      aheadState.value = ahead
      return
    }
    // The latest state is held again and its split copy goes; unless a tab took the copy meanwhile,
    // when it is that tab's
    aheadState.value = ahead
    queueWrite(async () => {
      if (!(await discardRecent(split)) && aheadState.value === ahead) aheadState.value = undefined
    })
  }

  /** The visit to a typed field is over: its next change is a new step */
  function endTyping() {
    typing = null
  }

  /**
   * A change the sheet makes by itself, such as names a link fills in: while nothing has been done
   * by hand it is part of the quiz's start, after that a step like any other
   */
  function editBySheet(change: () => void) {
    if (!untouched(stateNow())) return void edit(change)
    quietly(change)
    startFile = currentState.value
  }

  function undo() {
    typing = null
    history.undo()
  }

  function redo() {
    typing = null
    history.redo()
  }

  /** The undo steps, oldest first, as kept beyond the page: without what runs alongside */
  const keptUndo = () => history.undoSteps.value.map(({ step }) => step)

  /** Take up a kept state's undo and redo steps, as a reload or a restore finds them */
  function takeHistory(state: { undo: UndoStep[]; redo?: UndoStep[] } | undefined) {
    const steps = (list: UndoStep[] = []) => list.map((step) => sheetStep(step))
    history.setStacks(steps(state?.undo), steps(state?.redo))
  }

  /** A stored state's quiz, or null when there is none or it can't be read */
  function readState(file: string | undefined): DeserializeResult | null {
    if (!file) return null
    try {
      return parseQuizFile(file)
    } catch {
      return null
    }
  }

  /** OT rounds to allocate for a freshly loaded quiz: as many as its saved answers reach */
  function computeInitialOtRounds(loaded: DeserializeResult): number {
    if (!loaded.quiz.overtime) return 1
    return overtimeRoundsNeeded(
      loaded.quiz,
      loaded.teams,
      loaded.quizzers,
      answerLookup(loaded.answers),
      loaded.noJumps,
    )
  }

  // --- Restore the tab's own quiz ---
  const restored = readState(startRecord?.current?.file)
  if (restored) {
    store.loadState(restored)
    noJumpMap.value = restored.noJumps
    timeoutMap.value = restored.timeouts
    internalOtRounds.value = computeInitialOtRounds(restored)
    takeHistory(startRecord?.current)
  } else {
    // Nothing restored (empty, corrupt, or a newer auto-save set aside): no quiz to warn about
    openedFromNewerFile.value = false
  }

  /** Columns built reactively — regulation when OT is off, + OT rounds when on */
  const columns = computed<Column[]>(() => {
    const rounds = quiz.value.overtime ? internalOtRounds.value : 0
    return buildColumns(rules.value, rounds)
  })

  const noJumps = computed<boolean[]>(() =>
    columns.value.map((col) => noJumpMap.value.get(col.key) ?? false),
  )

  /** Teams sorted by seat order — this is the canonical iteration order */
  const teams = computed<Team[]>(() => [...store.teams].sort((a, b) => a.seatOrder - b.seatOrder))

  /** Quizzers per team, indexed by team position */
  const teamQuizzers = computed(() => teams.value.map((team) => store.quizzersByTeam(team.id)))

  /** Derived cell grid — recomputes when store data or columns change */
  const cells = computed<CellValue[][][]>(() => store.cellGrid(columns.value))

  function setCell(teamIdx: number, seatIdx: number, colIdx: number, value: CellValue) {
    const team = teams.value[teamIdx]
    if (!team) return
    const qzrs = store.quizzersByTeam(team.id)
    const qzr = qzrs[seatIdx]
    const col = columns.value[colIdx]
    if (!qzr || !col) return
    const prev = store.getAnswer(qzr.id, col.key)
    if (prev === value) return
    edit(() => store.setAnswer(qzr.id, col.key, value))
  }

  // --- Scoring ---

  const scoring = computed<TeamScoring[]>(() => {
    const cols = columns.value
    const grid = cells.value
    return teams.value.map((team, teamIdx) =>
      scoreTeam(grid[teamIdx]!, cols, team.onTime, rules.value),
    )
  })

  // --- Grey-out & validation ---

  /** Set of "teamIdx:seatIdx" keys for quizzers with empty/blank names */
  const emptySeats = computed((previous?: Set<string>) => {
    const set = emptySeatKeys(teams.value.map((team) => store.quizzersByTeam(team.id)))
    // Keep the previous set while it's unchanged, so typing a name doesn't re-run the assessment
    const same = previous?.size === set.size && [...set].every((key) => previous.has(key))
    return same ? previous : set
  })

  // Validation, overtime and placement come from one shared assessment, so a stored quiz is placed
  // exactly as the sheet shows it
  const assessment = computed(() =>
    assessQuiz({
      cells: cells.value,
      columns: columns.value,
      rules: rules.value,
      noJumps: noJumps.value,
      onTimes: teams.value.map((t) => t.onTime),
      overtime: quiz.value.overtime,
      bonusRule: quiz.value.bonusRule,
      placementFormula: quiz.value.placementFormula,
      emptySeats: emptySeats.value,
      timeouts: teams.value.map((t) => timeoutMap.value.get(t.id) ?? []),
    }),
  )

  const greyedOutResult = computed<GreyedOutResult>(() => assessment.value.greyedOut)

  const validationErrors = computed(() => assessment.value.validationErrors)

  // Pre-grouped views of `validationErrors`. Folded once per validation change
  // so the per-quizzer / per-team template helpers are O(1) lookups instead of
  // scanning columns × seats on every render.
  const errorsByQuizzer = computed(() => {
    const m = new Map<TeamSeat, Set<ValidationCode>>()
    for (const col of validationErrors.value.values()) {
      for (const [key, codes] of col) {
        let set = m.get(key)
        if (!set) {
          set = new Set()
          m.set(key, set)
        }
        for (const c of codes) set.add(c)
      }
    }
    return m
  })

  const errorsByTeam = computed(() => {
    const m = new Map<number, Set<ValidationCode>>()
    teamQuizzers.value.forEach((qzrs, teamIdx) => {
      const agg = new Set<ValidationCode>()
      const team = toTeamIdx(teamIdx)
      for (let s = 0; s < qzrs.length; s++) {
        const codes = errorsByQuizzer.value.get(teamSeatKey(team, toSeatIdx(s)))
        if (codes) for (const c of codes) agg.add(c)
      }
      if (agg.size > 0) m.set(teamIdx, agg)
    })
    return m
  })

  /** Column indices that have an invalid timeout (once error points begin) */
  const timeoutValidationErrors = computed(() => assessment.value.timeoutErrorColumns)

  /** Team indices that have invalid timeouts, mapped to the offending column indices */

  /** Team indices that have more than 2 timeouts */
  const tooManyTimeoutsTeams = computed(() => assessment.value.tooManyTimeoutsTeams)

  // --- Query helpers (business logic the template needs) ---

  function isBonusForTeam(teamIdx: number, colIdx: number): boolean {
    return isBonusSituation(greyedOutResult.value.tossedUp, teamIdx, colIdx, teams.value.length)
  }

  function isGreyedOut(teamIdx: number, seatIdx: number, colIdx: number): boolean {
    const g = greyedOutResult.value
    return (
      (g.disabledTeams[colIdx]?.has(toTeamIdx(teamIdx)) ?? false) ||
      (g.disabledSeats[colIdx]?.has(teamSeatKey(toTeamIdx(teamIdx), toSeatIdx(seatIdx))) ?? false)
    )
  }

  function isInvalid(teamIdx: number, seatIdx: number, colIdx: number): boolean {
    return (
      validationErrors.value
        .get(colIdx)
        ?.has(teamSeatKey(toTeamIdx(teamIdx), toSeatIdx(seatIdx))) ?? false
    )
  }

  /** Get human-readable validation messages for a cell (deduplicated) */
  function cellValidationMessages(teamIdx: number, seatIdx: number, colIdx: number): string[] {
    const codes = validationErrors.value
      .get(colIdx)
      ?.get(teamSeatKey(toTeamIdx(teamIdx), toSeatIdx(seatIdx)))
    if (!codes) return []
    return [...new Set(codes.map(validationMessage))]
  }

  /** Whether any cell in a column has a validation error */
  function columnHasErrors(colIdx: number): boolean {
    if (timeoutValidationErrors.value.has(colIdx)) return true
    return (validationErrors.value.get(colIdx)?.size ?? 0) > 0
  }

  /** Get deduplicated validation messages for all cells in a column */
  function columnValidationMessages(colIdx: number): string[] {
    const msgs = new Set<string>()
    if (timeoutValidationErrors.value.has(colIdx)) {
      msgs.add(validationMessage(ValidationCode.TimeoutAfterErrorPoints))
    }
    const col = validationErrors.value.get(colIdx)
    if (col) {
      for (const codes of col.values()) {
        for (const code of codes) msgs.add(validationMessage(code))
      }
    }
    return [...msgs]
  }

  /** Whether any cell for a specific quizzer has a validation error */
  function quizzerHasErrors(teamIdx: number, seatIdx: number): boolean {
    return errorsByQuizzer.value.has(teamSeatKey(toTeamIdx(teamIdx), toSeatIdx(seatIdx)))
  }

  /** Get deduplicated validation messages for a specific quizzer */
  function quizzerValidationMessages(teamIdx: number, seatIdx: number): string[] {
    const codes = errorsByQuizzer.value.get(teamSeatKey(toTeamIdx(teamIdx), toSeatIdx(seatIdx)))
    return codes ? [...codes].map(validationMessage) : []
  }

  /** Get deduplicated validation messages for all cells in a team */
  function teamValidationMessages(teamIdx: number): string[] {
    const msgs = new Set<string>()
    if (assessment.value.timeoutErrorsByTeam.has(teamIdx)) {
      msgs.add(validationMessage(ValidationCode.TimeoutAfterErrorPoints))
    }
    if (tooManyTimeoutsTeams.value.has(teamIdx)) {
      msgs.add(validationMessage(ValidationCode.TooManyTimeouts))
    }
    const codes = errorsByTeam.value.get(teamIdx)
    if (codes) for (const c of codes) msgs.add(validationMessage(c))
    return [...msgs]
  }

  function isAfterOut(teamIdx: number, seatIdx: number, colIdx: number): boolean {
    const qs = scoring.value[teamIdx]?.quizzers[seatIdx]
    if (!qs || qs.outAfterCol < 0 || colIdx <= qs.outAfterCol) return false
    if (cells.value[teamIdx]![seatIdx]![colIdx] !== CellValue.Empty) return false
    // Errored or fouled out by this column: gone from the bench
    if (qs.leftBenchAfterCol >= 0 && colIdx > qs.leftBenchAfterCol) return true
    // Otherwise quizzed out, and still on the bench for bonuses
    return !(columns.value[colIdx]?.type === QuestionType.B || isBonusForTeam(teamIdx, colIdx))
  }

  function isFouledOnQuestion(teamIdx: number, seatIdx: number, colIdx: number): boolean {
    return (
      greyedOutResult.value.fouledQuizzers[colIdx]?.has(
        teamSeatKey(toTeamIdx(teamIdx), toSeatIdx(seatIdx)),
      ) ?? false
    )
  }

  function teamHasErrors(teamIdx: number): boolean {
    if (assessment.value.timeoutErrorsByTeam.has(teamIdx)) return true
    if (tooManyTimeoutsTeams.value.has(teamIdx)) return true
    return errorsByTeam.value.has(teamIdx)
  }

  const hasAnyErrors = computed(() => assessment.value.hasErrors)

  /** Get the answer value for a column (first non-empty, non-foul value) */
  function colAnswerValue(colIdx: number): CellValue {
    for (const team of cells.value) {
      for (const row of team) {
        const v = row[colIdx] ?? CellValue.Empty
        if (v !== CellValue.Empty && v !== CellValue.Foul) return v
      }
    }
    return CellValue.Empty
  }

  function isEmptySeat(teamIdx: number, seatIdx: number): boolean {
    const team = teams.value[teamIdx]
    if (!team) return false
    const qzrs = store.quizzersByTeam(team.id)
    const qzr = qzrs[seatIdx]
    if (!qzr) return false
    return store.isQuizzerUnnamed(qzr.id)
  }

  function noJumpHasConflict(colIdx: number): boolean {
    if (!noJumps.value[colIdx]) return false
    // No-jump on an orphaned column is itself invalid
    if (assessment.value.orphanedColumns.has(colIdx)) return true
    const col = validationErrors.value.get(colIdx)
    if (!col) return false
    for (const codes of col.values()) {
      if (codes.includes(ValidationCode.NoJump)) return true
    }
    return false
  }

  // --- Column visibility ---

  /** How many OT rounds should be visible (0 = none, 1 = the first round, etc.) */
  const visibleOtRounds = computed(() => assessment.value.visibleOtRounds)

  /**
   * Grow-only: once we've allocated columns for round N we keep them. Shrinking
   * would silently drop user-entered answers in later rounds when the visible
   * window contracts (e.g. after deleting a tie-breaking answer).
   */
  watch(visibleOtRounds, (needed) => {
    if (needed > internalOtRounds.value) {
      internalOtRounds.value = needed
    }
  })

  const visibleColumns = computed(() =>
    computeVisibleColumns(
      cells.value,
      columns.value,
      noJumps.value,
      visibleOtRounds.value,
      rules.value,
      greyedOutResult.value.colStatuses,
    ),
  )

  /** Whether all questions in the visible range have been jumped on or no-jumped */
  const allQuestionsComplete = computed(() =>
    quizJumpedComplete(
      cells.value,
      columns.value,
      noJumps.value,
      visibleOtRounds.value,
      rules.value,
    ),
  )

  /** Placement medals per team: PlaceKey (encoding rank + tie-width), or null if not yet placed */
  const placements = computed(() => assessment.value.placements)

  /** Placement points per team (null if not yet placed) */
  const placementPoints = computed(() => assessment.value.placementPoints)

  function setTeamName(teamIdx: number, name: string) {
    const team = teams.value[teamIdx]
    if (!team) return
    editTyped(`team:${team.id}:name`, () => store.setTeamName(team.id, name))
  }

  /**
   * Two teams change places, each with its name, quizzers, answers, timeouts and on-time mark, as
   * one edit that undo takes back. `alongside` runs with the swap each way, for what is kept by
   * place outside the quiz.
   */
  function swapTeams(teamIdxA: number, teamIdxB: number, alongside: () => void = () => {}) {
    const a = teams.value[teamIdxA]
    const b = teams.value[teamIdxB]
    if (!a || !b || a === b) return
    // A swap is its own undoing
    edit(() => store.swapTeams(a.id, b.id), { undo: alongside, redo: alongside })
  }

  /**
   * Do an edit made of several writes as one, which undo takes back and redo makes again. Its own
   * undo and redo run too, in the session, for what they write outside the quiz; their writes to
   * the quiz repeat what the step already put back.
   */
  function editAsOne(change: HistoryCommand) {
    edit(() => {}, change)
  }

  /** Two quizzers change seats; `alongside` runs with it each way, as `swapTeams`'s does */
  function moveQuizzer(
    teamIdx: number,
    fromSeat: number,
    toSeat: number,
    alongside?: HistoryCommand,
  ) {
    const team = teams.value[teamIdx]
    if (!team) return
    edit(() => store.moveQuizzer(team.id, toSeatIdx(fromSeat), toSeatIdx(toSeat)), alongside)
  }

  function setQuizzerName(teamIdx: number, seatIdx: number, name: string) {
    const team = teams.value[teamIdx]
    if (!team) return
    const qzrs = store.quizzersByTeam(team.id)
    const qzr = qzrs[seatIdx]
    if (!qzr) return
    editTyped(`quizzer:${qzr.id}:name`, () => store.setQuizzerName(qzr.id, name))
  }

  function toggleOnTime(teamIdx: number) {
    const team = teams.value[teamIdx]
    if (!team) return
    edit(() => (team.onTime = !team.onTime))
  }

  /** Set one of the quiz's settings; the division and number are typed, so a visit is one step */
  function setQuizField<K extends QuizField>(field: K, value: Quiz[K]) {
    const change = () => (store.quiz[field] = value)
    if (field === 'division' || field === 'quizNumber') editTyped(`quiz:${field}`, change)
    else edit(change)
  }

  /**
   * Toggle no-jump for a column by key.
   *
   * The `noJumpMap.value = new Map(noJumpMap.value)` reassignment after each
   * `.set()` is intentional: Vue's `ref(Map)` only tracks ref reassignment, not
   * in-place Map mutation, so consumers (`noJumps` computed → `otIneligibility`
   * → `greyedOutResult`) won't recompute without it. Same pattern repeats in
   * the timeout helpers below.
   */
  function toggleNoJump(colIdx: number) {
    const key = columns.value[colIdx]?.key
    if (!key) return
    const next = !(noJumpMap.value.get(key) ?? false)
    edit(() => {
      noJumpMap.value.set(key, next)
      noJumpMap.value = new Map(noJumpMap.value)
    })
  }

  // --- Timeouts ---

  function teamTimeouts(teamId: number): Timeout[] {
    return timeoutMap.value.get(teamId) ?? []
  }

  function timeoutCount(teamId: number): number {
    return teamTimeouts(teamId).length
  }

  /** Timeouts can be called between questions until error points begin */
  function isTimeoutAllowed(columnKey: string): boolean {
    return isTimeoutAllowedBy(columnKey, rules.value)
  }

  function addTimeout(teamId: number, afterColumnKey: string | null): void {
    edit(() => {
      const current = teamTimeouts(teamId)

      // Only one team can have a timeout after a given question — clear the other team's
      if (afterColumnKey !== null) {
        for (const [otherId, otherTimeouts] of timeoutMap.value) {
          if (otherId === teamId) continue
          const filtered = otherTimeouts.filter((t) => t.afterColumnKey !== afterColumnKey)
          if (filtered.length !== otherTimeouts.length) {
            timeoutMap.value.set(otherId, filtered)
          }
        }
      }

      // If a column is specified and this team has an untracked timeout, upgrade it
      if (afterColumnKey !== null) {
        const untrackedIdx = current.findIndex((t) => t.afterColumnKey === null)
        if (untrackedIdx >= 0) {
          const next = [...current]
          next[untrackedIdx] = { afterColumnKey }
          timeoutMap.value.set(teamId, next)
          timeoutMap.value = new Map(timeoutMap.value)
          return
        }
      }

      const next = [...current, { afterColumnKey }]
      timeoutMap.value.set(teamId, next)
      timeoutMap.value = new Map(timeoutMap.value)
    })
  }

  function removeLastTimeout(teamId: number): void {
    const current = teamTimeouts(teamId)
    if (current.length === 0) return

    edit(() => {
      timeoutMap.value.set(teamId, current.slice(0, -1))
      timeoutMap.value = new Map(timeoutMap.value)
    })
  }

  /** Toggle a timeout for a team at a specific column */
  function toggleTimeout(teamId: number, columnKey: string): void {
    const current = teamTimeouts(teamId)
    const existingIdx = current.findIndex((t) => t.afterColumnKey === columnKey)
    if (existingIdx < 0) return addTimeout(teamId, columnKey)
    edit(() => {
      timeoutMap.value.set(
        teamId,
        current.filter((_, i) => i !== existingIdx),
      )
      timeoutMap.value = new Map(timeoutMap.value)
    })
  }

  /** Check if a specific team has a timeout at a specific column */
  function hasTimeoutAt(teamId: number, columnKey: string): boolean {
    return teamTimeouts(teamId).some((t) => t.afterColumnKey === columnKey)
  }

  /** Check if any team has a timeout after the given column */
  function hasTimeoutAfterCol(colKey: string): boolean {
    for (const timeouts of timeoutMap.value.values()) {
      if (timeouts.some((t) => t.afterColumnKey === colKey)) return true
    }
    return false
  }

  /** Null clears the category. */
  function setQuestionType(colIdx: number, category: QuestionCategory | null) {
    const col = columns.value[colIdx]
    if (!col) return
    edit(() => store.setQuestionType(col.key, category))
  }

  // --- Saved and submitted states ---

  /** The state last saved to a file in, or opened from one in */
  const savedState = shallowRef<QuizState | undefined>(startRecord?.saved)
  /** The state last sent to the meet in, or opened from it in, and where it went */
  const submittedState = shallowRef<SubmittedState | undefined>(startRecord?.submitted)
  /**
   * While the quiz is positioned behind its latest state (an Open or a restore matched an earlier
   * one): that latest state, kept until redone up to or split off by an edit
   */
  const aheadState = shallowRef<QuizState | undefined>(startRecord?.ahead)
  /** The tab's meet link, as it changes */
  const link = shallowRef<MeetSessionData | null>(tab?.link ?? null)
  /** The quiz on the sheet as a canonical file, which states are compared by */
  const currentState = computed(() => canonicalStoreFile(store, noJumpMap.value, timeoutMap.value))

  /** Whether state `file` is one the quiz was saved or submitted in */
  const savedAt = (file: string) =>
    isSaved(file, savedState.value, submittedState.value, link.value)

  const unsaved = computed(() => !savedAt(currentState.value))

  /**
   * An edit made at state `here` leaves the latest state behind for good: it goes to the recent
   * quizzes as a quiz of its own, with its history, the saved states that aren't this one's, and
   * the same link
   */
  function splitAhead(here: string): string | undefined {
    const ahead = aheadState.value
    if (!ahead || !tab) return undefined
    aheadState.value = undefined
    // Redone up to it already: nothing is left behind
    if (here === ahead.file) return undefined
    const keep = <S extends QuizState>(state: S | undefined) =>
      state && state.file !== here ? state : undefined
    const saved = keep(savedState.value)
    const submitted = keep(submittedState.value)
    const split: QuizRecord = {
      id: newRecordId(),
      current: { file: ahead.file, undo: ahead.undo, redo: [] },
      start: startFile,
      saved,
      submitted,
      link: tab.link,
      fromNewerFile: openedFromNewerFile.value,
      unsaved: !isSaved(ahead.file, saved, submitted, tab.link),
      changedAt: Date.now(),
      offered: true,
    }
    queueWrite(() => writeRecord(split))
    return split.id
  }

  /** The quiz as it is now, for marking it saved or submitted once the save or send is done */
  function stateToMark(): MarkedState {
    // Its last step is kept as it is now: typing on is a step of its own
    typing = null
    return { file: currentState.value, undo: keptUndo(), of: replaced }
  }

  /** How many times the quiz shown was replaced (New, Open, a restore) */
  let replaced = 0

  /** The state to mark, unless the quiz it was taken from was replaced meanwhile */
  function stillOurs({ of, ...state }: MarkedState): QuizState | undefined {
    return of === replaced ? state : undefined
  }

  /**
   * The quiz was saved to a file, or opened from one, in state `state`: as it is now, unless the
   * caller took it before waiting on the save, while edits went on
   */
  function markSaved(state: MarkedState = stateToMark()) {
    savedState.value = stillOurs(state) ?? savedState.value
  }

  /** The quiz was sent to the meet, or opened from it, as it is now, as scheduled quiz `quizId` */
  function markSubmitted(
    meetId: number,
    quizId: string | null,
    marked: MarkedState = stateToMark(),
  ) {
    const state = stillOurs(marked)
    if (!state) return
    submittedState.value = {
      ...state,
      meetId,
      quizId,
      link: link.value,
    }
  }

  /** Load a deserialized quiz file into the store, replacing all state */
  function loadFile(data: DeserializeResult, { fromNewerFile = false } = {}) {
    openedFromNewerFile.value = fromNewerFile
    store.loadState(data)
    noJumpMap.value = data.noJumps
    timeoutMap.value = data.timeouts
    internalOtRounds.value = computeInitialOtRounds(data)
    history.clear()
    startFile = currentState.value
  }
  function resetStore(format = QuizFormat.TwentyQuestion) {
    openedFromNewerFile.value = false
    const fresh = createQuizStore()
    store.loadState({
      quiz: { ...fresh.quiz, format },
      teams: fresh.teams,
      quizzers: fresh.quizzers,
      answers: [],
    })
    noJumpMap.value = new Map()
    timeoutMap.value = new Map()
    internalOtRounds.value = 1
    history.clear()
    startFile = currentState.value
  }

  /**
   * Restart the quiz with the same teams and quizzers: clears answers, no-jumps, timeouts and
   * question types, since a restarted quiz asks new questions
   */
  function clearAnswers() {
    edit(() => {
      // Snapshot before calling loadState — loadState mutates the internal arrays in-place,
      // so passing store.teams/quizzers directly would zero them out mid-iteration.
      const teams = [...store.teams]
      const quizzers = [...store.quizzers]
      store.loadState({
        quiz: { ...store.quiz, questionTypes: new Map() },
        teams,
        quizzers,
        answers: [],
      })
      noJumpMap.value = new Map()
      timeoutMap.value = new Map()
      internalOtRounds.value = 1
    })
  }

  /**
   * Blank every team and quizzer name, as a new quiz has them, as one step; `alongside` runs with
   * it each way, for what goes with the names outside the quiz
   */
  function clearNames(alongside?: HistoryCommand) {
    edit(() => {
      for (const team of store.teams) {
        store.setTeamName(team.id, '')
        for (const quizzer of store.quizzersByTeam(team.id)) store.setQuizzerName(quizzer.id, '')
      }
    }, alongside)
  }

  // --- Writing the tab's quiz, link and history ---

  /** The state the quiz began in, kept with it */
  let startFile = startRecord?.start ?? currentState.value

  /** The tab's record as the sheet now has it, in state `file` */
  function recordNow(tab: Tab, file: string): QuizRecord {
    const before = tab.record
    return {
      ...stateNow(file),
      id: tab.id,
      link: tab.link,
      // Unsaved too while the latest state, held ahead, is: it is the quiz's own work
      unsaved: unsaved.value || (aheadState.value !== undefined && !savedAt(aheadState.value.file)),
      changedAt: before?.current?.file === file ? before.changedAt : Date.now(),
      offered: before?.offered ?? false,
    }
  }

  // Writes go one after another, so a slow one is never overtaken by an older state
  let writing = Promise.resolve()
  // A sheet taken down writes nothing more
  let disposed = false
  function persistNow({ offered = false } = {}) {
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = null
    if (pauseAutoSave.value || !tab) return
    const file = currentState.value
    // Redone up to the latest state: no longer behind it
    if (aheadState.value?.file === file) aheadState.value = undefined
    // Written even with nothing done by hand, so a reload brings back the quiz and its link; such a
    // quiz is not kept as a recent one once its tab has gone (isKept)
    const record = recordNow(tab, file)
    record.offered ||= offered
    tab.record = record
    queueWrite(() => writeRecord(record))
  }

  /** Why the tab's quiz couldn't be kept on the device, until a write of it succeeds */
  const keepFailed = ref<'full' | 'failed' | null>(storageFailedAtStart() ? 'failed' : null)

  /** Write after the writes before, unless the sheet is gone; a failure is said, and never stops the next */
  function queueWrite(write: () => Promise<boolean | void>) {
    writing = writing.then(async () => {
      if (disposed) return
      try {
        // False: the device had no room, even without the saved recent quizzes
        keepFailed.value = (await write()) === false ? 'full' : null
      } catch (e) {
        console.error('Could not keep the quiz on this device', e)
        keepFailed.value = 'failed'
      }
    })
  }

  /**
   * The tab's record is left, for New, Open or a restore: written as it is, a recent quiz, or
   * deleted, while still held, when nothing was done by hand, since no reload comes back to it
   */
  function leaveRecord(tab: Tab) {
    persistNow({ offered: true })
    const left = tab.record
    const { id } = tab
    if (left && !isKept(left)) queueWrite(() => deleteOwnRecord(id))
  }

  /**
   * The sheet is about to show another quiz (New, Open): the quiz it shows goes to the recent
   * quizzes as it is, unless it is not worth keeping, and the tab begins a new record
   */
  function replaceQuiz() {
    endAside()
    replaced++
    if (!tab) return
    leaveRecord(tab)
    moveTab(tab, undefined, writing)
    savedState.value = undefined
    submittedState.value = undefined
    aheadState.value = undefined
  }

  /**
   * Show a recent quiz the tab has claimed, in one of its states: the quiz the tab showed goes to
   * the recent quizzes. Left again by closing the tab, it is offered again.
   */
  function restoreQuiz(
    record: QuizRecord,
    claim: RecordClaim,
    state: StateKind = 'current',
  ): MeetSessionData | null {
    endAside()
    replaced++
    if (!tab) return null
    leaveRecord(tab)
    moveTab(
      tab,
      { id: record.id, claim, record: { ...positioned(record, state), offered: false } },
      writing,
    )
    link.value = tab.link
    showState(tab.record)
    return tab.link
  }

  /**
   * `record` positioned at one of its earlier states: that state is current, the latest is kept
   * ahead, and the steps between are redo where the histories join
   */
  function positioned(record: QuizRecord, state: StateKind): QuizRecord {
    const latest = record.current
    const at = record[state]
    // As submitted, the quiz comes back with the link it was sent with
    const link = state === 'submitted' ? (record.submitted?.link ?? record.link) : record.link
    if (!latest || !at || at.file === latest.file) return { ...record, link }
    const joined = JSON.stringify(latest.undo.slice(0, at.undo.length)) === JSON.stringify(at.undo)
    // Redo leads to the latest state, then on through the steps undone from it
    const redo = joined ? [...latest.redo, ...latest.undo.slice(at.undo.length).reverse()] : []
    return {
      ...record,
      link,
      current: { file: at.file, undo: at.undo, redo },
      ahead: { file: latest.file, undo: latest.undo },
    }
  }

  /**
   * Write the tab's quiz now, with whatever was waiting for the pause to end; resolves once written,
   * or once the write has failed
   */
  function flushAutoSave(): Promise<unknown> {
    persistNow()
    return writing
  }

  /** The quiz as the sheet has it, in state `file`, as a record keeps it */
  function stateNow(file = currentState.value): SheetState {
    return {
      current: { file, undo: keptUndo(), redo: history.redoSteps.value.map(({ step }) => step) },
      start: startFile,
      saved: savedState.value,
      submitted: submittedState.value,
      ahead: aheadState.value,
      fromNewerFile: openedFromNewerFile.value,
    }
  }

  /** Show a quiz as a record or the set-aside copy keeps it; with none, a blank quiz */
  function showState(state: SheetState | undefined) {
    const data = readState(state?.current?.file)
    if (data) loadFile(data, { fromNewerFile: state?.fromNewerFile ?? false })
    else resetStore()
    if (state) startFile = state.start
    savedState.value = state?.saved
    submittedState.value = state?.submitted
    aheadState.value = state?.ahead
    takeHistory(state?.current)
  }

  /** The quiz set aside while the tutorial has the sheet, kept in memory whatever the device keeps */
  let aside: SheetState | null = null

  /**
   * Set the quiz aside for the tutorial: written with what was waiting, then left alone, so a
   * reload mid-tutorial brings it back, and kept in memory for when the tutorial ends
   */
  function setAside(onReplaced: () => void) {
    flushAutoSave()
    aside = stateNow()
    asideReplaced = onReplaced
    pauseAutoSave.value = true
    // The practice quiz is none of these: an edit to it must not split the latest state off
    savedState.value = undefined
    submittedState.value = undefined
    aheadState.value = undefined
  }

  /**
   * The quiz is replaced while one is set aside: whoever set it aside ends that first (the
   * tutorial ends), so the quiz set aside comes back and goes to the recent quizzes, never written
   * over the quiz that replaces it
   */
  function endAside() {
    if (aside) asideReplaced?.()
  }

  /** Called when the quiz set aside is replaced, by whoever set it aside */
  let asideReplaced: (() => void) | null = null

  /** Show the quiz set aside again; auto-save stays paused until the caller resumes it */
  function bringBack() {
    showState(aside ?? tab?.record)
    aside = null
    asideReplaced = null
  }

  const pauseAutoSave = ref(false)
  let persistTimer: ReturnType<typeof setTimeout> | null = null
  function schedulePersist() {
    if (pauseAutoSave.value) return
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(persistNow, 300)
  }
  const stopHearingLink = onTabLinkChange(() => {
    link.value = tab?.link ?? null
    schedulePersist()
  })
  watch([savedState, submittedState, openedFromNewerFile], schedulePersist)
  // The page may go before the pause ends; what is waiting is written as it goes
  window.addEventListener('pagehide', flushAutoSave)
  // Leaving a typed field ends the visit to it
  window.addEventListener('focusout', endTyping)
  onScopeDispose(() => {
    disposed = true
    if (persistTimer) clearTimeout(persistTimer)
    window.removeEventListener('pagehide', flushAutoSave)
    window.removeEventListener('focusout', endTyping)
    stopHearingLink()
  })
  // Deep-watch the reactive store directly — the `teams`/`teamQuizzers`
  // computeds track array structure + seatOrder but not per-field edits
  // like names, onTime, or questionTypes, so we'd miss auto-saves on those.
  watch(
    [() => store.quiz, () => store.teams, () => store.quizzers, noJumpMap, timeoutMap],
    schedulePersist,
    { deep: true },
  )
  // `cells` covers answer changes (reactive answerMap reads); outside the
  // deep-watch because `cells.value` is a fresh array on every invalidation.
  watch(cells, schedulePersist)

  return {
    columns,
    rules,
    openedFromNewerFile,
    quiz,
    teams,
    teamQuizzers,
    cells,
    noJumps,
    scoring,
    setCell,
    toggleNoJump,
    toggleOnTime,
    setQuizField,
    setTeamName,
    setQuizzerName,
    swapTeams,
    editAsOne,
    moveQuizzer,

    // Grey-out & validation
    validationErrors,
    timeoutValidationErrors,
    tooManyTimeoutsTeams,

    // Query helpers
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
    teamHasErrors,
    hasAnyErrors,
    colAnswerValue,
    noJumpHasConflict,

    // Column visibility
    visibleColumns,
    visibleOtRounds,
    allQuestionsComplete,

    // Placements
    placements,
    placementPoints,

    // Undo/redo
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    unsaved,
    undo,
    redo,
    edit,
    editBySheet,
    markSaved,
    markSubmitted,
    stateToMark,

    // Persistence
    store,
    noJumpMap,
    timeoutMap,
    pauseAutoSave,
    flushAutoSave,
    setAside,
    bringBack,
    keepFailed,
    replaceQuiz,
    restoreQuiz,
    loadFile,
    resetStore,
    clearAnswers,
    clearNames,

    // Timeouts
    teamTimeouts,
    timeoutCount,
    isTimeoutAllowed,
    addTimeout,
    removeLastTimeout,
    toggleTimeout,
    hasTimeoutAt,
    hasTimeoutAfterCol,

    // Question types
    setQuestionType,
  }
}
