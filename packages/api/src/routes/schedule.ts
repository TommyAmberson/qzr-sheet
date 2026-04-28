import { Hono, type Context } from 'hono'
import { eq, and, asc, inArray } from 'drizzle-orm'
import type { Bindings } from '../bindings'
import type { SessionVariables } from '../middleware/session'
import { requireAuth, getUser } from '../middleware/session'
import { createDb, type Db } from '../lib/db'
import { isAdminOrSuperuser } from '../lib/permissions'
import * as schema from '../db/schema'

interface ScheduleVariables extends SessionVariables {
  db: Db
}

type Env = { Bindings: Bindings; Variables: ScheduleVariables }

export const schedule = new Hono<Env>()

schedule.use('*', requireAuth())
schedule.use('*', async (c, next) => {
  if (!c.get('db')) {
    c.set('db', createDb(c.env.DB) as unknown as Db)
  }
  await next()
})

function getDb(c: { get(key: 'db'): Db }): Db {
  return c.get('db')
}

async function requireAdmin(c: Context<Env>, meetId: number) {
  const user = getUser(c)
  const db = getDb(c)
  if (!(await isAdminOrSuperuser(db, user.id, user.role, meetId))) {
    return c.json({ error: 'Admin or superuser access required' }, 403)
  }
  return null
}

// ---- Rooms ----

schedule.get('/:id/rooms', async (c) => {
  const meetId = Number(c.req.param('id'))
  if (Number.isNaN(meetId)) return c.json({ error: 'Invalid meet ID' }, 400)

  const db = getDb(c)
  const rooms = await db
    .select({
      id: schema.meetRooms.id,
      name: schema.meetRooms.name,
      sortOrder: schema.meetRooms.sortOrder,
      hasCode: schema.meetRooms.codeHash,
    })
    .from(schema.meetRooms)
    .where(eq(schema.meetRooms.meetId, meetId))
    .orderBy(asc(schema.meetRooms.sortOrder), asc(schema.meetRooms.id))

  return c.json({
    rooms: rooms.map((r) => ({
      id: r.id,
      name: r.name,
      sortOrder: r.sortOrder,
      hasCode: r.hasCode !== null,
    })),
  })
})

schedule.patch('/:id/rooms/:roomId', async (c) => {
  const meetId = Number(c.req.param('id'))
  const roomId = Number(c.req.param('roomId'))
  if (Number.isNaN(meetId) || Number.isNaN(roomId)) {
    return c.json({ error: 'Invalid ID' }, 400)
  }

  const denied = await requireAdmin(c, meetId)
  if (denied) return denied

  const body = await c.req.json<{ name?: string; sortOrder?: number }>()
  const updates: Record<string, string | number> = {}
  if (typeof body.name === 'string' && body.name.trim()) updates.name = body.name.trim()
  if (typeof body.sortOrder === 'number') updates.sortOrder = body.sortOrder
  if (Object.keys(updates).length === 0) {
    return c.json({ error: 'No valid fields to update' }, 400)
  }

  const db = getDb(c)
  const [updated] = await db
    .update(schema.meetRooms)
    .set(updates)
    .where(and(eq(schema.meetRooms.id, roomId), eq(schema.meetRooms.meetId, meetId)))
    .returning({
      id: schema.meetRooms.id,
      name: schema.meetRooms.name,
      sortOrder: schema.meetRooms.sortOrder,
      hasCode: schema.meetRooms.codeHash,
    })

  if (!updated) return c.json({ error: 'Room not found' }, 404)
  return c.json({
    room: {
      id: updated.id,
      name: updated.name,
      sortOrder: updated.sortOrder,
      hasCode: updated.hasCode !== null,
    },
  })
})

// ---- Slots ----

schedule.get('/:id/slots', async (c) => {
  const meetId = Number(c.req.param('id'))
  if (Number.isNaN(meetId)) return c.json({ error: 'Invalid meet ID' }, 400)

  const db = getDb(c)
  const slots = await db
    .select()
    .from(schema.meetSlots)
    .where(eq(schema.meetSlots.meetId, meetId))
    .orderBy(asc(schema.meetSlots.sortOrder), asc(schema.meetSlots.id))

  return c.json({ slots })
})

