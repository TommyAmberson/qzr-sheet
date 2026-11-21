import type { Context, MiddlewareHandler } from 'hono'
import type { Bindings } from '../bindings'
import { createAuth, type Auth } from '../lib/auth'
import type { SendEmail } from '../lib/email'
import { currentGuest, type GuestPayload } from '../lib/jwt'
import { createDb, type Db } from '../lib/db'
import { AccountRole, effectiveAccountRole } from '@qzr/shared'

export interface SessionUser {
  id: string
  email: string
  name: string
  role: AccountRole
}

export interface SessionVariables {
  user: SessionUser | null
  guest: GuestPayload | null
  /** Set by whichever runs first: a test's `mockDb`, the app's own, or this middleware */
  db: Db
  /** Set by the app (Resend) or a test (a recording sender) */
  sendEmail: SendEmail
  /** Better Auth for this request, set by this middleware */
  auth: Auth
  /** The signed-in session, set by this middleware */
  session: { token: string; createdAt: Date } | null
}

/** The cookies holding Better Auth's cached copy of the session, chunked or not, prefixed or not */
const CACHED_SESSION = /\.session_data(?:\.\d+)?$/

/**
 * The request's headers without the session's cached copy (`session.cookieCache` in lib/auth.ts),
 * so Better Auth reads the session from the database: a session ended elsewhere, by a password
 * reset or "That's not me", stops at once rather than when the copy lapses
 */
export function withoutCachedSession(headers: Headers): Headers {
  const cookie = headers.get('cookie')
  if (!cookie) return headers
  const kept = cookie
    .split(';')
    .map((part) => part.trim())
    .filter((part) => !CACHED_SESSION.test(part.split('=')[0]!))
  const without = new Headers(headers)
  if (kept.length > 0) without.set('cookie', kept.join('; '))
  else without.delete('cookie')
  return without
}

/**
 * Whether a request may trust the session's cached copy: one that only reads. Anything that
 * changes something checks the database, so a session ended elsewhere can at most read, for the
 * minute its copy lasts.
 */
function readsOnly(method: string) {
  return method === 'GET' || method === 'HEAD'
}

/**
 * Read the Better Auth session from request cookies and/or a guest JWT from
 * the `Authorization: Bearer` header. Sets `c.var.user` and `c.var.guest` —
 * both nullable; a guest token that isn't current leaves `guest` null. Always
 * calls next.
 *
 * A signed-in cookie session takes precedence: when both are present, `user`
 * is set and `guest` is left null so downstream code doesn't double-count.
 */
export function sessionMiddleware(): MiddlewareHandler<{
  Bindings: Bindings
  Variables: SessionVariables
}> {
  return async (c, next) => {
    // Shared with the routes, which reuse a DB already set
    if (!c.get('db')) c.set('db', createDb(c.env.DB) as unknown as Db)
    // One instance per request, which the routes reuse. Reading the session
    // sends no email; a router without a sender doesn't send any.
    const auth = createAuth(c.env, c.get('db'), c.get('sendEmail') ?? (() => {}))
    c.set('auth', auth)
    const headers = readsOnly(c.req.method)
      ? c.req.raw.headers
      : withoutCachedSession(c.req.raw.headers)
    const session = await auth.api.getSession({ headers })
    c.set(
      'session',
      session ? { token: session.session.token, createdAt: session.session.createdAt } : null,
    )

    if (session?.user) {
      c.set('user', {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
        role: effectiveAccountRole(session.user),
      })
      c.set('guest', null)
      await next()
      return
    }

    c.set('user', null)
    const authHeader = c.req.header('Authorization')
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length).trim()
      : null
    if (!token) {
      c.set('guest', null)
      await next()
      return
    }
    c.set('guest', await currentGuest(c.get('db'), token, c.env.BETTER_AUTH_SECRET))
    await next()
  }
}

/**
 * A path about one meet by its id, as the apps read it when deciding to renew a guest session
 * (`MEET_PATH` in packages/ui/src/guestSession.ts, which also reads a viewer code there; the apps
 * name a meet by code only to read it), allowing for the API's /qzr mount
 */
const MEET_PATH = /^(?:\/qzr)?\/api\/meets\/(\d+)(?:\/|$)/

/**
 * 401 if no signed-in user. Routes that need a real account use this. A guest whose accepted token
 * is for the meet the path names gets 403 instead: the apps renew a guest session after a 401 to a
 * request about its meet, which can't help here. Anywhere else, such as the account's own meets, a
 * guest keeps the 401, which the apps (released ones too) read as not signed in.
 */
export function requireAuth(): MiddlewareHandler<{
  Bindings: Bindings
  Variables: SessionVariables
}> {
  return async (c, next) => {
    if (c.get('user')) return next()
    const guest = c.get('guest')
    const pathMeetId = guest ? MEET_PATH.exec(c.req.path)?.[1] : undefined
    if (guest && pathMeetId !== undefined && guest.meetId === Number(pathMeetId)) {
      return c.json({ error: 'Sign in to an account for this' }, 403)
    }
    return c.json({ error: 'Authentication required' }, 401)
  }
}

/**
 * 401 if neither a signed-in user nor a guest JWT is present. Read routes
 * that admit anonymous guest viewers (with a valid guest JWT) use this.
 */
export function requireAuthOrGuest(): MiddlewareHandler<{
  Bindings: Bindings
  Variables: SessionVariables
}> {
  return async (c, next) => {
    if (!c.get('user') && !c.get('guest')) {
      return c.json({ error: 'Authentication required' }, 401)
    }
    await next()
  }
}

/** 403 if authenticated user is not a superuser. Must be used after requireAuth. */
export function requireSuperuser(): MiddlewareHandler<{
  Bindings: Bindings
  Variables: SessionVariables
}> {
  return async (c, next) => {
    const user = c.get('user')
    if (!user || user.role !== AccountRole.Superuser) {
      return c.json({ error: 'Superuser access required' }, 403)
    }
    await next()
  }
}

/** Helper to extract the authenticated user (non-null). Use after requireAuth. */
export function getUser<E extends { Variables: SessionVariables }>(c: Context<E>): SessionUser {
  return c.get('user')!
}

/** Helper to read the guest JWT payload (nullable). Set by sessionMiddleware. */
export function getGuest<E extends { Variables: SessionVariables }>(
  c: Context<E>,
): GuestPayload | null {
  return c.get('guest')
}
