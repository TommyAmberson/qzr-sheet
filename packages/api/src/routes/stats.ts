import { Hono, type Context } from 'hono'
import { and, eq, inArray } from 'drizzle-orm'
import {
  attentionOf,
  mayChangeQuizzes,
  divisionStats,
  foldName,
  nameDismissal,
  resultKeyDivision,
  resultKeyName,
  statsSettingsError,
  viewerHas,
  viewersSeeStats,
  type AttentionItem,
  type DivisionStats,
  type QuizResult,
  type StageResults,
  type StatsSettings,
  type TeamRow,
  type TeamTable,
  type ViewerHas,
} from '@qzr/shared'
import type { Bindings } from '../bindings'
import type { SessionVariables } from '../middleware/session'
import { requireAuthOrGuest } from '../middleware/session'
import { createDb, type Db } from '../lib/db'
import {
  REVISIONS_SCORED_PER_REQUEST,
  divisionOf,
  divisionStatesQuery,
  meetQuery,
  stateOf,
  statsGround,
} from '../lib/divisionStats'
import { isAdminOrSuperuser, isViewerOf, officialRoomsOf } from '../lib/permissions'
import { jsonBody, meetIdOf } from '../lib/request'
import { otherFormulaCount, otherFormulaKeys, statsSettingsOf } from '../lib/statsSettings'
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
 * The meet in the path and the database, for a caller who is one of its admins; otherwise the
 * response refusing them. Only admins change the stats settings.
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

/**
 * The meet in the path and the database, for a caller who may read its stats, with whether they
 * are one of its admins; otherwise the response refusing them
 */
async function forMember(
  c: Context<Env>,
): Promise<{ meetId: number; db: Db; admin: boolean } | Response> {
  const meetId = meetIdOf(c)
  if (meetId === null) return c.json({ error: 'Meet not found' }, 404)
  const db = c.get('db')
  if (!(await isViewerOf(c, db, meetId))) return c.json({ error: 'Not a member of this meet' }, 403)
  const user = c.get('user')
  const admin = !!user && (await isAdminOrSuperuser(db, user.id, user.role, meetId))
  return { meetId, db, admin }
}

// The settings' paths are matched before a division's, which would take `settings` for its name
stats.get('/:id/stats/settings', async (c) => {
  const member = await forMember(c)
  if (member instanceof Response) return member
  const { meetId, db, admin } = member
  const { settings, changed } = await statsSettingsOf(db, meetId)
  if (!admin) return c.json({ settings })
  // Admins are told how many stored quizzes are scored another way, which the page offers to fix
  const otherFormula = await otherFormulaCount(db, meetId, settings.levelTeams)
  return c.json({ settings, ...(changed ? { changed } : {}), otherFormula })
})

stats.put('/:id/stats/settings', async (c) => {
  const admin = await forAdmin(c)
  if (admin instanceof Response) return admin
  const { meetId, db } = admin
  const [meet] = await meetQuery(db, meetId)
  if (!meet) return c.json({ error: 'Meet not found' }, 404)
  // A done meet's stats stand as they were given out, until it is moved back to review
  if (meet.phase === 'done') {
    return c.json({ error: 'The meet is done', meetPhase: meet.phase }, 409)
  }
  const body = await jsonBody<{ settings?: unknown }>(c)
  const error = statsSettingsError(body?.settings)
  if (error !== null) return c.json({ error }, 400)
  const user = c.get('user')!
  const settings = body!.settings as StatsSettings
  const savedAt = new Date()
  await db.insert(schema.meetStatsSettings).values({
    meetId,
    settings: JSON.stringify(settings),
    savedByAccountId: user.id,
    savedByName: user.name,
    savedAt,
  })
  return c.json({
    settings,
    changed: { by: user.name, at: savedAt.toISOString() },
    otherFormula: await otherFormulaCount(db, meetId, settings.levelTeams),
  })
})

stats.get('/:id/stats', async (c) => {
  const member = await forMember(c)
  if (member instanceof Response) return member
  const { meetId, db, admin } = member
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
  if (!admin && !viewersSeeStats(meet.phase)) {
    return c.json({ phase: meet.phase, admin, divisions: [] })
  }

  // The meet's divisions in its order, then any that only stored quizzes name. A quiz with no
  // division is in none, so it has no page of its own
  const divisions = JSON.parse(meet.divisions) as string[]
  const listed = new Set(divisions.map(foldName))
  const unlisted = [...new Set(keys.map(({ quizKey }) => resultKeyDivision(quizKey)))]
    .filter((division) => division !== '' && !listed.has(division))
    .sort()
  return c.json({
    phase: meet.phase,
    admin,
    divisions: [...divisions, ...unlisted].map((division) => ({
      division,
      state: stateOf(states, division),
    })),
  })
})

