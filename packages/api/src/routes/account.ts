import { Hono, type Context } from 'hono'
import { deleteCookie, getCookie, setCookie, setSignedCookie } from 'hono/cookie'
import type { Bindings } from '../bindings'
import { requireAuth, getUser, type SessionVariables } from '../middleware/session'
import { createAuth, FRESH_SESSION_MS, PROVIDERS } from '../lib/auth'
import { createEmailSender, type ProviderName, type SendEmail } from '../lib/email'
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

export interface AccountVariables extends SessionVariables {
  /** Set by the tests' recording sender; otherwise Resend, from the bindings */
  sendEmail: SendEmail
}

type Env = { Bindings: Bindings; Variables: AccountVariables }

const account = new Hono<Env>()

account.use('*', async (c, next) => {
  if (!c.get('sendEmail')) {
    c.set(
      'sendEmail',
      createEmailSender({
        apiKey: c.env.RESEND_API_KEY,
        waitUntil: (promise) => c.executionCtx.waitUntil(promise),
      }),
    )
  }
  await next()
})

const authFor = (c: Context<Env>) => createAuth(c.env, c.get('db'), c.get('sendEmail'))

// Every bad pending cookie gets the same answer, used, expired or unknown,
// so it reveals nothing about the account it might have named (FR-016).
const invalidPending = (c: Context<Env>) =>
  c.json({ error: 'This sign-in has expired. Start it again.', code: 'PENDING_INVALID' }, 400)

/** The pending cookie as Better Auth names it, scoped to these routes at the
 *  mount the request came in on. */
async function pendingCookie(c: Context<Env>) {
  const authBase = c.req.path.replace(/\/account\/provider(\/.*)?$/, '/auth')
  const cookie = (await authFor(c).$context).createAuthCookie(PENDING_PROVIDER_COOKIE, {
    maxAge: PENDING_TTL_MS / 1000,
    path: pendingCookiePath(authBase),
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
  const ip = c.req.header('cf-connecting-ip') ?? null
  const sent = await sendPendingCode(c.get('db'), c.get('sendEmail'), found.row, ip)
  if (sent === 'gone') return invalidPending(c)
  if (sent === 'proven') return c.json({ step: 'choice' })
  if (sent === 'address' || sent === 'network') {
    const from = sent === 'network' ? 'from this network' : 'for this address'
    return c.json({ error: `Too many requests ${from}. Try again later.` }, 429)
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
  const internal = (await authFor(c).$context).internalAdapter
  const owner = await internal.findAccountByProviderId(pending.accountId, pending.provider)
  if (owner && owner.userId !== pending.userId) return invalidPending(c)
  if (!(await consume(c, found.row))) return invalidPending(c)
  if (!owner) {
    // The unique index refuses a link that raced another for the same
    // provider account; a refusing create hook returns null.
    const linked = await internal
      .linkAccount({
        providerId: pending.provider,
        accountId: pending.accountId,
        userId: pending.userId,
      })
      .then(Boolean, () => false)
    if (!linked) return invalidPending(c)
  }
  await internal.updateUser(pending.userId, { emailVerified: true })
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
  const auth = authFor(c)
  const ctx = await auth.$context
  const target = await ctx.internalAdapter.findUserById(pending.userId)
  // Verified meanwhile (the owner signed in and verified): nothing to take.
  if (!target || target.emailVerified) return invalidPending(c)
  if (!(await consume(c, found.row))) return invalidPending(c)
  if (!(await takeOver(c.get('db'), pending))) return invalidPending(c)
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
  const body = await c.req.json<{ provider?: unknown; password?: unknown }>().catch(() => null)
  const provider = body?.provider as ProviderName
  const password = body?.password
  if (!PROVIDERS.includes(provider) || typeof password !== 'string') {
    return c.json({ error: 'provider and password required' }, 400)
  }
  const auth = authFor(c)
  const current = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!current) return c.json({ error: 'Authentication required' }, 401)
  if (Date.now() - new Date(current.session.createdAt).getTime() > FRESH_SESSION_MS) {
    return c.json({ error: 'Sign in again to disconnect it.', code: 'SESSION_NOT_FRESH' }, 403)
  }
  const ctx = await auth.$context
  const accounts = await ctx.internalAdapter.findAccounts(user.id)
  const credential = accounts.find((a) => a.providerId === 'credential' && a.password)
  if (!credential) {
    return c.json(
      { error: 'Set a password before disconnecting.', code: 'FAILED_TO_UNLINK_LAST_ACCOUNT' },
      400,
    )
  }
  if (!(await ctx.password.verify({ hash: credential.password!, password }))) {
    return c.json({ error: 'Wrong password.', code: 'INVALID_PASSWORD' }, 403)
  }
  for (const a of accounts) {
    if (a.providerId === provider) await ctx.internalAdapter.deleteAccount(a.id)
  }
  for (const session of await ctx.internalAdapter.listSessions(user.id)) {
    if (session.token !== current.session.token) {
      await ctx.internalAdapter.deleteSession(session.token)
    }
  }
  return c.json({ ok: true })
})

export { account }
