import { Hono, type Context } from 'hono'
import { csrf } from 'hono/csrf'
import { deleteCookie, getCookie, setCookie, setSignedCookie } from 'hono/cookie'
import { getIp } from 'better-auth/api'
import { isSocialProvider, tooManyRequestsMessage } from '@qzr/shared'
import type { Bindings } from '../bindings'
import { requireAuth, getUser, type SessionVariables } from '../middleware/session'
import { isFreshSession, refusedByUniqueIndex } from '../lib/auth'
import {
  PER_ACCOUNT_PASSWORD,
  PER_CLIENT_CODE_ENTRY,
  codeEntryKey,
  passwordKey,
  takeAllowance,
} from '../lib/emailLimits'
import {
  PENDING_PROVIDER_COOKIE,
  PENDING_TTL_MS,
  confirmPendingCode,
  consumePending,
  pendingCookiePath,
  readPending,
  sendPendingCode,
  takeOver,
  type PendingRow,
} from '../lib/pendingProvider'

type Env = { Bindings: Bindings; Variables: SessionVariables }

const account = new Hono<Env>()

// Better Auth's context for this request, from the session middleware's instance.
const authContext = (c: Context<Env>) => c.get('auth').$context

// A form post from another origin, even one on the same site, carries the
// cookies these routes act on, and the routes read JSON whatever the content
// type: refuse it unless the origin is one Better Auth trusts (FR-031). JSON
// from elsewhere already fails CORS. verse-vault shares this origin, so this
// can't tell its pages from ours.
account.use(
  '*',
  csrf({ origin: async (origin, c) => (await authContext(c)).isTrustedOrigin(origin) }),
)

// Every bad pending cookie gets the same answer, used, expired or unknown,
// so it reveals nothing about the account it might have named (FR-016).
const invalidPending = (c: Context<Env>) =>
  c.json({ error: 'This sign-in has expired. Start it again.', code: 'PENDING_INVALID' }, 400)

/** The pending cookie as Better Auth names it, scoped to these routes at the
 *  mount the request came in on. */
async function pendingCookie(c: Context<Env>) {
  const cookie = (await authContext(c)).createAuthCookie(PENDING_PROVIDER_COOKIE, {
    maxAge: PENDING_TTL_MS / 1000,
    path: pendingCookiePath(c.req.path),
  })
  return { name: cookie.name, options: cookie.attributes as Parameters<typeof setCookie>[3] }
}

/** The live pending row this browser's cookie names, with its token. */
async function pendingFor(c: Context<Env>) {
  const { name } = await pendingCookie(c)
  const token = getCookie(c, name)
  const row = token ? await readPending(c.get('db'), token) : null
  return row && token ? { token, row } : null
}

/** The row's steps each get 10 minutes, and so does the cookie. */
async function renewCookie(c: Context<Env>, token: string) {
  const { name, options } = await pendingCookie(c)
  setCookie(c, name, token, options)
}

/**
 * GET /api/account/provider
 *
 * Which step a pending GitHub or Google sign-in is on: `code` until the inbox
 * is proven, then `choice`. The address is the one just signed in to the
 * provider with, so it tells the person nothing new.
 */
account.get('/provider', async (c) => {
  const found = await pendingFor(c)
  if (!found) return invalidPending(c)
  const { pending } = found.row
  return c.json({
    step: pending.proven ? 'choice' : 'code',
    provider: pending.provider,
    email: pending.email,
  })
})

/** POST /api/account/provider/confirm `{ code }`: the code step (FR-015). */
account.post('/provider/confirm', async (c) => {
  const body = await c.req.json<{ code?: unknown }>().catch(() => null)
  const found = await pendingFor(c)
  if (!found) return invalidPending(c)
  if (typeof body?.code !== 'string') return c.json({ error: 'code required' }, 400)
  // No code went out (an email limit stopped it): nothing to try, and
  // nothing spent.
  if (!found.row.pending.proven && !found.row.pending.codeHash) {
    return c.json({ error: 'No code was sent. Send a new one.', code: 'NO_CODE_SENT' }, 400)
  }
  // Each row allows 3 tries, but a new sign-in brings a new row, so code
  // entry is limited per client too (FR-030).
  const ip = getIp(c.req.raw, (await authContext(c)).options)
  if (ip && !(await takeAllowance(c.get('db'), codeEntryKey(ip), PER_CLIENT_CODE_ENTRY))) {
    return c.json({ error: tooManyRequestsMessage('network') }, 429)
  }
  const outcome = await confirmPendingCode(c.get('db'), found.row, body.code.trim())
  if (outcome === 'gone') return invalidPending(c)
  if (outcome === 'locked') {
    const { name, options } = await pendingCookie(c)
    deleteCookie(c, name, options)
    return c.json({ error: 'Too many wrong tries.', code: 'TOO_MANY_ATTEMPTS' }, 403)
  }
  if (outcome === 'wrong') return c.json({ error: 'Invalid code', code: 'INVALID_OTP' }, 400)
  await renewCookie(c, found.token)
  return c.json({ step: 'choice' })
})

/** POST /api/account/provider/resend: a new code-step code, under the email
 *  limits (FR-011). */
account.post('/provider/resend', async (c) => {
  const found = await pendingFor(c)
  if (!found) return invalidPending(c)
  const ip = getIp(c.req.raw, (await authContext(c)).options)
  const sent = await sendPendingCode(c.get('db'), c.get('sendEmail'), found.row, ip)
  if (sent === 'gone') return invalidPending(c)
  if (sent === 'proven') return c.json({ step: 'choice' })
  if (sent === 'address' || sent === 'network') {
    return c.json({ error: tooManyRequestsMessage(sent) }, 429)
  }
  await renewCookie(c, found.token)
  return c.json({ step: 'code' })
})

