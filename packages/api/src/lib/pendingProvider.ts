import { and, eq, gt, ne } from 'drizzle-orm'
import { AccountRole, type SocialProvider } from '@qzr/shared'
import { constantTimeEqual, generateRandomString } from 'better-auth/crypto'
import * as schema from '../db/schema'
import { asOne, isUniqueViolation, type Db } from './db'
import { generateCode, hashCode } from './codes'
import { providerCodeEmail, type SendEmail } from './email'
import { takeEmailLimits } from './emailLimits'

/** Verification rows for a refused GitHub or Google sign-in onto an
 *  unverified password account: the code step, then "That's me" or "That's
 *  not me" (research D6). */
export const PENDING_PROVIDER_PREFIX = 'pending-provider:'

/** The cookie holding a pending row's token. Set on the callback's response
 *  and sent only to the account routes for it, so a copied page address
 *  carries nothing that would let the inbox's owner finish someone else's
 *  sign-in. */
export const PENDING_PROVIDER_COOKIE = 'pending_provider'

/** A pending row, its code, and each step after proof, last 10 minutes. */
export const PENDING_TTL_MS = 10 * 60 * 1000

const MAX_CODE_TRIES = 3

/** What a pending row holds: the account the sign-in matched, the provider
 *  identity to connect to it, and whether the inbox is proven yet, by Google
 *  hosting the address or by an emailed code. The code lives here rather than
 *  in the email-code plugin's rows, so it works for this step only. */
export interface PendingProvider {
  userId: string
  provider: SocialProvider
  accountId: string
  email: string
  proven: boolean
  codeHash?: string
  tries?: number
}

export interface PendingRow {
  identifier: string
  pending: PendingProvider
  /** The stored value, for `replacePending`. */
  value: string
}

/** Where the account routes for a pending sign-in live below the API's
 *  mount, as index.ts mounts them. */
const PENDING_ROUTES = '/api/account/provider'

/** The pending cookie's path, from any path under the API's mount the
 *  request came in on (`/qzr/api/auth`, `/api/account/provider/confirm`):
 *  `/qzr/api/account/provider` or `/api/account/provider`. */
export const pendingCookiePath = (pathUnderApi: string) =>
  `${pathUnderApi.slice(0, pathUnderApi.indexOf('/api/'))}${PENDING_ROUTES}`

/** Creates a pending row; returns its token and the row as stored. */
export async function createPending(
  db: Db,
  pending: PendingProvider,
): Promise<{ token: string; row: PendingRow }> {
  const token = generateCode(32)
  const identifier = `${PENDING_PROVIDER_PREFIX}${token}`
  const value = JSON.stringify(pending)
  const now = new Date()
  await db.insert(schema.verification).values({
    id: crypto.randomUUID(),
    identifier,
    value,
    expiresAt: new Date(now.getTime() + PENDING_TTL_MS),
    createdAt: now,
    updatedAt: now,
  })
  return { token, row: { identifier, pending, value } }
}

/** The live pending row a token names, if any. */
export async function readPending(db: Db, token: string): Promise<PendingRow | null> {
  const identifier = `${PENDING_PROVIDER_PREFIX}${token}`
  const [row] = await db
    .select()
    .from(schema.verification)
    .where(
      and(
        eq(schema.verification.identifier, identifier),
        gt(schema.verification.expiresAt, new Date()),
      ),
    )
  if (!row) return null
  return { identifier, pending: JSON.parse(row.value) as PendingProvider, value: row.value }
}

/** Replaces a row's value if nobody changed it since `row` was read; `renew`
 *  gives it another 10 minutes, for a new code or the choice, never for a
 *  wrong guess, so a code lasts the 10 minutes its email says. Requests may run in different isolates, so
 *  this compare-and-set is what keeps two of them from both spending a try
 *  or a code. False when another request got there first. */
export async function replacePending(
  db: Db,
  row: PendingRow,
  next: PendingProvider,
  renew = true,
): Promise<boolean> {
  const updated = await db
    .update(schema.verification)
    .set({
      value: JSON.stringify(next),
      ...(renew ? { expiresAt: new Date(Date.now() + PENDING_TTL_MS) } : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.verification.identifier, row.identifier),
        eq(schema.verification.value, row.value),
      ),
    )
    .returning({ id: schema.verification.id })
  return updated.length > 0
}

