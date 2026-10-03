import { CellValue, PlacementFormula, QuizFormat, type QuizFile } from '../../../quizFile'
import { buildColumns } from '../../../types/scoresheet'
import { quizRules } from '../../quizRules'

export const RULES = quizRules(QuizFormat.FifteenQuestion)
export const cols = buildColumns(RULES)
const { Correct: C, Error: E, Foul: F, Bonus: B } = CellValue

// One complete three-team 15-question quiz (teams A, B, C; seat numbers 0-4), scored by hand.
//
// | Q   | Answer   | A       | B       | C       | Why                                          |
// | --- | -------- | ------- | ------- | ------- | -------------------------------------------- |
// |     | on time  | +20     | +20     | +20     |                                              |
// | 1   | A0 c     | +20     |         |         |                                              |
// | 2   | A0 c     | +20     |         |         |                                              |
// | 3   | A0 c     | +30     |         |         | 3rd correct, no errors: quiz-out bonus       |
// | 4   | B0 e     |         | 0       |         | first error, before error points: free       |
// | 5   | C0 e     |         |         | 0       | toss-up error, also free                     |
// | 6   | A0 b     | +20     |         |         | bonus before error points; quizzed out is ok |
// | 7   | A1 c     | +20     |         |         |                                              |
// | 8   | A2 c     | +30     |         |         | 3rd unique quizzer                           |
// | 9   | B1 f, C1 c |       | 0       | +20     | first team foul: no deduction                |
// | 10  | C1 c     |         |         | +20     |                                              |
// | 11  | C1 c     |         |         | +30     | C1's 3rd correct, no errors: quiz-out bonus  |
// | 12  | B2 e     |         | 0       |         | B's 2nd team error, B2's 1st: free           |
// | 12A | A3 e     | 0       |         |         | toss-up error, A's 1st: free                 |
// | 12B | C3 b     |         |         | +20     | bonus on Q12 is still worth 20               |
// | 13  | B0 e     |         | -10     |         | error points                                 |
// | 13A | C2 e     |         |         | -10     | error points                                 |
// | 13B | A2 b     | +10     |         |         | bonus from Q13 on is worth 10                |
// | 14  | A4 c     | +30     |         |         | 4th unique quizzer                           |
// | 15  | B3 c     |         | +20     |         |                                              |
// |     | total    | 200     | 30      | 100     |                                              |
export const ANSWERS: [team: number, seat: number, key: string, value: CellValue][] = [
  [0, 0, '1', C],
  [0, 0, '2', C],
  [0, 0, '3', C],
  [1, 0, '4', E],
  [2, 0, '5', E],
  [0, 0, '6', B],
  [0, 1, '7', C],
  [0, 2, '8', C],
  [1, 1, '9', F],
  [2, 1, '9', C],
  [2, 1, '10', C],
  [2, 1, '11', C],
  [1, 2, '12', E],
  [0, 3, '12A', E],
  [2, 3, '12B', B],
  [1, 0, '13', E],
  [2, 2, '13A', E],
  [0, 2, '13B', B],
  [0, 4, '14', C],
  [1, 3, '15', C],
]

export function buildCells(): CellValue[][][] {
  const cells = [0, 1, 2].map(() =>
    Array.from({ length: 5 }, () => cols.map(() => CellValue.Empty)),
  )
  for (const [team, seat, key, value] of ANSWERS) {
    const colIdx = cols.findIndex((c) => c.key === key)
    if (colIdx === -1) throw new Error(`Column ${key} not found`)
    cells[team]![seat]![colIdx] = value
  }
  return cells
}

/** The same quiz as a saved quiz file: teams A, B, C (ids 1-3), quizzer id `team * 10 + seat` */
export function fifteenQuestionQuizFile(): QuizFile {
  const names = ['A', 'B', 'C']
  return {
    version: 3,
    quiz: {
      division: '1',
      quizNumber: '1',
      overtime: false,
      placementFormula: PlacementFormula.Rules,
      format: QuizFormat.FifteenQuestion,
      questionTypes: [],
    },
    teams: names.map((name, team) => ({
      id: team + 1,
      name: `Team ${name}`,
      onTime: true,
      seatOrder: team,
      quizzers: [0, 1, 2, 3, 4].map((seat) => ({
        id: (team + 1) * 10 + seat,
        name: `${name}${seat}`,
        seatOrder: seat,
      })),
    })),
    answers: ANSWERS.map(([team, seat, columnKey, value]) => ({
      quizzerId: (team + 1) * 10 + seat,
      columnKey,
      value,
    })),
    noJumps: [],
  }
}
