import { lt, sql } from 'drizzle-orm'
import * as schema from '../db/schema'
import type { Db } from './db'

interface Limit {
  max: number
  windowSecs: number
}

/** Reset, verification and provider code-step emails to one address (FR-011);
 *  the email sent at sign-up isn't counted. */
export const PER_ADDRESS: Limit = { max: 3, windowSecs: 60 * 60 }
/** Every email a client's requests send, sign-up included (FR-011). */
export const PER_CLIENT: Limit = { max: 10, windowSecs: 24 * 60 * 60 }

export const addressKey = (email: string) => `address:${email.trim().toLowerCase()}`
export const clientKey = (ip: string) => `client:${ip}`

/**
 * Counts one email against `key` and says whether it is allowed. In one
 * statement, so two requests at the same moment can't both slip under the
 * limit; past the limit nothing is counted.
 */
export async function takeEmailSend(
  db: Db,
  key: string,
  limit: Limit,
  nowSecs = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  const windowStart = nowSecs - (nowSecs % limit.windowSecs)
  const counted = await db
    .insert(schema.emailSends)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [schema.emailSends.key, schema.emailSends.windowStart],
      set: { count: sql`${schema.emailSends.count} + 1` },
      setWhere: sql`${schema.emailSends.count} < ${limit.max}`,
    })
    .returning({ count: schema.emailSends.count })
  return counted.length > 0
}

/** Deletes windows that have ended, the longest limit's included. */
export async function pruneEmailSends(db: Db, nowSecs = Math.floor(Date.now() / 1000)) {
  await db
    .delete(schema.emailSends)
    .where(lt(schema.emailSends.windowStart, nowSecs - PER_CLIENT.windowSecs))
}