// What needs attention across the meet (FR-030), before a division's path, which would take its name
stats.get('/:id/stats/attention', async (c) => {
  const admin = await forAdmin(c)
  if (admin instanceof Response) return admin
  const { meetId, db } = admin
  const [ground, keys] = await Promise.all([
    statsGround(db, meetId),
    db
      .select({ quizKey: schema.quizResults.quizKey })
      .from(schema.quizResults)
      .where(eq(schema.quizResults.meetId, meetId)),
  ])
  if (!ground) return c.json({ error: 'Meet not found' }, 404)

  // Every division the meet lists or a stored quiz names, and quizzes in none, which have no
  // standings but can still be unstaged
  const listed = new Set(ground.meet.divisions.map(foldName))
  const divisions = [
    ...ground.meet.divisions,
    ...new Set(keys.map(({ quizKey }) => resultKeyDivision(quizKey)).filter((d) => !listed.has(d))),
  ]
  const items: AttentionItem[] = []
  // The whole request shares one scoring budget, as the divisions' states do
  const scoring = { left: REVISIONS_SCORED_PER_REQUEST }
  for (const division of divisions) {
    const answer = await divisionOf(db, meetId, ground, division, undefined, scoring)
    if (answer.kind === 'notFound') continue
    if (answer.kind === 'preparing') {
      c.header('Retry-After', '1')
      return c.json({ error: 'Stats are being prepared' }, 503)
    }
    // A quiz an admin set not to count has no stage by their choice, which needs nothing
    for (const quiz of answer.quizzes) {
      if (quiz.stage === null && !quiz.admin) {
        items.push({ kind: 'noStage', quiz: { id: quiz.id, name: quiz.name } })
      }
    }
    if (division !== '') items.push(...attentionOf(divisionStats(answer.input)))
  }
  const other = await otherFormulaKeys(db, meetId, ground.settings.levelTeams)
  if (other.length > 0) {
    items.push({
      kind: 'otherFormula',
      quizzes: other.map(({ id, quizKey }) => ({ id, name: resultKeyName(quizKey) })),
    })
  }
  return c.json({ items })
})

// Two names an admin says are different, so their look-alike flag is not raised again (FR-032)
stats.post('/:id/stats/dismissals', async (c) => {
  const admin = await forAdmin(c)
  if (admin instanceof Response) return admin
  const { meetId, db } = admin
  const body = await jsonBody<{ division?: unknown; team?: unknown; names?: unknown }>(c)
  const { division, team, names } = body ?? {}
  const isName = (value: unknown): value is string => typeof value === 'string' && value !== ''
  if (
    typeof division !== 'string' ||
    (team !== undefined && !isName(team)) ||
    !Array.isArray(names) ||
    names.length !== 2 ||
    !names.every(isName)
  ) {
    return c.json({ error: 'A division, two names, and a team for two quizzers' }, 400)
  }
  const pair = nameDismissal(team ?? null, names as [string, string])
  if (pair.names[0] === pair.names[1]) return c.json({ error: 'The two names are the same' }, 400)
  // Names change with the quizzes, so only while an admin may change those
  const [meet] = await meetQuery(db, meetId)
  if (!meet) return c.json({ error: 'Meet not found' }, 404)
  if (!mayChangeQuizzes(meet.phase, true)) {
    return c.json({ error: 'Quizzes cannot change now', meetPhase: meet.phase }, 409)
  }
  const user = c.get('user')!
  await db
    .insert(schema.meetNameDismissals)
    .values({
      meetId,
      division: foldName(division),
      team: pair.team,
      nameA: pair.names[0],
      nameB: pair.names[1],
      byAccountId: user.id,
      byName: user.name,
      at: new Date(),
    })
    .onConflictDoNothing()
  return c.json({ ok: true })
})

stats.get('/:id/stats/:division', async (c) => {
  const member = await forMember(c)
  if (member instanceof Response) return member
  const { meetId, db } = member
  // An admin may look at the page as its viewers see it
  const admin = member.admin && c.req.query('as') !== 'viewer'
  const [ground, own] = await Promise.all([
    statsGround(db, meetId),
    admin ? new Set<number>() : ownQuizzes(c, db, meetId),
  ])
  if (!ground) return c.json({ error: 'Meet not found' }, 404)
  const asked = c.req.param('division')
  const state = stateOf(ground.states, asked)
  const has = viewerHas(ground.settings, state, ground.meet.phase)
  // Quizzer standings by stage are worked out over the quizzes up to the last step confirmed
  const through = admin ? undefined : has.quizzers?.through
  const answer = await divisionOf(db, meetId, ground, asked, through)
  if (answer.kind === 'notFound') return c.json({ error: 'Division not found' }, 404)
  if (answer.kind === 'preparing') {
    c.header('Retry-After', '1')
    return c.json({ error: 'Stats are being prepared' }, 503)
  }
  const stats = divisionStats(answer.input)
  return c.json(admin ? stats : cutTo(stats, has, own))
})

