import type { Context, MiddlewareHandler } from 'hono'
import type { Bindings } from '../bindings'
import { createAuth } from '../lib/auth'
import { verifyGuestJwt, type GuestPayload } from '../lib/jwt'
import { AccountRole } from '@qzr/shared'

export interface SessionUser {
  id: string
  email: string
  name: string
  role: AccountRole
}

export interface SessionVariables {
  user: SessionUser | null
  guest: GuestPayload | null
}

/**
 * Read the Better Auth session from request cookies and/or a guest JWT from
 * the `Authorization: Bearer` header. Sets `c.var.user` and `c.var.guest` —
 * both nullable. Always calls next.
 *
 * A signed-in cookie session takes precedence: when both are present, `user`
 * is set and `guest` is left null so downstream code doesn't double-count.
 */
export function sessionMiddleware(): MiddlewareHandler<{
  Bindings: Bindings
  Variables: SessionVariables
}> {
  return async (c, next) => {
    const auth = createAuth(c.env)
    const session = await auth.api.getSession({ headers: c.req.raw.headers })

    if (session?.user) {
      c.set('user', {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
        role: (session.user.role as AccountRole) ?? AccountRole.Normal,
      })
      c.set('guest', null)
    } else {
      c.set('user', null)
      const authHeader = c.req.header('Authorization')
      const token = authHeader?.startsWith('Bearer ')
        ? authHeader.slice('Bearer '.length).trim()
        : null
      const guest = token ? await verifyGuestJwt(token, c.env.BETTER_AUTH_SECRET) : null
      c.set('guest', guest)
    }

    await next()
  }
}

/**
 * 401 if neither a signed-in user nor a guest JWT is present.
 * Must be used after sessionMiddleware.
 */
export function requireAuth(): MiddlewareHandler<{
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
