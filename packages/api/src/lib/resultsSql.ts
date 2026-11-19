import { and, eq, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
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

/** A stored quiz's current revision, and the revision whose content it shows */
export const current = alias(schema.quizResultRevisions, 'current')
export const content = alias(schema.quizResultRevisions, 'content')

/** Joins a stored quiz to its current revision, as `current` */
export const toCurrent = and(
  eq(current.resultId, schema.quizResults.id),
  eq(current.revision, latestRevision),
)

/**
 * Joins a stored quiz to the revision whose content is current, as `content`, after `toCurrent`:
 * a restoring revision shows the content of the revision it restores
 */
export const toContent = and(
  eq(content.resultId, schema.quizResults.id),
  eq(content.revision, sql`COALESCE(${current.restoredFrom}, ${current.revision})`),
)