schedule.post('/:id/slots', async (c) => {
  const meetId = Number(c.req.param('id'))
  if (Number.isNaN(meetId)) return c.json({ error: 'Invalid meet ID' }, 400)

  const denied = await requireAdmin(c, meetId)
  if (denied) return denied

  const body = await c.req.json<{
    startAt: string | number
    durationMinutes: number
    kind: 'quiz' | 'event'
    eventLabel?: string | null
    sortOrder: number
  }>()
  if (body.kind !== 'quiz' && body.kind !== 'event') {
    return c.json({ error: 'kind must be quiz or event' }, 400)
  }
  if (typeof body.durationMinutes !== 'number' || body.durationMinutes <= 0) {
    return c.json({ error: 'durationMinutes must be positive' }, 400)
  }
  if (typeof body.sortOrder !== 'number') {
    return c.json({ error: 'sortOrder is required' }, 400)
  }

  const startAt = typeof body.startAt === 'number' ? new Date(body.startAt) : new Date(body.startAt)
  if (Number.isNaN(startAt.getTime())) return c.json({ error: 'Invalid startAt' }, 400)

  const db = getDb(c)
  const [created] = await db
    .insert(schema.meetSlots)
    .values({
      meetId,
      startAt,
      durationMinutes: body.durationMinutes,
      kind: body.kind,
      eventLabel: body.eventLabel ?? null,
      sortOrder: body.sortOrder,
    })
    .returning()

  return c.json({ slot: created }, 201)
})

schedule.patch('/:id/slots/:slotId', async (c) => {
  const meetId = Number(c.req.param('id'))
  const slotId = Number(c.req.param('slotId'))
  if (Number.isNaN(meetId) || Number.isNaN(slotId)) {
    return c.json({ error: 'Invalid ID' }, 400)
  }

  const denied = await requireAdmin(c, meetId)
  if (denied) return denied

  const body = await c.req.json<{
    startAt?: string | number
    durationMinutes?: number
    eventLabel?: string | null
    sortOrder?: number
  }>()
  const updates: Record<string, unknown> = {}
  if (body.startAt !== undefined) {
    const startAt =
      typeof body.startAt === 'number' ? new Date(body.startAt) : new Date(body.startAt)
    if (Number.isNaN(startAt.getTime())) return c.json({ error: 'Invalid startAt' }, 400)
    updates.startAt = startAt
  }
  if (typeof body.durationMinutes === 'number' && body.durationMinutes > 0) {
    updates.durationMinutes = body.durationMinutes
  }
  if ('eventLabel' in body) updates.eventLabel = body.eventLabel ?? null
  if (typeof body.sortOrder === 'number') updates.sortOrder = body.sortOrder
  if (Object.keys(updates).length === 0) {
    return c.json({ error: 'No valid fields to update' }, 400)
  }

  const db = getDb(c)
  const [updated] = await db
    .update(schema.meetSlots)
    .set(updates)
    .where(and(eq(schema.meetSlots.id, slotId), eq(schema.meetSlots.meetId, meetId)))
    .returning()

  if (!updated) return c.json({ error: 'Slot not found' }, 404)
  return c.json({ slot: updated })
})

schedule.delete('/:id/slots/:slotId', async (c) => {
  const meetId = Number(c.req.param('id'))
  const slotId = Number(c.req.param('slotId'))
  if (Number.isNaN(meetId) || Number.isNaN(slotId)) {
    return c.json({ error: 'Invalid ID' }, 400)
  }

  const denied = await requireAdmin(c, meetId)
  if (denied) return denied

  const db = getDb(c)
  const deleted = await db
    .delete(schema.meetSlots)
    .where(and(eq(schema.meetSlots.id, slotId), eq(schema.meetSlots.meetId, meetId)))
    .returning({ id: schema.meetSlots.id })

  if (deleted.length === 0) return c.json({ error: 'Slot not found' }, 404)
  return c.json({ deleted: true })
})

