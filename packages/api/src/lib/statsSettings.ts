import { and, count, desc, eq, isNotNull, ne, sql } from 'drizzle-orm'
import { DEFAULT_STATS_SETTINGS, PlacementFormula, type StatsSettings } from '@qzr/shared'
import * as schema from '../db/schema'
import type { Db } from './db'
import { content, current, toContent, toCurrent } from './resultsSql'

/** A meet's stats settings, with who saved them last and when; the defaults where none are saved */
export async function statsSettingsOf(
  db: Db,
  meetId: number,
): Promise<{ settings: StatsSettings; changed?: { by: string; at: string } }> {
  const [row] = await db
    .select({
      settings: schema.meetStatsSettings.settings,
      by: schema.meetStatsSettings.savedByName,
      at: schema.meetStatsSettings.savedAt,
    })
    .from(schema.meetStatsSettings)
    .where(eq(schema.meetStatsSettings.meetId, meetId))
    .orderBy(desc(schema.meetStatsSettings.id))
    .limit(1)
  if (!row) return { settings: DEFAULT_STATS_SETTINGS }
  return {
    settings: JSON.parse(row.settings) as StatsSettings,
    changed: { by: row.by, at: row.at.toISOString() },
  }
}

/**
 * A stored quiz's own way of scoring level teams, from the content it shows; a file that doesn't
 * say scores by the rulebook, as the codec reads it
 */
const contentFormula = sql<string>`COALESCE(json_extract(${content.quizFile}, '$.quiz.placementFormula'), ${PlacementFormula.Rules})`

/** Where a stored quiz of the meet shows content whose way of scoring level teams isn't `formula` */
function scoredAnotherWay(meetId: number, formula: PlacementFormula) {
  return and(
    eq(schema.quizResults.meetId, meetId),
    // Content always has a file, a restoring revision pointing at one that does; this keeps it so
    isNotNull(content.quizFile),
    ne(contentFormula, formula),
  )
}

/** How many of a meet's stored quizzes score level teams another way than the meet (FR-023b) */
export async function otherFormulaCount(
  db: Db,
  meetId: number,
  formula: PlacementFormula,
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(schema.quizResults)
    .innerJoin(current, toCurrent)
    .innerJoin(content, toContent)
    .where(scoredAnotherWay(meetId, formula))
  return row?.n ?? 0
}

/** Some of a meet's stored quizzes that score level teams another way, with the content shown */
export function otherFormulaQuizzes(
  db: Db,
  meetId: number,
  formula: PlacementFormula,
  limit: number,
) {
  return db
    .select({
      id: schema.quizResults.id,
      quizFile: content.quizFile,
      contentRevision: content.revision,
    })
    .from(schema.quizResults)
    .innerJoin(current, toCurrent)
    .innerJoin(content, toContent)
    .where(scoredAnotherWay(meetId, formula))
    .limit(limit)
}
