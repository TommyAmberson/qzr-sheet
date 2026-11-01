import { Hono, type Context } from 'hono'
import type { Bindings } from '../bindings'
import { requireAuth, getUser, type SessionVariables } from '../middleware/session'
import { createAuth, FRESH_SESSION_MS, PROVIDERS } from '../lib/auth'
import { createEmailSender, type ProviderName, type SendEmail } from '../lib/email'

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