// ---- Scheduled quizzes + seats ----

interface SeatInput {
  seatNumber: number
  letter?: string | null
  seedRef?: string | null
}

schedule.get('/:id/quizzes', async (c) => {
  const meetId = Number(c.req.param('id'))
  if (Number.isNaN(meetId)) return c.json({ error: 'Invalid meet ID' }, 400)

  const db = getDb(c)
  const quizzes = await db
    .select()
    .from(schema.scheduledQuizzes)
    .where(eq(schema.scheduledQuizzes.meetId, meetId))

  const seats =
    quizzes.length === 0
      ? []
      : await db
          .select()
          .from(schema.scheduledQuizSeats)
          .where(
            inArray(
              schema.scheduledQuizSeats.quizId,
              quizzes.map((q) => q.id),
            ),
          )

  const seatsByQuiz = new Map<number, schema.ScheduledQuizSeat[]>()
  for (const seat of seats) {
    const arr = seatsByQuiz.get(seat.quizId) ?? []
    arr.push(seat)
    seatsByQuiz.set(seat.quizId, arr)
  }

  return c.json({
    quizzes: quizzes.map((q) => ({ ...q, seats: seatsByQuiz.get(q.id) ?? [] })),
  })
})

schedule.post('/:id/quizzes', async (c) => {
  const meetId = Number(c.req.param('id'))
  if (Number.isNaN(meetId)) return c.json({ error: 'Invalid meet ID' }, 400)

  const denied = await requireAdmin(c, meetId)
  if (denied) return denied

  const body = await c.req.json<{
    slotId: number
    roomId: number
    division: string
    phase: 'prelim' | 'elim'
    lane?: 'main' | 'consolation' | 'intermediate' | null
    label: string
    bracketLabel?: string | null
    seats?: SeatInput[]
  }>()
  if (body.phase !== 'prelim' && body.phase !== 'elim') {
    return c.json({ error: 'phase must be prelim or elim' }, 400)
  }
  if (!body.label?.trim()) return c.json({ error: 'label is required' }, 400)
  if (typeof body.slotId !== 'number' || typeof body.roomId !== 'number') {
    return c.json({ error: 'slotId and roomId are required' }, 400)
  }

  const db = getDb(c)
  const [created] = await db
    .insert(schema.scheduledQuizzes)
    .values({
      meetId,
      slotId: body.slotId,
      roomId: body.roomId,
      division: body.division,
      phase: body.phase,
      lane: body.lane ?? null,
      label: body.label.trim(),
      bracketLabel: body.bracketLabel ?? null,
    })
    .returning()

  if (body.seats?.length) {
    await db.insert(schema.scheduledQuizSeats).values(
      body.seats.map((s) => ({
        quizId: created!.id,
        seatNumber: s.seatNumber,
        letter: s.letter ?? null,
        seedRef: s.seedRef ?? null,
      })),
    )
  }

  return c.json({ quiz: created }, 201)
})

