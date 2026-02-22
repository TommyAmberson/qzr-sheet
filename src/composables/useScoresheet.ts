import { reactive } from 'vue'
import {
  type Scoresheet,
  type Team,
  type QuestionColumn,
  CellValue,
  cellKey,
  questionKey,
  QUIZZERS_PER_TEAM,
  TEAMS_COUNT,
} from '@/types/scoresheet'

function createEmptyTeam(id: number): Team {
  return {
    id,
    name: '',
    onTime: true,
    timeouts: [],
    quizzers: Array.from({ length: QUIZZERS_PER_TEAM }, (_, i) => ({
      id: i,
      name: '',
    })),
  }
}

export function useScoresheet() {
  const sheet: Scoresheet = reactive({
    meta: {
      division: 1,
      quizNumber: 1,
      overtime: false,
    },
    teams: Array.from({ length: TEAMS_COUNT }, (_, i) => createEmptyTeam(i)),
    cells: {},
  })

  function getCell(teamIdx: number, quizzerIdx: number, col: QuestionColumn): CellValue {
    const key = cellKey(teamIdx, quizzerIdx, questionKey(col))
    return sheet.cells[key] ?? CellValue.Empty
  }

  function setCell(teamIdx: number, quizzerIdx: number, col: QuestionColumn, value: CellValue) {
    const key = cellKey(teamIdx, quizzerIdx, questionKey(col))
    if (value === CellValue.Empty) {
      delete sheet.cells[key]
    } else {
      sheet.cells[key] = value
    }
  }

  /** Cycle through cell values on click */
  function cycleCell(teamIdx: number, quizzerIdx: number, col: QuestionColumn) {
    const current = getCell(teamIdx, quizzerIdx, col)
    const order = [CellValue.Empty, CellValue.Correct, CellValue.Error, CellValue.Foul]
    const idx = order.indexOf(current)
    const next = order[(idx + 1) % order.length]
    setCell(teamIdx, quizzerIdx, col, next)
  }

  return {
    sheet,
    getCell,
    setCell,
    cycleCell,
  }
}
