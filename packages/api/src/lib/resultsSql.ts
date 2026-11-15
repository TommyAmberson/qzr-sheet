import { sql } from 'drizzle-orm'
import * as schema from '../db/schema'

/**
 * The enclosing query's stored quiz, for a subquery. Always qualified: drizzle leaves a column
 * unqualified in a one-table select, where inside a subquery it would name the subquery's own.
 */
const storedQuizId = sql`${schema.quizResults}.${sql.identifier('id')}`

/** The newest revision of the stored quiz in the enclosing query, which is its current one */
export const latestRevision = sql<number>`(
  SELECT MAX(latest.revision) FROM quiz_result_revisions latest
  WHERE latest.result_id = ${storedQuizId}
)`

/** Whether the stored quiz in the enclosing query counts: its newest counting record says so */
export const isCounted = sql`COALESCE((
  SELECT newest.counted FROM quiz_result_count_changes newest
  WHERE newest.result_id = ${storedQuizId}
  ORDER BY newest.id DESC LIMIT 1
), 0)`.mapWith(Boolean)
