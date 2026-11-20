import { Hono, type Context } from 'hono'
import {
  dayQuizStatus,
  divisionStats,
  scheduledStage,
  benchKey,
  benchShown,
  tidyName,
  viewerHas,
  type DayResult,
  type DayStatus,
  type DivisionStats,
  type MeetDay,
  type QuizResult,
  type ResultsLevel,
  type SettledBench,
  type Stage,
  type ViewerHas,
} from '@qzr/shared'
import type { Bindings } from '../bindings'
import type { SessionVariables } from '../middleware/session'
import { requireAuthOrGuest } from '../middleware/session'
import { createDb, type Db } from '../lib/db'
import {
  attentionItems,
  meetDivisions,
  type DivisionQuiz,
  stateOf,
  type ReadyDivision,
  type StatsGround,
} from '../lib/divisionStats'
import { isAdminOrSuperuser, isViewerOf } from '../lib/permissions'
import { scheduleDivisionId } from '../lib/quizFacts'
import { meetIdOf } from '../lib/request'
import { otherFormulaKeys } from '../lib/statsSettings'
import { cutQuizResult, OFFICIAL_RESULTS, statsReaderOf } from '../lib/viewerCut'

type Env = { Bindings: Bindings; Variables: SessionVariables & { db: Db } }

/** How long a viewer's copy of the meet day is served before it is built again (research R2) */
const VIEWER_COPY_SECONDS = 20

/**
 * The meet day (`GET /api/meets/:id/day`): the published schedule's quizzes with their results and
 * settled benches, and the stored quizzes it doesn't have, cut to the reader as a division's stats
 * are. Mounted where guest tokens reach it, as the stats routes are.
 */
export const day = new Hono<Env>()

day.use('/:id/day', requireAuthOrGuest())
day.use('/:id/day', async (c, next) => {
  if (!c.get('db')) c.set('db', createDb(c.env.DB) as unknown as Db)
  await next()
})

day.get('/:id/day', async (c) => {
  const meetId = meetIdOf(c)
  if (meetId === null) return c.json({ error: 'Meet not found' }, 404)
  const db = c.get('db')
  if (!(await isViewerOf(c, db, meetId))) return c.json({ error: 'Not a member of this meet' }, 403)
  const user = c.get('user')
  const { kind, own } = await statsReaderOf(
    c,
    db,
    meetId,
    !!user && isAdminOrSuperuser(db, user.id, user.role, meetId),
  )
  // Viewers and coaches share one copy, and officials with no quiz of their own another, an
  // official's own quizzes being all that tells them apart. An official's scoresheet asks afresh,
  // so a bench settled moments ago fills the quiz it opens
  const fresh = kind !== 'viewer' && c.req.query('fresh') !== undefined
  const copy = kind === 'admin' || own.size > 0 || fresh ? undefined : kind
  const cached = copy ? await viewerCopy(c, meetId, copy) : undefined
  if (cached) return cached

  const read = await meetDivisions(db, meetId)
  if (read === 'notFound') return c.json({ error: 'Meet not found' }, 404)
  if (read === 'preparing') {
    c.header('Retry-After', '1')
    return c.json({ error: 'Stats are being prepared' }, 503)
  }
  const { ground, divisions } = read
  const reader: Reader = { admin: kind === 'admin', official: kind === 'official', own }
  // Each division's stats are worked out at most once, and only where something needs them
  const worked = new Map<ReadyDivision, DivisionStats>()
  const statsOf = (answer: ReadyDivision) => {
    const stats = worked.get(answer) ?? divisionStats(answer.input)
    worked.set(answer, stats)
    return stats
  }
  const body = meetDay(ground, divisions, statsOf, reader)
  if (reader.admin) {
    const other = await otherFormulaKeys(db, meetId, ground.settings.levelTeams)
    const all = divisions.map((answer) => ({ answer, stats: statsOf(answer) }))
    body.attention = attentionItems(all, other).length
  }
  const response = c.json(body)
  if (copy) {
    const keeping = keepViewerCopy(c, meetId, copy, response)
    // Kept after answering where the Workers runtime allows it; tests have no execution context
    try {
      c.executionCtx.waitUntil(keeping)
    } catch {
      await keeping
    }
  }
  return response
})

