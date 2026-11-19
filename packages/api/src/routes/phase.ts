import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import {
  MEET_PHASES,
  DIVISION_STATES,
  findDivision,
  foldName,
  sameDivision,
  divisionStats,
  heldQuizzes,
  scheduledStage,
  type MeetPhase,
  type DivisionStateValue,
  type Stage,
} from '@qzr/shared'
import type { Bindings } from '../bindings'
import type { SessionVariables } from '../middleware/session'
import { requireAuth, getUser } from '../middleware/session'
import { asOne, createDb, type Db } from '../lib/db'
import {
  REVISIONS_SCORED_PER_REQUEST,
  divisionOf,
  stateOf,
  statsGround,
  type DivisionAnswer,
  type StatsGround,
} from '../lib/divisionStats'
import { isAdminOrSuperuser } from '../lib/permissions'
import { scheduledQuiz, scheduledStages } from '../lib/quizFacts'
import * as schema from '../db/schema'

interface PhaseVariables extends SessionVariables {
  db: Db
}

type Env = { Bindings: Bindings; Variables: PhaseVariables }

export const phase = new Hono<Env>()

phase.use('*', requireAuth())
phase.use('*', async (c, next) => {
  if (!c.get('db')) {
    c.set('db', createDb(c.env.DB) as unknown as Db)
  }
  await next()
})

function getDb(c: { get(key: 'db'): Db }): Db {
  return c.get('db')
}

/**
 * Single-step state-machine validator. Reused for both meet phase and per-division
 * state because they share the exact same forward/reverse/multi-step semantics.
 */
type TransitionResult<T> =
  | { kind: 'ok'; reversed: boolean }
  | { kind: 'unchanged' }
  | { kind: 'multi-step'; from: T; to: T }
  | { kind: 'invalid' }

function validateTransition<T extends string>(
  seq: readonly T[],
  from: T,
  to: T,
): TransitionResult<T> {
  if (!seq.includes(to)) return { kind: 'invalid' }
  const fromIdx = seq.indexOf(from)
  const toIdx = seq.indexOf(to)
  if (toIdx === fromIdx) return { kind: 'unchanged' }
  if (Math.abs(toIdx - fromIdx) > 1) return { kind: 'multi-step', from, to }
  return { kind: 'ok', reversed: toIdx < fromIdx }
}

/**
 * Advance or revert the meet phase. Single-step only; reverses are allowed
 * but flagged in the response so the UI can warn.
 */
phase.post('/:id/phase', async (c) => {
  const meetId = Number(c.req.param('id'))
  if (Number.isNaN(meetId)) return c.json({ error: 'Invalid meet ID' }, 400)

  const user = getUser(c)
  const db = getDb(c)
  if (!(await isAdminOrSuperuser(db, user.id, user.role, meetId))) {
    return c.json({ error: 'Admin or superuser access required' }, 403)
  }

  const body = await c.req.json<{ phase: MeetPhase }>()

  const [meet] = await db
    .select({ id: schema.quizMeets.id, phase: schema.quizMeets.phase })
    .from(schema.quizMeets)
    .where(eq(schema.quizMeets.id, meetId))
  if (!meet) return c.json({ error: 'Meet not found' }, 404)

  const result = validateTransition(MEET_PHASES, meet.phase as MeetPhase, body.phase)
  switch (result.kind) {
    case 'invalid':
      return c.json({ error: 'Invalid phase' }, 400)
    case 'multi-step':
      return c.json(
        { error: 'Phase transitions must be single-step', from: result.from, to: result.to },
        400,
      )
    case 'unchanged':
      return c.json({ phase: meet.phase, reversed: false, unchanged: true })
    case 'ok':
      await db
        .update(schema.quizMeets)
        .set({ phase: body.phase })
        .where(eq(schema.quizMeets.id, meetId))
      return c.json({ phase: body.phase, reversed: result.reversed })
  }
})

/** The stage whose quizzes a division finishes by moving on from each state (FR-019a) */
const ENDING: Partial<Record<DivisionStateValue, Stage>> = {
  prelim_running: 'prelim',
  stats_break: 'intermediate',
  elim_running: 'elimination',
  finals: 'finals',
}

/**
 * The scheduled quizzes of a stage that are missing, or stored and not counting, so a division
 * isn't ready to move on from it, by their scheduled names. Nothing is missing in a meet with no
 * published schedule, which has nothing to wait for.
 */
