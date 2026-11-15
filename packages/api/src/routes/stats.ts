import { Hono } from 'hono'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import {
  divisionStats,
  foldName,
  type DivisionStateValue,
  type ScoredQuiz,
  type StatsQuiz,
} from '@qzr/shared'
import type { Bindings } from '../bindings'
import type { SessionVariables } from '../middleware/session'
import { requireAuthOrGuest } from '../middleware/session'
import { createDb, type Db } from '../lib/db'
import { isAdminOrSuperuser } from '../lib/permissions'
import { meetIdOf } from '../lib/request'
import { SHARED_VERSION, keepScores } from '../lib/scores'
import * as schema from '../db/schema'

type Env = { Bindings: Bindings; Variables: SessionVariables & { db: Db } }

/**
 * A meet's stats, computed from its stored quizzes as scored when they were saved. Its own router,
 * mounted where guest tokens reach it, since viewers read stats. Its middleware is scoped to its
 * own paths, so it never answers for routes mounted after it.
 */
export const stats = new Hono<Env>()

for (const path of ['/:id/stats', '/:id/stats/*']) {
  stats.use(path, requireAuthOrGuest())
  stats.use(path, async (c, next) => {
    if (!c.get('db')) c.set('db', createDb(c.env.DB) as unknown as Db)
    await next()
  })
}

/**
 * How many revisions one request scores when their kept scores are missing or were made by another
 * shared version. Scoring is the costly part of a request, and the Workers free plan allows 10 ms
 * of CPU, so a request scores a few and asks the caller to come back for the rest.
 */
const REVISIONS_SCORED_PER_REQUEST = 5

const current = alias(schema.quizResultRevisions, 'current')

/** The meet's stored quizzes, each with its current content's revision and that revision's score */
function storedQuizzes(db: Db, meetId: number) {
  // A restoring revision shows the content of the revision it restores, which is the one scored
  const contentRevision = sql<number>`COALESCE(${current.restoredFrom}, ${current.revision})`
  const content = alias(schema.quizResultRevisions, 'content')
  return db
    .select({
      id: schema.quizResults.id,
      quizKey: schema.quizResults.quizKey,
      counted: sql`COALESCE((
        SELECT newest.counted FROM quiz_result_count_changes newest
        WHERE newest.result_id = ${schema.quizResults.id}
        ORDER BY newest.id DESC LIMIT 1
      ), 0)`.mapWith(Boolean),
      revisionId: content.id,
      sharedVersion: schema.quizResultScores.sharedVersion,
      scored: schema.quizResultScores.scored,
    })
    .from(schema.quizResults)
    .innerJoin(
      current,
      and(
        eq(current.resultId, schema.quizResults.id),
        eq(
          current.revision,
          sql`(SELECT MAX(latest.revision) FROM quiz_result_revisions latest
               WHERE latest.result_id = ${schema.quizResults.id})`,
        ),
      ),
    )
    .innerJoin(
      content,
      and(eq(content.resultId, schema.quizResults.id), eq(content.revision, contentRevision)),
    )
    .leftJoin(schema.quizResultScores, eq(schema.quizResultScores.revisionId, content.id))
    .where(eq(schema.quizResults.meetId, meetId))
}

/** The division a stored quiz's key names, folded as the key folds it */
function divisionOfKey(quizKey: string): string {
  return quizKey.split('|')[0]!
}

async function meetOf(db: Db, meetId: number) {
  const [meet] = await db
    .select({ phase: schema.quizMeets.phase, divisions: schema.quizMeets.divisions })
    .from(schema.quizMeets)
    .where(eq(schema.quizMeets.id, meetId))
  return meet && { phase: meet.phase, divisions: JSON.parse(meet.divisions) as string[] }
}

async function divisionStatesOf(db: Db, meetId: number): Promise<Map<string, DivisionStateValue>> {
  const rows = await db
    .select({ division: schema.divisionStates.division, state: schema.divisionStates.state })
    .from(schema.divisionStates)
    .where(eq(schema.divisionStates.meetId, meetId))
  return new Map(rows.map((row) => [foldName(row.division), row.state]))
}

