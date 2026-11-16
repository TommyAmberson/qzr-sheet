import { desc, eq } from 'drizzle-orm'
import * as schema from '../db/schema'
import type { Db } from './db'

/** The meet's newest published schedule version, the one readers see */
export async function newestVersion(db: Db, meetId: number) {
  const [row] = await db
    .select()
    .from(schema.meetScheduleVersions)
    .where(eq(schema.meetScheduleVersions.meetId, meetId))
    .orderBy(desc(schema.meetScheduleVersions.version))
    .limit(1)
  return row ?? null
}