function missingOf(
  ground: StatsGround,
  answer: Extract<DivisionAnswer, { kind: 'ready' }>,
  stage: Stage,
): { name: string }[] {
  const { facts } = ground
  if (!facts.schedule) return []
  const counting = new Set(
    heldQuizzes(answer.input)
      .filter((quiz) => quiz.counts)
      .map((quiz) => quiz.id),
  )
  const countingFor = new Set(
    answer.quizzes.flatMap((quiz) =>
      quiz.scheduleQuizId !== null && counting.has(quiz.id) ? [quiz.scheduleQuizId] : [],
    ),
  )
  return [...facts.schedule.quizzes.values()]
    .filter(
      (quiz) =>
        sameDivision(quiz.division, answer.division) &&
        scheduledStage(quiz) === stage &&
        !countingFor.has(quiz.id),
    )
    .map((quiz) => ({ name: scheduledQuiz(facts, quiz.id)?.name ?? quiz.label }))
}

/** The stored quizzes seated from an order: those of the stages after it */
const SEATED_FROM: Record<ConfirmedOrderKind, Stage[]> = {
  prelims: ['intermediate', 'elimination', 'finals'],
  rerank: ['elimination', 'finals'],
}

type ConfirmedOrderKind = (typeof schema.CONFIRMED_ORDERS)[number]

/**
 * The order the step into each state confirms, which the step back out of it withdraws: the stats
 * break confirms the prelim order, the eliminations the re-rank
 */
const CONFIRMS: Partial<Record<DivisionStateValue, ConfirmedOrderKind>> = {
  stats_break: 'prelims',
  elim_running: 'rerank',
}

/**
 * Advance or revert a per-division state, while the meet is `live` or in `review`, one step at a
 * time. Moving on confirms the order a step ends with, and moving back withdraws it (FR-019a to
 * FR-019c): each needs `confirm` where scheduled quizzes are missing, or where quizzes seated from
 * the order withdrawn are stored, and a withdrawal flags those quizzes until each is kept.
 */
phase.post('/:id/divisions/:division/state', async (c) => {
  const meetId = Number(c.req.param('id'))
  if (Number.isNaN(meetId)) return c.json({ error: 'Invalid meet ID' }, 400)
  const asked = c.req.param('division')
  if (!asked) return c.json({ error: 'Division required' }, 400)

  const user = getUser(c)
  const db = getDb(c)
  if (!(await isAdminOrSuperuser(db, user.id, user.role, meetId))) {
    return c.json({ error: 'Admin or superuser access required' }, 403)
  }

  const body = await c.req.json<{ state: DivisionStateValue; confirm?: boolean }>()

  const ground = await statsGround(db, meetId)
  if (!ground) return c.json({ error: 'Meet not found' }, 404)
  const meetPhase = ground.meet.phase
  if (meetPhase !== 'live' && meetPhase !== 'review') {
    return c.json(
      {
        error: 'Division state transitions only allowed when meet is live or in review',
        meetPhase,
      },
      409,
    )
  }

  // The division as the meet spells it, so its state row and its confirmations agree
  const division = findDivision(ground.meet.divisions, asked) ?? asked
  const existing = ground.states.find((row) => sameDivision(row.division, division))
  // No prior row: the division is running its prelims
  const fromState = existing?.state ?? 'prelim_running'
  const result = validateTransition(DIVISION_STATES, fromState, body.state)
  switch (result.kind) {
    case 'invalid':
      return c.json({ error: 'Invalid state' }, 400)
    case 'multi-step':
      return c.json(
        {
          error: 'Division state transitions must be single-step',
          from: result.from,
          to: result.to,
        },
        400,
      )
    case 'unchanged':
      return c.json({ state: fromState, reversed: false, unchanged: true })
  }

  const answer = await divisionOf(db, meetId, ground, division)
  if (answer.kind === 'preparing') {
    c.header('Retry-After', '1')
    return c.json({ error: 'Stats are being prepared' }, 503)
  }
  const ready = answer.kind === 'ready' ? answer : null
  const now = new Date()
  const by = { byAccountId: user.id, byName: user.name, at: now }
  let record: typeof schema.divisionConfirmations.$inferInsert | null = null
  // The order the step enters confirms, or the step leaves withdraws
  const what = CONFIRMS[result.reversed ? fromState : body.state]

  if (!result.reversed) {
    const ending = ENDING[fromState]
    const missing = ready && ending ? missingOf(ground, ready, ending) : []
    if (missing.length > 0 && !body.confirm) {
      return c.json({ error: 'Scheduled quizzes are missing or not counting', missing }, 409)
    }
    // Moving on confirms the order the step ends with: the current one, as it stands now
    const stats = ready && what ? divisionStats(ready.input) : null
    const table = what === 'prelims' ? stats?.prelimStandings : stats?.rerank
    // An order with no team in it confirms nothing: the division moves on unconfirmed
    if (what && table && table.teams.length > 0) {
      record = {
        meetId,
        division,
        what,
        confirmed: true,
        teams: JSON.stringify(table.current ?? table.teams),
        ...by,
      }
    }
  } else if (what && ready?.input.confirmed?.[what]) {
    const affected = ready.quizzes
      .filter((quiz) => quiz.stage !== null && SEATED_FROM[what].includes(quiz.stage))
      .map(({ id, name }) => ({ id, name }))
    if (affected.length > 0 && !body.confirm) {
      return c.json({ error: 'Quizzes were seated from the order this withdraws', affected }, 409)
    }
    record = {
      meetId,
      division,
      what,
      confirmed: false,
      affected: JSON.stringify(affected.map((quiz) => quiz.id)),
      ...by,
    }
  }

  // The move and what it confirms or withdraws are made together, or neither is
  await asOne(db, [
    existing
      ? db
          .update(schema.divisionStates)
          .set({ state: body.state, division, transitionedAt: now })
          .where(eq(schema.divisionStates.id, existing.id))
      : db
          .insert(schema.divisionStates)
          .values({ meetId, division, state: body.state, transitionedAt: now }),
    ...(record ? [db.insert(schema.divisionConfirmations).values(record)] : []),
  ])
  return c.json({
    state: body.state,
    reversed: result.reversed,
    ...(record?.confirmed
      ? { confirmed: { what: record.what, by: user.name, at: now.toISOString() } }
      : {}),
  })
})

