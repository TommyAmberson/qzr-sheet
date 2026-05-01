import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import type { Bindings } from '../../bindings'
import type { SessionVariables } from '../../middleware/session'
import { schedule } from '../schedule'
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

const env = { ENVIRONMENT: 'test' } as unknown as Bindings

function createApp(user: typeof testSuperuser | typeof testUser | null, db: Db) {
  const app = new Hono<{ Bindings: Bindings; Variables: SessionVariables & { db: Db } }>()
  app.use('*', mockSession(user))
  app.use('*', mockDb(db))
  app.route('/api/meets', schedule)
  return app
}

const postJson = (body: Record<string, unknown>) => jsonRequest('POST', body)
const patchJson = (body: Record<string, unknown>) => jsonRequest('PATCH', body)

async function seedRoom(db: Db, meetId: number, name: string, sortOrder = 0) {
  const [room] = await db.insert(schema.meetRooms).values({ meetId, name, sortOrder }).returning()
  return room!
}

async function seedSlot(db: Db, meetId: number, sortOrder = 0) {
  const [slot] = await db
    .insert(schema.meetSlots)
    .values({
      meetId,
      startAt: new Date('2026-01-01T20:00:00Z'),
      durationMinutes: 25,
      kind: 'quiz',
      sortOrder,
    })
    .returning()
  return slot!
}

describe('GET /api/meets/:id/rooms', () => {
  let db: Db
  let app: ReturnType<typeof createApp>

  beforeEach(async () => {
    db = await createTestDb()
    app = createApp(testSuperuser, db)
  })

  it('returns rooms ordered by sortOrder then id', async () => {
    const meet = await seedMeet(db)
    await seedRoom(db, meet.id, 'Room B', 1)
    await seedRoom(db, meet.id, 'Room A', 0)

    const res = await app.request(`/api/meets/${meet.id}/rooms`, {}, env)
    expect(res.status).toBe(200)
    const body = await jsonOf<{ rooms: { name: string; sortOrder: number; hasCode: boolean }[] }>(
      res,
    )
    expect(body.rooms.map((r) => r.name)).toEqual(['Room A', 'Room B'])
    expect(body.rooms[0]!.hasCode).toBe(false)
  })

  it('reflects hasCode when codeHash is set', async () => {
    const meet = await seedMeet(db)
    await db.insert(schema.meetRooms).values({
      meetId: meet.id,
      name: 'Room A',
      sortOrder: 0,
      codeHash: 'somehash',
    })

    const res = await app.request(`/api/meets/${meet.id}/rooms`, {}, env)
    const body = await jsonOf<{ rooms: { hasCode: boolean }[] }>(res)
    expect(body.rooms[0]!.hasCode).toBe(true)
  })
})

describe('PATCH /api/meets/:id/rooms/:roomId', () => {
  let db: Db
  let app: ReturnType<typeof createApp>

  beforeEach(async () => {
    db = await createTestDb()
    app = createApp(testSuperuser, db)
  })

  it('renames a room', async () => {
    const meet = await seedMeet(db)
    const room = await seedRoom(db, meet.id, 'Room A')

    const res = await app.request(
      `/api/meets/${meet.id}/rooms/${room.id}`,
      patchJson({ name: 'Sanctuary' }),
      env,
    )
    expect(res.status).toBe(200)
    const body = await jsonOf<{ room: { name: string } }>(res)
    expect(body.room.name).toBe('Sanctuary')
  })

  it('updates sortOrder', async () => {
    const meet = await seedMeet(db)
    const room = await seedRoom(db, meet.id, 'Room A', 0)

    const res = await app.request(
      `/api/meets/${meet.id}/rooms/${room.id}`,
      patchJson({ sortOrder: 5 }),
      env,
    )
    expect(res.status).toBe(200)
    const body = await jsonOf<{ room: { sortOrder: number } }>(res)
    expect(body.room.sortOrder).toBe(5)
  })

  it('rejects unknown room', async () => {
    const meet = await seedMeet(db)
    const res = await app.request(
      `/api/meets/${meet.id}/rooms/9999`,
      patchJson({ name: 'Nope' }),
      env,
    )
    expect(res.status).toBe(404)
  })

  it('requires admin', async () => {
    const meet = await seedMeet(db)
    const room = await seedRoom(db, meet.id, 'Room A')
    const userApp = createApp(testUser, db)
    const res = await userApp.request(
      `/api/meets/${meet.id}/rooms/${room.id}`,
      patchJson({ name: 'Nope' }),
      env,
    )
    expect(res.status).toBe(403)
  })
})

