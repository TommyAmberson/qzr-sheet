import { eq, and, lte, isNotNull, or } from 'drizzle-orm'
import * as schema from './db/schema'
import type { Db } from './lib/db'

/**
 * Auto-advance meet phases when their scheduled timestamp has passed.
 *
 * Rules:
 * - registration → build  when `registrationClosesAt <= now`
 * - build         → live   when `meetStartsAt <= now`
 *
 * Idempotent: re-running on the same DB has no effect after meets are caught up.
 * Returns counts so the caller (or tests) can assert behavior.
 */
export async function autoAdvancePhases(
  db: Db,
  now: Date = new Date(),
): Promise<{ promotedToBuild: number; promotedToLive: number }> {
  // Snapshot both candidate lists BEFORE any updates so we don't cascade
  // a meet from registration → build → live in a single tick. Single-step
  // per call matches the manual transition rules.
  const toBuild = await db
    .select({ id: schema.quizMeets.id })
    .from(schema.quizMeets)
    .where(
      and(
        eq(schema.quizMeets.phase, 'registration'),
        isNotNull(schema.quizMeets.registrationClosesAt),
        lte(schema.quizMeets.registrationClosesAt, now),
      ),
    )

  const toLive = await db
    .select({ id: schema.quizMeets.id })
    .from(schema.quizMeets)
    .where(
      and(
        eq(schema.quizMeets.phase, 'build'),
        isNotNull(schema.quizMeets.meetStartsAt),
        lte(schema.quizMeets.meetStartsAt, now),
      ),
    )

  if (toBuild.length > 0) {
    await db
      .update(schema.quizMeets)
      .set({ phase: 'build' })
      .where(or(...toBuild.map((m) => eq(schema.quizMeets.id, m.id))))
  }

  if (toLive.length > 0) {
    await db
      .update(schema.quizMeets)
      .set({ phase: 'live' })
      .where(or(...toLive.map((m) => eq(schema.quizMeets.id, m.id))))
  }

  return { promotedToBuild: toBuild.length, promotedToLive: toLive.length }
}