/**
 * Each division's state, with whether it is ready for its next step and what is missing, and who
 * confirmed its standing orders. The meet's divisions first, then any only a state names.
 * Divisions without a row are implicitly 'prelim_running'.
 */
phase.get('/:id/divisions/state', async (c) => {
  const meetId = Number(c.req.param('id'))
  if (Number.isNaN(meetId)) return c.json({ error: 'Invalid meet ID' }, 400)

  const user = getUser(c)
  const db = getDb(c)
  if (!(await isAdminOrSuperuser(db, user.id, user.role, meetId))) {
    return c.json({ error: 'Admin or superuser access required' }, 403)
  }

  const ground = await statsGround(db, meetId)
  if (!ground) return c.json({ error: 'Meet not found' }, 404)
  const divisions = [...ground.meet.divisions]
  for (const row of ground.states) {
    if (findDivision(divisions, row.division) === undefined) divisions.push(row.division)
  }
  const divisionStates = []
  // One budget for the request, however many divisions it reads
  const scoring = { left: REVISIONS_SCORED_PER_REQUEST }
  for (const division of divisions) {
    const answer = await divisionOf(db, meetId, ground, division, undefined, scoring)
    if (answer.kind === 'preparing') {
      c.header('Retry-After', '1')
      return c.json({ error: 'Stats are being prepared' }, 503)
    }
    const row = ground.states.find((state) => sameDivision(state.division, division))
    const state = stateOf(ground.states, division)
    const ending = ENDING[state]
    const missing = answer.kind === 'ready' && ending ? missingOf(ground, answer, ending) : []
    const orders = ground.facts.confirmed.get(foldName(division)) ?? {}
    divisionStates.push({
      division,
      state,
      // So a division with no eliminations can go from its stats break straight to its Finals
      stages: scheduledStages(ground.facts, division),
      ...(row ? { transitionedAt: row.transitionedAt } : {}),
      // The last state has no next step to be ready for
      ready: ending !== undefined && missing.length === 0,
      missing,
      confirmed: Object.fromEntries(
        Object.entries(orders).map(([what, order]) => [what, { by: order.by, at: order.at }]),
      ),
    })
  }
  return c.json({ divisionStates })
})