describe('slots CRUD', () => {
  let db: Db
  let app: ReturnType<typeof createApp>

  beforeEach(async () => {
    db = await createTestDb()
    app = createApp(testSuperuser, db)
  })

  it('creates, lists, updates, deletes a slot', async () => {
    const meet = await seedMeet(db)

    const created = await app.request(
      `/api/meets/${meet.id}/slots`,
      postJson({
        startAt: '2026-01-01T20:00:00Z',
        durationMinutes: 25,
        kind: 'quiz',
        sortOrder: 0,
      }),
      env,
    )
    expect(created.status).toBe(201)
    const { slot } = await jsonOf<{ slot: { id: number } }>(created)

    const list = await app.request(`/api/meets/${meet.id}/slots`, {}, env)
    expect(list.status).toBe(200)
    const listed = await jsonOf<{ slots: unknown[] }>(list)
    expect(listed.slots).toHaveLength(1)

    const patched = await app.request(
      `/api/meets/${meet.id}/slots/${slot.id}`,
      patchJson({ durationMinutes: 30 }),
      env,
    )
    expect(patched.status).toBe(200)
    const patchedBody = await jsonOf<{ slot: { durationMinutes: number } }>(patched)
    expect(patchedBody.slot.durationMinutes).toBe(30)

    const deleted = await app.request(
      `/api/meets/${meet.id}/slots/${slot.id}`,
      { method: 'DELETE' },
      env,
    )
    expect(deleted.status).toBe(200)
  })

  it('rejects invalid kind', async () => {
    const meet = await seedMeet(db)
    const res = await app.request(
      `/api/meets/${meet.id}/slots`,
      postJson({ startAt: 0, durationMinutes: 25, kind: 'bogus', sortOrder: 0 }),
      env,
    )
    expect(res.status).toBe(400)
  })

  it('creates an event slot with a label', async () => {
    const meet = await seedMeet(db)
    const res = await app.request(
      `/api/meets/${meet.id}/slots`,
      postJson({
        startAt: '2026-01-02T08:00:00Z',
        durationMinutes: 60,
        kind: 'event',
        eventLabel: 'Breakfast',
        sortOrder: 5,
      }),
      env,
    )
    expect(res.status).toBe(201)
    const body = await jsonOf<{ slot: { kind: string; eventLabel: string } }>(res)
    expect(body.slot.kind).toBe('event')
    expect(body.slot.eventLabel).toBe('Breakfast')
  })
})

