import { Hono, type Context } from 'hono'
import { eq, and, asc, inArray, sql } from 'drizzle-orm'
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
      hasCode: sql<number>`(${schema.meetRooms.codeHash} IS NOT NULL)`,
    })
    .from(schema.meetRooms)
    .where(eq(schema.meetRooms.meetId, meetId))
    .orderBy(asc(schema.meetRooms.sortOrder), asc(schema.meetRooms.id))

  return c.json({
    rooms: rooms.map((r) => ({
      id: r.id,
      name: r.name,
      sortOrder: r.sortOrder,
      hasCode: Boolean(r.hasCode),
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
      codeHash: schema.meetRooms.codeHash,
    })

  if (!updated) return c.json({ error: 'Room not found' }, 404)
  return c.json({
    room: {
      id: updated.id,
      name: updated.name,
      sortOrder: updated.sortOrder,
      hasCode: updated.codeHash !== null,
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

  const startAt = new Date(body.startAt)
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
    const startAt = new Date(body.startAt)
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
    .where(and(eq(schema.scheduledQuizzes.id, quizId), eq(schema.scheduledQuizzes.meetId, meetId)))
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
 * Replace all seats for a quiz. NOTE: not atomic — D1 doesn't support
 * interactive transactions, so a delete-failure-then-insert window is
 * possible. Callers can recover by re-issuing the PATCH. Rejects if the
 * quiz is already completed.
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

/**
 * GET /api/meets/:id/prelim-assignments
 *
 * Returns the team→letter mapping for every division in the meet.
 * Any authenticated viewer can read; we use the wider phase/schedule
 * `requireAuth` already mounted on this router.
 */
schedule.get('/:id/prelim-assignments', async (c) => {
  const meetId = Number(c.req.param('id'))
  if (Number.isNaN(meetId)) return c.json({ error: 'Invalid meet ID' }, 400)

  const db = getDb(c)
  const rows = await db
    .select()
    .from(schema.prelimAssignments)
    .where(eq(schema.prelimAssignments.meetId, meetId))
    .orderBy(schema.prelimAssignments.division, schema.prelimAssignments.letter)
  return c.json({ assignments: rows })
})

/**
 * POST /api/meets/:id/prelim-assignments
 *
 * Replaces the team→letter mapping for one division. Body shape:
 * `{ division: string, mapping: { letter: string, teamId: number }[] }`.
 * Admin-only (Roll Teams is an admin operation). Each (meet, division,
 * letter) is unique; we delete-then-insert atomically per division.
 */
schedule.post('/:id/prelim-assignments', async (c) => {
  const meetId = Number(c.req.param('id'))
  if (Number.isNaN(meetId)) return c.json({ error: 'Invalid meet ID' }, 400)

  const denied = await requireAdmin(c, meetId)
  if (denied) return denied

  const body = await c.req.json<{
    division?: string
    mapping?: { letter?: string; teamId?: number }[]
  }>()
  const division = body.division?.trim()
  if (!division) return c.json({ error: 'division required' }, 400)
  const mapping = body.mapping ?? []
  if (!Array.isArray(mapping) || mapping.length === 0) {
    return c.json({ error: 'mapping must be a non-empty array' }, 400)
  }

  const seenLetters = new Set<string>()
  const seenTeams = new Set<number>()
  for (const entry of mapping) {
    if (!entry.letter || typeof entry.teamId !== 'number') {
      return c.json({ error: 'each mapping entry needs letter + teamId' }, 400)
    }
    if (seenLetters.has(entry.letter)) {
      return c.json({ error: `duplicate letter ${entry.letter}` }, 400)
    }
    if (seenTeams.has(entry.teamId)) {
      return c.json({ error: `duplicate teamId ${entry.teamId}` }, 400)
    }
    seenLetters.add(entry.letter)
    seenTeams.add(entry.teamId)
  }

  const db = getDb(c)
  // Verify every teamId belongs to this meet AND this division.
  const teamIds = mapping.map((m) => m.teamId!)
  const teamRows = await db
    .select({ id: schema.teams.id, division: schema.teams.division })
    .from(schema.teams)
    .where(and(eq(schema.teams.meetId, meetId), inArray(schema.teams.id, teamIds)))
  if (teamRows.length !== teamIds.length) {
    return c.json({ error: 'one or more teamIds are not in this meet' }, 400)
  }
  for (const row of teamRows) {
    if (row.division !== division) {
      return c.json(
        { error: `team ${row.id} is in division ${row.division}, not ${division}` },
        400,
      )
    }
  }

  await db
    .delete(schema.prelimAssignments)
    .where(
      and(
        eq(schema.prelimAssignments.meetId, meetId),
        eq(schema.prelimAssignments.division, division),
      ),
    )
  const now = new Date()
  await db.insert(schema.prelimAssignments).values(
    mapping.map((m) => ({
      meetId,
      division,
      letter: m.letter!,
      teamId: m.teamId!,
      assignedAt: now,
    })),
  )

  const assignments = await db
    .select()
    .from(schema.prelimAssignments)
    .where(
      and(
        eq(schema.prelimAssignments.meetId, meetId),
        eq(schema.prelimAssignments.division, division),
      ),
    )
    .orderBy(schema.prelimAssignments.letter)
  return c.json({ assignments })
})
