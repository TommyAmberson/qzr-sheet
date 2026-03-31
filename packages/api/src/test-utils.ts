import type { MiddlewareHandler } from 'hono'
import type { Bindings } from './bindings'
import type { SessionUser, SessionVariables } from './middleware/session'
import type { Db } from './lib/db'
import { AccountRole } from '@qzr/shared'

/**
 * Test-only middleware that injects a user directly into context,
 * bypassing Better Auth session lookup.
 */
export function mockSession(
  user: SessionUser | null,
): MiddlewareHandler<{ Bindings: Bindings; Variables: SessionVariables }> {
  return async (c, next) => {
    c.set('user', user)
    await next()
  }
}

/**
 * Test-only middleware that injects a drizzle DB instance into context.
 */
export function mockDb(
  db: Db,
): MiddlewareHandler<{ Bindings: Bindings; Variables: SessionVariables & { db: Db } }> {
  return async (c, next) => {
    c.set('db', db)
    await next()
  }
}

export const testAdmin: SessionUser = {
  id: 'admin-001',
  email: 'admin@test.com',
  name: 'Test Admin',
  role: AccountRole.Superuser,
}

export const testUser: SessionUser = {
  id: 'user-001',
  email: 'user@test.com',
  name: 'Test User',
  role: AccountRole.Normal,
}

/** Typed wrapper around Response.json() for use in tests. */
export async function jsonOf<T>(res: Response): Promise<T> {
  return res.json() as Promise<T>
}
