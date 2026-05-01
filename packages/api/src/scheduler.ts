import { and, lte, isNotNull, eq } from 'drizzle-orm'
import * as schema from './db/schema'
import type { Db } from './lib/db'

/**
 * Auto-advance meet phases when their scheduled timestamp has passed.
 * Rules: `registration → build` at `registrationClosesAt`,
 *        `build → live` at `meetStartsAt`. Single-step per tick — running
 * the build→live promotion FIRST means meets just promoted out of
 * registration this tick stay at build until the next tick.
 */
export async function autoAdvancePhases(
  db: Db,
  now: Date = new Date(),
): Promise<{ promotedToBuild: number; promotedToLive: number }> {
  const promotedToLive = await db
    .update(schema.quizMeets)
    .set({ phase: 'live' })
    .where(
      and(
        eq(schema.quizMeets.phase, 'build'),
        isNotNull(schema.quizMeets.meetStartsAt),
        lte(schema.quizMeets.meetStartsAt, now),
      ),
    )
    .returning({ id: schema.quizMeets.id })

  const promotedToBuild = await db
    .update(schema.quizMeets)
    .set({ phase: 'build' })
    .where(
      and(
        eq(schema.quizMeets.phase, 'registration'),
        isNotNull(schema.quizMeets.registrationClosesAt),
        lte(schema.quizMeets.registrationClosesAt, now),
      ),
    )
    .returning({ id: schema.quizMeets.id })

  return { promotedToBuild: promotedToBuild.length, promotedToLive: promotedToLive.length }
}
