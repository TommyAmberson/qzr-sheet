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

describe('POST /api/meets/:id/schedule/sync', () => {
  let db: Db
  let app: ReturnType<typeof createApp>

  beforeEach(async () => {
    db = await createTestDb()
    app = createApp(testSuperuser, db)
  })

  async function seedChurch(meetId: number, name = 'Grace') {
    const [church] = await db
      .insert(schema.churches)
      .values({ meetId, name, shortName: name, coachCodeHash: 'x' })
      .returning()
    return church!
  }

  async function seedTeam(meetId: number, churchId: number, division: string, number: number) {
    const [team] = await db
      .insert(schema.teams)
      .values({ meetId, churchId, division, number })
      .returning()
    return team!
  }

  function emptyPayload() {
    return { slots: [], quizzes: [], prelimAssignments: [], teamLateness: [] }
  }

  function syncReq(body: Record<string, unknown>) {
    return jsonRequest('POST', body)
  }

  it('empty payload is a no-op that returns the current state', async () => {
    const meet = await seedMeet(db)
    const room = await seedRoom(db, meet.id, 'Room A')
    const slot = await seedSlot(db, meet.id)
    await db.insert(schema.scheduledQuizzes).values({
      meetId: meet.id,
      slotId: slot.id,
      roomId: room.id,
      division: 'Division 1',
      phase: 'prelim',
      label: 'D1Q1',
    })

    const res = await app.request(
      `/api/meets/${meet.id}/schedule/sync`,
      syncReq(emptyPayload()),
      env,
    )
    expect(res.status).toBe(200)
    const body = await jsonOf<{
      slots: { id: number }[]
      quizzes: { id: number }[]
    }>(res)
    // Empty payload deletes everything (since nothing was sent to keep).
    expect(body.slots).toHaveLength(0)
    expect(body.quizzes).toHaveLength(0)
  })

  it('creates a new slot and a new quiz referencing it by temp id', async () => {
    const meet = await seedMeet(db)
    const room = await seedRoom(db, meet.id, 'Room A')

    const res = await app.request(
      `/api/meets/${meet.id}/schedule/sync`,
      syncReq({
        slots: [
          {
            id: -1,
            startAt: '2026-01-01T20:00:00.000Z',
            durationMinutes: 25,
            kind: 'quiz',
            eventLabel: null,
            sortOrder: 0,
          },
        ],
        quizzes: [
          {
            id: -10,
            slotId: -1, // ← references the temp slot above
            roomId: room.id,
            division: 'Division 1',
            phase: 'prelim',
            label: 'D1Q1',
            bracketLabel: null,
            seats: [
              { seatNumber: 1, letter: 'A', seedRef: null },
              { seatNumber: 2, letter: 'B', seedRef: null },
              { seatNumber: 3, letter: 'C', seedRef: null },
            ],
          },
        ],
        prelimAssignments: [],
        teamLateness: [],
      }),
      env,
    )
    expect(res.status).toBe(200)
    const body = await jsonOf<{
      slots: { id: number; sortOrder: number }[]
      quizzes: { id: number; slotId: number; label: string; seats: { letter: string }[] }[]
    }>(res)
    expect(body.slots).toHaveLength(1)
    expect(body.quizzes).toHaveLength(1)
    expect(body.quizzes[0]!.slotId).toBe(body.slots[0]!.id)
    expect(body.quizzes[0]!.label).toBe('D1Q1')
    const letters = body.quizzes[0]!.seats.map((s) => s.letter).sort()
    expect(letters).toEqual(['A', 'B', 'C'])
  })

  it('updates an existing slot only when fields differ', async () => {
    const meet = await seedMeet(db)
    const slot = await seedSlot(db, meet.id, 0)

    const res = await app.request(
      `/api/meets/${meet.id}/schedule/sync`,
      syncReq({
        slots: [
          {
            id: slot.id,
            startAt: slot.startAt.toISOString(),
            durationMinutes: slot.durationMinutes,
            kind: slot.kind,
            eventLabel: slot.eventLabel,
            sortOrder: 7, // ← only sortOrder differs
          },
        ],
        quizzes: [],
        prelimAssignments: [],
        teamLateness: [],
      }),
      env,
    )
    expect(res.status).toBe(200)
    const body = await jsonOf<{ slots: { id: number; sortOrder: number }[] }>(res)
    expect(body.slots).toHaveLength(1)
    expect(body.slots[0]!.sortOrder).toBe(7)
  })

  it('deleting a slot cascades to its quizzes', async () => {
    const meet = await seedMeet(db)
    const room = await seedRoom(db, meet.id, 'Room A')
    const slot = await seedSlot(db, meet.id)
    await db.insert(schema.scheduledQuizzes).values({
      meetId: meet.id,
      slotId: slot.id,
      roomId: room.id,
      division: 'Division 1',
      phase: 'prelim',
      label: 'D1Q1',
    })

    const res = await app.request(
      `/api/meets/${meet.id}/schedule/sync`,
      syncReq({ ...emptyPayload() }),
      env,
    )
    expect(res.status).toBe(200)
    const body = await jsonOf<{ slots: unknown[]; quizzes: unknown[] }>(res)
    expect(body.slots).toHaveLength(0)
    expect(body.quizzes).toHaveLength(0)
    const remainingQuizzes = await db
      .select()
      .from(schema.scheduledQuizzes)
      .where(eq(schema.scheduledQuizzes.meetId, meet.id))
    expect(remainingQuizzes).toHaveLength(0)
  })

  it('replaces prelim assignments per division (full replace)', async () => {
    const meet = await seedMeet(db)
    const church = await seedChurch(meet.id)
    const t1 = await seedTeam(meet.id, church.id, 'Division 1', 1)
    const t2 = await seedTeam(meet.id, church.id, 'Division 1', 2)

    // First sync: assign A→t1, B→t2
    const first = await app.request(
      `/api/meets/${meet.id}/schedule/sync`,
      syncReq({
        ...emptyPayload(),
        prelimAssignments: [
          {
            division: 'Division 1',
            mapping: [
              { letter: 'A', teamId: t1.id },
              { letter: 'B', teamId: t2.id },
            ],
          },
        ],
      }),
      env,
    )
    expect(first.status).toBe(200)
    const firstBody = await jsonOf<{ prelimAssignments: { letter: string; teamId: number }[] }>(
      first,
    )
    expect(firstBody.prelimAssignments).toHaveLength(2)

    // Second sync: swap the mapping
    const second = await app.request(
      `/api/meets/${meet.id}/schedule/sync`,
      syncReq({
        ...emptyPayload(),
        prelimAssignments: [
          {
            division: 'Division 1',
            mapping: [
              { letter: 'A', teamId: t2.id },
              { letter: 'B', teamId: t1.id },
            ],
          },
        ],
      }),
      env,
    )
    expect(second.status).toBe(200)
    const stored = await db
      .select()
      .from(schema.prelimAssignments)
      .where(eq(schema.prelimAssignments.meetId, meet.id))
    expect(stored).toHaveLength(2)
    expect(stored.find((a) => a.letter === 'A')!.teamId).toBe(t2.id)
    expect(stored.find((a) => a.letter === 'B')!.teamId).toBe(t1.id)
  })

  it('flips team lateness for only the teams in the payload', async () => {
    const meet = await seedMeet(db)
    const church = await seedChurch(meet.id)
    const t1 = await seedTeam(meet.id, church.id, 'Division 1', 1)
    const t2 = await seedTeam(meet.id, church.id, 'Division 1', 2)

    const res = await app.request(
      `/api/meets/${meet.id}/schedule/sync`,
      syncReq({
        ...emptyPayload(),
        teamLateness: [{ teamId: t1.id, lateness: true }],
      }),
      env,
    )
    expect(res.status).toBe(200)
    const teams = await db.select().from(schema.teams).where(eq(schema.teams.meetId, meet.id))
    expect(teams.find((t) => t.id === t1.id)!.lateness).toBe(true)
    expect(teams.find((t) => t.id === t2.id)!.lateness).toBe(false)
  })

  it('rejects non-admin callers', async () => {
    const meet = await seedMeet(db)
    const userApp = createApp(testUser, db)
    const res = await userApp.request(
      `/api/meets/${meet.id}/schedule/sync`,
      syncReq(emptyPayload()),
      env,
    )
    expect(res.status).toBe(403)
  })

  it('rejects payloads that delete a completed quiz', async () => {
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
        label: 'Done',
        completedAt: new Date(),
      })
      .returning()

    const res = await app.request(
      `/api/meets/${meet.id}/schedule/sync`,
      syncReq({
        ...emptyPayload(),
        slots: [
          {
            id: slot.id,
            startAt: slot.startAt.toISOString(),
            durationMinutes: slot.durationMinutes,
            kind: slot.kind,
            eventLabel: slot.eventLabel,
            sortOrder: slot.sortOrder,
          },
        ],
        // quiz omitted ⇒ would be deleted
      }),
      env,
    )
    expect(res.status).toBe(409)
    const body = await jsonOf<{ error: string }>(res)
    expect(body.error).toMatch(new RegExp(`Completed quiz ${quiz!.id}`))
  })

  it('rejects payloads that mutate a completed quiz row', async () => {
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
        label: 'Done',
        completedAt: new Date(),
      })
      .returning()

    const res = await app.request(
      `/api/meets/${meet.id}/schedule/sync`,
      syncReq({
        ...emptyPayload(),
        slots: [
          {
            id: slot.id,
            startAt: slot.startAt.toISOString(),
            durationMinutes: slot.durationMinutes,
            kind: slot.kind,
            eventLabel: slot.eventLabel,
            sortOrder: slot.sortOrder,
          },
        ],
        quizzes: [
          {
            id: quiz!.id,
            slotId: slot.id,
            roomId: room.id,
            division: 'Division 1',
            phase: 'prelim',
            label: 'Renamed', // ← would mutate the locked row
            bracketLabel: null,
            seats: [],
          },
        ],
      }),
      env,
    )
    expect(res.status).toBe(409)
  })

  it('mixed payload: new slot + new quiz + existing-slot update + delete + lateness', async () => {
    const meet = await seedMeet(db)
    const church = await seedChurch(meet.id)
    const t1 = await seedTeam(meet.id, church.id, 'Division 1', 1)
    const room = await seedRoom(db, meet.id, 'Room A')
    const slotKeep = await seedSlot(db, meet.id, 0)
    const slotDelete = await seedSlot(db, meet.id, 1)

    const res = await app.request(
      `/api/meets/${meet.id}/schedule/sync`,
      syncReq({
        slots: [
          // Keep this one but bump sortOrder
          {
            id: slotKeep.id,
            startAt: slotKeep.startAt.toISOString(),
            durationMinutes: slotKeep.durationMinutes,
            kind: slotKeep.kind,
            eventLabel: slotKeep.eventLabel,
            sortOrder: 5,
          },
          // New slot
          {
            id: -1,
            startAt: '2026-01-01T21:00:00.000Z',
            durationMinutes: 25,
            kind: 'quiz',
            eventLabel: null,
            sortOrder: 6,
          },
          // slotDelete is omitted ⇒ deleted
        ],
        quizzes: [
          // New quiz on the new slot
          {
            id: -10,
            slotId: -1,
            roomId: room.id,
            division: 'Division 1',
            phase: 'prelim',
            label: 'D1Q1',
            bracketLabel: null,
            seats: [{ seatNumber: 1, letter: 'A', seedRef: null }],
          },
        ],
        prelimAssignments: [{ division: 'Division 1', mapping: [{ letter: 'A', teamId: t1.id }] }],
        teamLateness: [{ teamId: t1.id, lateness: true }],
      }),
      env,
    )
    expect(res.status).toBe(200)
    const body = await jsonOf<{
      slots: { id: number; sortOrder: number }[]
      quizzes: { id: number; slotId: number }[]
      prelimAssignments: { letter: string; teamId: number }[]
      teams: { id: number; lateness: boolean }[]
    }>(res)
    expect(body.slots).toHaveLength(2)
    expect(body.slots.find((s) => s.id === slotKeep.id)!.sortOrder).toBe(5)
    expect(body.slots.find((s) => s.id === slotDelete.id)).toBeUndefined()
    expect(body.quizzes).toHaveLength(1)
    const newSlot = body.slots.find((s) => s.id !== slotKeep.id)!
    expect(body.quizzes[0]!.slotId).toBe(newSlot.id)
    expect(body.prelimAssignments).toHaveLength(1)
    expect(body.teams.find((t) => t.id === t1.id)!.lateness).toBe(true)
  })
})
