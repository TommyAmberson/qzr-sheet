import type { Context, MiddlewareHandler } from 'hono'
import type { Bindings } from '../bindings'
import { createAuth } from '../lib/auth'
import { AccountRole } from '@qzr/shared'

export interface SessionUser {
  id: string
  email: string
  name: string
  role: AccountRole
}

export interface SessionVariables {
  user: SessionUser | null
}

/**
 * Read the Better Auth session from request cookies and set `c.var.user`.
 * Always calls next — sets user to null if no valid session.
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
    } else {
      c.set('user', null)
    }

    await next()
  }
}

/** 401 if no authenticated session. Must be used after sessionMiddleware. */
export function requireAuth(): MiddlewareHandler<{
  Bindings: Bindings
  Variables: SessionVariables
}> {
  return async (c, next) => {
    if (!c.get('user')) {
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
