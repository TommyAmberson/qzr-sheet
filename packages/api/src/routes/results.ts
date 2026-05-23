import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'
import { Value } from '@sinclair/typebox/value'
import { QuizFileSchema, type QuizFile } from '@qzr/shared'
import type { Bindings } from '../bindings'
import type { SessionVariables } from '../middleware/session'
import { requireAuthOrGuest } from '../middleware/session'
import { createDb, type Db } from '../lib/db'
import { isOfficialOf } from '../lib/permissions'
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