/** The stored quizzes of the meet saved from a room the caller officiates */
async function ownQuizzes(c: Context<Env>, db: Db, meetId: number): Promise<Set<number>> {
  const rooms = await officialRoomsOf(c, db, meetId)
  if (rooms.length === 0) return new Set()
  const rows = await db
    .selectDistinct({ id: schema.quizResultRevisions.resultId })
    .from(schema.quizResultRevisions)
    .innerJoin(schema.quizResults, eq(schema.quizResults.id, schema.quizResultRevisions.resultId))
    .where(
      and(
        eq(schema.quizResults.meetId, meetId),
        inArray(schema.quizResultRevisions.savedByRoomId, rooms),
      ),
    )
  return new Set(rows.map((row) => row.id))
}

/**
 * A division's stats cut to what a viewer, coach or official has of them (FR-018 to FR-021),
 * before the response is built, so nothing reaches them early by any route (SC-005). Each object
 * is rebuilt from the fields a viewer may have, so a field added for admins stays with them: each
 * table only from its moment, results at the level the settings give, and no warnings or flags.
 * An official keeps what is wrong with the quizzes of their own rooms (FR-020a). The quizzes behind
 * each total go as far as each quiz's stage shows (FR-027).
 */
function cutTo(stats: DivisionStats, has: ViewerHas, own: Set<number>): DivisionStats {
  const results = stats.results.flatMap((stage): StageResults[] => {
    const level = has.results[stage.stage]
    if (!level) return []
    const quizzes = stage.quizzes.map(
      (quiz): QuizResult => ({
        name: quiz.name,
        status: quiz.status,
        teams: quiz.teams.map(({ name, place, tiedWith, score }) => ({
          name,
          place,
          tiedWith,
          score: level === 'scores' ? score : undefined,
        })),
        ...(quiz.id !== undefined && own.has(quiz.id)
          ? {
              id: quiz.id,
              problems: quiz.problems,
              withdrawnOrder: quiz.withdrawnOrder,
              incompleteTypes: quiz.incompleteTypes,
            }
          : {}),
      }),
    )
    return [{ stage: stage.stage, level, quizzes, medals: stage.medals }]
  })
  // The quizzes behind a total are shown as far as their stage's results are: a team's place in
  // each wherever the stage shows, its score and errors and a quizzer's points only where it shows
  // the full sheet
  const stageOf = new Map(
    stats.results.flatMap((stage) => stage.quizzes.map((quiz) => [quiz.name, stage.stage])),
  )
  const scoresShown = (quiz: string) => {
    const stage = stageOf.get(quiz)
    return stage !== undefined && has.results[stage] === 'scores'
  }
  const teamLines = (lines: TeamRow['lines']): TeamRow['lines'] =>
    lines.flatMap(({ quiz, stage, place, placementPoints, score, errors }) => {
      const level = has.results[stage]
      if (!level) return []
      const sheet = level === 'scores' ? { score, errors } : {}
      return [{ quiz, stage, place, placementPoints, ...sheet }]
    })
  const table = (shown: TeamTable | undefined, state: ViewerHas['prelimStandings']) =>
    shown && state
      ? {
          // An order no admin confirmed, as for a division moved on before confirmations were
          // kept, is the current one, so it is no more than a live preview whatever the moment
          state: shown.state === 'lockedIn' ? state : ('livePreview' as const),
          covers: shown.covers,
          teams: shown.teams.map(
            ({
              name,
              rank,
              placementPoints,
              quizzes,
              tied,
              decidedBy,
              finalist,
              lines,
            }): TeamRow => ({
              ...{ name, rank, placementPoints, quizzes, tied, decidedBy, finalist },
              lines: teamLines(lines),
            }),
          ),
        }
      : undefined
  const quizzers =
    stats.quizzers && has.quizzers
      ? {
          state: has.quizzers.state,
          through: stats.quizzers.through,
          lists: stats.quizzers.lists.map((list) => ({
            consolation: list.consolation,
            quizzers: list.quizzers.map(
              ({ name, team, place, average, points, errors, jumps, quizzes, types, lines }) => ({
                ...{ name, team, place, average, points, errors, jumps, quizzes, types },
                flags: [],
                lines: lines
                  .filter((line) => scoresShown(line.quiz))
                  .map(({ quiz, points, errors, jumps, types }) => ({
                    ...{ quiz, points, errors, jumps, types },
                  })),
              }),
            ),
          })),
        }
      : undefined
  return {
    division: stats.division,
    state: stats.state,
    phase: stats.phase,
    results,
    prelimStandings: table(stats.prelimStandings, has.prelimStandings),
    rerank: table(stats.rerank, has.rerank),
    quizzers,
  }
}
