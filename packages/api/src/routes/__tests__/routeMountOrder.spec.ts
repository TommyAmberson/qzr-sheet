import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import type { Bindings } from '../../bindings'
import type { SessionVariables } from '../../middleware/session'
import { meets } from '../meets'
import { phase } from '../phase'
import { schedule } from '../schedule'
import { churches } from '../churches'
import { join } from '../join'
import { memberships } from '../memberships'
import { results } from '../results'
import { mockSession, mockDb, jsonOf, jsonRequest, seedMeet } from '../../test-utils'
import { createTestDb } from '../../test-db'
import type { Db } from '../../lib/db'
import { generateCode, hashCode } from '../../lib/codes'
import * as schema from '../../db/schema'
import { MeetRole, PlacementFormula } from '@qzr/shared'
import { codeTagFor, signGuestJwt, type GuestPayload } from '../../lib/jwt'
import { sessionMiddleware } from '../../middleware/session'
import { eq } from 'drizzle-orm'

// No account session in these tests; guests come from a Bearer token through the real middleware
vi.mock('../../lib/auth', () => ({
  createAuth: () => ({ api: { getSession: async () => null } }),
}))

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

/** `guest` is injected as the session middleware would set it, or `'bearer'` runs the real one */
function mountRoutes(db: Db, guest: GuestPayload | null | 'bearer') {
  const app = new Hono<{ Bindings: Bindings; Variables: SessionVariables }>()
  app.use('*', mockDb(db))
  app.use('*', guest === 'bearer' ? sessionMiddleware() : mockSession(null, guest))
  // Must mirror packages/api/src/index.ts mount order.
  app.route('/api/meets', meets)
  app.route('/api/join', join)
  app.route('/api/my-meets', memberships)
  app.route('/api', churches)
  app.route('/api/meets', results)
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
    const app = mountRoutes(db, { meetId: meet.id, role: MeetRole.Viewer })
    const res = await app.request(`/api/meets/${meet.id}/teams`, {}, env)
    expect(res.status).toBe(200)
    const body = await jsonOf<{ teams: { id: number }[]; meetDivisions: string[] }>(res)
    expect(body.teams).toHaveLength(1)
    expect(Array.isArray(body.meetDivisions)).toBe(true)
  })

  it('returns 403 when the guest JWT is for a different meet', async () => {
    const meet = await seedMeetWithTeam(db)
    const app = mountRoutes(db, { meetId: meet.id + 999, role: MeetRole.Viewer })
    const res = await app.request(`/api/meets/${meet.id}/teams`, {}, env)
    expect(res.status).toBe(403)
  })

  it('returns 401 when no auth at all', async () => {
    const meet = await seedMeetWithTeam(db)
    const app = mountRoutes(db, null)
    const res = await app.request(`/api/meets/${meet.id}/teams`, {}, env)
    expect(res.status).toBe(401)
  })
})

describe('route mount order — a guest official can submit results', () => {
  it('reaches the results router ahead of the account-only routers', async () => {
    const db = await createTestDb()
    const meet = await seedMeet(db, 'Results Meet')
    const [room] = await db
      .insert(schema.meetRooms)
      .values({ meetId: meet.id, name: 'Room 1', codeHash: 'hash-1' })
      .returning()
    const app = mountRoutes(db, {
      meetId: meet.id,
      role: MeetRole.Official,
      roomId: room!.id,
      codeTag: await codeTagFor('room', 'hash-1', env.BETTER_AUTH_SECRET),
    })
    const quizFile = {
      version: 2,
      quiz: {
        division: '1',
        quizNumber: '1',
        overtime: false,
        placementFormula: PlacementFormula.Rules,
        questionTypes: [],
      },
      teams: [],
      answers: [],
      noJumps: [],
    }
    const res = await app.request(
      `/api/meets/${meet.id}/results`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quizFile }),
      },
      env,
    )
    expect(res.status).toBe(201)
  })
})

describe('a guest token is checked by the session middleware', () => {
  let db: Db
  let meet: Awaited<ReturnType<typeof seedMeetWithTeam>>
  let roomId: number
  beforeEach(async () => {
    db = await createTestDb()
    meet = await seedMeetWithTeam(db)
    const [room] = await db
      .insert(schema.meetRooms)
      .values({ meetId: meet.id, name: 'Room 1', codeHash: 'hash-1' })
      .returning()
    roomId = room!.id
  })

  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` })
  const officialToken = async () =>
    signGuestJwt(
      {
        meetId: meet.id,
        role: MeetRole.Official,
        roomId,
        codeTag: await codeTagFor('room', 'hash-1', env.BETTER_AUTH_SECRET),
      },
      env.BETTER_AUTH_SECRET,
    )
  const rotateRoomCode = () =>
    db
      .update(schema.meetRooms)
      .set({ codeHash: 'hash-rotated' })
      .where(eq(schema.meetRooms.id, roomId))

  it('admits a current token', async () => {
    const token = await signGuestJwt(
      {
        meetId: meet.id,
        role: MeetRole.Viewer,
        codeTag: await codeTagFor('viewer', meet.viewerCode, env.BETTER_AUTH_SECRET),
      },
      env.BETTER_AUTH_SECRET,
    )
    const res = await mountRoutes(db, 'bearer').request(
      `/api/meets/${meet.id}/teams`,
      { headers: bearer(token) },
      env,
    )
    expect(res.status).toBe(200)
  })

  it('treats a token for a rotated room code as absent, for reads', async () => {
    const token = await officialToken()
    await rotateRoomCode()
    const res = await mountRoutes(db, 'bearer').request(
      `/api/meets/${meet.id}/teams`,
      { headers: bearer(token) },
      env,
    )
    expect(res.status).toBe(401)
  })

  it('treats a token for a rotated room code as absent, for sends', async () => {
    const token = await officialToken()
    await rotateRoomCode()
    const request = jsonRequest('POST', { quizFile: {} })
    const res = await mountRoutes(db, 'bearer').request(
      `/api/meets/${meet.id}/results`,
      { ...request, headers: { ...request.headers, ...bearer(token) } },
      env,
    )
    expect(res.status).toBe(401)
  })
})