/** Uses a row up. False when another request used it first. */
export async function consumePending(db: Db, row: PendingRow): Promise<boolean> {
  const deleted = await db
    .delete(schema.verification)
    .where(
      and(
        eq(schema.verification.identifier, row.identifier),
        eq(schema.verification.value, row.value),
      ),
    )
    .returning({ id: schema.verification.id })
  return deleted.length > 0
}

export type SendOutcome = 'sent' | 'address' | 'network' | 'gone' | 'proven'

/** Emails a new code-step code for the row, replacing any older one, under
 *  both email limits (FR-011). `address` or `network` when that limit
 *  stopped the send. */
export async function sendPendingCode(
  db: Db,
  sendEmail: SendEmail,
  row: PendingRow,
  ip: string | null,
): Promise<SendOutcome> {
  if (row.pending.proven) return 'proven'
  const refused = await takeEmailLimits(db, row.pending.email, ip)
  if (refused) return refused
  const code = generateRandomString(6, '0-9')
  const next = { ...row.pending, codeHash: await hashCode(code), tries: 0 }
  if (!(await replacePending(db, row, next))) return 'gone'
  sendEmail(
    providerCodeEmail(row.pending.email, row.pending.provider, code, PENDING_TTL_MS / 60000),
  )
  return 'sent'
}

export type ConfirmOutcome = 'proven' | 'wrong' | 'locked' | 'gone'

/** Checks a code-step code. A right one proves the row and spends the code;
 *  the third wrong one ends the row. */
export async function confirmPendingCode(
  db: Db,
  row: PendingRow,
  code: string,
): Promise<ConfirmOutcome> {
  if (row.pending.proven) return 'proven'
  const { codeHash, tries = 0, ...rest } = row.pending
  if (codeHash && constantTimeEqual(await hashCode(code), codeHash)) {
    return (await replacePending(db, row, { ...rest, proven: true })) ? 'proven' : 'gone'
  }
  if (tries + 1 >= MAX_CODE_TRIES) {
    return (await consumePending(db, row)) ? 'locked' : 'gone'
  }
  const counted = await replacePending(db, row, { ...row.pending, tries: tries + 1 }, false)
  return counted ? 'wrong' : 'gone'
}

/**
 * "That's not me" (FR-015, research D7): the provider identity becomes the
 * account's only way in: connects it, removes the password, every other
 * GitHub or Google account the registrant linked, every session, and the
 * meet memberships and roles their codes earned, and returns the role to
 * normal (FR-027), in one batch. Direct writes send no notices: the person did this.
 * False when the connection was refused.
 */
export async function takeOver(db: Db, pending: PendingProvider): Promise<boolean> {
  const now = new Date()
  const linkId = crypto.randomUUID()
  const userId = pending.userId
  try {
    // All at once, the connection included, so a failure leaves the account
    // as it was rather than half taken over. A connection the unique index
    // refuses fails the whole batch.
    await asOne(db, [
      db.insert(schema.account).values({
        id: linkId,
        userId,
        providerId: pending.provider,
        accountId: pending.accountId,
        createdAt: now,
        updatedAt: now,
      }),
      db
        .delete(schema.account)
        .where(and(eq(schema.account.userId, userId), ne(schema.account.id, linkId))),
      db.delete(schema.session).where(eq(schema.session.userId, userId)),
      db.delete(schema.adminMemberships).where(eq(schema.adminMemberships.accountId, userId)),
      db.delete(schema.coachMemberships).where(eq(schema.coachMemberships.accountId, userId)),
      db.delete(schema.officialMemberships).where(eq(schema.officialMemberships.accountId, userId)),
      db.delete(schema.viewerMemberships).where(eq(schema.viewerMemberships.accountId, userId)),
      db
        .update(schema.user)
        .set({ emailVerified: true, role: AccountRole.Normal, updatedAt: now })
        .where(eq(schema.user.id, userId)),
    ])
  } catch (e) {
    if (isUniqueViolation(e)) return false
    throw e
  }
  return true
}
