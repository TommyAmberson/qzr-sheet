import { ref, computed, triggerRef } from 'vue'
import { CellValue, COLUMNS, KEY_TO_IDX, QuestionType, MAX_OVERTIME_ROUNDS, type Quiz, type Team, type Quizzer } from '../types/scoresheet'
import { createQuizStore } from '../stores/quizStore'
import { scoreTeam, type TeamScoring } from '../scoring/scoreTeam'
import { computeGreyedOut, type GreyedOutResult } from '../scoring/greyedOut'
import { validateCells, ValidationCode } from '../scoring/validation'
import {
  anyTeamHasValue,
  colHasAnyContent,
  isBonusSituation,
} from '../scoring/helpers'
import { overtimeQuestionsNeeded, getOvertimeEligibleTeams } from '../scoring/overtime'

export function useScoresheet() {
  const store = createQuizStore()
  const columns = COLUMNS

  // --- Reactive wrappers around store data ---
  const quiz = ref<Quiz>(store.quiz)
  const noJumps = ref<boolean[]>(store.noJumps)

  // Bump this to force recomputation of cells/scoring after answer changes
  const answerVersion = ref(0)

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

  /** Derived cell grid — recomputes when answerVersion changes */
  const cells = computed<CellValue[][][]>(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    answerVersion.value // reactive dependency
    return store.cellGrid()
  })

  /** Set a cell value using positional indices (for UI compatibility) */
  function setCell(teamIdx: number, quizzerIdx: number, colIdx: number, value: CellValue) {
    const team = teams.value[teamIdx]
    if (!team) return
    const qzrs = store.quizzersByTeam(team.id)
    const qzr = qzrs[quizzerIdx]
    const col = columns[colIdx]
    if (!qzr || !col) return
    store.setAnswer(qzr.id, col.key, value)
    answerVersion.value++
  }

  // --- Scoring ---

  const scoring = computed<TeamScoring[]>(() => {
    const grid = cells.value
    return teams.value.map((team, ti) => scoreTeam(grid[ti]!, columns, team.onTime))
  })

  // --- Grey-out & validation ---

  const greyedOutResult = computed<GreyedOutResult>(() =>
    computeGreyedOut(cells.value, columns),
  )

  const tossedUpSet = computed(() => greyedOutResult.value.tossedUp)

  const otEligibleTeams = computed(() =>
    getOvertimeEligibleTeams(
      cells.value,
      columns,
      teams.value.map((t) => t.onTime),
    ),
  )

  const validationErrors = computed(() =>
    validateCells(cells.value, columns, greyedOutResult.value, noJumps.value, otEligibleTeams.value),
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
      if (columns[colIdx]?.type === QuestionType.B || isBonusForTeam(ti, colIdx)) return false
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

  function abColumnNeeded(colIdx: number): boolean {
    if (colHasAnyContent(cells.value, colIdx)) return true
    const col = columns[colIdx]!
    if (col.type === QuestionType.A) {
      const baseIdx = KEY_TO_IDX.get(`${col.number}`)
      return baseIdx !== undefined && anyTeamHasValue(cells.value, baseIdx, CellValue.Error)
    }
    if (col.type === QuestionType.B) {
      const aIdx = KEY_TO_IDX.get(`${col.number}A`)
      return aIdx !== undefined && anyTeamHasValue(cells.value, aIdx, CellValue.Error)
    }
    return false
  }

  /** How many overtime questions are visible (0, 3, 6, 9, …) */
  const overtimeCount = computed(() =>
    overtimeQuestionsNeeded(quiz.value.overtimeRounds),
  )

  /** Max overtime question number currently visible (0 = none, 23 = round 1, 26 = round 2, …) */
  const maxOvertimeQuestion = computed(() => {
    if (overtimeCount.value === 0) return 0
    return 20 + overtimeCount.value
  })

  /** Add another overtime round (3 questions) */
  function addOvertimeRound() {
    if (quiz.value.overtimeRounds < MAX_OVERTIME_ROUNDS) {
      quiz.value.overtimeRounds++
    }
  }

  /** Remove the last overtime round (won't go below 0) */
  function removeOvertimeRound() {
    if (quiz.value.overtimeRounds > 0) {
      quiz.value.overtimeRounds--
    }
  }

  const visibleColumns = computed(() =>
    columns.map((col, i) => ({ col, idx: i })).filter(({ col, idx }) => {
      // Overtime columns: hidden unless within the current OT round
      if (col.isOvertime && col.number > maxOvertimeQuestion.value) return false
      // A/B columns (both regulation and overtime): only show when needed
      if (col.type === QuestionType.A || col.type === QuestionType.B) return abColumnNeeded(idx)
      return true
    }),
  )

  const allQuestionsComplete = computed(() => {
    for (let ci = 0; ci < columns.length; ci++) {
      const col = columns[ci]!
      if (col.isOvertime && col.number > maxOvertimeQuestion.value) continue
      if ((col.type === QuestionType.A || col.type === QuestionType.B) && !abColumnNeeded(ci)) continue
      if (noJumps.value[ci]) continue
      if (colAnswerValue(ci) !== CellValue.Empty) continue
      return false
    }
    return true
  })

  /** Toggle no-jump for a column */
  function toggleNoJump(colIdx: number) {
    store.toggleNoJump(colIdx)
    triggerRef(noJumps)
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
    addOvertimeRound,
    removeOvertimeRound,
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
  }
}