/** A proven pending row, the choice's proof that a provider sign-in for the
 *  address just completed and the inbox is the person's. */
async function provenFor(c: Context<Env>) {
  const found = await pendingFor(c)
  return found?.row.pending.proven ? found : null
}

/** Uses the row up and drops the cookie. False when another request used it
 *  first. */
async function consume(c: Context<Env>, row: PendingRow): Promise<boolean> {
  if (!(await consumePending(c.get('db'), row))) return false
  const { name, options } = await pendingCookie(c)
  deleteCookie(c, name, options)
  return true
}

/**
 * POST /api/account/provider/claim
 *
 * "That's me": the person has just signed in to the account with its
 * password, so the provider connects and the address is verified.
 */
account.post('/provider/claim', requireAuth(), async (c) => {
  const found = await provenFor(c)
  if (!found) return invalidPending(c)
  const { pending } = found.row
  if (pending.userId !== getUser(c).id) {
    return c.json({ error: 'Signed in to a different account.' }, 403)
  }
  const internal = (await authContext(c)).internalAdapter
  const connectedHere = async () =>
    (await internal.findAccountByProviderId(pending.accountId, pending.provider))?.userId ===
    pending.userId
  // Connected before the row is used up, so a refusal leaves it for a retry.
  // The unique index refuses a link that raced another for the same provider
  // account, which is fine when that one landed here too.
  if (!(await connectedHere())) {
    const linked = await internal
      .linkAccount({
        providerId: pending.provider,
        accountId: pending.accountId,
        userId: pending.userId,
      })
      .catch(refusedByUniqueIndex)
    if (!linked && !(await connectedHere())) return invalidPending(c)
  }
  await internal.updateUser(pending.userId, { emailVerified: true })
  await consume(c, found.row)
  return c.json({ ok: true })
})

/**
 * POST /api/account/provider/takeover
 *
 * "That's not me": the person proved the inbox, so the account becomes
 * theirs, with the provider as its only way in, and they are signed in.
 */
account.post('/provider/takeover', async (c) => {
  const found = await provenFor(c)
  if (!found) return invalidPending(c)
  const { pending } = found.row
  const ctx = await authContext(c)
  const target = await ctx.internalAdapter.findUserById(pending.userId)
  // Verified meanwhile (the owner signed in and verified): nothing to take.
  if (!target || target.emailVerified) return invalidPending(c)
  // Taken over before the row is used up, so a failure leaves it for a retry.
  if (!(await takeOver(c.get('db'), pending))) return invalidPending(c)
  await consume(c, found.row)
  const session = await ctx.internalAdapter.createSession(pending.userId)
  const cookie = ctx.authCookies.sessionToken
  await setSignedCookie(c, cookie.name, session.token, ctx.secret, {
    ...(cookie.attributes as Parameters<typeof setSignedCookie>[4]),
    maxAge: ctx.sessionConfig.expiresIn,
  })
  return c.json({ ok: true })
})

/**
 * POST /api/account/disconnect `{ provider, password }`
 *
 * Disconnects GitHub or Google (FR-018): every account of that provider goes,
 * and every other session ends, so whoever got in through it is out (OWASP).
 * Done here rather than by Better Auth's unlink route, which removes one
 * account and leaves sessions alone. Needs the password, a sign-in within the
 * last day, and a password to keep signing in with.
 */
account.post('/disconnect', requireAuth(), async (c) => {
  const user = getUser(c)
  const current = c.get('session')!
  const body = await c.req.json<{ provider?: unknown; password?: unknown }>().catch(() => null)
  const provider = body?.provider
  const password = body?.password
  if (!isSocialProvider(provider) || typeof password !== 'string') {
    return c.json({ error: 'provider and password required' }, 400)
  }
  const ctx = await authContext(c)
  if (!isFreshSession(current.createdAt, ctx.sessionConfig.freshAge)) {
    return c.json({ error: 'Sign in again to disconnect it.', code: 'SESSION_NOT_FRESH' }, 403)
  }
  const accounts = await ctx.internalAdapter.findAccounts(user.id)
  // Nothing to disconnect (a stale settings page): don't spend a password try
  // or end other sessions for it.
  if (!accounts.some((a) => a.providerId === provider)) {
    return c.json({ error: 'Not connected.', code: 'NOT_CONNECTED' }, 400)
  }
  const credential = accounts.find((a) => a.providerId === 'credential' && a.password)
  if (!credential) {
    return c.json(
      { error: 'Set a password before disconnecting.', code: 'FAILED_TO_UNLINK_LAST_ACCOUNT' },
      400,
    )
  }
  // Better Auth's rate limiter covers only its own routes, so guesses here
  // count in the email-limit table (FR-030).
  if (!(await takeAllowance(c.get('db'), passwordKey(user.id), PER_ACCOUNT_PASSWORD))) {
    return c.json({ error: 'Too many tries. Try again later.' }, 429)
  }
  if (!(await ctx.password.verify({ hash: credential.password!, password }))) {
    return c.json({ error: 'Wrong password.', code: 'INVALID_PASSWORD' }, 403)
  }
  // One at a time through the adapter, so each sends its notice.
  for (const a of accounts) {
    if (a.providerId === provider) await ctx.internalAdapter.deleteAccount(a.id)
  }
  const others = (await ctx.internalAdapter.listSessions(user.id))
    .map((session) => session.token)
    .filter((token) => token !== current.token)
  if (others.length > 0) await ctx.internalAdapter.deleteSessions(others)
  return c.json({ ok: true })
})

export { account }