stats.get('/:id/stats', async (c) => {
  const meetId = meetIdOf(c)
  if (meetId === null) return c.json({ error: 'Meet not found' }, 404)
  const db = c.get('db')
  const user = c.get('user')
  if (!user || !(await isAdminOrSuperuser(db, user.id, user.role, meetId))) {
    return c.json({ error: 'Admin access required' }, 403)
  }
  const meet = await meetOf(db, meetId)
  if (!meet) return c.json({ error: 'Meet not found' }, 404)

  const states = await divisionStatesOf(db, meetId)
  const keys = await db
    .select({ quizKey: schema.quizResults.quizKey })
    .from(schema.quizResults)
    .where(eq(schema.quizResults.meetId, meetId))
  // The meet's divisions in its order, then any that only stored quizzes name
  const listed = new Set(meet.divisions.map(foldName))
  const unlisted = [...new Set(keys.map(({ quizKey }) => divisionOfKey(quizKey)))]
    .filter((division) => !listed.has(division))
    .sort()
  return c.json({
    phase: meet.phase,
    divisions: [...meet.divisions, ...unlisted].map((division) => ({
      division,
      state: states.get(foldName(division)) ?? 'prelim_running',
    })),
  })
})

stats.get('/:id/stats/:division', async (c) => {
  const meetId = meetIdOf(c)
  if (meetId === null) return c.json({ error: 'Meet not found' }, 404)
  const db = c.get('db')
  const user = c.get('user')
  if (!user || !(await isAdminOrSuperuser(db, user.id, user.role, meetId))) {
    return c.json({ error: 'Admin access required' }, 403)
  }
  const meet = await meetOf(db, meetId)
  if (!meet) return c.json({ error: 'Meet not found' }, 404)

  const folded = foldName(c.req.param('division'))
  const division = meet.divisions.find((name) => foldName(name) === folded)
  const quizzes = (await storedQuizzes(db, meetId)).filter(
    ({ quizKey }) => divisionOfKey(quizKey) === folded,
  )
  if (division === undefined && quizzes.length === 0) {
    return c.json({ error: 'Division not found' }, 404)
  }

  const scores = new Map<number, ScoredQuiz>()
  const unscored: number[] = []
  for (const quiz of quizzes) {
    if (quiz.scored !== null && quiz.sharedVersion === SHARED_VERSION) {
      scores.set(quiz.revisionId, JSON.parse(quiz.scored) as ScoredQuiz)
    } else {
      unscored.push(quiz.revisionId)
    }
  }
  if (unscored.length > 0) {
    const files = await db
      .select({
        id: schema.quizResultRevisions.id,
        quizFile: schema.quizResultRevisions.quizFile,
      })
      .from(schema.quizResultRevisions)
      .where(
        inArray(schema.quizResultRevisions.id, unscored.slice(0, REVISIONS_SCORED_PER_REQUEST)),
      )
    const scored = await keepScores(
      db,
      files.flatMap(({ id, quizFile }) => (quizFile === null ? [] : [{ id, quizFile }])),
    )
    for (const [revisionId, score] of scored) scores.set(revisionId, score)
    if (unscored.length > scored.size) {
      c.header('Retry-After', '1')
      return c.json({ error: 'Stats are being prepared' }, 503)
    }
  }

  const states = await divisionStatesOf(db, meetId)
  return c.json(
    divisionStats({
      division: division ?? folded,
      state: states.get(folded) ?? 'prelim_running',
      phase: meet.phase,
      quizzes: quizzes.map((quiz): StatsQuiz => {
        const scored = scores.get(quiz.revisionId)!
        // Until a quiz has a stage of its own, one that counts is a prelim (research R3)
        return { id: quiz.id, name: scored.name, stage: quiz.counted ? 'prelim' : null, scored }
      }),
    }),
  )
})
