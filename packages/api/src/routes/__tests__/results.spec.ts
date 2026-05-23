import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { FILE_VERSION, MeetRole, PlacementFormula, type QuizFile } from '@qzr/shared'
import type { Bindings } from '../../bindings'
import type { SessionVariables } from '../../middleware/session'
import { results } from '../results'
import * as schema from '../../db/schema'
import {
  mockSession,
  mockDb,
  testSuperuser,
  testUser,
  jsonOf,
  jsonRequest,
  seedMeet,
} from '../../test-utils'
import { createTestDb } from '../../test-db'
import type { Db } from '../../lib/db'
import type { GuestPayload } from '../../lib/jwt'
import type { SessionUser } from '../../middleware/session'

const env = { ENVIRONMENT: 'test' } as unknown as Bindings

function createApp(user: SessionUser | null, db: Db, guest: GuestPayload | null = null) {
  const app = new Hono<{ Bindings: Bindings; Variables: SessionVariables & { db: Db } }>()
  app.use('*', mockSession(user, guest))
  app.use('*', mockDb(db))
  app.route('/api/meets', results)
  return app
}

/** Minimal QuizFile that passes schema validation. */
function makeQuizFile(overrides: Partial<QuizFile['quiz']> = {}): QuizFile {
  return {
    version: FILE_VERSION,
    quiz: {
      division: '1',
      quizNumber: '1',
      overtime: false,
      placementFormula: PlacementFormula.Rules,
      questionTypes: [],
      ...overrides,
    },
    teams: [],
    answers: [],
    noJumps: [],
  }
}

async function seedRoom(db: Db, meetId: number, name = 'Room A') {
  const [room] = await db
    .insert(schema.meetRooms)
    .values({ meetId, name, sortOrder: 0 })
    .returning()
  return room!
}

async function seedSlot(db: Db, meetId: number) {
  const [slot] = await db
    .insert(schema.meetSlots)
    .values({
      meetId,
      startAt: new Date('2026-01-01T20:00:00Z'),
      durationMinutes: 25,
      kind: 'quiz',
      sortOrder: 0,
    })
    .returning()
  return slot!
}

async function seedScheduledQuiz(db: Db, meetId: number, opts: { roomId?: number } = {}) {
  const room = opts.roomId
    ? { id: opts.roomId }
    : await seedRoom(db, meetId, `Room ${Math.random().toString(36).slice(2, 6)}`)
  const slot = await seedSlot(db, meetId)
  const [quiz] = await db
    .insert(schema.scheduledQuizzes)
    .values({
      meetId,
      slotId: slot.id,
      roomId: room.id,
      division: '1',
      phase: 'prelim',
      label: 'D1-Q1',
    })
    .returning()
  return quiz!
}

async function seedOfficial(db: Db, meetId: number, accountId: string, roomId: number) {
  await db.insert(schema.officialMemberships).values({ accountId, meetId, roomId })
}

async function seedAdmin(db: Db, meetId: number, accountId: string) {
  await db.insert(schema.adminMemberships).values({ accountId, meetId })
}

const postJson = (body: Record<string, unknown>) => jsonRequest('POST', body)

