import { ref, computed, shallowRef, watch } from 'vue'
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
  parseQuizFileAttempt,
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
import { applyStep, recordEdit, type UndoStep } from './undoSteps'
import { canonicalQuizFile } from '../persistence/quizFile'
import {
  currentTab,
  onTabLinkChange,
  type QuizRecord,
  type Tab,
  writeRecord,
  listKeptNewerAutoSaves,
  isAutoSavePausedForNewer,
  hasNewerKeptInPlace,
  readKeptNewerAutoSave,
  discardKeptNewerAutoSave as discardKeptAutoSaveKey,
} from '../persistence/autoSave'

/**
 * Seat vs. Quizzer: the positional indices used throughout this composable
 * (`teamIdx`, `seatIdx`, `colIdx`) are 0-based slots. A "seat" is a position on
 * a team's bench — the occupant can change after a substitution — distinct
 * from a "quizzer," which is a stable person with an immutable `id`. The
 * branded `TeamIdx` / `SeatIdx` / `ColIdx` types live in the scoring/store
 * layers; see `../types/indices.ts` for the full explanation.
 */
/** Undo steps the sheet keeps: up to this many, the oldest falling off */
const UNDO_LIMIT = 1000

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

  /** A step as the session runs it: its changes written back, then whatever runs alongside */
  function sheetStep(step: UndoStep, alongside?: HistoryCommand): SheetStep {
    return {
      step,
      undo: () => {
        applyStep(undoTarget, step, 'undo')
        alongside?.undo()
      },
      redo: () => {
        applyStep(undoTarget, step, 'redo')
        alongside?.redo()
      },
    }
  }

  /** Make `change` as one undoable step, with `alongside` run on each undo and redo */
  function edit(change: () => void, alongside?: HistoryCommand) {
    const step = recordEdit(undoTarget, change)
    if (step.changes.length > 0 || alongside) history.push(sheetStep(step, alongside))
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
    const named = [...restored.teams, ...restored.quizzers].some(({ name }) => name.trim())
    if (restored.answers.length > 0 || named) history.push(sheetStep({ changes: [] }))
  } else {
    // Nothing restored (empty, corrupt, or a newer auto-save set aside): no quiz to warn about
    openedFromNewerFile.value = false
  }

  /** Keys of auto-saves from a newer version, set aside by the previous version */
  const keptNewerAutoSaves = shallowRef(listKeptNewerAutoSaves())
  /** Auto-save is paused because a kept newer auto-save couldn't be moved out of its way */
  const autoSavePausedForKept = shallowRef(isAutoSavePausedForNewer())
  /** A newer quiz kept in place blocks the tutorial until it is discarded */
  const tutorialBlockedByKept = shallowRef(hasNewerKeptInPlace())

  function refreshKeptNewerAutoSaves(): void {
    keptNewerAutoSaves.value = listKeptNewerAutoSaves()
    autoSavePausedForKept.value = isAutoSavePausedForNewer()
    tutorialBlockedByKept.value = hasNewerKeptInPlace()
  }

  /**
   * Best-effort open of the most recent kept auto-save; throws if it can't be read. The kept
   * original stays until it is discarded: the opened copy has lost whatever this build can't read.
   */
  function openKeptNewerAutoSave(): void {
    const key = keptNewerAutoSaves.value[0]
    if (!key) return
    const json = readKeptNewerAutoSave(key)
    if (json !== null) loadFile(parseQuizFileAttempt(json), { fromNewerFile: true })
  }

  function discardKeptNewerAutoSave(): void {
    const key = keptNewerAutoSaves.value[0]
    if (!key) return
    discardKeptAutoSaveKey(key)
    refreshKeptNewerAutoSaves()
    // If that quiz was pausing auto-save, save the sheet now so work done meanwhile survives a reload
    schedulePersist()
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
    store.setTeamName(team.id, name)
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
    edit(
      () => {
        store.swapTeams(a.id, b.id)
        alongside()
      },
      // A swap is its own undoing
      { undo: alongside, redo: alongside },
    )
  }

  /**
   * Do an edit made of several writes as one, which undo takes back and redo makes again. Its own
   * undo and redo run too, in the session, for what they write outside the quiz; their writes to
   * the quiz repeat what the step already put back.
   */
  function editAsOne(change: HistoryCommand) {
    edit(change.redo, change)
  }

  function moveQuizzer(teamIdx: number, fromSeat: number, toSeat: number) {
    const team = teams.value[teamIdx]
    if (!team) return
    store.moveQuizzer(team.id, toSeatIdx(fromSeat), toSeatIdx(toSeat))
  }

  function setQuizzerName(teamIdx: number, seatIdx: number, name: string) {
    const team = teams.value[teamIdx]
    if (!team) return
    const qzrs = store.quizzersByTeam(team.id)
    const qzr = qzrs[seatIdx]
    if (!qzr) return
    store.setQuizzerName(qzr.id, name)
  }

  function toggleOnTime(teamIdx: number) {
    const team = teams.value[teamIdx]
    if (!team) return
    team.onTime = !team.onTime
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
    edit(() => addTimeoutNow(teamId, afterColumnKey))
  }

  function addTimeoutNow(teamId: number, afterColumnKey: string | null): void {
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
    store.setQuestionType(col.key, category)
  }

  // Names aren't kept in history, so typing them doesn't make the sheet dirty. What was typed since
  // the sheet was last saved, started or opened is told apart from those names instead.
  const namesNow = () =>
    JSON.stringify(
      store.teams.map((team) => [team.name, store.quizzersByTeam(team.id).map((q) => q.name)]),
    )
  const keptNames = ref(namesNow())
  /** Take the names on the sheet as its own, as a save or a quiz just begun has them */
  function keepNames() {
    keptNames.value = namesNow()
  }
  /** Whether names were typed that the sheet would lose: changed since kept, and not all blank */
  const namesChanged = computed(
    () =>
      namesNow() !== keptNames.value &&
      store.teams.some(
        (team) =>
          team.name.trim() !== '' ||
          store.quizzersByTeam(team.id).some((quizzer) => quizzer.name.trim() !== ''),
      ),
  )
  function markSaved() {
    history.markSaved()
    keepNames()
  }

  /** Load a deserialized quiz file into the store, replacing all state */
  function loadFile(data: DeserializeResult, { fromNewerFile = false } = {}) {
    openedFromNewerFile.value = fromNewerFile
    store.loadState(data)
    noJumpMap.value = data.noJumps
    timeoutMap.value = data.timeouts
    internalOtRounds.value = computeInitialOtRounds(data)
    history.clear()
    keepNames()
    startFile = stateNow()
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
    keepNames()
    startFile = stateNow()
  }

  /**
   * Restart the quiz with the same teams and quizzers: clears answers, no-jumps, timeouts and
   * question types, since a restarted quiz asks new questions
   */
  function clearAnswers() {
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
    history.clear()
  }

  /** Blank every team and quizzer name, as a new quiz has them */
  function clearNames() {
    for (const team of store.teams) {
      store.setTeamName(team.id, '')
      for (const quizzer of store.quizzersByTeam(team.id)) store.setQuizzerName(quizzer.id, '')
    }
    history.clear()
  }

  // --- Writing the tab's quiz, link and history ---

  /** The quiz on the sheet as a canonical file, which states are compared by */
  function stateNow(): string {
    return canonicalQuizFile({
      quiz: store.quiz,
      teams: store.teams,
      quizzers: store.quizzers,
      answers: store.answers,
      noJumps: noJumpMap.value,
      timeouts: timeoutMap.value,
    })
  }

  /** The state the quiz began in, kept with it */
  let startFile = startRecord?.start ?? stateNow()

  /** The tab's record as the sheet now has it */
  function recordNow(tab: Tab): QuizRecord {
    const file = stateNow()
    const before = tab.record
    return {
      ...before,
      id: tab.id,
      current: { file, undo: [], redo: [] },
      start: startFile,
      link: tab.link,
      fromNewerFile: openedFromNewerFile.value,
      unsaved: true,
      changedAt: before?.current?.file === file ? before.changedAt : Date.now(),
      offered: before?.offered ?? false,
    }
  }

  // Writes go one after another, so a slow one is never overtaken by an older state
  let writing = Promise.resolve()
  function persistNow() {
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = null
    if (pauseAutoSave.value || !tab) return
    const record = recordNow(tab)
    tab.record = record
    writing = writing.then(async () => {
      await writeRecord(record)
    })
  }

  /** Write the tab's quiz now, with whatever was waiting for the pause to end */
  function flushAutoSave() {
    persistNow()
  }

  /**
   * Show the tab's own quiz as its record has it, and give back its meet link: the record is left
   * alone while the tutorial runs, so this is what the tutorial ends with
   */
  function showTabQuiz() {
    const record = tab?.record
    const data = readState(record?.current?.file)
    if (data) loadFile(data, { fromNewerFile: record!.fromNewerFile })
    else resetStore()
    startFile = record?.start ?? startFile
    return record?.link ?? null
  }

  const pauseAutoSave = ref(false)
  let persistTimer: ReturnType<typeof setTimeout> | null = null
  function schedulePersist() {
    if (pauseAutoSave.value) return
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(persistNow, 300)
  }
  onTabLinkChange(schedulePersist)
  watch(openedFromNewerFile, schedulePersist)
  // The page may go before the pause ends; what is waiting is written as it goes
  window.addEventListener('pagehide', flushAutoSave)
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
    keptNewerAutoSaves,
    autoSavePausedForKept,
    tutorialBlockedByKept,
    openKeptNewerAutoSave,
    discardKeptNewerAutoSave,
    quiz,
    teams,
    teamQuizzers,
    cells,
    noJumps,
    scoring,
    setCell,
    toggleNoJump,
    toggleOnTime,
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
    isDirty: history.isDirty,
    namesChanged,
    keepNames,
    undo: history.undo,
    redo: history.redo,
    markSaved,

    // Persistence
    store,
    noJumpMap,
    timeoutMap,
    pauseAutoSave,
    flushAutoSave,
    showTabQuiz,
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
