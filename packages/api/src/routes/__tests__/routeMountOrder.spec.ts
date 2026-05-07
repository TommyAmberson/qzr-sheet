import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { Bindings } from '../../bindings'
import type { SessionVariables } from '../../middleware/session'
import { meets } from '../meets'
import { phase } from '../phase'
import { schedule } from '../schedule'
import { churches } from '../churches'
import { join } from '../join'
import { memberships } from '../memberships'
import { mockSession, mockDb, jsonOf, seedMeet } from '../../test-utils'
import { createTestDb } from '../../test-db'
import type { Db } from '../../lib/db'
import { generateCode, hashCode } from '../../lib/codes'
import * as schema from '../../db/schema'
import { MeetRole } from '@qzr/shared'

/**
 * Regression guard for the route mount order in `index.ts`.
 *
 * `phase` and `schedule` register `use('*', requireAuth())` which short-circuits
 * with 401 for anonymous/guest requests on any path under `/api/meets`, even
 * paths those sub-apps don't handle. `churches` (which owns
 * `/api/meets/:meetId/teams`) accepts guests via `requireAuthOrGuest`. If
 * churches is mounted *after* phase/schedule, Hono's middleware short-circuits
 * the request before churches's handler can run. This file mounts the sub-apps
 * in the same order as `index.ts` and verifies a guest can still read teams.
 *
 * If you reorder mounts in `index.ts`, mirror the change here.
 */

const env = {
  ENVIRONMENT: 'test',
  BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
} as unknown as Bindings

function createApp(
  db: Db,
  guest: { meetId: number; role: MeetRole.Viewer | MeetRole.Official } | null,
) {
  const app = new Hono<{ Bindings: Bindings; Variables: SessionVariables }>()
  app.use('*', mockSession(null, guest))
  app.use('*', mockDb(db))
  // Must mirror packages/api/src/index.ts mount order.
  app.route('/api/meets', meets)
  app.route('/api/join', join)
  app.route('/api/my-meets', memberships)
  app.route('/api', churches)
  app.route('/api/meets', phase)
  app.route('/api/meets', schedule)
  return app
}

async function seedMeetWithTeam(db: Db) {
  const meet = await seedMeet(db, 'Guest Meet')
  const [church] = await db
    .insert(schema.churches)
    .values({
      meetId: meet.id,
      name: 'First Church',
      shortName: 'FC',
      coachCodeHash: await hashCode(generateCode()),
    })
    .returning()
  await db
    .insert(schema.teams)
    .values({ meetId: meet.id, churchId: church!.id, division: '1', number: 1 })
  return meet
}

describe('route mount order — guest can read /api/meets/:meetId/teams', () => {
  let db: Db
  beforeEach(async () => {
    db = await createTestDb()
  })

  it('returns 200 with teams when a guest JWT is scoped to that meet', async () => {
    const meet = await seedMeetWithTeam(db)
    const app = createApp(db, { meetId: meet.id, role: MeetRole.Viewer })
    const res = await app.request(`/api/meets/${meet.id}/teams`, {}, env)
    expect(res.status).toBe(200)
    const body = await jsonOf<{ teams: { id: number }[]; meetDivisions: string[] }>(res)
    expect(body.teams).toHaveLength(1)
    expect(Array.isArray(body.meetDivisions)).toBe(true)
  })

  it('returns 403 when the guest JWT is for a different meet', async () => {
    const meet = await seedMeetWithTeam(db)
    const app = createApp(db, { meetId: meet.id + 999, role: MeetRole.Viewer })
    const res = await app.request(`/api/meets/${meet.id}/teams`, {}, env)
    expect(res.status).toBe(403)
  })

  it('returns 401 when no auth at all', async () => {
    const meet = await seedMeetWithTeam(db)
    const app = createApp(db, null)
    const res = await app.request(`/api/meets/${meet.id}/teams`, {}, env)
    expect(res.status).toBe(401)
  })
})