describe('quizzes + seats CRUD', () => {
  let db: Db
  let app: ReturnType<typeof createApp>

  beforeEach(async () => {
    db = await createTestDb()
    app = createApp(testSuperuser, db)
  })

  it('creates a quiz with seats and lists it back', async () => {
    const meet = await seedMeet(db)
    const room = await seedRoom(db, meet.id, 'Room A')
    const slot = await seedSlot(db, meet.id)

    const created = await app.request(
      `/api/meets/${meet.id}/quizzes`,
      postJson({
        slotId: slot.id,
        roomId: room.id,
        division: 'Division 1',
        phase: 'prelim',
        label: 'Div 1 Quiz 1',
        seats: [
          { seatNumber: 1, letter: 'A' },
          { seatNumber: 2, letter: 'B' },
          { seatNumber: 3, letter: 'C' },
        ],
      }),
      env,
    )
    expect(created.status).toBe(201)

    const list = await app.request(`/api/meets/${meet.id}/quizzes`, {}, env)
    expect(list.status).toBe(200)
    const body = await jsonOf<{ quizzes: { label: string; seats: { letter: string }[] }[] }>(list)
    expect(body.quizzes).toHaveLength(1)
    expect(body.quizzes[0]!.label).toBe('Div 1 Quiz 1')
    expect(body.quizzes[0]!.seats).toHaveLength(3)
    const letters = body.quizzes[0]!.seats.map((s) => s.letter).sort()
    expect(letters).toEqual(['A', 'B', 'C'])
  })

  it('blocks edits and deletes on completed quizzes', async () => {
    const meet = await seedMeet(db)
    const room = await seedRoom(db, meet.id, 'Room A')
    const slot = await seedSlot(db, meet.id)
    const [quiz] = await db
      .insert(schema.scheduledQuizzes)
      .values({
        meetId: meet.id,
        slotId: slot.id,
        roomId: room.id,
        division: 'Division 1',
        phase: 'prelim',
        label: 'Done Quiz',
        completedAt: new Date(),
      })
      .returning()

    const patchRes = await app.request(
      `/api/meets/${meet.id}/quizzes/${quiz!.id}`,
      patchJson({ label: 'Renamed' }),
      env,
    )
    expect(patchRes.status).toBe(409)

    const deleteRes = await app.request(
      `/api/meets/${meet.id}/quizzes/${quiz!.id}`,
      { method: 'DELETE' },
      env,
    )
    expect(deleteRes.status).toBe(409)

    const seatsRes = await app.request(
      `/api/meets/${meet.id}/quizzes/${quiz!.id}/seats`,
      patchJson({ seats: [{ seatNumber: 1, letter: 'A' }] }),
      env,
    )
    expect(seatsRes.status).toBe(409)
  })

  it('replaces seats transactionally', async () => {
    const meet = await seedMeet(db)
    const room = await seedRoom(db, meet.id, 'Room A')
    const slot = await seedSlot(db, meet.id)
    const [quiz] = await db
      .insert(schema.scheduledQuizzes)
      .values({
        meetId: meet.id,
        slotId: slot.id,
        roomId: room.id,
        division: 'Division 1',
        phase: 'prelim',
        label: 'Q1',
      })
      .returning()
    await db.insert(schema.scheduledQuizSeats).values([
      { quizId: quiz!.id, seatNumber: 1, letter: 'A' },
      { quizId: quiz!.id, seatNumber: 2, letter: 'B' },
    ])

    const res = await app.request(
      `/api/meets/${meet.id}/quizzes/${quiz!.id}/seats`,
      patchJson({
        seats: [
          { seatNumber: 1, letter: 'X' },
          { seatNumber: 2, letter: 'Y' },
          { seatNumber: 3, letter: 'Z' },
        ],
      }),
      env,
    )
    expect(res.status).toBe(200)

    const stored = await db
      .select()
      .from(schema.scheduledQuizSeats)
      .where(eq(schema.scheduledQuizSeats.quizId, quiz!.id))
    const letters = stored.map((s) => s.letter).sort()
    expect(letters).toEqual(['X', 'Y', 'Z'])
  })

  it('requires admin for mutations', async () => {
    const meet = await seedMeet(db)
    const room = await seedRoom(db, meet.id, 'Room A')
    const slot = await seedSlot(db, meet.id)
    const userApp = createApp(testUser, db)

    const res = await userApp.request(
      `/api/meets/${meet.id}/quizzes`,
      postJson({
        slotId: slot.id,
        roomId: room.id,
        division: 'Division 1',
        phase: 'prelim',
        label: 'Nope',
      }),
      env,
    )
    expect(res.status).toBe(403)
  })
})