describe('POST /api/meets/:id/results — auth matrix', () => {
  let db: Db
  beforeEach(async () => {
    db = await createTestDb()
  })

  it('401 when no signed-in user and no guest', async () => {
    const meet = await seedMeet(db)
    const app = createApp(null, db, null)
    const res = await app.request(
      `/api/meets/${meet.id}/results`,
      postJson({ quizFile: makeQuizFile() }),
      env,
    )
    expect(res.status).toBe(401)
  })

  it('404 when meet does not exist', async () => {
    const app = createApp(testSuperuser, db)
    const res = await app.request(
      `/api/meets/999/results`,
      postJson({ quizFile: makeQuizFile() }),
      env,
    )
    expect(res.status).toBe(404)
  })

  it('403 when signed-in non-member', async () => {
    const meet = await seedMeet(db)
    const app = createApp(testUser, db)
    const res = await app.request(
      `/api/meets/${meet.id}/results`,
      postJson({ quizFile: makeQuizFile() }),
      env,
    )
    expect(res.status).toBe(403)
  })

  it('403 when guest carries role=Viewer', async () => {
    const meet = await seedMeet(db)
    const app = createApp(null, db, { meetId: meet.id, role: MeetRole.Viewer })
    const res = await app.request(
      `/api/meets/${meet.id}/results`,
      postJson({ quizFile: makeQuizFile() }),
      env,
    )
    expect(res.status).toBe(403)
  })

  it('403 when guest official is scoped to a different meet', async () => {
    const meet = await seedMeet(db)
    const app = createApp(null, db, { meetId: meet.id + 1, role: MeetRole.Official })
    const res = await app.request(
      `/api/meets/${meet.id}/results`,
      postJson({ quizFile: makeQuizFile() }),
      env,
    )
    expect(res.status).toBe(403)
  })

  it('201 for superuser', async () => {
    const meet = await seedMeet(db)
    const app = createApp(testSuperuser, db)
    const res = await app.request(
      `/api/meets/${meet.id}/results`,
      postJson({ quizFile: makeQuizFile() }),
      env,
    )
    expect(res.status).toBe(201)
  })

  it('201 for meet admin', async () => {
    const meet = await seedMeet(db)
    await seedAdmin(db, meet.id, testUser.id)
    const app = createApp(testUser, db)
    const res = await app.request(
      `/api/meets/${meet.id}/results`,
      postJson({ quizFile: makeQuizFile() }),
      env,
    )
    expect(res.status).toBe(201)
  })

  it('201 for meet official', async () => {
    const meet = await seedMeet(db)
    const room = await seedRoom(db, meet.id)
    await seedOfficial(db, meet.id, testUser.id, room.id)
    const app = createApp(testUser, db)
    const res = await app.request(
      `/api/meets/${meet.id}/results`,
      postJson({ quizFile: makeQuizFile() }),
      env,
    )
    expect(res.status).toBe(201)
  })

  it('201 for guest with role=Official', async () => {
    const meet = await seedMeet(db)
    const app = createApp(null, db, {
      meetId: meet.id,
      role: MeetRole.Official,
      label: 'Room 1 official',
    })
    const res = await app.request(
      `/api/meets/${meet.id}/results`,
      postJson({ quizFile: makeQuizFile() }),
      env,
    )
    expect(res.status).toBe(201)
  })
})

describe('POST /api/meets/:id/results — payload validation', () => {
  let db: Db
  beforeEach(async () => {
    db = await createTestDb()
  })

  it('400 when QuizFile is missing required fields', async () => {
    const meet = await seedMeet(db)
    const app = createApp(testSuperuser, db)
    const res = await app.request(
      `/api/meets/${meet.id}/results`,
      postJson({ quizFile: { version: 2 } }),
      env,
    )
    expect(res.status).toBe(400)
    const body = await jsonOf<{ error: string }>(res)
    expect(body.error).toContain('Invalid QuizFile')
  })

  it('400 when quizId belongs to a different meet', async () => {
    const meetA = await seedMeet(db, 'Meet A')
    const meetB = await seedMeet(db, 'Meet B')
    const quiz = await seedScheduledQuiz(db, meetB.id)
    const app = createApp(testSuperuser, db)
    const res = await app.request(
      `/api/meets/${meetA.id}/results`,
      postJson({ quizFile: makeQuizFile(), quizId: quiz.id }),
      env,
    )
    expect(res.status).toBe(400)
    expect((await jsonOf<{ error: string }>(res)).error).toContain('Quiz')
  })

  it('400 when roomId belongs to a different meet', async () => {
    const meetA = await seedMeet(db, 'Meet A')
    const meetB = await seedMeet(db, 'Meet B')
    const room = await seedRoom(db, meetB.id, 'Other Room')
    const app = createApp(testSuperuser, db)
    const res = await app.request(
      `/api/meets/${meetA.id}/results`,
      postJson({ quizFile: makeQuizFile(), roomId: room.id }),
      env,
    )
    expect(res.status).toBe(400)
    expect((await jsonOf<{ error: string }>(res)).error).toContain('Room')
  })
})

