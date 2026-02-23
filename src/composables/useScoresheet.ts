import { ref, computed, watch } from 'vue'
import { CellValue, buildColumns, buildKeyToIdx, QuestionType, type Column, type Quiz, type Team, type Quizzer } from '../types/scoresheet'
import { createQuizStore } from '../stores/quizStore'
import { scoreTeam, type TeamScoring } from '../scoring/scoreTeam'
import { computeGreyedOut, type GreyedOutResult } from '../scoring/greyedOut'
import { validateCells, ValidationCode } from '../scoring/validation'
import {
  isBonusSituation,
} from '../scoring/helpers'
import { computeVisibleColumns, abColumnNeeded as _abColumnNeeded } from '../scoring/columnVisibility'
import { getOvertimeEligibleTeams, computeOvertimeRounds, computeOtCheckpointScores, computeRegulationScores, questionsComplete } from '../scoring/overtime'
import { computePlacements } from '../scoring/placement'

export function useScoresheet() {
  const store = createQuizStore()

  // --- Reactive wrappers around store data ---
  const quiz = ref<Quiz>(store.quiz)

  // Bump this to force recomputation of cells/scoring after answer changes
  const answerVersion = ref(0)

  /**
   * Internally tracked overtime round count.
   * Starts at 1 when OT is enabled, auto-grows when content is added.
   */
  const internalOtRounds = ref(1)

  /** Columns built reactively — regulation when OT is off, + OT rounds when on */
  const columns = computed<Column[]>(() => {
    const rounds = quiz.value.overtime ? internalOtRounds.value : 0
    return buildColumns(rounds)
  })

  /** Key→index lookup, kept in sync with columns */
  const keyToIdx = computed(() => buildKeyToIdx(columns.value))

  /** No-jump flags — grows/shrinks with columns */
  const noJumpMap = ref(new Map<string, boolean>())

  const noJumps = computed<boolean[]>(() =>
    columns.value.map((col) => noJumpMap.value.get(col.key) ?? false),
  )

  /** Teams sorted by seat order — this is the canonical iteration order */
  const teams = computed<Team[]>(() =>
    [...store.teams].sort((a, b) => a.seatOrder - b.seatOrder),
  )

  /** Quizzers per team, indexed by team position */
  const teamQuizzers = computed(() =>
    teams.value.map((team) => store.quizzersByTeam(team.id)),
  )

  /** All quizzers (flat list) */
  const quizzers = computed<Quizzer[]>(() => store.quizzers)

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
    store.setAnswer(qzr.id, col.key, value)
    answerVersion.value++
  }

  // --- Scoring ---

  const scoring = computed<TeamScoring[]>(() => {
    const cols = columns.value
    const grid = cells.value
    return teams.value.map((team, ti) => scoreTeam(grid[ti]!, cols, team.onTime))
  })

  // --- Grey-out & validation ---

  const otEligibleTeams = computed(() =>
    getOvertimeEligibleTeams(
      cells.value,
      columns.value,
      teams.value.map((t) => t.onTime),
    ),
  )

  const greyedOutResult = computed<GreyedOutResult>(() =>
    computeGreyedOut(cells.value, columns.value, otEligibleTeams.value),
  )

  const tossedUpSet = computed(() => greyedOutResult.value.tossedUp)

  const validationErrors = computed(() =>
    validateCells(cells.value, columns.value, greyedOutResult.value, noJumps.value, otEligibleTeams.value),
  )

  // --- Query helpers (business logic the template needs) ---

  function isBonusForTeam(teamIdx: number, colIdx: number): boolean {
    return isBonusSituation(tossedUpSet.value, teamIdx, colIdx, teams.value.length)
  }

  function isGreyedOut(teamIdx: number, colIdx: number): boolean {
    return greyedOutResult.value.disabled.has(`${teamIdx}:${colIdx}`)
  }

  function isInvalid(ti: number, qi: number, ci: number): boolean {
    return validationErrors.value.has(`${ti}:${qi}:${ci}`)
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

  function noJumpHasConflict(colIdx: number): boolean {
    if (!noJumps.value[colIdx]) return false
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
    computeVisibleColumns(cells.value, columns.value, noJumps.value, visibleOtRounds.value),
  )

  function abColumnNeeded(colIdx: number): boolean {
    return _abColumnNeeded(cells.value, columns.value, noJumps.value, colIdx)
  }

  const allQuestionsComplete = computed(() => {
    const cols = columns.value
    for (let ci = 0; ci < cols.length; ci++) {
      const col = cols[ci]!
      if ((col.type === QuestionType.A || col.type === QuestionType.B) && !abColumnNeeded(ci)) continue
      if (noJumps.value[ci]) continue
      if (colAnswerValue(ci) !== CellValue.Empty) continue
      return false
    }
    return true
  })

  /** Whether regulation questions (Q1–20) are fully filled out */
  const regulationComplete = computed(() =>
    questionsComplete(cells.value, columns.value, noJumps.value, 1, 20),
  )

  /** Placement medals: 1/2/3 per team, or null if not yet placed */
  const placements = computed(() => {
    if (!regulationComplete.value || hasAnyErrors.value) {
      return teams.value.map(() => null)
    }
    const onTimes = teams.value.map((t) => t.onTime)
    const regScores = computeRegulationScores(cells.value, columns.value, onTimes)
    const checkpoints = computeOtCheckpointScores(cells.value, columns.value, onTimes, noJumps.value)
    return computePlacements(regScores, checkpoints, true)
  })

  /** Toggle no-jump for a column by key */
  function toggleNoJump(colIdx: number) {
    const key = columns.value[colIdx]?.key
    if (!key) return
    const current = noJumpMap.value.get(key) ?? false
    noJumpMap.value.set(key, !current)
    // Trigger reactivity on the map ref
    noJumpMap.value = new Map(noJumpMap.value)
  }

  return {
    columns,
    quiz,
    teams,
    teamQuizzers,
    quizzers,
    cells,
    noJumps,
    scoring,
    setCell,
    toggleNoJump,
    store,

    // Grey-out & validation
    greyedOutResult,
    tossedUpSet,
    validationErrors,

    // Query helpers
    isBonusForTeam,
    isGreyedOut,
    isInvalid,
    isAfterOut,
    isFouledOnQuestion,
    teamHasErrors,
    hasAnyErrors,
    colAnswerValue,
    noJumpHasConflict,

    // Column visibility
    visibleColumns,
    allQuestionsComplete,
    abColumnNeeded,

    // Placements
    placements,
  }
}