schedule.patch('/:id/quizzes/:quizId', async (c) => {
  const meetId = Number(c.req.param('id'))
  const quizId = Number(c.req.param('quizId'))
  if (Number.isNaN(meetId) || Number.isNaN(quizId)) {
    return c.json({ error: 'Invalid ID' }, 400)
  }

  const denied = await requireAdmin(c, meetId)
  if (denied) return denied

  const db = getDb(c)
  const [existing] = await db
    .select({ completedAt: schema.scheduledQuizzes.completedAt })
    .from(schema.scheduledQuizzes)
    .where(and(eq(schema.scheduledQuizzes.id, quizId), eq(schema.scheduledQuizzes.meetId, meetId)))
  if (!existing) return c.json({ error: 'Quiz not found' }, 404)
  if (existing.completedAt) {
    return c.json({ error: 'Completed quizzes are immutable' }, 409)
  }

  const body = await c.req.json<{
    slotId?: number
    roomId?: number
    label?: string
    bracketLabel?: string | null
    publishedAt?: string | number | null
  }>()
  const updates: Record<string, unknown> = {}
  if (typeof body.slotId === 'number') updates.slotId = body.slotId
  if (typeof body.roomId === 'number') updates.roomId = body.roomId
  if (typeof body.label === 'string' && body.label.trim()) updates.label = body.label.trim()
  if ('bracketLabel' in body) updates.bracketLabel = body.bracketLabel ?? null
  if ('publishedAt' in body) {
    updates.publishedAt = body.publishedAt == null ? null : new Date(body.publishedAt)
  }
  if (Object.keys(updates).length === 0) {
    return c.json({ error: 'No valid fields to update' }, 400)
  }

  const [updated] = await db
    .update(schema.scheduledQuizzes)
    .set(updates)
    .where(eq(schema.scheduledQuizzes.id, quizId))
    .returning()

  return c.json({ quiz: updated })
})

schedule.delete('/:id/quizzes/:quizId', async (c) => {
  const meetId = Number(c.req.param('id'))
  const quizId = Number(c.req.param('quizId'))
  if (Number.isNaN(meetId) || Number.isNaN(quizId)) {
    return c.json({ error: 'Invalid ID' }, 400)
  }

  const denied = await requireAdmin(c, meetId)
  if (denied) return denied

  const db = getDb(c)
  const [existing] = await db
    .select({ completedAt: schema.scheduledQuizzes.completedAt })
    .from(schema.scheduledQuizzes)
    .where(and(eq(schema.scheduledQuizzes.id, quizId), eq(schema.scheduledQuizzes.meetId, meetId)))
  if (!existing) return c.json({ error: 'Quiz not found' }, 404)
  if (existing.completedAt) {
    return c.json({ error: 'Completed quizzes are immutable' }, 409)
  }

  await db.delete(schema.scheduledQuizzes).where(eq(schema.scheduledQuizzes.id, quizId))
  return c.json({ deleted: true })
})

/**
 * PATCH /api/meets/:id/quizzes/:quizId/seats
 * Body: { seats: [{ seatNumber, letter?, seedRef? }, ...] }
 *
 * Replace all seats for a quiz transactionally. Rejects if quiz is completed.
 */
schedule.patch('/:id/quizzes/:quizId/seats', async (c) => {
  const meetId = Number(c.req.param('id'))
  const quizId = Number(c.req.param('quizId'))
  if (Number.isNaN(meetId) || Number.isNaN(quizId)) {
    return c.json({ error: 'Invalid ID' }, 400)
  }

  const denied = await requireAdmin(c, meetId)
  if (denied) return denied

  const body = await c.req.json<{ seats: SeatInput[] }>()
  if (!Array.isArray(body.seats)) {
    return c.json({ error: 'seats array required' }, 400)
  }

  const db = getDb(c)
  const [existing] = await db
    .select({ completedAt: schema.scheduledQuizzes.completedAt })
    .from(schema.scheduledQuizzes)
    .where(and(eq(schema.scheduledQuizzes.id, quizId), eq(schema.scheduledQuizzes.meetId, meetId)))
  if (!existing) return c.json({ error: 'Quiz not found' }, 404)
  if (existing.completedAt) {
    return c.json({ error: 'Completed quizzes are immutable' }, 409)
  }

  await db.delete(schema.scheduledQuizSeats).where(eq(schema.scheduledQuizSeats.quizId, quizId))
  if (body.seats.length > 0) {
    await db.insert(schema.scheduledQuizSeats).values(
      body.seats.map((s) => ({
        quizId,
        seatNumber: s.seatNumber,
        letter: s.letter ?? null,
        seedRef: s.seedRef ?? null,
      })),
    )
  }

  const seats = await db
    .select()
    .from(schema.scheduledQuizSeats)
    .where(eq(schema.scheduledQuizSeats.quizId, quizId))

  return c.json({ seats })
})
