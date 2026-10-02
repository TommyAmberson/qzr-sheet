import { CellValue, QuizFormat } from '../../../quizFile'
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
// | 11  | B2 e     |         | 0       |         | B's 2nd team error, B2's 1st: free           |
// | 11A | A3 e     | 0       |         |         | toss-up error, A's 1st: free                 |
// | 11B | C3 b     |         |         | +20     | bonus on Q11 is still worth 20               |
// | 12  | C1 c     |         |         | +30     | C1's 3rd correct, no errors: quiz-out bonus  |
// | 13  | B0 e     |         | -10     |         | error points                                 |
// | 13A | C2 e     |         |         | -10     | error points                                 |
// | 13B | A2 b     | +10     |         |         | bonus from Q12 on is worth 10                |
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
  [1, 2, '11', E],
  [0, 3, '11A', E],
  [2, 3, '11B', B],
  [2, 1, '12', C],
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