describe('POST /api/meets/:id/results — happy path + storage', () => {
  let db: Db
  beforeEach(async () => {
    db = await createTestDb()
  })

  it('stores scheduled submission with quizId, roomId, division, round', async () => {
    const meet = await seedMeet(db)
    const room = await seedRoom(db, meet.id, 'Sanctuary')
    const quiz = await seedScheduledQuiz(db, meet.id, { roomId: room.id })
    const app = createApp(testSuperuser, db)
    const qf = makeQuizFile({ division: '2', quizNumber: 'A' })
    const res = await app.request(
      `/api/meets/${meet.id}/results`,
      postJson({ quizFile: qf, quizId: quiz.id, roomId: room.id }),
      env,
    )
    expect(res.status).toBe(201)
    const body = await jsonOf<{ id: number; submittedAt: string }>(res)
    expect(body.id).toBeGreaterThan(0)

    const [row] = await db.select().from(schema.quizResults)
    expect(row?.meetId).toBe(meet.id)
    expect(row?.quizId).toBe(quiz.id)
    expect(row?.roomId).toBe(room.id)
    expect(row?.division).toBe('2')
    expect(row?.round).toBe('A')
    expect(row?.submittedByAccountId).toBe(testSuperuser.id)
    expect(row?.submittedByGuestLabel).toBeNull()
    expect(JSON.parse(row!.quizFile)).toEqual(qf)
  })

  it('stores orphan submission with null quizId + roomId', async () => {
    const meet = await seedMeet(db)
    const app = createApp(testSuperuser, db)
    const res = await app.request(
      `/api/meets/${meet.id}/results`,
      postJson({ quizFile: makeQuizFile() }),
      env,
    )
    expect(res.status).toBe(201)
    const [row] = await db.select().from(schema.quizResults)
    expect(row?.quizId).toBeNull()
    expect(row?.roomId).toBeNull()
  })

  it('records guest label and null accountId on guest submission', async () => {
    const meet = await seedMeet(db)
    const app = createApp(null, db, {
      meetId: meet.id,
      role: MeetRole.Official,
      label: 'Room 3 official',
    })
    await app.request(`/api/meets/${meet.id}/results`, postJson({ quizFile: makeQuizFile() }), env)
    const [row] = await db.select().from(schema.quizResults)
    expect(row?.submittedByAccountId).toBeNull()
    expect(row?.submittedByGuestLabel).toBe('Room 3 official')
  })

  it('409 when submitting the same scheduled quiz twice', async () => {
    const meet = await seedMeet(db)
    const quiz = await seedScheduledQuiz(db, meet.id)
    const app = createApp(testSuperuser, db)
    const first = await app.request(
      `/api/meets/${meet.id}/results`,
      postJson({ quizFile: makeQuizFile(), quizId: quiz.id }),
      env,
    )
    expect(first.status).toBe(201)
    const second = await app.request(
      `/api/meets/${meet.id}/results`,
      postJson({ quizFile: makeQuizFile(), quizId: quiz.id }),
      env,
    )
    expect(second.status).toBe(409)
  })

  it('allows two orphaned submissions for the same meet (NULL ≠ NULL)', async () => {
    const meet = await seedMeet(db)
    const app = createApp(testSuperuser, db)
    const a = await app.request(
      `/api/meets/${meet.id}/results`,
      postJson({ quizFile: makeQuizFile() }),
      env,
    )
    const b = await app.request(
      `/api/meets/${meet.id}/results`,
      postJson({ quizFile: makeQuizFile() }),
      env,
    )
    expect(a.status).toBe(201)
    expect(b.status).toBe(201)
    const rows = await db.select().from(schema.quizResults)
    expect(rows).toHaveLength(2)
  })
})

