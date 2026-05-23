import { Hono, type Context } from 'hono'
import { eq, and, desc } from 'drizzle-orm'
import { Value } from '@sinclair/typebox/value'
import { QuizFileSchema, type QuizFile } from '@qzr/shared'
import type { Bindings } from '../bindings'
import type { SessionVariables } from '../middleware/session'
import { requireAuthOrGuest } from '../middleware/session'
import { createDb, type Db } from '../lib/db'
import { isAdminOrSuperuser, isOfficialOf } from '../lib/permissions'
import * as schema from '../db/schema'

interface ResultsVariables extends SessionVariables {
  db: Db
}

type Env = { Bindings: Bindings; Variables: ResultsVariables }

export const results = new Hono<Env>()

// Mutation routes here admit guests with role=Official — gated via
// isOfficialOf inside the handler. Reads layer requireAuth() on top
// because admin lists do not yet expose to guests.
results.use('*', requireAuthOrGuest())
results.use('*', async (c, next) => {
  if (!c.get('db')) {
    c.set('db', createDb(c.env.DB) as unknown as Db)
  }
  await next()
})

function getDb(c: { get(key: 'db'): Db }): Db {
  return c.get('db')
}

async function requireAdmin(c: Context<Env>, meetId: number) {
  const user = c.get('user')
  if (!user) return c.json({ error: 'Sign-in required' }, 401)
  const db = getDb(c)
  if (!(await isAdminOrSuperuser(db, user.id, user.role, meetId))) {
    return c.json({ error: 'Admin or superuser access required' }, 403)
  }
  return null
}

/**
 * POST /api/meets/:id/saves
 *
 * Append a row to the in-progress save history. Both autosaves and
 * manual checkpoints flow through here; the `kind` discriminator and
 * optional `label` let admins filter the audit view.
 *
 * Body:
 *   {
 *     quizFile, kind: 'autosave' | 'checkpoint',
 *     scheduledQuizId?, roomId?, label?
 *   }
 *
 * Append-only: no UNIQUE constraint, every POST is a new row.
 * Submission/freeze lives at POST /results, not here.
 */
results.post('/:id/saves', async (c) => {
  const meetId = Number(c.req.param('id'))
  if (Number.isNaN(meetId)) return c.json({ error: 'Invalid meet ID' }, 400)

  const db = getDb(c)
  const [meet] = await db
    .select({ id: schema.quizMeets.id })
    .from(schema.quizMeets)
    .where(eq(schema.quizMeets.id, meetId))
  if (!meet) return c.json({ error: 'Meet not found' }, 404)

  if (!(await isOfficialOf(c, db, meetId))) {
    return c.json({ error: 'Official access required' }, 403)
  }

  const body = await c.req.json<{
    quizFile: unknown
    kind: 'autosave' | 'checkpoint'
    scheduledQuizId?: number | null
    roomId?: number | null
    label?: string | null
  }>()

  if (body.kind !== 'autosave' && body.kind !== 'checkpoint') {
    return c.json({ error: "kind must be 'autosave' or 'checkpoint'" }, 400)
  }
  if (!Value.Check(QuizFileSchema, body.quizFile)) {
    return c.json({ error: 'Invalid QuizFile' }, 400)
  }
  const quizFile = body.quizFile as QuizFile

  if (body.scheduledQuizId != null) {
    const [q] = await db
      .select({ id: schema.scheduledQuizzes.id })
      .from(schema.scheduledQuizzes)
      .where(
        and(
          eq(schema.scheduledQuizzes.id, body.scheduledQuizId),
          eq(schema.scheduledQuizzes.meetId, meetId),
        ),
      )
    if (!q) return c.json({ error: 'Quiz does not belong to this meet' }, 400)
  }
  if (body.roomId != null) {
    const [r] = await db
      .select({ id: schema.meetRooms.id })
      .from(schema.meetRooms)
      .where(and(eq(schema.meetRooms.id, body.roomId), eq(schema.meetRooms.meetId, meetId)))
    if (!r) return c.json({ error: 'Room does not belong to this meet' }, 400)
  }

  const user = c.get('user')
  const guest = c.get('guest')

  const [inserted] = await db
    .insert(schema.quizSaves)
    .values({
      meetId,
      scheduledQuizId: body.scheduledQuizId ?? null,
      roomId: body.roomId ?? null,
      division: quizFile.quiz.division,
      round: quizFile.quiz.quizNumber,
      savedAt: new Date(),
      kind: body.kind,
      label: body.label?.trim() ? body.label.trim() : null,
      savedByAccountId: user?.id ?? null,
      savedByGuestLabel: !user && guest ? (guest.label ?? null) : null,
      quizFile: JSON.stringify(quizFile),
    })
    .returning({ id: schema.quizSaves.id, savedAt: schema.quizSaves.savedAt })

  return c.json({ id: inserted!.id, savedAt: inserted!.savedAt }, 201)
})

/**
 * GET /api/meets/:id/saves
 *
 * Admin/superuser list. Returns metadata only (no quizFile blob) so
 * scrubbing the history doesn't blow up the response. Optional query
 * filters: ?scheduledQuizId=N, ?division=1, ?round=A. Newest first.
 */
