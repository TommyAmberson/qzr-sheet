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

async function seedScheduledQuiz(db: Db, meetId: number) {
  const room = await seedRoom(db, meetId, `Room ${Math.random().toString(36).slice(2, 6)}`)
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

describe('POST /api/meets/:id/saves — auth matrix', () => {
  let db: Db
  beforeEach(async () => {
    db = await createTestDb()
  })

  it('401 with neither user nor guest', async () => {
    const meet = await seedMeet(db)
    const app = createApp(null, db, null)
    const res = await app.request(
      `/api/meets/${meet.id}/saves`,
      postJson({ quizFile: makeQuizFile(), kind: 'autosave' }),
      env,
    )
    expect(res.status).toBe(401)
  })

  it('404 when meet does not exist', async () => {
    const app = createApp(testSuperuser, db)
    const res = await app.request(
      `/api/meets/999/saves`,
      postJson({ quizFile: makeQuizFile(), kind: 'autosave' }),
      env,
    )
    expect(res.status).toBe(404)
  })

  it('403 for signed-in non-member', async () => {
    const meet = await seedMeet(db)
    const app = createApp(testUser, db)
    const res = await app.request(
      `/api/meets/${meet.id}/saves`,
      postJson({ quizFile: makeQuizFile(), kind: 'autosave' }),
      env,
    )
    expect(res.status).toBe(403)
  })

  it('403 for guest with role=Viewer', async () => {
    const meet = await seedMeet(db)
    const app = createApp(null, db, { meetId: meet.id, role: MeetRole.Viewer })
    const res = await app.request(
      `/api/meets/${meet.id}/saves`,
      postJson({ quizFile: makeQuizFile(), kind: 'autosave' }),
      env,
    )
    expect(res.status).toBe(403)
  })

  it('201 for superuser', async () => {
    const meet = await seedMeet(db)
    const app = createApp(testSuperuser, db)
    const res = await app.request(
      `/api/meets/${meet.id}/saves`,
      postJson({ quizFile: makeQuizFile(), kind: 'autosave' }),
      env,
    )
    expect(res.status).toBe(201)
  })

  it('201 for meet admin', async () => {
    const meet = await seedMeet(db)
    await seedAdmin(db, meet.id, testUser.id)
    const app = createApp(testUser, db)
    const res = await app.request(
      `/api/meets/${meet.id}/saves`,
      postJson({ quizFile: makeQuizFile(), kind: 'autosave' }),
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
      `/api/meets/${meet.id}/saves`,
      postJson({ quizFile: makeQuizFile(), kind: 'autosave' }),
      env,
    )
    expect(res.status).toBe(201)
  })

  it('201 for guest with role=Official scoped to meet', async () => {
    const meet = await seedMeet(db)
    const app = createApp(null, db, {
      meetId: meet.id,
      role: MeetRole.Official,
      label: 'Room 2',
    })
    const res = await app.request(
      `/api/meets/${meet.id}/saves`,
      postJson({ quizFile: makeQuizFile(), kind: 'autosave' }),
      env,
    )
    expect(res.status).toBe(201)
  })
})

describe('POST /api/meets/:id/saves — payload validation', () => {
  let db: Db
  beforeEach(async () => {
    db = await createTestDb()
  })

  it('400 when kind is missing or invalid', async () => {
    const meet = await seedMeet(db)
    const app = createApp(testSuperuser, db)
    const res = await app.request(
      `/api/meets/${meet.id}/saves`,
      postJson({ quizFile: makeQuizFile(), kind: 'mystery' }),
      env,
    )
    expect(res.status).toBe(400)
  })

  it('400 when QuizFile is malformed', async () => {
    const meet = await seedMeet(db)
    const app = createApp(testSuperuser, db)
    const res = await app.request(
      `/api/meets/${meet.id}/saves`,
      postJson({ quizFile: { version: 2 }, kind: 'autosave' }),
      env,
    )
    expect(res.status).toBe(400)
  })

  it('400 when scheduledQuizId is from a different meet', async () => {
    const meetA = await seedMeet(db, 'A')
    const meetB = await seedMeet(db, 'B')
    const quiz = await seedScheduledQuiz(db, meetB.id)
    const app = createApp(testSuperuser, db)
    const res = await app.request(
      `/api/meets/${meetA.id}/saves`,
      postJson({ quizFile: makeQuizFile(), kind: 'autosave', scheduledQuizId: quiz.id }),
      env,
    )
    expect(res.status).toBe(400)
  })
})

describe('POST /api/meets/:id/saves — storage shape', () => {
  let db: Db
  beforeEach(async () => {
    db = await createTestDb()
  })

  it('stores division + round from QuizFile, kind, label, scheduledQuizId, submitter', async () => {
    const meet = await seedMeet(db)
    const quiz = await seedScheduledQuiz(db, meet.id)
    const app = createApp(testSuperuser, db)
    const qf = makeQuizFile({ division: '2', quizNumber: 'B' })

    await app.request(
      `/api/meets/${meet.id}/saves`,
      postJson({
        quizFile: qf,
        kind: 'checkpoint',
        scheduledQuizId: quiz.id,
        roomId: quiz.roomId,
        label: 'after Q15',
      }),
      env,
    )

    const [row] = await db.select().from(schema.quizSaves)
    expect(row?.meetId).toBe(meet.id)
    expect(row?.scheduledQuizId).toBe(quiz.id)
    expect(row?.roomId).toBe(quiz.roomId)
    expect(row?.division).toBe('2')
    expect(row?.round).toBe('B')
    expect(row?.kind).toBe('checkpoint')
    expect(row?.label).toBe('after Q15')
    expect(row?.savedByAccountId).toBe(testSuperuser.id)
    expect(row?.savedByGuestLabel).toBeNull()
    expect(JSON.parse(row!.quizFile)).toEqual(qf)
  })

  it('records guest label when posted via guest JWT', async () => {
    const meet = await seedMeet(db)
    const app = createApp(null, db, {
      meetId: meet.id,
      role: MeetRole.Official,
      label: 'Room 3 official',
    })
    await app.request(
      `/api/meets/${meet.id}/saves`,
      postJson({ quizFile: makeQuizFile(), kind: 'autosave' }),
      env,
    )
    const [row] = await db.select().from(schema.quizSaves)
    expect(row?.savedByAccountId).toBeNull()
    expect(row?.savedByGuestLabel).toBe('Room 3 official')
  })

  it('appends rows; two saves for the same quiz coexist', async () => {
    const meet = await seedMeet(db)
    const quiz = await seedScheduledQuiz(db, meet.id)
    const app = createApp(testSuperuser, db)
    for (let i = 0; i < 3; i++) {
      const res = await app.request(
        `/api/meets/${meet.id}/saves`,
        postJson({ quizFile: makeQuizFile(), kind: 'autosave', scheduledQuizId: quiz.id }),
        env,
      )
      expect(res.status).toBe(201)
    }
    const rows = await db.select().from(schema.quizSaves)
    expect(rows).toHaveLength(3)
  })

  it('blank label is normalised to null', async () => {
    const meet = await seedMeet(db)
    const app = createApp(testSuperuser, db)
    await app.request(
      `/api/meets/${meet.id}/saves`,
      postJson({ quizFile: makeQuizFile(), kind: 'autosave', label: '   ' }),
      env,
    )
    const [row] = await db.select().from(schema.quizSaves)
    expect(row?.label).toBeNull()
  })
})

describe('GET /api/meets/:id/saves — admin list', () => {
  let db: Db
  beforeEach(async () => {
    db = await createTestDb()
  })

  it('401 when no signed-in user', async () => {
    const meet = await seedMeet(db)
    const app = createApp(null, db, { meetId: meet.id, role: MeetRole.Official })
    const res = await app.request(`/api/meets/${meet.id}/saves`, {}, env)
    expect(res.status).toBe(401)
  })

  it('403 for signed-in non-admin', async () => {
    const meet = await seedMeet(db)
    const room = await seedRoom(db, meet.id)
    await seedOfficial(db, meet.id, testUser.id, room.id)
    const app = createApp(testUser, db)
    const res = await app.request(`/api/meets/${meet.id}/saves`, {}, env)
    expect(res.status).toBe(403)
  })

  it('returns newest first; supports scheduledQuizId + division + round filters', async () => {
    const meet = await seedMeet(db)
    const quizA = await seedScheduledQuiz(db, meet.id)
    const quizB = await seedScheduledQuiz(db, meet.id)
    const app = createApp(testSuperuser, db)

    async function post(scheduledQuizId: number, quizNumber: string) {
      const r = await app.request(
        `/api/meets/${meet.id}/saves`,
        postJson({
          quizFile: makeQuizFile({ quizNumber }),
          kind: 'autosave',
          scheduledQuizId,
        }),
        env,
      )
      return (await jsonOf<{ id: number }>(r)).id
    }
    const a1 = await post(quizA.id, '1')
    const a2 = await post(quizA.id, '1')
    await post(quizB.id, '2')

    // Force a1 to look older than a2 for the ordering check.
    await db
      .update(schema.quizSaves)
      .set({ savedAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.quizSaves.id, a1))

    const all = await app.request(`/api/meets/${meet.id}/saves`, {}, env)
    expect(all.status).toBe(200)
    const allBody = await jsonOf<{ saves: { id: number }[] }>(all)
    expect(allBody.saves).toHaveLength(3)
    // a2 saved most recently, then quizB save, then a1.
    expect(allBody.saves[allBody.saves.length - 1]!.id).toBe(a1)

    const filtered = await app.request(
      `/api/meets/${meet.id}/saves?scheduledQuizId=${quizA.id}`,
      {},
      env,
    )
    const filteredBody = await jsonOf<{ saves: { id: number }[] }>(filtered)
    expect(filteredBody.saves).toHaveLength(2)

    const byRound = await app.request(`/api/meets/${meet.id}/saves?round=2`, {}, env)
    const byRoundBody = await jsonOf<{ saves: { id: number }[] }>(byRound)
    expect(byRoundBody.saves).toHaveLength(1)
  })

  it('omits the quizFile blob from list rows', async () => {
    const meet = await seedMeet(db)
    const app = createApp(testSuperuser, db)
    await app.request(
      `/api/meets/${meet.id}/saves`,
      postJson({ quizFile: makeQuizFile(), kind: 'autosave' }),
      env,
    )
    const res = await app.request(`/api/meets/${meet.id}/saves`, {}, env)
    const body = await jsonOf<{ saves: Record<string, unknown>[] }>(res)
    expect(body.saves[0]).not.toHaveProperty('quizFile')
  })
})

describe('GET /api/meets/:id/saves/:saveId — admin detail', () => {
  let db: Db
  beforeEach(async () => {
    db = await createTestDb()
  })

  it('403 for non-admin', async () => {
    const meet = await seedMeet(db)
    const app = createApp(testUser, db)
    const res = await app.request(`/api/meets/${meet.id}/saves/1`, {}, env)
    expect(res.status).toBe(403)
  })

  it('404 when the save belongs to a different meet', async () => {
    const meetA = await seedMeet(db, 'A')
    const meetB = await seedMeet(db, 'B')
    const app = createApp(testSuperuser, db)
    const post = await app.request(
      `/api/meets/${meetA.id}/saves`,
      postJson({ quizFile: makeQuizFile(), kind: 'autosave' }),
      env,
    )
    const { id } = await jsonOf<{ id: number }>(post)
    const res = await app.request(`/api/meets/${meetB.id}/saves/${id}`, {}, env)
    expect(res.status).toBe(404)
  })

  it('returns the row with the QuizFile parsed', async () => {
    const meet = await seedMeet(db)
    const app = createApp(testSuperuser, db)
    const qf = makeQuizFile({ division: '3' })
    const post = await app.request(
      `/api/meets/${meet.id}/saves`,
      postJson({ quizFile: qf, kind: 'checkpoint', label: 'mid-quiz' }),
      env,
    )
    const { id } = await jsonOf<{ id: number }>(post)
    const res = await app.request(`/api/meets/${meet.id}/saves/${id}`, {}, env)
    expect(res.status).toBe(200)
    const body = await jsonOf<{
      save: { id: number; division: string; label: string; quizFile: QuizFile }
    }>(res)
    expect(body.save.id).toBe(id)
    expect(body.save.division).toBe('3')
    expect(body.save.label).toBe('mid-quiz')
    expect(body.save.quizFile).toEqual(qf)
  })
})

describe('POST /api/meets/:id/results — submit', () => {
  let db: Db
  beforeEach(async () => {
    db = await createTestDb()
  })

  it('401 with neither user nor guest', async () => {
    const meet = await seedMeet(db)
    const app = createApp(null, db, null)
    const res = await app.request(
      `/api/meets/${meet.id}/results`,
      postJson({ quizFile: makeQuizFile() }),
      env,
    )
    expect(res.status).toBe(401)
  })

  it('403 for guest with role=Viewer', async () => {
    const meet = await seedMeet(db)
    const app = createApp(null, db, { meetId: meet.id, role: MeetRole.Viewer })
    const res = await app.request(
      `/api/meets/${meet.id}/results`,
      postJson({ quizFile: makeQuizFile() }),
      env,
    )
    expect(res.status).toBe(403)
  })

  it('400 when QuizFile is invalid', async () => {
    const meet = await seedMeet(db)
    const app = createApp(testSuperuser, db)
    const res = await app.request(
      `/api/meets/${meet.id}/results`,
      postJson({ quizFile: { version: 2 } }),
      env,
    )
    expect(res.status).toBe(400)
  })

  it('400 when quizId belongs to a different meet', async () => {
    const meetA = await seedMeet(db, 'A')
    const meetB = await seedMeet(db, 'B')
    const quiz = await seedScheduledQuiz(db, meetB.id)
    const app = createApp(testSuperuser, db)
    const res = await app.request(
      `/api/meets/${meetA.id}/results`,
      postJson({ quizFile: makeQuizFile(), quizId: quiz.id }),
      env,
    )
    expect(res.status).toBe(400)
  })

  it('201 for guest official, stores label and parses division/round from QuizFile', async () => {
    const meet = await seedMeet(db)
    const app = createApp(null, db, {
      meetId: meet.id,
      role: MeetRole.Official,
      label: 'Room 1',
    })
    const qf = makeQuizFile({ division: '2', quizNumber: 'A' })
    const res = await app.request(`/api/meets/${meet.id}/results`, postJson({ quizFile: qf }), env)
    expect(res.status).toBe(201)
    const [row] = await db.select().from(schema.quizResults)
    expect(row?.division).toBe('2')
    expect(row?.round).toBe('A')
    expect(row?.submittedByAccountId).toBeNull()
    expect(row?.submittedByGuestLabel).toBe('Room 1')
    expect(JSON.parse(row!.quizFile)).toEqual(qf)
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

  it('allows two orphan submissions in the same meet (NULL ≠ NULL)', async () => {
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

  it('saves can still be appended after submit (history keeps growing)', async () => {
    const meet = await seedMeet(db)
    const quiz = await seedScheduledQuiz(db, meet.id)
    const app = createApp(testSuperuser, db)
    await app.request(
      `/api/meets/${meet.id}/results`,
      postJson({ quizFile: makeQuizFile(), quizId: quiz.id }),
      env,
    )
    const save = await app.request(
      `/api/meets/${meet.id}/saves`,
      postJson({ quizFile: makeQuizFile(), kind: 'autosave', scheduledQuizId: quiz.id }),
      env,
    )
    expect(save.status).toBe(201)
    const saves = await db.select().from(schema.quizSaves)
    expect(saves).toHaveLength(1)
    const results = await db.select().from(schema.quizResults)
    expect(results).toHaveLength(1)
  })
})
