import { ref, computed, watch } from 'vue'
import { useHistory } from './useHistory'
import {
  CellValue,
  QuestionCategory,
  buildColumns,
  QuestionType,
  type Column,
  type Quiz,
  type Team,
  type PlaceKey,
} from '../types/scoresheet'
import { createQuizStore } from '../stores/quizStore'
import { scoreTeam, type TeamScoring } from '../scoring/scoreTeam'
import { computeGreyedOut, type GreyedOutResult } from '../scoring/greyedOut'
import { validateCells, ValidationCode, validationMessage } from '../scoring/validation'
import { isBonusSituation } from '../scoring/helpers'
import { computeVisibleColumns, computeOrphanedColumns } from '../scoring/columnVisibility'
import {
  getOvertimeEligibleTeams,
  computeOtIneligibility,
  computeOvertimeRounds,
  computeOtCheckpointScores,
  computeRegulationScores,
  questionsComplete,
  quizJumpedComplete,
} from '../scoring/overtime'
import { computePlacements, computePlacementPoints } from '../scoring/placement'
import type { DeserializeResult } from '../persistence/quizFile'
import { saveToStorage, loadFromStorage, clearStorage } from '../persistence/autoSave'

export function useScoresheet() {
  const store = createQuizStore()
  const history = useHistory()

  // --- Reactive wrappers around store data ---
  const quiz = ref<Quiz>(store.quiz)

  // Bump this to force recomputation of cells/scoring after answer changes
  const answerVersion = ref(0)

  // Bump this to force recomputation when team metadata (e.g. onTime) changes
  const teamVersion = ref(0)

  /**
   * Internally tracked overtime round count.
   * Starts at 1 when OT is enabled, auto-grows when content is added.
   */
  const internalOtRounds = ref(1)

  /** No-jump flags — grows/shrinks with columns */
  const noJumpMap = ref(new Map<string, boolean>())

  // --- Restore persisted state from localStorage ---
  const restored = loadFromStorage()
  if (restored) {
    store.loadState(restored)
    quiz.value = store.quiz
    noJumpMap.value = restored.noJumps
    internalOtRounds.value = restored.quiz.overtime
      ? Math.max(
          1,
          computeOvertimeRounds(
            store.cellGrid(buildColumns(20)),
            buildColumns(20),
            restored.teams.map((t) => t.onTime),
            buildColumns(20).map((c) => restored.noJumps.get(c.key) ?? false),
          ),
        )
      : 1
    if (restored.answers.length > 0 || restored.quizzers.some((q) => q.name.trim())) {
      history.push({ undo: () => {}, redo: () => {} })
    }
  }

  /** Columns built reactively — regulation when OT is off, + OT rounds when on */
  const columns = computed<Column[]>(() => {
    const rounds = quiz.value.overtime ? internalOtRounds.value : 0
    return buildColumns(rounds)
  })

  const noJumps = computed<boolean[]>(() =>
    columns.value.map((col) => noJumpMap.value.get(col.key) ?? false),
  )

  /** Teams sorted by seat order — this is the canonical iteration order */
  const teams = computed<Team[]>(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    teamVersion.value // reactive dependency
    return [...store.teams].sort((a, b) => a.seatOrder - b.seatOrder)
  })

  /** Quizzers per team, indexed by team position */
  const teamQuizzers = computed(() => teams.value.map((team) => store.quizzersByTeam(team.id)))

  /** Derived cell grid — recomputes when answerVersion or columns change */
  const cells = computed<CellValue[][][]>(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    answerVersion.value // reactive dependency
    return store.cellGrid(columns.value)
  })

  /** Set a cell value using positional indices (for UI compatibility) */
  function setCell(teamIdx: number, quizzerIdx: number, colIdx: number, value: CellValue) {
    const team = teams.value[teamIdx]
    if (!team) return
    const qzrs = store.quizzersByTeam(team.id)
    const qzr = qzrs[quizzerIdx]
    const col = columns.value[colIdx]
    if (!qzr || !col) return
    const prev = store.getAnswer(qzr.id, col.key)
    if (prev === value) return
    store.setAnswer(qzr.id, col.key, value)
    answerVersion.value++
    history.push({
      undo: () => {
        store.setAnswer(qzr.id, col.key, prev)
        answerVersion.value++
      },
      redo: () => {
        store.setAnswer(qzr.id, col.key, value)
        answerVersion.value++
      },
    })
  }

  // --- Scoring ---

  const scoring = computed<TeamScoring[]>(() => {
    const cols = columns.value
    const grid = cells.value
    return teams.value.map((team, ti) => scoreTeam(grid[ti]!, cols, team.onTime))
  })

  // --- Grey-out & validation ---

  // Per-column ineligibility map: which teams can't jump on each OT column,
  // scoped correctly so teams resolved out in round N aren't retroactively
  // tossed-up on round N columns.
  const otIneligibility = computed(() =>
    computeOtIneligibility(
      cells.value,
      columns.value,
      teams.value.map((t) => t.onTime),
      noJumps.value,
    ),
  )

  // Regulation-only eligibility for NotInOvertime validation — a team's OT
  // answers are never invalid just because they were resolved out later.
  const otEligibleTeams = computed(() =>
    getOvertimeEligibleTeams(
      cells.value,
      columns.value,
      teams.value.map((t) => t.onTime),
    ),
  )

  const greyedOutResult = computed<GreyedOutResult>(() =>
    computeGreyedOut(cells.value, columns.value, otIneligibility.value),
  )

  const orphanedColumns = computed(() =>
    computeOrphanedColumns(
      cells.value,
      columns.value,
      noJumps.value,
      visibleOtRounds.value,
      greyedOutResult.value.colStatuses,
    ),
  )

  /** Set of "ti:qi" keys for quizzers with empty/blank names */
  const emptySeats = computed(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    teamVersion.value // reactive dependency
    const set = new Set<string>()
    teams.value.forEach((team, ti) => {
      const qzrs = store.quizzersByTeam(team.id)
      qzrs.forEach((qzr, qi) => {
        if (store.isEmptySeat(qzr.id)) set.add(`${ti}:${qi}`)
      })
    })
    return set
  })

  const validationErrors = computed(() =>
    validateCells(
      cells.value,
      columns.value,
      greyedOutResult.value,
      noJumps.value,
      otEligibleTeams.value,
      orphanedColumns.value,
      emptySeats.value,
    ),
  )

  // --- Query helpers (business logic the template needs) ---

  function isBonusForTeam(teamIdx: number, colIdx: number): boolean {
    return isBonusSituation(greyedOutResult.value.tossedUp, teamIdx, colIdx, teams.value.length)
  }

  function isGreyedOut(teamIdx: number, colIdx: number): boolean {
    return greyedOutResult.value.disabled.has(`${teamIdx}:${colIdx}`)
  }

  function isInvalid(ti: number, qi: number, ci: number): boolean {
    return validationErrors.value.has(`${ti}:${qi}:${ci}`)
  }

  /** Get human-readable validation messages for a cell (deduplicated) */
  function cellValidationMessages(ti: number, qi: number, ci: number): string[] {
    const codes = validationErrors.value.get(`${ti}:${qi}:${ci}`)
    if (!codes) return []
    return [...new Set(codes.map(validationMessage))]
  }

  /** Whether any cell in a column has a validation error */
  function columnHasErrors(ci: number): boolean {
    for (const key of validationErrors.value.keys()) {
      if (key.endsWith(`:${ci}`)) return true
    }
    return false
  }

  /** Get deduplicated validation messages for all cells in a column */
  function columnValidationMessages(ci: number): string[] {
    const msgs = new Set<string>()
    for (const [key, codes] of validationErrors.value) {
      if (key.endsWith(`:${ci}`)) {
        for (const code of codes) msgs.add(validationMessage(code))
      }
    }
    return [...msgs]
  }

  /** Whether any cell for a specific quizzer has a validation error */
  function quizzerHasErrors(ti: number, qi: number): boolean {
    for (const key of validationErrors.value.keys()) {
      if (key.startsWith(`${ti}:${qi}:`)) return true
    }
    return false
  }

  /** Get deduplicated validation messages for a specific quizzer */
  function quizzerValidationMessages(ti: number, qi: number): string[] {
    const msgs = new Set<string>()
    for (const [key, codes] of validationErrors.value) {
      if (key.startsWith(`${ti}:${qi}:`)) {
        for (const code of codes) msgs.add(validationMessage(code))
      }
    }
    return [...msgs]
  }

  /** Get deduplicated validation messages for all cells in a team */
  function teamValidationMessages(ti: number): string[] {
    const msgs = new Set<string>()
    for (const [key, codes] of validationErrors.value) {
      if (key.startsWith(`${ti}:`)) {
        for (const code of codes) msgs.add(validationMessage(code))
      }
    }
    return [...msgs]
  }

  function isAfterOut(ti: number, qi: number, colIdx: number): boolean {
    const qs = scoring.value[ti]?.quizzers[qi]
    if (!qs || qs.outAfterCol < 0 || colIdx <= qs.outAfterCol) return false
    if (cells.value[ti]![qi]![colIdx] !== CellValue.Empty) return false
    if (qs.quizzedOut && !qs.erroredOut) {
      if (columns.value[colIdx]?.type === QuestionType.B || isBonusForTeam(ti, colIdx)) return false
    }
    return true
  }

  function isFouledOnQuestion(ti: number, qi: number, colIdx: number): boolean {
    return greyedOutResult.value.fouledQuizzers.has(`${ti}:${qi}:${colIdx}`)
  }

  function teamHasErrors(ti: number): boolean {
    for (const key of validationErrors.value.keys()) {
      if (key.startsWith(`${ti}:`)) return true
    }
    return false
  }

  const hasAnyErrors = computed(() => validationErrors.value.size > 0)

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

  /** Check if a quizzer is an empty seat by positional indices */
  function isEmptySeat(teamIdx: number, quizzerIdx: number): boolean {
    const team = teams.value[teamIdx]
    if (!team) return false
    const qzrs = store.quizzersByTeam(team.id)
    const qzr = qzrs[quizzerIdx]
    if (!qzr) return false
    return store.isEmptySeat(qzr.id)
  }

  function noJumpHasConflict(colIdx: number): boolean {
    if (!noJumps.value[colIdx]) return false
    // No-jump on an orphaned column is itself invalid
    if (orphanedColumns.value.has(colIdx)) return true
    for (const key of validationErrors.value.keys()) {
      if (key.endsWith(`:${colIdx}`)) {
        const codes = validationErrors.value.get(key)
        if (codes?.includes(ValidationCode.NoJump)) return true
      }
    }
    return false
  }

  // --- Column visibility ---

  /** How many OT rounds should be visible (0 = none, 1 = Q21-23, etc.) */
  const visibleOtRounds = computed(() => {
    if (!quiz.value.overtime) return 0
    return computeOvertimeRounds(
      cells.value,
      columns.value,
      teams.value.map((t) => t.onTime),
      noJumps.value,
    )
  })

  /** Grow internal allocation when more rounds are needed */
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
      greyedOutResult.value.colStatuses,
    ),
  )

  /** Whether regulation questions (Q1–20) are fully filled out */
  const regulationComplete = computed(() =>
    questionsComplete(cells.value, columns.value, noJumps.value, 1, 20),
  )

  /** Whether all questions in the visible range have been jumped on or no-jumped */
  const allQuestionsComplete = computed(() =>
    quizJumpedComplete(cells.value, columns.value, noJumps.value, visibleOtRounds.value),
  )

  /** Placement medals per team: PlaceKey (encoding rank + tie-width), or null if not yet placed */
  const placements = computed(() => {
    if (!regulationComplete.value || hasAnyErrors.value) {
      return teams.value.map((): PlaceKey | null => null)
    }
    const onTimes = teams.value.map((t) => t.onTime)
    const regScores = computeRegulationScores(cells.value, columns.value, onTimes)
    const checkpoints = computeOtCheckpointScores(
      cells.value,
      columns.value,
      onTimes,
      noJumps.value,
    )
    return computePlacements(regScores, checkpoints, true, visibleOtRounds.value > 0)
  })

  /** Placement points per team (null if not yet placed), derived from placement + regulation score.
   * Per rules §1.e.4: in case of a tie, placement points use the score at end of Q20, not OT. */
  const placementPoints = computed(() => {
    const onTimes = teams.value.map((t) => t.onTime)
    const regScores = computeRegulationScores(cells.value, columns.value, onTimes)
    return teams.value.map((_, ti) =>
      computePlacementPoints(
        regScores[ti] ?? 0,
        placements.value[ti] ?? null,
        quiz.value.placementFormula,
      ),
    )
  })

  /** Update a team name by positional index */
  function setTeamName(teamIdx: number, name: string) {
    const team = teams.value[teamIdx]
    if (!team) return
    store.setTeamName(team.id, name)
    teamVersion.value++
  }

  /** Move a quizzer within a team by positional indices */
  function moveQuizzer(teamIdx: number, fromSeat: number, toSeat: number) {
    const team = teams.value[teamIdx]
    if (!team) return
    store.moveQuizzer(team.id, fromSeat, toSeat)
    teamVersion.value++
    answerVersion.value++
  }

  /** Update a quizzer name by positional indices */
  function setQuizzerName(teamIdx: number, quizzerIdx: number, name: string) {
    const team = teams.value[teamIdx]
    if (!team) return
    const qzrs = store.quizzersByTeam(team.id)
    const qzr = qzrs[quizzerIdx]
    if (!qzr) return
    store.setQuizzerName(qzr.id, name)
    teamVersion.value++
  }

  /** Toggle on-time for a team by index */
  function toggleOnTime(teamIdx: number) {
    const team = teams.value[teamIdx]
    if (!team) return
    team.onTime = !team.onTime
    teamVersion.value++
  }

  /** Toggle no-jump for a column by key */
  function toggleNoJump(colIdx: number) {
    const key = columns.value[colIdx]?.key
    if (!key) return
    const prev = noJumpMap.value.get(key) ?? false
    const next = !prev
    noJumpMap.value.set(key, next)
    noJumpMap.value = new Map(noJumpMap.value)
    history.push({
      undo: () => {
        noJumpMap.value.set(key, prev)
        noJumpMap.value = new Map(noJumpMap.value)
      },
      redo: () => {
        noJumpMap.value.set(key, next)
        noJumpMap.value = new Map(noJumpMap.value)
      },
    })
  }

  /** Set the question category for a column by index (null clears it) */
  function setQuestionType(colIdx: number, category: QuestionCategory | null) {
    const col = columns.value[colIdx]
    if (!col) return
    store.setQuestionType(col.key, category)
    answerVersion.value++
  }

  /** Load a deserialized quiz file into the store, replacing all state */
  function loadFile(data: DeserializeResult) {
    store.loadState(data)
    quiz.value = store.quiz
    noJumpMap.value = data.noJumps
    internalOtRounds.value = data.quiz.overtime
      ? Math.max(
          1,
          computeOvertimeRounds(
            store.cellGrid(buildColumns(20)),
            buildColumns(20),
            data.teams.map((t) => t.onTime),
            buildColumns(20).map((c) => data.noJumps.get(c.key) ?? false),
          ),
        )
      : 1
    answerVersion.value++
    teamVersion.value++
    history.clear()
    saveToStorage(store, data.noJumps)
  }
  function resetStore() {
    const fresh = createQuizStore()
    store.loadState({
      quiz: fresh.quiz,
      teams: fresh.teams,
      quizzers: fresh.quizzers,
      answers: [],
    })
    quiz.value = store.quiz
    noJumpMap.value = new Map()
    internalOtRounds.value = 1
    answerVersion.value++
    teamVersion.value++
    history.clear()
    clearStorage()
  }

  /** Clear all answers and no-jump flags, keeping names and quiz metadata */
  function clearAnswers() {
    store.loadState({
      quiz: store.quiz,
      teams: store.teams,
      quizzers: store.quizzers,
      answers: [],
    })
    noJumpMap.value = new Map()
    internalOtRounds.value = 1
    answerVersion.value++
    history.clear()
    saveToStorage(store, noJumpMap.value)
  }

  /** Clear all team and quizzer names, keeping answers and quiz metadata */
  function clearNames() {
    for (const team of store.teams) {
      store.setTeamName(team.id, '')
    }
    for (const quizzer of store.quizzers) {
      store.setQuizzerName(quizzer.id, '')
    }
    teamVersion.value++
    history.clear()
    saveToStorage(store, noJumpMap.value)
  }

  // --- Auto-persist to localStorage ---
  let persistTimer: ReturnType<typeof setTimeout> | null = null
  function schedulePersist() {
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => saveToStorage(store, noJumpMap.value), 300)
  }
  watch(
    [
      () => answerVersion.value,
      () => teamVersion.value,
      noJumpMap,
      () => quiz.value.division,
      () => quiz.value.quizNumber,
      () => quiz.value.overtime,
      () => quiz.value.placementFormula,
    ],
    schedulePersist,
  )

  return {
    columns,
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
    moveQuizzer,

    // Grey-out & validation
    validationErrors,

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
    undo: history.undo,
    redo: history.redo,
    markSaved: history.markSaved,

    // Persistence
    store,
    noJumpMap,
    loadFile,
    resetStore,
    clearAnswers,
    clearNames,

    // Question types
    setQuestionType,
  }
}
