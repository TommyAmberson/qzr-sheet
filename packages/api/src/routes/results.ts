import { Hono, type Context } from 'hono'
import { eq, and, desc, inArray, sql } from 'drizzle-orm'
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

/**
 * GET /api/meets/:id/results
 *
 * Admin/superuser list of submitted results for a meet, newest first.
 * Includes an `openDisputes` count per row so the future admin UI can
 * surface the badge without a second round-trip.
 */
results.get('/:id/results', async (c) => {
  const meetId = Number(c.req.param('id'))
  if (Number.isNaN(meetId)) return c.json({ error: 'Invalid meet ID' }, 400)

  const denied = await requireAdmin(c, meetId)
  if (denied) return denied

  const db = getDb(c)
  const rows = await db
    .select({
      id: schema.quizResults.id,
      meetId: schema.quizResults.meetId,
      quizId: schema.quizResults.quizId,
      roomId: schema.quizResults.roomId,
      division: schema.quizResults.division,
      round: schema.quizResults.round,
      submittedAt: schema.quizResults.submittedAt,
      submittedByAccountId: schema.quizResults.submittedByAccountId,
      submittedByGuestLabel: schema.quizResults.submittedByGuestLabel,
    })
    .from(schema.quizResults)
    .where(eq(schema.quizResults.meetId, meetId))
    .orderBy(desc(schema.quizResults.submittedAt), desc(schema.quizResults.id))

  // Open-dispute counts as a separate query — cheaper than a left-join
  // aggregate and the admin list will be small.
  const resultIds = rows.map((r) => r.id)
  const disputeRows =
    resultIds.length === 0
      ? []
      : await db
          .select({
            resultId: schema.quizDisputes.resultId,
            open: sql<number>`SUM(CASE WHEN ${schema.quizDisputes.resolved} = 0 THEN 1 ELSE 0 END)`,
          })
          .from(schema.quizDisputes)
          .where(inArray(schema.quizDisputes.resultId, resultIds))
          .groupBy(schema.quizDisputes.resultId)
  const openByResult = new Map(disputeRows.map((d) => [d.resultId, Number(d.open)]))

  return c.json({
    results: rows.map((r) => ({ ...r, openDisputes: openByResult.get(r.id) ?? 0 })),
  })
})

/**
 * GET /api/meets/:id/results/:resultId
 *
 * Returns one result with the full QuizFile parsed back out of storage
 * for admins to inspect.
 */
results.get('/:id/results/:resultId', async (c) => {
  const meetId = Number(c.req.param('id'))
  const resultId = Number(c.req.param('resultId'))
  if (Number.isNaN(meetId) || Number.isNaN(resultId)) {
    return c.json({ error: 'Invalid ID' }, 400)
  }

  const denied = await requireAdmin(c, meetId)
  if (denied) return denied

  const db = getDb(c)
  const [row] = await db
    .select()
    .from(schema.quizResults)
    .where(and(eq(schema.quizResults.id, resultId), eq(schema.quizResults.meetId, meetId)))
  if (!row) return c.json({ error: 'Result not found' }, 404)

  return c.json({ result: { ...row, quizFile: JSON.parse(row.quizFile) as QuizFile } })
})
