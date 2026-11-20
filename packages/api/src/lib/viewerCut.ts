import type { Context } from 'hono'
import { and, eq, inArray } from 'drizzle-orm'
import type { QuizResult, ResultsLevel } from '@qzr/shared'
import * as schema from '../db/schema'
import type { SessionVariables } from '../middleware/session'
import type { Db } from './db'
import { officialRoomsOf } from './permissions'

/**
 * A quiz's result as a viewer, coach or official has it (FR-018 to FR-021 of meet stats), rebuilt
 * from the fields they may have so a field added for admins stays with them: its teams' places,
 * scores only at the scores level, and for an official's own quiz what is wrong with it (FR-020a).
 * The one cut every route giving a reader quizzes goes through.
 */
export function cutQuizResult(quiz: QuizResult, level: ResultsLevel, own: boolean): QuizResult {
  return {
    name: quiz.name,
    status: quiz.status,
    teams: quiz.teams.map(({ name, place, tiedWith, score }) => ({
      name,
      place,
      tiedWith,
      score: level === 'scores' ? score : undefined,
    })),
    ...(quiz.id !== undefined && own
      ? {
          id: quiz.id,
          problems: quiz.problems,
          withdrawnOrder: quiz.withdrawnOrder,
          incompleteTypes: quiz.incompleteTypes,
        }
      : {}),
  }
}

/** The stored quizzes saved from the caller's rooms, for an official; none for anyone else */
export async function ownQuizzes<E extends { Variables: SessionVariables }>(
  c: Context<E>,
  db: Db,
  meetId: number,
): Promise<Set<number>> {
  const rooms = await officialRoomsOf(c, db, meetId)
  if (rooms.length === 0) return new Set()
  const rows = await db
    .selectDistinct({ id: schema.quizResultRevisions.resultId })
    .from(schema.quizResultRevisions)
    .innerJoin(schema.quizResults, eq(schema.quizResults.id, schema.quizResultRevisions.resultId))
    .where(
      and(
        eq(schema.quizResults.meetId, meetId),
        inArray(schema.quizResultRevisions.savedByRoomId, rooms),
      ),
    )
  return new Set(rows.map((row) => row.id))
}
