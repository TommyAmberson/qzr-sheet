import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'
import type { Bindings } from '../bindings'
import type { SessionVariables } from '../middleware/session'
import { requireAuth, requireSuperuser, getUser } from '../middleware/session'
import { createDb, type Db } from '../lib/db'
import * as schema from '../db/schema'
import { AccountRole } from '@qzr/shared'

export interface ChurchesVariables extends SessionVariables {
  db: Db
}

type Env = { Bindings: Bindings; Variables: ChurchesVariables }

export const churches = new Hono<Env>()

churches.use('*', requireAuth())

churches.use('*', async (c, next) => {
  if (!c.get('db')) {
    c.set('db', createDb(c.env.DB) as unknown as Db)
  }
  await next()
})

function getDb(c: { get(key: 'db'): Db }): Db {
  return c.get('db')
}

/** Resolve meetId param or 400. */
function parseMeetId(raw: string): number | null {
  const n = Number(raw)
  return Number.isNaN(n) ? null : n
}

// ---- Churches ----

/**
 * GET /api/meets/:meetId/churches
 *
 * Returns all churches for the meet. Any coach member can read.
 * createdBy is included so the client can determine edit ownership.
 */
churches.get('/meets/:meetId/churches', async (c) => {
  const meetId = parseMeetId(c.req.param('meetId'))
  if (meetId === null) return c.json({ error: 'Invalid meet ID' }, 400)

  const db = getDb(c)
  const rows = await db.select().from(schema.churches).where(eq(schema.churches.meetId, meetId))
  return c.json({ churches: rows })
})

/**
 * POST /api/meets/:meetId/churches
 *
 * Creates a church for the meet. Requires an active coach membership.
 */
churches.post('/meets/:meetId/churches', async (c) => {
  const meetId = parseMeetId(c.req.param('meetId'))
  if (meetId === null) return c.json({ error: 'Invalid meet ID' }, 400)

  const user = getUser(c)
  const db = getDb(c)

  // Verify the user is a coach for this meet (or superuser)
  if (user.role !== AccountRole.Superuser) {
    const [membership] = await db
      .select()
      .from(schema.coachMemberships)
      .where(
        and(
          eq(schema.coachMemberships.accountId, user.id),
          eq(schema.coachMemberships.meetId, meetId),
        ),
      )
    if (!membership) return c.json({ error: 'Coach membership required' }, 403)
  }

  const body = await c.req.json<{ name?: string; shortName?: string }>()
  if (!body.name?.trim() || !body.shortName?.trim()) {
    return c.json({ error: 'name and shortName are required' }, 400)
  }

  const [church] = await db
    .insert(schema.churches)
    .values({
      meetId,
      createdBy: user.id,
      name: body.name.trim(),
      shortName: body.shortName.trim(),
    })
    .returning()

  return c.json({ church }, 201)
})

// ---- Teams ----

/**
 * GET /api/churches/:churchId/teams
 *
 * Returns all teams under a church. Any authenticated member can read.
 */
churches.get('/churches/:churchId/teams', async (c) => {
  const churchId = Number(c.req.param('churchId'))
  if (Number.isNaN(churchId)) return c.json({ error: 'Invalid church ID' }, 400)

  const db = getDb(c)
  const [church] = await db.select().from(schema.churches).where(eq(schema.churches.id, churchId))
  if (!church) return c.json({ error: 'Church not found' }, 404)

  const rows = await db.select().from(schema.teams).where(eq(schema.teams.churchId, churchId))
  return c.json({ teams: rows })
})

/**
 * POST /api/churches/:churchId/teams
 *
 * Creates a team under a church. Coach must own the church (or be superuser).
 * `number` auto-increments per church per division if omitted.
 */
churches.post('/churches/:churchId/teams', async (c) => {
  const churchId = Number(c.req.param('churchId'))
  if (Number.isNaN(churchId)) return c.json({ error: 'Invalid church ID' }, 400)

  const user = getUser(c)
  const db = getDb(c)

  const [church] = await db.select().from(schema.churches).where(eq(schema.churches.id, churchId))

  if (!church) return c.json({ error: 'Church not found' }, 404)
  if (user.role !== AccountRole.Superuser && church.createdBy !== user.id) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const body = await c.req.json<{ division?: string }>()
  if (!body.division?.trim()) {
    return c.json({ error: 'division is required' }, 400)
  }
  const division = body.division.trim()

  // Derive next team number for this church (global across divisions)
  const existing = await db
    .select({ number: schema.teams.number })
    .from(schema.teams)
    .where(eq(schema.teams.churchId, churchId))

  const nextNumber = existing.length === 0 ? 1 : Math.max(...existing.map((r) => r.number)) + 1

  const [team] = await db
    .insert(schema.teams)
    .values({
      meetId: church.meetId,
      churchId,
      division,
      number: nextNumber,
    })
    .returning()

  return c.json({ team }, 201)
})

/**
 * PATCH /api/teams/:teamId
 *
 * Updates a team's division. Coach must own the church (or be superuser).
 */
churches.patch('/teams/:teamId', async (c) => {
  const teamId = Number(c.req.param('teamId'))
  if (Number.isNaN(teamId)) return c.json({ error: 'Invalid team ID' }, 400)

  const user = getUser(c)
  const db = getDb(c)

  const team = await getTeamWithChurch(db, teamId)
  if (!team) return c.json({ error: 'Team not found' }, 404)
  if (user.role !== AccountRole.Superuser && team.church.createdBy !== user.id) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const body = await c.req.json<{ division?: string }>()
  if (!body.division?.trim()) return c.json({ error: 'division is required' }, 400)

  const [updated] = await db
    .update(schema.teams)
    .set({ division: body.division.trim() })
    .where(eq(schema.teams.id, teamId))
    .returning()

  return c.json({ team: updated })
})