interface Reader {
  admin: boolean
  /**
   * An official of the meet's rooms, who sees every result as an admin does, and the benches it
   * fills; the draw only as the schedule shows it to them (FR-019)
   */
  official: boolean
  /** An official's own stored quizzes */
  own: Set<number>
}

/** A stored quiz with a stage, as an admin has its result, and what the reader is given of it */
interface Stored {
  result: QuizResult
  stage: Stage
  level: ResultsLevel | undefined
}

/** The meet day for one reader, from every division read */
function meetDay(
  ground: StatsGround,
  divisions: ReadyDivision[],
  statsOf: (answer: ReadyDivision) => DivisionStats,
  reader: Reader,
): MeetDay {
  const phase = ground.meet.phase
  const schedule = ground.facts.schedule
  const doc = schedule?.document ?? null
  const told = (id: number) => reader.admin || reader.own.has(id)

  const hasOf = new Map<string, ViewerHas>()
  const stored = new Map<number, Stored>()
  const linked = new Map<string, number>()
  const unlinked: (DivisionQuiz & { division: string })[] = []
  const held = new Map<number, { quiz: DivisionQuiz; teams: () => string[] }>()
  const settled = new Map<string, SettledBench>()
  for (const answer of divisions) {
    const has = reader.official
      ? OFFICIAL_RESULTS
      : viewerHas(ground.settings, stateOf(ground.states, answer.division), phase)
    const id = scheduleDivisionId(ground.facts, answer.division)
    if (id !== undefined) hasOf.set(id, has)
    for (const [key, bench] of answer.benches) settled.set(key, bench)
    for (const quiz of answer.quizzes) {
      held.set(quiz.id, { quiz, teams: () => teamNames(answer).get(quiz.id) ?? [] })
      // A second quiz on one scheduled quiz is listed with the quizzes the schedule doesn't have
      if (quiz.scheduleQuizId !== null && doc && !linked.has(quiz.scheduleQuizId)) {
        linked.set(quiz.scheduleQuizId, quiz.id)
      } else unlinked.push({ ...quiz, division: answer.division })
    }
    // Results are worked out only where the reader may see some, or has quizzes of their own
    const mine = answer.quizzes.some((quiz) => told(quiz.id))
    if (!mine && Object.keys(has.results).length === 0) continue
    for (const stage of statsOf(answer).results) {
      for (const result of stage.quizzes) {
        if (result.id === undefined) continue
        stored.set(result.id, { result, stage: stage.stage, level: has.results[stage.stage] })
      }
    }
  }

  /** A stored quiz's result for `dayQuizStatus`, a quiz with no stage told apart by why */
  const resultOf = (id: number) => {
    const quiz = stored.get(id)
    if (quiz) return quiz.result
    return held.get(id)?.quiz.admin ? ('notCounted' as const) : ('unstaged' as const)
  }

  /** A stored quiz's line for the reader: its teams at their level, and its problems if theirs */
  const line = (id: number, quiz: Stored | undefined, status: DayStatus) => ({
    teams:
      status === 'hidden' || status === 'notIn'
        ? []
        : quiz
          ? // A stage's level is the settings' for a viewer or coach and the scores for an official,
            // who also sees their own quiz in a stage hidden from others
            cutQuizResult(quiz.result, reader.admin ? 'scores' : (quiz.level ?? 'places'), false)
              .teams
          : (held.get(id)?.teams() ?? []).map((name) => ({ name })),
    ...(told(id) ? { storedId: id, problems: quiz?.result.problems } : {}),
  })

  const quizzes = (doc?.quizzes ?? []).map((quiz) => {
    const id = linked.get(quiz.id)
    const result = id === undefined ? undefined : stored.get(id)
    const level = result ? result.level : hasOf.get(quiz.division)?.results[scheduledStage(quiz)]
    const mine = id !== undefined && told(id)
    const status = dayQuizStatus(id === undefined ? undefined : resultOf(id), {
      sees: reader.admin || mine || !!level,
      told: mine,
    })
    return { id: quiz.id, status, ...(id === undefined ? { teams: [] } : line(id, result, status)) }
  })

  const notOnSchedule = unlinked.flatMap((quiz): DayResult[] => {
    const result = stored.get(quiz.id)
    const mine = told(quiz.id)
    // Anyone but an admin or the quiz's official sees only quizzes with a stage they may see
    if (!mine && !result?.level) return []
    const status = dayQuizStatus(resultOf(quiz.id), { sees: true, told: mine })
    if (status === 'hidden' || status === 'notIn') return []
    const { name, division, stage } = quiz
    return [{ name, division, stage, status, ...line(quiz.id, result, status) }]
  })

  const benches: Record<string, SettledBench> = {}
  for (const quiz of doc?.quizzes ?? []) {
    const has = hasOf.get(quiz.division)
    quiz.seats.forEach((bench, index) => {
      const key = benchKey(quiz.id, index)
      const team = settled.get(key)
      if (!team) return
      // Admins see every bench; anyone else those whose source they may see, an official every
      // result's but the draw only as the schedule shows it to them (FR-019)
      if (reader.admin || (has && benchShown(schedule!.quizzes, quiz, bench, has, phase))) {
        benches[key] = team
      }
    })
  }

  return { phase, scheduleVersion: schedule?.version ?? null, quizzes, benches, notOnSchedule }
}

