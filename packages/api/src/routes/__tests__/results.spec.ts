import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
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