results.get('/:id/saves', async (c) => {
  const meetId = Number(c.req.param('id'))
  if (Number.isNaN(meetId)) return c.json({ error: 'Invalid meet ID' }, 400)

  const denied = await requireAdmin(c, meetId)
  if (denied) return denied

  const filters = [eq(schema.quizSaves.meetId, meetId)]
  const qid = c.req.query('scheduledQuizId')
  if (qid && !Number.isNaN(Number(qid))) {
    filters.push(eq(schema.quizSaves.scheduledQuizId, Number(qid)))
  }
  const div = c.req.query('division')
  if (div) filters.push(eq(schema.quizSaves.division, div))
  const round = c.req.query('round')
  if (round) filters.push(eq(schema.quizSaves.round, round))

  const db = getDb(c)
  const rows = await db
    .select({
      id: schema.quizSaves.id,
      scheduledQuizId: schema.quizSaves.scheduledQuizId,
      roomId: schema.quizSaves.roomId,
      division: schema.quizSaves.division,
      round: schema.quizSaves.round,
      savedAt: schema.quizSaves.savedAt,
      kind: schema.quizSaves.kind,
      label: schema.quizSaves.label,
      savedByAccountId: schema.quizSaves.savedByAccountId,
      savedByGuestLabel: schema.quizSaves.savedByGuestLabel,
    })
    .from(schema.quizSaves)
    .where(and(...filters))
    .orderBy(desc(schema.quizSaves.savedAt), desc(schema.quizSaves.id))

  return c.json({ saves: rows })
})

/**
 * GET /api/meets/:id/saves/:saveId
 *
 * Admin detail with the QuizFile blob parsed back into the response.
 */
results.get('/:id/saves/:saveId', async (c) => {
  const meetId = Number(c.req.param('id'))
  const saveId = Number(c.req.param('saveId'))
  if (Number.isNaN(meetId) || Number.isNaN(saveId)) {
    return c.json({ error: 'Invalid ID' }, 400)
  }

  const denied = await requireAdmin(c, meetId)
  if (denied) return denied

  const db = getDb(c)
  const [row] = await db
    .select()
    .from(schema.quizSaves)
    .where(and(eq(schema.quizSaves.id, saveId), eq(schema.quizSaves.meetId, meetId)))
  if (!row) return c.json({ error: 'Save not found' }, 404)

  return c.json({ save: { ...row, quizFile: JSON.parse(row.quizFile) as QuizFile } })
})

/**
 * POST /api/meets/:id/results
 *
 * Mark this room's quiz "done" by freezing the current QuizFile as the
 * official record. Distinct from /saves — Submit is a status flip, not
 * a data event. Subsequent /saves rows still flow (audit), but
 * quiz_results stays frozen at submit-time.
 *
 * Body: { quizFile, quizId?, roomId? }
 *
 * UNIQUE(meetId, quizId) — SQLite NULL≠NULL lets orphans coexist; a
 * second submit of the same scheduled quiz returns 409.
 */
results.post('/:id/results', async (c) => {
  const meetId = Number(c.req.param('id'))
  if (Number.isNaN(meetId)) return c.json({ error: 'Invalid meet ID' }, 400)

  const db = getDb(c)
  const [meet] = await db
    .select({ id: schema.quizMeets.id })
    .from(schema.quizMeets)
    .where(eq(schema.quizMeets.id, meetId))
  if (!meet) return c.json({ error: 'Meet not found' }, 404)

  if (!(await isOfficialOf(c, db, meetId))) {
    return c.json({ error: 'Official access required' }, 403)
  }

  const body = await c.req.json<{
    quizFile: unknown
    quizId?: number | null
    roomId?: number | null
  }>()

  if (!Value.Check(QuizFileSchema, body.quizFile)) {
    return c.json({ error: 'Invalid QuizFile' }, 400)
  }
  const quizFile = body.quizFile as QuizFile

  if (body.quizId != null) {
    const [q] = await db
      .select({ id: schema.scheduledQuizzes.id })
      .from(schema.scheduledQuizzes)
      .where(
        and(
          eq(schema.scheduledQuizzes.id, body.quizId),
          eq(schema.scheduledQuizzes.meetId, meetId),
        ),
      )
    if (!q) return c.json({ error: 'Quiz does not belong to this meet' }, 400)
  }
  if (body.roomId != null) {
    const [r] = await db
      .select({ id: schema.meetRooms.id })
      .from(schema.meetRooms)
      .where(and(eq(schema.meetRooms.id, body.roomId), eq(schema.meetRooms.meetId, meetId)))
    if (!r) return c.json({ error: 'Room does not belong to this meet' }, 400)
  }

  const user = c.get('user')
  const guest = c.get('guest')

  try {
    const [inserted] = await db
      .insert(schema.quizResults)
      .values({
        meetId,
        quizId: body.quizId ?? null,
        roomId: body.roomId ?? null,
        division: quizFile.quiz.division,
        round: quizFile.quiz.quizNumber,
        submittedAt: new Date(),
        submittedByAccountId: user?.id ?? null,
        submittedByGuestLabel: !user && guest ? (guest.label ?? null) : null,
        quizFile: JSON.stringify(quizFile),
      })
      .returning({
        id: schema.quizResults.id,
        submittedAt: schema.quizResults.submittedAt,
      })
    return c.json({ id: inserted!.id, submittedAt: inserted!.submittedAt }, 201)
  } catch (e) {
    if (e instanceof Error && /UNIQUE.*quiz_results/.test(e.message)) {
      return c.json({ error: 'A result already exists for this scheduled quiz' }, 409)
    }
    throw e
  }
})
