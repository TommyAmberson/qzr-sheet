import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'
import { MEET_PHASES, DIVISION_STATES, type MeetPhase, type DivisionStateValue } from '@qzr/shared'
import type { Bindings } from '../bindings'
import type { SessionVariables } from '../middleware/session'
import { requireAuth, getUser } from '../middleware/session'
import { createDb, type Db } from '../lib/db'
import { isAdminOrSuperuser } from '../lib/permissions'
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

/**
 * Advance or revert a per-division state inside the meet's `live` phase.
 * Single-step only; reverses are allowed and flagged.
 */
phase.post('/:id/divisions/:division/state', async (c) => {
  const meetId = Number(c.req.param('id'))
  if (Number.isNaN(meetId)) return c.json({ error: 'Invalid meet ID' }, 400)
  const division = c.req.param('division')
  if (!division) return c.json({ error: 'Division required' }, 400)

  const user = getUser(c)
  const db = getDb(c)
  if (!(await isAdminOrSuperuser(db, user.id, user.role, meetId))) {
    return c.json({ error: 'Admin or superuser access required' }, 403)
  }

  const body = await c.req.json<{ state: DivisionStateValue }>()

  const [meet] = await db
    .select({ id: schema.quizMeets.id, phase: schema.quizMeets.phase })
    .from(schema.quizMeets)
    .where(eq(schema.quizMeets.id, meetId))
  if (!meet) return c.json({ error: 'Meet not found' }, 404)
  if (meet.phase !== 'live') {
    return c.json(
      { error: 'Division state transitions only allowed when meet is live', meetPhase: meet.phase },
      409,
    )
  }

  const [existing] = await db
    .select()
    .from(schema.divisionStates)
    .where(
      and(eq(schema.divisionStates.meetId, meetId), eq(schema.divisionStates.division, division)),
    )

  // No prior row → implicit starting state is 'prelim_running'.
  const fromState: DivisionStateValue = (existing?.state as DivisionStateValue) ?? 'prelim_running'
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
    case 'ok': {
      const now = new Date()
      if (existing) {
        await db
          .update(schema.divisionStates)
          .set({ state: body.state, transitionedAt: now })
          .where(
            and(
              eq(schema.divisionStates.meetId, meetId),
              eq(schema.divisionStates.division, division),
            ),
          )
      } else {
        await db
          .insert(schema.divisionStates)
          .values({ meetId, division, state: body.state, transitionedAt: now })
      }
      return c.json({ state: body.state, reversed: result.reversed })
    }
  }
})

/** Lists transitioned division states. Divisions without a row are implicitly 'prelim_running'. */
phase.get('/:id/divisions/state', async (c) => {
  const meetId = Number(c.req.param('id'))
  if (Number.isNaN(meetId)) return c.json({ error: 'Invalid meet ID' }, 400)

  const user = getUser(c)
  const db = getDb(c)
  if (!(await isAdminOrSuperuser(db, user.id, user.role, meetId))) {
    return c.json({ error: 'Admin or superuser access required' }, 403)
  }

  const rows = await db
    .select({
      division: schema.divisionStates.division,
      state: schema.divisionStates.state,
      transitionedAt: schema.divisionStates.transitionedAt,
    })
    .from(schema.divisionStates)
    .where(eq(schema.divisionStates.meetId, meetId))

  return c.json({ divisionStates: rows })
})
