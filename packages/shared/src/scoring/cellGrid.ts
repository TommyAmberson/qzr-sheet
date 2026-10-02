import { CellValue } from '../quizFile'
import type { Answer, Column, Quizzer, Team } from '../types/scoresheet'
import type { QuizzerId } from '../types/indices'

/** Looks up the value a quizzer has in a column; Empty when unanswered */
export type AnswerLookup = (quizzerId: QuizzerId, columnKey: string) => CellValue

/** The key a quiz's answers are indexed by */
export function answerKey(quizzerId: QuizzerId, columnKey: string): string {
  return `${quizzerId}:${columnKey}`
}

/** An `AnswerLookup` over a plain list of answers, such as a deserialized quiz file's */
export function answerLookup(
  answers: Pick<Answer, 'quizzerId' | 'columnKey' | 'value'>[],
): AnswerLookup {
  const byKey = new Map(answers.map((a) => [answerKey(a.quizzerId, a.columnKey), a.value]))
  return (quizzerId, columnKey) => byKey.get(answerKey(quizzerId, columnKey)) ?? CellValue.Empty
}

/** Teams in seat order, each with its quizzers in seat order: the order scoring indexes them by */
export function inSeatOrder<
  T extends Pick<Team, 'id' | 'seatOrder'>,
  Q extends Pick<Quizzer, 'teamId' | 'seatOrder'>,
>(teams: T[], quizzers: Q[]): { team: T; quizzers: Q[] }[] {
  return [...teams]
    .sort((a, b) => a.seatOrder - b.seatOrder)
    .map((team) => ({
      team,
      quizzers: quizzers
        .filter((q) => q.teamId === team.id)
        .sort((a, b) => a.seatOrder - b.seatOrder),
    }))
}

/** The grid every scoring function reads, `cells[teamIdx][seatIdx][colIdx]`, in seat order */
export function buildCellGrid(
  teams: Pick<Team, 'id' | 'seatOrder'>[],
  quizzers: Pick<Quizzer, 'id' | 'teamId' | 'seatOrder'>[],
  columns: Column[],
  answerAt: AnswerLookup,
): CellValue[][][] {
  return inSeatOrder(teams, quizzers).map((seated) =>
    seated.quizzers.map((q) => columns.map((col) => answerAt(q.id, col.key))),
  )
}
