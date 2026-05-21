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

// ---- Schedule sync (draft → server commit) ----

interface SyncSlotInput {
  id: number
  startAt: string | number
  durationMinutes: number
  kind: 'quiz' | 'event'
  eventLabel?: string | null
  sortOrder: number
}

interface SyncQuizInput {
  id: number
  slotId: number
  roomId: number
  division: string
  phase: 'prelim' | 'elim'
  label: string
  bracketLabel?: string | null
  seats: SeatInput[]
}

interface SyncPrelimDivision {
  division: string
  mapping: { letter: string; teamId: number }[]
}

interface SyncTeamLateness {
  teamId: number
  lateness: boolean
}

interface ScheduleSyncPayload {
  slots: SyncSlotInput[]
  quizzes: SyncQuizInput[]
  prelimAssignments: SyncPrelimDivision[]
  teamLateness: SyncTeamLateness[]
}

/**
 * POST /api/meets/:id/schedule/sync
 *
 * Replaces the meet's editable schedule state in one request. Payload
 * carries the full desired state: slots, quizzes (with seats),
 * prelim-assignment mappings per division, and any team-lateness flips.
 *
 * Temp IDs (negative) signal new slots/quizzes; `quiz.slotId` may
 * reference a negative slot id from the same payload, which is resolved
 * after slot inserts. Response is the post-commit state.
 *
 * NOT atomic — D1 has no interactive transactions, same constraint as
 * the per-row /seats and /prelim-assignments endpoints. A mid-flight
 * failure can leave the meet partly updated; callers recover by
 * re-issuing the sync.
 *
 * TODO: lock completed quizzes via UI; today the server only blocks
 * destructive changes to them. See risks in the schedule-draft plan.
 */
