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

// Mutation routes here admit guests with role=Official — see isOfficialOf
// below. Read routes layer requireAuth() on top because admin lists do
// not yet expose to guests.
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
 * POST /api/meets/:id/results
 *
 * Submit a completed scoresheet. Body: `{ quizFile, quizId?, roomId? }`.
 * The QuizFile JSON is stored verbatim; (meetId, quizId) is unique when
 * quizId is set, returning 409 on a second scheduled submission of the
 * same quiz. Orphaned submissions (no quizId, no roomId) coexist
 * freely — admins reconcile them post-hoc.
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
      .returning({ id: schema.quizResults.id, submittedAt: schema.quizResults.submittedAt })
    return c.json({ id: inserted!.id, submittedAt: inserted!.submittedAt }, 201)
  } catch (e) {
    if (e instanceof Error && /UNIQUE.*quiz_results/.test(e.message)) {
      return c.json({ error: 'A result already exists for this scheduled quiz' }, 409)
    }
    throw e
  }
})