/**
 * DELETE /api/teams/:teamId
 *
 * Deletes a team and its entire roster. Coach must own the church (or be superuser).
 */
churches.delete('/teams/:teamId', async (c) => {
  const teamId = Number(c.req.param('teamId'))
  if (Number.isNaN(teamId)) return c.json({ error: 'Invalid team ID' }, 400)

  const user = getUser(c)
  const db = getDb(c)

  const team = await getTeamWithChurch(db, teamId)
  if (!team) return c.json({ error: 'Team not found' }, 404)
  if (user.role !== AccountRole.Superuser && team.church.createdBy !== user.id) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  await db.delete(schema.teams).where(eq(schema.teams.id, teamId))

  return c.json({ deleted: true as const })
})

// ---- Quizzers ----

/**
 * GET /api/teams/:teamId/quizzers
 *
 * Returns all roster entries for a team.
 */
churches.get('/teams/:teamId/quizzers', async (c) => {
  const teamId = Number(c.req.param('teamId'))
  if (Number.isNaN(teamId)) return c.json({ error: 'Invalid team ID' }, 400)

  const user = getUser(c)
  const db = getDb(c)

  const team = await getTeamWithChurch(db, teamId)
  if (!team) return c.json({ error: 'Team not found' }, 404)
  if (user.role !== AccountRole.Superuser && team.church.createdBy !== user.id) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const rows = await db
    .select({
      quizzerId: schema.teamRosters.quizzerId,
      name: schema.teamRosters.name,
    })
    .from(schema.teamRosters)
    .where(eq(schema.teamRosters.teamId, teamId))

  return c.json({ quizzers: rows })
})

/**
 * POST /api/teams/:teamId/quizzers
 *
 * Adds a quizzer to a team. Creates a new QuizzerIdentity automatically.
 */
churches.post('/teams/:teamId/quizzers', async (c) => {
  const teamId = Number(c.req.param('teamId'))
  if (Number.isNaN(teamId)) return c.json({ error: 'Invalid team ID' }, 400)

  const user = getUser(c)
  const db = getDb(c)

  const team = await getTeamWithChurch(db, teamId)
  if (!team) return c.json({ error: 'Team not found' }, 404)
  if (user.role !== AccountRole.Superuser && team.church.createdBy !== user.id) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const body = await c.req.json<{ name?: string }>()
  if (!body.name?.trim()) {
    return c.json({ error: 'name is required' }, 400)
  }

  // Each quizzer in a roster gets a fresh identity for now
  const [identity] = await db.insert(schema.quizzerIdentities).values({}).returning()
  const [entry] = await db
    .insert(schema.teamRosters)
    .values({ teamId, quizzerId: identity!.id, name: body.name.trim() })
    .returning()

  return c.json({ quizzer: entry }, 201)
})

/**
 * PATCH /api/teams/:teamId/quizzers/:quizzerId
 *
 * Update the display name for a quizzer on this team.
 */
churches.patch('/teams/:teamId/quizzers/:quizzerId', async (c) => {
  const teamId = Number(c.req.param('teamId'))
  const quizzerId = Number(c.req.param('quizzerId'))
  if (Number.isNaN(teamId) || Number.isNaN(quizzerId)) {
    return c.json({ error: 'Invalid ID' }, 400)
  }

  const user = getUser(c)
  const db = getDb(c)

  const team = await getTeamWithChurch(db, teamId)
  if (!team) return c.json({ error: 'Team not found' }, 404)
  if (user.role !== AccountRole.Superuser && team.church.createdBy !== user.id) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const body = await c.req.json<{ name?: string }>()
  if (!body.name?.trim()) {
    return c.json({ error: 'name is required' }, 400)
  }

  const [entry] = await db
    .update(schema.teamRosters)
    .set({ name: body.name.trim() })
    .where(and(eq(schema.teamRosters.teamId, teamId), eq(schema.teamRosters.quizzerId, quizzerId)))
    .returning()

  if (!entry) return c.json({ error: 'Quizzer not found on this team' }, 404)

  return c.json({ quizzer: entry })
})

/**
 * DELETE /api/teams/:teamId/quizzers/:quizzerId
 *
 * Removes a quizzer from a team roster.
 */
churches.delete('/teams/:teamId/quizzers/:quizzerId', async (c) => {
  const teamId = Number(c.req.param('teamId'))
  const quizzerId = Number(c.req.param('quizzerId'))
  if (Number.isNaN(teamId) || Number.isNaN(quizzerId)) {
    return c.json({ error: 'Invalid ID' }, 400)
  }

  const user = getUser(c)
  const db = getDb(c)

  const team = await getTeamWithChurch(db, teamId)
  if (!team) return c.json({ error: 'Team not found' }, 404)
  if (user.role !== AccountRole.Superuser && team.church.createdBy !== user.id) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const [deleted] = await db
    .delete(schema.teamRosters)
    .where(and(eq(schema.teamRosters.teamId, teamId), eq(schema.teamRosters.quizzerId, quizzerId)))
    .returning()

  if (!deleted) return c.json({ error: 'Quizzer not found on this team' }, 404)

  return c.json({ deleted: true as const })
})

// ---- Helpers ----

async function getTeamWithChurch(
  db: Db,
  teamId: number,
): Promise<{ team: schema.Team; church: schema.Church } | null> {
  const [row] = await db
    .select({ team: schema.teams, church: schema.churches })
    .from(schema.teams)
    .innerJoin(schema.churches, eq(schema.teams.churchId, schema.churches.id))
    .where(eq(schema.teams.id, teamId))

  return row ?? null
}

// requireSuperuser re-export for convenience in tests (guards superuser-only routes)
export { requireSuperuser }