describe('GET /api/meets/:id/results — admin list', () => {
  let db: Db
  beforeEach(async () => {
    db = await createTestDb()
  })

  it('401 when no signed-in user', async () => {
    const meet = await seedMeet(db)
    const app = createApp(null, db, { meetId: meet.id, role: MeetRole.Official })
    const res = await app.request(`/api/meets/${meet.id}/results`, {}, env)
    expect(res.status).toBe(401)
  })

  it('403 when signed-in non-admin', async () => {
    const meet = await seedMeet(db)
    const room = await seedRoom(db, meet.id)
    await seedOfficial(db, meet.id, testUser.id, room.id)
    const app = createApp(testUser, db)
    const res = await app.request(`/api/meets/${meet.id}/results`, {}, env)
    expect(res.status).toBe(403)
  })

  it('returns rows newest first with openDisputes count', async () => {
    const meet = await seedMeet(db)
    const app = createApp(testSuperuser, db)
    const earlyRes = await app.request(
      `/api/meets/${meet.id}/results`,
      postJson({ quizFile: makeQuizFile({ quizNumber: 'early' }) }),
      env,
    )
    const earlyId = (await jsonOf<{ id: number }>(earlyRes)).id
    // Force the second row's submittedAt strictly later than the first.
    await db
      .update(schema.quizResults)
      .set({ submittedAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.quizResults.id, earlyId))
    await app.request(
      `/api/meets/${meet.id}/results`,
      postJson({ quizFile: makeQuizFile({ quizNumber: 'late' }) }),
      env,
    )
    // Flag the earlier result twice; resolve one. openDisputes should be 1.
    await db.insert(schema.quizDisputes).values([
      {
        resultId: earlyId,
        createdAt: new Date(),
        reason: 'looks wrong',
        resolved: false,
      },
      {
        resultId: earlyId,
        createdAt: new Date(),
        reason: 'already addressed',
        resolved: true,
      },
    ])

    const res = await app.request(`/api/meets/${meet.id}/results`, {}, env)
    expect(res.status).toBe(200)
    const body = await jsonOf<{
      results: { id: number; round: string; openDisputes: number }[]
    }>(res)
    expect(body.results.map((r) => r.round)).toEqual(['late', 'early'])
    expect(body.results.find((r) => r.id === earlyId)?.openDisputes).toBe(1)
  })
})

describe('GET /api/meets/:id/results/:resultId — admin detail', () => {
  let db: Db
  beforeEach(async () => {
    db = await createTestDb()
  })

  it('403 for non-admin', async () => {
    const meet = await seedMeet(db)
    const app = createApp(testUser, db)
    const res = await app.request(`/api/meets/${meet.id}/results/1`, {}, env)
    expect(res.status).toBe(403)
  })

  it('404 when the result is in a different meet', async () => {
    const meetA = await seedMeet(db, 'Meet A')
    const meetB = await seedMeet(db, 'Meet B')
    const app = createApp(testSuperuser, db)
    const post = await app.request(
      `/api/meets/${meetA.id}/results`,
      postJson({ quizFile: makeQuizFile() }),
      env,
    )
    const { id } = await jsonOf<{ id: number }>(post)
    const res = await app.request(`/api/meets/${meetB.id}/results/${id}`, {}, env)
    expect(res.status).toBe(404)
  })

  it('returns the row with the QuizFile parsed', async () => {
    const meet = await seedMeet(db)
    const app = createApp(testSuperuser, db)
    const qf = makeQuizFile({ division: '3' })
    const post = await app.request(`/api/meets/${meet.id}/results`, postJson({ quizFile: qf }), env)
    const { id } = await jsonOf<{ id: number }>(post)
    const res = await app.request(`/api/meets/${meet.id}/results/${id}`, {}, env)
    expect(res.status).toBe(200)
    const body = await jsonOf<{ result: { id: number; division: string; quizFile: QuizFile } }>(res)
    expect(body.result.id).toBe(id)
    expect(body.result.division).toBe('3')
    expect(body.result.quizFile).toEqual(qf)
  })
})
