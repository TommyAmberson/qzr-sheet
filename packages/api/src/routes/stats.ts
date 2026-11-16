import { Hono, type Context } from 'hono'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import {
  divisionStats,
  foldName,
  resultKeyDivision,
  type DivisionStateValue,
  type ScoredQuiz,
  type StatsQuiz,
} from '@qzr/shared'
import type { Bindings } from '../bindings'
import type { SessionVariables } from '../middleware/session'
import { requireAuthOrGuest } from '../middleware/session'
import { createDb, type Db } from '../lib/db'
import { isAdminOrSuperuser } from '../lib/permissions'
import { hasLaterStages, meetFacts, quizFacts } from '../lib/quizFacts'
import { meetIdOf } from '../lib/request'
import { isCounted, latestRevision } from '../lib/resultsSql'
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
const content = alias(schema.quizResultRevisions, 'content')

/**
 * A division's stored quizzes, each with its current content's revision and that revision's score.
 * `foldedDivision` is the division as a result key folds it.
 */
function storedQuizzes(db: Db, meetId: number, foldedDivision: string) {
  // A result key starts with its division and a bar
  const prefix = `${foldedDivision}|`
  return (
    db
      .select({
        id: schema.quizResults.id,
        quizKey: schema.quizResults.quizKey,
        counted: isCounted,
        revisionId: content.id,
        contentRevision: content.revision,
        sharedVersion: schema.quizResultScores.sharedVersion,
        scored: schema.quizResultScores.scored,
      })
      .from(schema.quizResults)
      .innerJoin(
        current,
        and(eq(current.resultId, schema.quizResults.id), eq(current.revision, latestRevision)),
      )
      // A restoring revision shows the content of the revision it restores, which is the one scored
      .innerJoin(
        content,
        and(
          eq(content.resultId, schema.quizResults.id),
          eq(content.revision, sql`COALESCE(${current.restoredFrom}, ${current.revision})`),
        ),
      )
      .leftJoin(schema.quizResultScores, eq(schema.quizResultScores.revisionId, content.id))
      .where(
        and(
          eq(schema.quizResults.meetId, meetId),
          sql`substr(${schema.quizResults.quizKey}, 1, ${prefix.length}) = ${prefix}`,
        ),
      )
  )
}

function meetQuery(db: Db, meetId: number) {
  return db
    .select({ phase: schema.quizMeets.phase, divisions: schema.quizMeets.divisions })
    .from(schema.quizMeets)
    .where(eq(schema.quizMeets.id, meetId))
}

function divisionStatesQuery(db: Db, meetId: number) {
  return db
    .select({ division: schema.divisionStates.division, state: schema.divisionStates.state })
    .from(schema.divisionStates)
    .where(eq(schema.divisionStates.meetId, meetId))
}

type StateRows = Awaited<ReturnType<typeof divisionStatesQuery>>

/** A division's state by its folded name; one the admin has not moved is running its prelims */
function stateOf(rows: StateRows, division: string): DivisionStateValue {
  const folded = foldName(division)
  return rows.find((row) => foldName(row.division) === folded)?.state ?? 'prelim_running'
}

/**
 * The meet in the path and the database, for a caller who is one of its admins; otherwise the
 * response refusing them. Stats are for admins until the meet's settings give them to viewers.
 */
async function forAdmin(c: Context<Env>): Promise<{ meetId: number; db: Db } | Response> {
  const meetId = meetIdOf(c)
  if (meetId === null) return c.json({ error: 'Meet not found' }, 404)
  const db = c.get('db')
  const user = c.get('user')
  if (!user || !(await isAdminOrSuperuser(db, user.id, user.role, meetId))) {
    return c.json({ error: 'Admin access required' }, 403)
  }
  return { meetId, db }
}

stats.get('/:id/stats', async (c) => {
  const admin = await forAdmin(c)
  if (admin instanceof Response) return admin
  const { meetId, db } = admin
  const [meets, states, keys] = await Promise.all([
    meetQuery(db, meetId),
    divisionStatesQuery(db, meetId),
    db
      .select({ quizKey: schema.quizResults.quizKey })
      .from(schema.quizResults)
      .where(eq(schema.quizResults.meetId, meetId)),
  ])
  const meet = meets[0]
  if (!meet) return c.json({ error: 'Meet not found' }, 404)

  // The meet's divisions in its order, then any that only stored quizzes name
  const divisions = JSON.parse(meet.divisions) as string[]
  const listed = new Set(divisions.map(foldName))
  const unlisted = [...new Set(keys.map(({ quizKey }) => resultKeyDivision(quizKey)))]
    .filter((division) => !listed.has(division))
    .sort()
  return c.json({
    phase: meet.phase,
    divisions: [...divisions, ...unlisted].map((division) => ({
      division,
      state: stateOf(states, division),
    })),
  })
})

stats.get('/:id/stats/:division', async (c) => {
  const admin = await forAdmin(c)
  if (admin instanceof Response) return admin
  const { meetId, db } = admin
  const folded = foldName(c.req.param('division'))
  // Not one batch: D1 gives a batched select's rows by column name, and the joined revisions
  // share theirs, so the quizzes' rows would come back with one revision's columns as another's
  const [meets, quizzes, states, facts] = await Promise.all([
    meetQuery(db, meetId),
    storedQuizzes(db, meetId, folded),
    divisionStatesQuery(db, meetId),
    meetFacts(db, meetId),
  ])
  const meet = meets[0]
  if (!meet) return c.json({ error: 'Meet not found' }, 404)
  const division = (JSON.parse(meet.divisions) as string[]).find(
    (name) => foldName(name) === folded,
  )
  if (division === undefined && quizzes.length === 0) {
    return c.json({ error: 'Division not found' }, 404)
  }

  const unscored = quizzes
    .filter((quiz) => quiz.scored === null || quiz.sharedVersion !== SHARED_VERSION)
    .map((quiz) => quiz.revisionId)
  const rescored = new Map<number, ScoredQuiz>()
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
    if (unscored.length > scored.size) {
      c.header('Retry-After', '1')
      return c.json({ error: 'Stats are being prepared' }, 503)
    }
    for (const [revisionId, score] of scored) rescored.set(revisionId, score)
  }

  return c.json(
    divisionStats({
      division: division ?? folded,
      state: stateOf(states, folded),
      phase: meet.phase,
      quizzes: quizzes.map((quiz): StatsQuiz => {
        // Kept scores are read only now, once it is known the stats can be answered
        const scored = rescored.get(quiz.revisionId) ?? (JSON.parse(quiz.scored!) as ScoredQuiz)
        const held = quizFacts(facts, quiz)
        return {
          id: quiz.id,
          name: scored.name,
          key: quiz.quizKey,
          stage: held.stage,
          scored,
          linked: held.linked,
          line: held.line,
          accepted: held.accepted,
        }
      }),
      // Every quiz of the division is held against the same teams
      roster: quizzes[0] ? quizFacts(facts, quizzes[0]).roster : null,
      laterStagesScheduled: hasLaterStages(facts, folded),
    }),
  )
})
