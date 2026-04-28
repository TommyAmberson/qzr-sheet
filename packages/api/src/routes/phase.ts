import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'
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

const MEET_PHASES = ['registration', 'build', 'live', 'done'] as const
type MeetPhase = (typeof MEET_PHASES)[number]

const DIVISION_STATES = ['prelim_running', 'stats_break', 'elim_running', 'division_done'] as const
type DivisionStateValue = (typeof DIVISION_STATES)[number]

function phaseIndex(p: MeetPhase): number {
  return MEET_PHASES.indexOf(p)
}

function divisionStateIndex(s: DivisionStateValue): number {
  return DIVISION_STATES.indexOf(s)
}

/**
 * POST /api/meets/:id/phase
 * Body: { phase: 'registration' | 'build' | 'live' | 'done' }
 *
 * Advance or revert the meet phase. Forward transitions require single-step
 * advance (no jumping registration → live). Reverse transitions are allowed
 * but flagged in the response so the UI can warn the admin.
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
  if (!MEET_PHASES.includes(body.phase)) {
    return c.json({ error: 'Invalid phase' }, 400)
  }

  const [meet] = await db
    .select({ id: schema.quizMeets.id, phase: schema.quizMeets.phase })
    .from(schema.quizMeets)
    .where(eq(schema.quizMeets.id, meetId))
  if (!meet) return c.json({ error: 'Meet not found' }, 404)

  const fromIdx = phaseIndex(meet.phase as MeetPhase)
  const toIdx = phaseIndex(body.phase)
  const reversed = toIdx < fromIdx
  if (Math.abs(toIdx - fromIdx) > 1) {
    return c.json(
      { error: 'Phase transitions must be single-step', from: meet.phase, to: body.phase },
      400,
    )
  }
  if (toIdx === fromIdx) {
    return c.json({ phase: meet.phase, reversed: false, unchanged: true })
  }

  await db
    .update(schema.quizMeets)
    .set({ phase: body.phase })
    .where(eq(schema.quizMeets.id, meetId))

  return c.json({ phase: body.phase, reversed })
})

/**
 * POST /api/meets/:id/divisions/:division/state
 * Body: { state: 'prelim_running' | 'stats_break' | 'elim_running' | 'division_done' }
 *
 * Advance or revert a per-division state inside the meet's `live` phase.
 * Single-step only; reverses allowed and flagged.
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
  if (!DIVISION_STATES.includes(body.state)) {
    return c.json({ error: 'Invalid state' }, 400)
  }

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

  const now = new Date()
  if (!existing) {
    // First transition for this division — initialize at 'prelim_running' implicitly.
    if (body.state !== 'prelim_running') {
      const targetIdx = divisionStateIndex(body.state)
      if (targetIdx > 1) {
        return c.json(
          {
            error: 'Division state transitions must be single-step',
            from: 'prelim_running',
            to: body.state,
          },
          400,
        )
      }
    }
    await db.insert(schema.divisionStates).values({
      meetId,
      division,
      state: body.state,
      transitionedAt: now,
    })
    return c.json({ state: body.state, reversed: false })
  }

  const fromIdx = divisionStateIndex(existing.state as DivisionStateValue)
  const toIdx = divisionStateIndex(body.state)
  const reversed = toIdx < fromIdx
  if (Math.abs(toIdx - fromIdx) > 1) {
    return c.json(
      {
        error: 'Division state transitions must be single-step',
        from: existing.state,
        to: body.state,
      },
      400,
    )
  }
  if (toIdx === fromIdx) {
    return c.json({ state: existing.state, reversed: false, unchanged: true })
  }

  await db
    .update(schema.divisionStates)
    .set({ state: body.state, transitionedAt: now })
    .where(
      and(eq(schema.divisionStates.meetId, meetId), eq(schema.divisionStates.division, division)),
    )

  return c.json({ state: body.state, reversed })
})

/**
 * GET /api/meets/:id/divisions/state
 *
 * Lists current state for every division in the meet (registered in division_states).
 * Divisions without a row are implicitly at 'prelim_running'.
 */
phase.get('/:id/divisions/state', async (c) => {
  const meetId = Number(c.req.param('id'))
  if (Number.isNaN(meetId)) return c.json({ error: 'Invalid meet ID' }, 400)

  const db = getDb(c)
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