schedule.post('/:id/schedule/sync', async (c) => {
  const meetId = Number(c.req.param('id'))
  if (Number.isNaN(meetId)) return c.json({ error: 'Invalid meet ID' }, 400)

  const denied = await requireAdmin(c, meetId)
  if (denied) return denied

  const body = await c.req.json<ScheduleSyncPayload>()
  if (
    !Array.isArray(body.slots) ||
    !Array.isArray(body.quizzes) ||
    !Array.isArray(body.prelimAssignments) ||
    !Array.isArray(body.teamLateness)
  ) {
    return c.json({ error: 'slots, quizzes, prelimAssignments, teamLateness all required' }, 400)
  }

  // ---- Shallow shape validation ----
  for (const s of body.slots) {
    if (typeof s.id !== 'number') return c.json({ error: 'slot.id required' }, 400)
    if (s.kind !== 'quiz' && s.kind !== 'event') {
      return c.json({ error: 'slot.kind must be quiz or event' }, 400)
    }
    if (typeof s.durationMinutes !== 'number' || s.durationMinutes <= 0) {
      return c.json({ error: 'slot.durationMinutes must be positive' }, 400)
    }
    if (typeof s.sortOrder !== 'number') {
      return c.json({ error: 'slot.sortOrder required' }, 400)
    }
    const startAt = new Date(s.startAt)
    if (Number.isNaN(startAt.getTime())) return c.json({ error: 'invalid slot.startAt' }, 400)
  }
  for (const q of body.quizzes) {
    if (typeof q.id !== 'number') return c.json({ error: 'quiz.id required' }, 400)
    if (typeof q.slotId !== 'number' || typeof q.roomId !== 'number') {
      return c.json({ error: 'quiz.slotId and quiz.roomId required' }, 400)
    }
    if (q.phase !== 'prelim' && q.phase !== 'elim') {
      return c.json({ error: 'quiz.phase must be prelim or elim' }, 400)
    }
    if (typeof q.label !== 'string' || !q.label.trim()) {
      return c.json({ error: 'quiz.label required' }, 400)
    }
    if (!Array.isArray(q.seats)) return c.json({ error: 'quiz.seats array required' }, 400)
    for (const seat of q.seats) {
      if (typeof seat.seatNumber !== 'number') {
        return c.json({ error: 'seat.seatNumber required' }, 400)
      }
    }
  }

  const db = getDb(c)

  // ---- Load current state ----
  const currentSlots = await db
    .select()
    .from(schema.meetSlots)
    .where(eq(schema.meetSlots.meetId, meetId))
  const currentQuizzes = await db
    .select()
    .from(schema.scheduledQuizzes)
    .where(eq(schema.scheduledQuizzes.meetId, meetId))
  const currentTeams = await db.select().from(schema.teams).where(eq(schema.teams.meetId, meetId))

  // ---- Completed-quiz guard ----
  // Reject sync payloads that would delete or mutate a completed quiz.
  // We don't yet surface a per-row lock in the UI; this server-side
  // check is the safety net.
  const payloadQuizById = new Map(body.quizzes.filter((q) => q.id > 0).map((q) => [q.id, q]))
  for (const cq of currentQuizzes) {
    if (!cq.completedAt) continue
    const payload = payloadQuizById.get(cq.id)
    if (!payload) {
      return c.json({ error: `Completed quiz ${cq.id} cannot be deleted` }, 409)
    }
    if (
      payload.roomId !== cq.roomId ||
      payload.division !== cq.division ||
      payload.phase !== cq.phase ||
      payload.label.trim() !== cq.label ||
      (payload.bracketLabel ?? null) !== (cq.bracketLabel ?? null)
    ) {
      return c.json({ error: `Completed quiz ${cq.id} cannot be modified` }, 409)
    }
  }

  // ---- Slot diff ----
  const payloadSlotIds = new Set(body.slots.filter((s) => s.id > 0).map((s) => s.id))
  const slotIdsToDelete = currentSlots.filter((s) => !payloadSlotIds.has(s.id)).map((s) => s.id)

  // Don't allow deleting a slot that hosts a completed quiz.
  if (slotIdsToDelete.length > 0) {
    const completedOnDeleted = currentQuizzes.find(
      (q) => q.completedAt !== null && slotIdsToDelete.includes(q.slotId),
    )
    if (completedOnDeleted) {
      return c.json(
        {
          error: `Slot ${completedOnDeleted.slotId} hosts a completed quiz and cannot be deleted`,
        },
        409,
      )
    }
    await db.delete(schema.meetSlots).where(inArray(schema.meetSlots.id, slotIdsToDelete))
  }

  // ---- Insert new slots; build tempId → realId map ----
  const slotTempIdMap = new Map<number, number>()
  const newSlots = body.slots.filter((s) => s.id < 0)
  if (newSlots.length > 0) {
    const inserted = await db
      .insert(schema.meetSlots)
      .values(
        newSlots.map((s) => ({
          meetId,
          startAt: new Date(s.startAt),
          durationMinutes: s.durationMinutes,
          kind: s.kind,
          eventLabel: s.eventLabel ?? null,
          sortOrder: s.sortOrder,
        })),
      )
      .returning()
    newSlots.forEach((s, i) => slotTempIdMap.set(s.id, inserted[i]!.id))
  }

  // ---- Update existing slot rows ----
  const currentSlotMap = new Map(currentSlots.map((s) => [s.id, s]))
  for (const s of body.slots) {
    if (s.id < 0) continue
    const current = currentSlotMap.get(s.id)
    if (!current) continue
    const startAt = new Date(s.startAt)
    const changed =
      current.startAt.getTime() !== startAt.getTime() ||
      current.durationMinutes !== s.durationMinutes ||
      current.kind !== s.kind ||
      (current.eventLabel ?? null) !== (s.eventLabel ?? null) ||
      current.sortOrder !== s.sortOrder
    if (changed) {
      await db
        .update(schema.meetSlots)
        .set({
          startAt,
          durationMinutes: s.durationMinutes,
          kind: s.kind,
          eventLabel: s.eventLabel ?? null,
          sortOrder: s.sortOrder,
        })
        .where(eq(schema.meetSlots.id, s.id))
    }
  }

  function resolveSlotId(slotId: number): number | null {
    if (slotId > 0) return slotId
    return slotTempIdMap.get(slotId) ?? null
  }

  // Reject completed-quiz slot moves after temp resolution.
  for (const cq of currentQuizzes) {
    if (!cq.completedAt) continue
    const payload = payloadQuizById.get(cq.id)!
    const resolved = resolveSlotId(payload.slotId)
    if (resolved !== cq.slotId) {
      return c.json({ error: `Completed quiz ${cq.id} cannot be moved between slots` }, 409)
    }
  }

  // ---- Quiz diff ----
  // Quizzes on deleted slots are gone via FK cascade; ignore them.
  const survivingCurrentQuizzes = currentQuizzes.filter((q) => !slotIdsToDelete.includes(q.slotId))
  const quizIdsToDelete = survivingCurrentQuizzes
    .filter((q) => !payloadQuizById.has(q.id))
    .map((q) => q.id)
  if (quizIdsToDelete.length > 0) {
    await db
      .delete(schema.scheduledQuizzes)
      .where(inArray(schema.scheduledQuizzes.id, quizIdsToDelete))
  }

  // ---- Insert new quizzes; build tempId → realId map ----
  const quizTempIdMap = new Map<number, number>()
  const newQuizzes = body.quizzes.filter((q) => q.id < 0)
  if (newQuizzes.length > 0) {
    const rows: (typeof schema.scheduledQuizzes.$inferInsert)[] = []
    for (const q of newQuizzes) {
      const slotId = resolveSlotId(q.slotId)
      if (slotId === null) {
        return c.json({ error: `Cannot resolve slotId ${q.slotId} for new quiz` }, 400)
      }
      rows.push({
        meetId,
        slotId,
        roomId: q.roomId,
        division: q.division,
        phase: q.phase,
        lane: null,
        label: q.label.trim(),
        bracketLabel: q.bracketLabel ?? null,
      })
    }
    const inserted = await db.insert(schema.scheduledQuizzes).values(rows).returning()
    newQuizzes.forEach((q, i) => quizTempIdMap.set(q.id, inserted[i]!.id))
  }

  // ---- Update existing quiz rows ----
  const currentQuizMap = new Map(survivingCurrentQuizzes.map((q) => [q.id, q]))
  for (const q of body.quizzes) {
    if (q.id < 0) continue
    const current = currentQuizMap.get(q.id)
    if (!current) continue
    if (current.completedAt) continue // already validated as unchanged above
    const slotId = resolveSlotId(q.slotId)
    if (slotId === null) {
      return c.json({ error: `Cannot resolve slotId ${q.slotId} for quiz ${q.id}` }, 400)
    }
    const labelTrim = q.label.trim()
    const changed =
      current.slotId !== slotId ||
      current.roomId !== q.roomId ||
      current.division !== q.division ||
      current.phase !== q.phase ||
      current.label !== labelTrim ||
      (current.bracketLabel ?? null) !== (q.bracketLabel ?? null)
    if (changed) {
      await db
        .update(schema.scheduledQuizzes)
        .set({
          slotId,
          roomId: q.roomId,
          division: q.division,
          phase: q.phase,
          label: labelTrim,
          bracketLabel: q.bracketLabel ?? null,
        })
        .where(eq(schema.scheduledQuizzes.id, q.id))
    }
  }

  // ---- Replace seats for every editable quiz in payload ----
  // Same delete-then-insert pattern as PATCH /quizzes/:id/seats. We
  // skip completed quizzes; their seats are pinned with the row.
  const editableQuizIds: number[] = []
  for (const q of body.quizzes) {
    const current = q.id > 0 ? currentQuizMap.get(q.id) : null
    if (current?.completedAt) continue
    const realId = q.id > 0 ? q.id : quizTempIdMap.get(q.id)!
    editableQuizIds.push(realId)
  }
  if (editableQuizIds.length > 0) {
    await db
      .delete(schema.scheduledQuizSeats)
      .where(inArray(schema.scheduledQuizSeats.quizId, editableQuizIds))
  }
  const seatRows: (typeof schema.scheduledQuizSeats.$inferInsert)[] = []
  for (const q of body.quizzes) {
    const current = q.id > 0 ? currentQuizMap.get(q.id) : null
    if (current?.completedAt) continue
    const realId = q.id > 0 ? q.id : quizTempIdMap.get(q.id)!
    for (const seat of q.seats) {
      seatRows.push({
        quizId: realId,
        seatNumber: seat.seatNumber,
        letter: seat.letter ?? null,
        seedRef: seat.seedRef ?? null,
      })
    }
  }
  if (seatRows.length > 0) {
    await db.insert(schema.scheduledQuizSeats).values(seatRows)
  }

  // ---- Prelim assignments (full-replace per division in payload) ----
  for (const div of body.prelimAssignments) {
    if (typeof div.division !== 'string' || !div.division.trim()) {
      return c.json({ error: 'prelimAssignments.division required' }, 400)
    }
    if (!Array.isArray(div.mapping)) {
      return c.json({ error: 'prelimAssignments.mapping array required' }, 400)
    }
    const seenLetters = new Set<string>()
    const seenTeams = new Set<number>()
    for (const entry of div.mapping) {
      if (!entry.letter || typeof entry.teamId !== 'number') {
        return c.json(
          { error: `prelimAssignments[${div.division}] entries need letter + teamId` },
          400,
        )
      }
      if (seenLetters.has(entry.letter)) {
        return c.json(
          { error: `duplicate letter ${entry.letter} in division ${div.division}` },
          400,
        )
      }
      if (seenTeams.has(entry.teamId)) {
        return c.json(
          { error: `duplicate teamId ${entry.teamId} in division ${div.division}` },
          400,
        )
      }
      seenLetters.add(entry.letter)
      seenTeams.add(entry.teamId)
    }
  }
  const allMappings = body.prelimAssignments.flatMap((d) =>
    d.mapping.map((m) => ({ division: d.division, teamId: m.teamId })),
  )
  if (allMappings.length > 0) {
    const teamRows = await db
      .select({ id: schema.teams.id, division: schema.teams.division })
      .from(schema.teams)
      .where(
        and(
          eq(schema.teams.meetId, meetId),
          inArray(
            schema.teams.id,
            allMappings.map((m) => m.teamId),
          ),
        ),
      )
    const teamDivMap = new Map(teamRows.map((t) => [t.id, t.division]))
    for (const m of allMappings) {
      const teamDiv = teamDivMap.get(m.teamId)
      if (!teamDiv) {
        return c.json({ error: `Team ${m.teamId} is not in this meet` }, 400)
      }
      if (teamDiv !== m.division) {
        return c.json(
          { error: `Team ${m.teamId} is in division ${teamDiv}, not ${m.division}` },
          400,
        )
      }
    }
  }
  const now = new Date()
  for (const div of body.prelimAssignments) {
    await db
      .delete(schema.prelimAssignments)
      .where(
        and(
          eq(schema.prelimAssignments.meetId, meetId),
          eq(schema.prelimAssignments.division, div.division),
        ),
      )
    if (div.mapping.length > 0) {
      await db.insert(schema.prelimAssignments).values(
        div.mapping.map((m) => ({
          meetId,
          division: div.division,
          letter: m.letter,
          teamId: m.teamId,
          assignedAt: now,
        })),
      )
    }
  }

  // ---- Team lateness (per-team diff) ----
  const currentTeamMap = new Map(currentTeams.map((t) => [t.id, t]))
  for (const t of body.teamLateness) {
    if (typeof t.teamId !== 'number' || typeof t.lateness !== 'boolean') {
      return c.json({ error: 'teamLateness entries need teamId + lateness' }, 400)
    }
    const current = currentTeamMap.get(t.teamId)
    if (!current) continue
    if (current.lateness !== t.lateness) {
      await db
        .update(schema.teams)
        .set({ lateness: t.lateness })
        .where(eq(schema.teams.id, t.teamId))
    }
  }

  // ---- Build response from post-commit state ----
  const responseSlots = await db
    .select()
    .from(schema.meetSlots)
    .where(eq(schema.meetSlots.meetId, meetId))
    .orderBy(asc(schema.meetSlots.sortOrder), asc(schema.meetSlots.id))
  const responseQuizzes = await db
    .select()
    .from(schema.scheduledQuizzes)
    .where(eq(schema.scheduledQuizzes.meetId, meetId))
  const responseSeats =
    responseQuizzes.length === 0
      ? []
      : await db
          .select()
          .from(schema.scheduledQuizSeats)
          .where(
            inArray(
              schema.scheduledQuizSeats.quizId,
              responseQuizzes.map((q) => q.id),
            ),
          )
  const seatsByQuiz = new Map<number, schema.ScheduledQuizSeat[]>()
  for (const seat of responseSeats) {
    const arr = seatsByQuiz.get(seat.quizId) ?? []
    arr.push(seat)
    seatsByQuiz.set(seat.quizId, arr)
  }
  const responsePrelim = await db
    .select()
    .from(schema.prelimAssignments)
    .where(eq(schema.prelimAssignments.meetId, meetId))
    .orderBy(schema.prelimAssignments.division, schema.prelimAssignments.letter)
  const responseTeams = await db.select().from(schema.teams).where(eq(schema.teams.meetId, meetId))

  return c.json({
    slots: responseSlots,
    quizzes: responseQuizzes.map((q) => ({ ...q, seats: seatsByQuiz.get(q.id) ?? [] })),
    prelimAssignments: responsePrelim,
    teams: responseTeams,
  })
})
