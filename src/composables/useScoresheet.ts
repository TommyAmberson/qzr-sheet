import { ref, computed } from 'vue'
import { CellValue, buildColumns, type Team, type Column, type QuizMeta } from '../types/scoresheet'
import { scoreTeam, type TeamScoring } from '../scoring/scoreTeam'

/** Create a blank cell grid for a team's quizzers */
function blankCells(quizzerCount: number, columns: Column[]): CellValue[][] {
  return Array.from({ length: quizzerCount }, () => columns.map(() => CellValue.Empty))
}

function createDefaultTeams(): Team[] {
  return [1, 2, 3].map((id) => ({
    id,
    name: `Team ${id}`,
    onTime: true,
    timeouts: [],
    quizzers: Array.from({ length: 5 }, (_, i) => ({
      id: (id - 1) * 5 + i + 1,
      name: `Quizzer ${i + 1}`,
      teamId: id,
    })),
  }))
}

export function useScoresheet() {
  const columns = buildColumns()
  const teams = ref<Team[]>(createDefaultTeams())
  const noJumps = ref<boolean[]>(columns.map(() => false))
  const quizMeta = ref<QuizMeta>({
    division: 1,
    quizNumber: 1,
    overtime: false,
  })

  // cells[teamIndex][quizzerIndex][colIndex] = CellValue
  const cells = ref<CellValue[][][]>(
    teams.value.map((t) => blankCells(t.quizzers.length, columns)),
  )

  /** Get a cell value with bounds checking */
  function getCell(teamIdx: number, quizzerIdx: number, colIdx: number): CellValue {
    return cells.value[teamIdx]?.[quizzerIdx]?.[colIdx] ?? CellValue.Empty
  }

  /** Set a cell value */
  function setCell(teamIdx: number, quizzerIdx: number, colIdx: number, value: CellValue) {
    const teamCells = cells.value[teamIdx]
    if (teamCells?.[quizzerIdx]) {
      teamCells[quizzerIdx][colIdx] = value
    }
  }

  /** Cycle through cell values on click */
  function cycleCell(teamIdx: number, quizzerIdx: number, colIdx: number) {
    const current = getCell(teamIdx, quizzerIdx, colIdx)
    const cycle: CellValue[] = [
      CellValue.Empty,
      CellValue.Correct,
      CellValue.Error,
      CellValue.Foul,
      CellValue.Bonus,
      CellValue.MissedBonus,
    ]
    const idx = cycle.indexOf(current)
    const next = cycle[(idx + 1) % cycle.length]!
    setCell(teamIdx, quizzerIdx, colIdx, next)
  }

  /** Live scoring for all teams */
  const scoring = computed<TeamScoring[]>(() =>
    teams.value.map((team, ti) => scoreTeam(cells.value[ti]!, columns, team.onTime)),
  )

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
    noJumps.value[colIdx] = !noJumps.value[colIdx]
  }

  return {
    columns,
    teams,
    cells,
    noJumps,
    quizMeta,
    scoring,
    setCell,
    cycleCell,
    toggleNoJump,
    columnGroups,
  }
}