/** The teams a stored quiz names, for one with no stage, which has no result to name them */
const namesOf = new WeakMap<ReadyDivision, Map<number, string[]>>()

/** The teams each stored quiz of a division names, worked out once for the division */
function teamNames(answer: ReadyDivision): Map<number, string[]> {
  const known = namesOf.get(answer)
  if (known) return known
  const names = new Map(
    answer.input.quizzes.map((quiz) => [
      quiz.id,
      quiz.scored.teams.map((team) => tidyName(team.name)).filter((name) => name !== ''),
    ]),
  )
  namesOf.set(answer, names)
  return names
}

/** The Workers' default cache, which the browser typings the API builds with don't name */
const workerCache = () => (caches as unknown as { default: Cache }).default

/** A viewer's copy of a meet's day, while fresh; the Workers cache is absent in tests */
async function viewerCopy(
  c: Context<Env>,
  meetId: number,
  kind: SharedCut,
): Promise<Response | undefined> {
  if (typeof caches === 'undefined') return undefined
  const copy = await workerCache().match(copyKey(c, meetId, kind))
  // A response of its own, so the headers this request's middleware sets are this reader's
  return copy && c.body(await copy.text(), 200, { 'Content-Type': 'application/json' })
}

async function keepViewerCopy(
  c: Context<Env>,
  meetId: number,
  kind: SharedCut,
  response: Response,
) {
  if (typeof caches === 'undefined') return
  // The body alone: the headers of the request that built it belong to that reader
  const copy = new Response(await response.clone().text(), {
    headers: { 'Cache-Control': `max-age=${VIEWER_COPY_SECONDS}` },
  })
  await workerCache().put(copyKey(c, meetId, kind), copy)
}

/** A cut every reader of a kind shares: viewers and coaches, or officials with no quiz of their own */
type SharedCut = 'viewer' | 'official'

/** One copy per meet for each shared cut, keyed apart from any real address */
function copyKey(c: Context<Env>, meetId: number, kind: SharedCut): Request {
  return new Request(`${new URL(c.req.url).origin}/__meet-day/${meetId}/${kind}`)
}
