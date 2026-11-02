import { lt, sql } from 'drizzle-orm'
import * as schema from '../db/schema'
import type { EmailLimit } from '@qzr/shared'
import type { Db } from './db'

interface Limit {
  max: number
  windowSecs: number
}

/** Reset, verification and provider code-step emails to one address (FR-011);
 *  the email sent at sign-up isn't counted. */
export const PER_ADDRESS: Limit = { max: 3, windowSecs: 60 * 60 }
/** Reset, verification and code-step emails a client's requests send
 *  (FR-011). */
export const PER_CLIENT: Limit = { max: 30, windowSecs: 24 * 60 * 60 }
/** Sign-up codes, counted apart so a venue full of sign-ups on one network
 *  doesn't use up the allowance its people need for resets (FR-011). */
export const PER_CLIENT_SIGNUP: Limit = { max: 30, windowSecs: 24 * 60 * 60 }

export const addressKey = (email: string) => `address:${email.trim().toLowerCase()}`
export const clientKey = (ip: string) => `client:${ip}`
export const signUpKey = (ip: string) => `signup:${ip}`

/** Password checks outside Better Auth's routes, per account (FR-030):
 *  disconnecting asks for the password. */
export const PER_ACCOUNT_PASSWORD: Limit = { max: 5, windowSecs: 15 * 60 }
export const passwordKey = (userId: string) => `password:${userId}`

/** Code-step code entry per client (FR-030): each pending row allows 3 tries,
 *  and this bounds the rows a client can work through. */
export const PER_CLIENT_CODE_ENTRY: Limit = { max: 10, windowSecs: 15 * 60 }
export const codeEntryKey = (ip: string) => `code:${ip}`

/**
 * Counts one request against `key` and says whether it is allowed. In one
 * statement, so two requests at the same moment can't both slip under the
 * limit; past the limit nothing is counted.
 */
export async function takeAllowance(
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

/**
 * Counts one email to `email`, requested from `ip`, against both limits
 * (FR-011), and says which refused it, if either. The client first: a client
 * over its own limit must not go on using up an address's allowance, which
 * would lock the address's owner out of resets.
 */
export async function takeEmailLimits(
  db: Db,
  email: string,
  ip: string | null,
): Promise<EmailLimit | null> {
  if (ip && !(await takeAllowance(db, clientKey(ip), PER_CLIENT))) return 'network'
  if (!(await takeAllowance(db, addressKey(email), PER_ADDRESS))) return 'address'
  return null
}
