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

export const testSuperuser: SessionUser = {
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

/** Build a JSON-bodied request init for use with `app.request(...)`. */
export function jsonRequest(method: string, body: Record<string, unknown>) {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

/**
 * Insert a minimal `quiz_meets` row for tests. Use for any new spec; the older
 * specs (join, memberships, churches) have their own copies that include
 * different return shapes and aren't worth migrating.
 */
import * as schema from './db/schema'
import type { MeetPhase } from '@qzr/shared'
export async function seedMeet(
  db: Db,
  name = 'Test Meet',
  opts: { phase?: MeetPhase; registrationClosesAt?: Date | null; meetStartsAt?: Date | null } = {},
) {
  const [meet] = await db
    .insert(schema.quizMeets)
    .values({
      name,
      dateFrom: '2026-01-01',
      adminCodeHash: 'x',
      viewerCode: name.toLowerCase().replace(/\s+/g, '-'),
      createdAt: new Date(),
      phase: opts.phase ?? 'registration',
      registrationClosesAt: opts.registrationClosesAt ?? null,
      meetStartsAt: opts.meetStartsAt ?? null,
    })
    .returning()
  return meet!
}
