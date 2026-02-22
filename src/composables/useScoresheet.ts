import { ref, computed, triggerRef } from 'vue'
import { CellValue, COLUMNS, type Quiz, type Team, type Quizzer } from '../types/scoresheet'
import { createQuizStore } from '../stores/quizStore'
import { scoreTeam, type TeamScoring } from '../scoring/scoreTeam'

export function useScoresheet() {
  const store = createQuizStore()
  const columns = COLUMNS

  // --- Reactive wrappers around store data ---
  // The store is plain objects; we wrap in refs so Vue tracks changes.

  const quiz = ref<Quiz>(store.quiz)
  const noJumps = ref<boolean[]>(store.noJumps)

  // Bump this to force recomputation of cells/scoring after answer changes
  const answerVersion = ref(0)

  /** Teams sorted by seat order — this is the canonical iteration order */
  const teams = computed<Team[]>(() =>
    [...store.teams].sort((a, b) => a.seatOrder - b.seatOrder),
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

  /** Live scoring for all teams */
  const scoring = computed<TeamScoring[]>(() => {
    const grid = cells.value
    return teams.value.map((team, ti) => scoreTeam(grid[ti]!, columns, team.onTime))
  })

  /** Column index ranges for visual grouping */
  const columnGroups = computed(() => {
    const normal: number[] = []
    const ab: number[] = []
    const overtime: number[] = []
    columns.forEach((col, i) => {
      if (col.isOvertime) overtime.push(i)
      else if (col.isAB) ab.push(i)
      else normal.push(i)
    })
    return { normal, ab, overtime }
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
    quizzers,
    cells,
    noJumps,
    scoring,
    setCell,
    toggleNoJump,
    columnGroups,
    store,
  }
}
