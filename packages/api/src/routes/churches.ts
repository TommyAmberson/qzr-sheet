import { Hono } from 'hono'
import { eq, and, inArray, sql } from 'drizzle-orm'
import type { Bindings } from '../bindings'
import type { SessionVariables } from '../middleware/session'
import { requireAuth, requireSuperuser, getUser } from '../middleware/session'
import { createDb, type Db } from '../lib/db'
import { generateCode, hashCode } from '../lib/codes'
import { isAdminOrSuperuser } from '../lib/permissions'
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

/** Returns true if the user can edit the given church (coach membership, admin, or superuser). */
async function canEditChurch(
  db: Db,
  userId: string,
  role: AccountRole,
  church: schema.Church,
): Promise<boolean> {
  if (await isAdminOrSuperuser(db, userId, role, church.meetId)) return true
  const [row] = await db
    .select()
    .from(schema.coachMemberships)
    .where(
      and(
        eq(schema.coachMemberships.accountId, userId),
        eq(schema.coachMemberships.churchId, church.id),
      ),
    )
  return !!row
}

// ---- Churches ----

/**
 * GET /api/meets/:meetId/churches
 *
 * Returns all churches for the meet. Any authenticated member can read.
 */
churches.get('/meets/:meetId/churches', async (c) => {
  const meetId = Number(c.req.param('meetId'))
  if (Number.isNaN(meetId)) return c.json({ error: 'Invalid meet ID' }, 400)

  const db = getDb(c)

  // Left join teams so churches with no teams still appear; count per church in one query.
  const rows = await db
    .select({
      id: schema.churches.id,
      meetId: schema.churches.meetId,
      name: schema.churches.name,
      shortName: schema.churches.shortName,
      coachCodeHash: schema.churches.coachCodeHash,
      teamCount: sql<number>`count(${schema.teams.id})`.mapWith(Number),
    })
    .from(schema.churches)
    .leftJoin(schema.teams, eq(schema.teams.churchId, schema.churches.id))
    .where(eq(schema.churches.meetId, meetId))
    .groupBy(schema.churches.id)

  return c.json({ churches: rows })
})

/**
 * POST /api/meets/:meetId/churches
 *
 * Creates a church for the meet. Requires superuser or admin membership.
 * Generates a coach code for the church on creation.
 */
churches.post('/meets/:meetId/churches', async (c) => {
  const meetId = Number(c.req.param('meetId'))
  if (Number.isNaN(meetId)) return c.json({ error: 'Invalid meet ID' }, 400)

  const user = getUser(c)
  const db = getDb(c)

  if (!(await isAdminOrSuperuser(db, user.id, user.role, meetId))) {
    return c.json({ error: 'Admin or superuser access required' }, 403)
  }

  const body = await c.req.json<{ name?: string; shortName?: string }>()
  if (!body.name?.trim()) {
    return c.json({ error: 'name is required' }, 400)
  }

  const name = body.name.trim()
  const shortName = body.shortName?.trim() || name

  const coachCode = generateCode()
  const coachCodeHash = await hashCode(coachCode)

  const [church] = await db
    .insert(schema.churches)
    .values({
      meetId,
      name,
      shortName,
      coachCodeHash,
    })
    .returning()

  return c.json({ church, coachCode }, 201)
})

/**
 * PATCH /api/churches/:churchId
 *
 * Updates a church's name and/or shortName. Requires admin or superuser.
 */
churches.patch('/churches/:churchId', async (c) => {
  const churchId = Number(c.req.param('churchId'))
  if (Number.isNaN(churchId)) return c.json({ error: 'Invalid church ID' }, 400)

  const user = getUser(c)
  const db = getDb(c)

  const [church] = await db.select().from(schema.churches).where(eq(schema.churches.id, churchId))
  if (!church) return c.json({ error: 'Church not found' }, 404)

  if (!(await isAdminOrSuperuser(db, user.id, user.role, church.meetId))) {
    return c.json({ error: 'Admin or superuser access required' }, 403)
  }

  const body = await c.req.json<{ name?: string; shortName?: string }>()
  const updates: Partial<{ name: string; shortName: string }> = {}

  if (body.name?.trim()) updates.name = body.name.trim()
  if (body.shortName?.trim()) updates.shortName = body.shortName.trim()

  if (Object.keys(updates).length === 0) {
    return c.json({ error: 'No fields to update' }, 400)
  }

  const [updated] = await db
    .update(schema.churches)
    .set(updates)
    .where(eq(schema.churches.id, churchId))
    .returning()

  return c.json({ church: updated })
})

/**
 * DELETE /api/churches/:churchId
 *
 * Deletes a church, its teams, rosters, and coach memberships (via CASCADE).
 * Requires admin or superuser.
 */
churches.delete('/churches/:churchId', async (c) => {
  const churchId = Number(c.req.param('churchId'))
  if (Number.isNaN(churchId)) return c.json({ error: 'Invalid church ID' }, 400)

  const user = getUser(c)
  const db = getDb(c)

  const [church] = await db.select().from(schema.churches).where(eq(schema.churches.id, churchId))
  if (!church) return c.json({ error: 'Church not found' }, 404)

  if (!(await isAdminOrSuperuser(db, user.id, user.role, church.meetId))) {
    return c.json({ error: 'Admin or superuser access required' }, 403)
  }

  await db.delete(schema.churches).where(eq(schema.churches.id, churchId))

  return c.json({ deleted: true as const })
})

/**
 * POST /api/churches/:churchId/rotate-coach-code
 *
 * Rotates the coach code for a church. Accepts { clearMembers: boolean }.
 * Requires admin or superuser.
 */
churches.post('/churches/:churchId/rotate-coach-code', async (c) => {
  const churchId = Number(c.req.param('churchId'))
  if (Number.isNaN(churchId)) return c.json({ error: 'Invalid church ID' }, 400)

  const user = getUser(c)
  const db = getDb(c)

  const [church] = await db.select().from(schema.churches).where(eq(schema.churches.id, churchId))
  if (!church) return c.json({ error: 'Church not found' }, 404)

  if (!(await isAdminOrSuperuser(db, user.id, user.role, church.meetId))) {
    return c.json({ error: 'Admin or superuser access required' }, 403)
  }

  const body = await c.req
    .json<{ clearMembers?: boolean }>()
    .catch((): { clearMembers?: boolean } => ({}))

  const coachCode = generateCode()
  const coachCodeHash = await hashCode(coachCode)

  await db.update(schema.churches).set({ coachCodeHash }).where(eq(schema.churches.id, churchId))

  if (body.clearMembers) {
    await db.delete(schema.coachMemberships).where(eq(schema.coachMemberships.churchId, churchId))
  }

  return c.json({ coachCode })
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

  const rows = await db
    .select({
      id: schema.teams.id,
      meetId: schema.teams.meetId,
      churchId: schema.teams.churchId,
      division: schema.teams.division,
      number: schema.teams.number,
      consolation: schema.teams.consolation,
    })
    .from(schema.teams)
    .where(eq(schema.teams.churchId, churchId))
  return c.json({ teams: rows })
})

/**
 * POST /api/churches/:churchId/teams
 *
 * Creates a team under a church. Requires coach, admin, or superuser access.
 */
churches.post('/churches/:churchId/teams', async (c) => {
  const churchId = Number(c.req.param('churchId'))
  if (Number.isNaN(churchId)) return c.json({ error: 'Invalid church ID' }, 400)

  const user = getUser(c)
  const db = getDb(c)

  const [church] = await db.select().from(schema.churches).where(eq(schema.churches.id, churchId))
  if (!church) return c.json({ error: 'Church not found' }, 404)

  if (!(await canEditChurch(db, user.id, user.role, church))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const body = await c.req.json<{ division?: string }>()
  if (!body.division?.trim()) {
    return c.json({ error: 'division is required' }, 400)
  }
  const division = body.division.trim()

  const existing = await db
    .select({ number: schema.teams.number })
    .from(schema.teams)
    .where(eq(schema.teams.churchId, churchId))

  const nextNumber = existing.length === 0 ? 1 : Math.max(...existing.map((r) => r.number)) + 1

  const [team] = await db
    .insert(schema.teams)
    .values({ meetId: church.meetId, churchId, division, number: nextNumber })
    .returning()

  return c.json({ team }, 201)
})

/**
 * PATCH /api/teams/:teamId
 *
 * Updates a team's division. Requires coach, admin, or superuser access.
 */
churches.patch('/teams/:teamId', async (c) => {
  const teamId = Number(c.req.param('teamId'))
  if (Number.isNaN(teamId)) return c.json({ error: 'Invalid team ID' }, 400)

  const user = getUser(c)
  const db = getDb(c)

  const team = await getTeamWithChurch(db, teamId)
  if (!team) return c.json({ error: 'Team not found' }, 404)

  if (!(await canEditChurch(db, user.id, user.role, team.church))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const body = await c.req.json<{ division?: string; number?: number }>()
  if (!body.division?.trim() && (body.number == null || typeof body.number !== 'number')) {
    return c.json({ error: 'division or number is required' }, 400)
  }

  const patch: { division?: string; number?: number } = {}
  if (body.division?.trim()) patch.division = body.division.trim()
  if (typeof body.number === 'number') patch.number = body.number

  const [updated] = await db
    .update(schema.teams)
    .set(patch)
    .where(eq(schema.teams.id, teamId))
    .returning()

  return c.json({ team: updated })
})

/**
 * DELETE /api/teams/:teamId
 *
 * Deletes a team and its entire roster. Requires coach, admin, or superuser access.
 */
churches.delete('/teams/:teamId', async (c) => {
  const teamId = Number(c.req.param('teamId'))
  if (Number.isNaN(teamId)) return c.json({ error: 'Invalid team ID' }, 400)

  const user = getUser(c)
  const db = getDb(c)

  const team = await getTeamWithChurch(db, teamId)
  if (!team) return c.json({ error: 'Team not found' }, 404)

  if (!(await canEditChurch(db, user.id, user.role, team.church))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  await db.delete(schema.teams).where(eq(schema.teams.id, teamId))

  return c.json({ deleted: true as const })
})

/**
 * POST /api/teams/:teamId/consolation
 *
 * Marks a team as consolation. Requires admin or superuser access.
 * Called at stats break when teams are split into the consolation bracket.
 */
churches.post('/teams/:teamId/consolation', async (c) => {
  const teamId = Number(c.req.param('teamId'))
  if (Number.isNaN(teamId)) return c.json({ error: 'Invalid team ID' }, 400)

  const user = getUser(c)
  const db = getDb(c)

  const team = await getTeamWithChurch(db, teamId)
  if (!team) return c.json({ error: 'Team not found' }, 404)

  if (!(await isAdminOrSuperuser(db, user.id, user.role, team.church.meetId))) {
    return c.json({ error: 'Admin or superuser access required' }, 403)
  }

  const [updated] = await db
    .update(schema.teams)
    .set({ consolation: true })
    .where(eq(schema.teams.id, teamId))
    .returning()

  return c.json({ team: updated }, 201)
})

/**
 * DELETE /api/teams/:teamId/consolation
 *
 * Removes consolation status from a team. Requires admin or superuser access.
 */
churches.delete('/teams/:teamId/consolation', async (c) => {
  const teamId = Number(c.req.param('teamId'))
  if (Number.isNaN(teamId)) return c.json({ error: 'Invalid team ID' }, 400)

  const user = getUser(c)
  const db = getDb(c)

  const team = await getTeamWithChurch(db, teamId)
  if (!team) return c.json({ error: 'Team not found' }, 404)

  if (!(await isAdminOrSuperuser(db, user.id, user.role, team.church.meetId))) {
    return c.json({ error: 'Admin or superuser access required' }, 403)
  }

  const [updated] = await db
    .update(schema.teams)
    .set({ consolation: false })
    .where(eq(schema.teams.id, teamId))
    .returning()

  return c.json({ team: updated })
})

// ---- Quizzers ----

/**
 * GET /api/teams/:teamId/quizzers
 */
churches.get('/teams/:teamId/quizzers', async (c) => {
  const teamId = Number(c.req.param('teamId'))
  if (Number.isNaN(teamId)) return c.json({ error: 'Invalid team ID' }, 400)

  const db = getDb(c)

  const rows = await db
    .select({ quizzerId: schema.teamRosters.quizzerId, name: schema.teamRosters.name })
    .from(schema.teamRosters)
    .where(eq(schema.teamRosters.teamId, teamId))

  return c.json({ quizzers: rows })
})

/**
 * POST /api/teams/:teamId/quizzers
 */
churches.post('/teams/:teamId/quizzers', async (c) => {
  const teamId = Number(c.req.param('teamId'))
  if (Number.isNaN(teamId)) return c.json({ error: 'Invalid team ID' }, 400)

  const user = getUser(c)
  const db = getDb(c)

  const team = await getTeamWithChurch(db, teamId)
  if (!team) return c.json({ error: 'Team not found' }, 404)

  if (!(await canEditChurch(db, user.id, user.role, team.church))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const body = await c.req.json<{ name?: string }>()
  if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400)

  const [identity] = await db.insert(schema.quizzerIdentities).values({}).returning()
  const [entry] = await db
    .insert(schema.teamRosters)
    .values({ teamId, quizzerId: identity!.id, name: body.name.trim() })
    .returning()

  return c.json({ quizzer: entry }, 201)
})

/**
 * PATCH /api/teams/:teamId/quizzers/:quizzerId
 */
churches.patch('/teams/:teamId/quizzers/:quizzerId', async (c) => {
  const teamId = Number(c.req.param('teamId'))
  const quizzerId = Number(c.req.param('quizzerId'))
  if (Number.isNaN(teamId) || Number.isNaN(quizzerId)) return c.json({ error: 'Invalid ID' }, 400)

  const user = getUser(c)
  const db = getDb(c)

  const team = await getTeamWithChurch(db, teamId)
  if (!team) return c.json({ error: 'Team not found' }, 404)

  if (!(await canEditChurch(db, user.id, user.role, team.church))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const body = await c.req.json<{ name?: string }>()
  if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400)

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
 */
churches.delete('/teams/:teamId/quizzers/:quizzerId', async (c) => {
  const teamId = Number(c.req.param('teamId'))
  const quizzerId = Number(c.req.param('quizzerId'))
  if (Number.isNaN(teamId) || Number.isNaN(quizzerId)) return c.json({ error: 'Invalid ID' }, 400)

  const user = getUser(c)
  const db = getDb(c)

  const team = await getTeamWithChurch(db, teamId)
  if (!team) return c.json({ error: 'Team not found' }, 404)

  if (!(await canEditChurch(db, user.id, user.role, team.church))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const [deleted] = await db
    .delete(schema.teamRosters)
    .where(and(eq(schema.teamRosters.teamId, teamId), eq(schema.teamRosters.quizzerId, quizzerId)))
    .returning()

  if (!deleted) return c.json({ error: 'Quizzer not found on this team' }, 404)
  return c.json({ deleted: true as const })
})

// ---- Roster sync ----

interface SyncQuizzerPayload {
  id: number
  name: string
}
interface SyncTeamPayload {
  id: number
  division: string
  quizzers: SyncQuizzerPayload[]
}
interface RosterSyncPayload {
  teams: SyncTeamPayload[]
  unassigned: SyncQuizzerPayload[]
}

/**
 * POST /api/churches/:churchId/roster/sync
 *
 * Replaces the church's entire roster in one request.
 * Client sends desired state: ordered teams (with division + quizzer names) and unassigned pool.
 * Temp IDs (negative) signal new teams/quizzers; server returns the resolved state.
 */
churches.post('/churches/:churchId/roster/sync', async (c) => {
  const churchId = Number(c.req.param('churchId'))
  if (Number.isNaN(churchId)) return c.json({ error: 'Invalid church ID' }, 400)

  const user = getUser(c)
  const db = getDb(c)

  const [church] = await db.select().from(schema.churches).where(eq(schema.churches.id, churchId))
  if (!church) return c.json({ error: 'Church not found' }, 404)

  if (!(await canEditChurch(db, user.id, user.role, church))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const body = await c.req.json<RosterSyncPayload>()
  if (!Array.isArray(body.teams) || !Array.isArray(body.unassigned)) {
    return c.json({ error: 'teams and unassigned are required arrays' }, 400)
  }

  // ---- Load current state ----

  const currentTeams = await db
    .select()
    .from(schema.teams)
    .where(eq(schema.teams.churchId, churchId))

  const currentRosters =
    currentTeams.length > 0
      ? await db
          .select()
          .from(schema.teamRosters)
          .where(
            inArray(
              schema.teamRosters.teamId,
              currentTeams.map((t) => t.id),
            ),
          )
      : []

  const currentTeamMap = new Map(currentTeams.map((t) => [t.id, t]))
  // quizzerId → { teamId, name }
  const currentRosterMap = new Map(
    currentRosters.map((r) => [r.quizzerId, { teamId: r.teamId, name: r.name }]),
  )

  // ---- Compute desired state ----

  const payloadTeamIds = new Set(body.teams.filter((t) => t.id > 0).map((t) => t.id))
  const payloadQuizzerIds = new Set(
    body.teams.flatMap((t) => t.quizzers.filter((q) => q.id > 0).map((q) => q.id)),
  )
  const unassignedIds = new Set(body.unassigned.filter((q) => q.id > 0).map((q) => q.id))

  const teamsToDelete = currentTeams.filter((t) => !payloadTeamIds.has(t.id)).map((t) => t.id)

  // Quizzers not in any team or unassigned list: fully remove (roster + identity)
  const quizzersToFullyDelete = [...currentRosterMap.keys()].filter(
    (id) => !payloadQuizzerIds.has(id) && !unassignedIds.has(id),
  )

  // Existing unassigned quizzers that currently have a team_roster entry: remove from roster only
  const quizzersToUnassign = [...unassignedIds].filter((id) => currentRosterMap.has(id))

  // ---- Execute deletions ----

  // Delete team_roster entries for fully-deleted quizzers whose teams are NOT being deleted
  // (team cascade will handle entries on deleted teams)
  const deletedTeamIdSet = new Set(teamsToDelete)
  const rosterEntriesToDelete = quizzersToFullyDelete.filter((id) => {
    const r = currentRosterMap.get(id)
    return r && !deletedTeamIdSet.has(r.teamId)
  })
  if (rosterEntriesToDelete.length > 0) {
    await db
      .delete(schema.teamRosters)
      .where(inArray(schema.teamRosters.quizzerId, rosterEntriesToDelete))
  }

  if (teamsToDelete.length > 0) {
    await db.delete(schema.teams).where(inArray(schema.teams.id, teamsToDelete))
    // cascade deletes team_rosters for deleted teams
  }

  if (quizzersToFullyDelete.length > 0) {
    await db
      .delete(schema.quizzerIdentities)
      .where(inArray(schema.quizzerIdentities.id, quizzersToFullyDelete))
  }

  if (quizzersToUnassign.length > 0) {
    await db
      .delete(schema.teamRosters)
      .where(inArray(schema.teamRosters.quizzerId, quizzersToUnassign))
  }

  // ---- Create new teams and build tempId→realId map ----

  const teamIdMap = new Map<number, number>() // tempId → realId

  // Batch-insert all new teams, then map input slot → real id by returning order.
  const newTeamSlots = body.teams.map((t, i) => ({ t, number: i + 1 })).filter(({ t }) => t.id < 0)
  const newTeamRows = newTeamSlots.map(({ t, number }) => ({
    meetId: church.meetId,
    churchId,
    division: t.division,
    number,
  }))
  const insertedTeams =
    newTeamRows.length > 0 ? await db.insert(schema.teams).values(newTeamRows).returning() : []
  insertedTeams.forEach((team, idx) => {
    teamIdMap.set(newTeamSlots[idx]!.t.id, team.id)
  })

  for (let i = 0; i < body.teams.length; i++) {
    const t = body.teams[i]!
    if (t.id < 0) continue
    const current = currentTeamMap.get(t.id)
    const number = i + 1
    if (current && (current.division !== t.division || current.number !== number)) {
      await db
        .update(schema.teams)
        .set({ division: t.division, number })
        .where(eq(schema.teams.id, t.id))
    }
  }

  // ---- Sync quizzers ----

  const quizzerIdMap = new Map<number, number>() // tempId → realId

  const newQuizzerSlots: Array<{ tempId: number; teamId: number; name: string }> = []
  for (const t of body.teams) {
    const realTeamId = t.id > 0 ? t.id : teamIdMap.get(t.id)!
    for (const q of t.quizzers) {
      if (q.id < 0) {
        newQuizzerSlots.push({ tempId: q.id, teamId: realTeamId, name: q.name.trim() })
      }
    }
  }
  const newIdentityIds = await batchCreateQuizzers(db, newQuizzerSlots)
  newQuizzerSlots.forEach((slot, idx) => quizzerIdMap.set(slot.tempId, newIdentityIds[idx]!))

  // Serial updates: bounded by actual changes; batching would need CASE WHEN SQL.
  for (const t of body.teams) {
    const realTeamId = t.id > 0 ? t.id : teamIdMap.get(t.id)!
    for (const q of t.quizzers) {
      if (q.id < 0) continue
      const current = currentRosterMap.get(q.id)
      if (!current) continue
      const nameChanged = current.name !== q.name.trim()
      const movedTeam = current.teamId !== realTeamId

      if (movedTeam) {
        await db
          .update(schema.teamRosters)
          .set({ teamId: realTeamId, name: q.name.trim() })
          .where(
            and(
              eq(schema.teamRosters.quizzerId, q.id),
              eq(schema.teamRosters.teamId, current.teamId),
            ),
          )
      } else if (nameChanged) {
        await db
          .update(schema.teamRosters)
          .set({ name: q.name.trim() })
          .where(
            and(eq(schema.teamRosters.quizzerId, q.id), eq(schema.teamRosters.teamId, realTeamId)),
          )
      }
    }
  }

  // ---- Build response from payload order (with real IDs) ----

  const responseTeams = []
  for (let i = 0; i < body.teams.length; i++) {
    const t = body.teams[i]!
    const realTeamId = t.id > 0 ? t.id : teamIdMap.get(t.id)!
    responseTeams.push({
      id: realTeamId,
      meetId: church.meetId,
      churchId,
      division: t.division,
      number: i + 1,
      quizzers: t.quizzers
        .filter((q) => q.id > 0 || quizzerIdMap.has(q.id))
        .map((q) => ({
          quizzerId: q.id > 0 ? q.id : quizzerIdMap.get(q.id)!,
          name: q.name.trim(),
        })),
    })
  }

  const responseUnassigned = body.unassigned
    .filter((q) => q.id > 0)
    .map((q) => ({ quizzerId: q.id, name: q.name.trim() }))

  return c.json({ teams: responseTeams, unassigned: responseUnassigned })
})

/**
 * GET /api/meets/:meetId/teams
 *
 * Returns all teams for a meet with their church label in one query, plus the
 * meet's canonical division list. Used by the scoresheet to populate the
 * division dropdown and team picker in quizmeet mode.
 * Any authenticated member of the meet can read.
 */
churches.get('/meets/:meetId/teams', async (c) => {
  const meetId = Number(c.req.param('meetId'))
  if (Number.isNaN(meetId)) return c.json({ error: 'Invalid meet ID' }, 400)

  const db = getDb(c)

  const [[meetRow], rows] = await Promise.all([
    db
      .select({ divisions: schema.quizMeets.divisions })
      .from(schema.quizMeets)
      .where(eq(schema.quizMeets.id, meetId)),
    db
      .select({
        id: schema.teams.id,
        churchId: schema.churches.id,
        churchName: schema.churches.name,
        churchShortName: schema.churches.shortName,
        division: schema.teams.division,
        number: schema.teams.number,
        consolation: schema.teams.consolation,
      })
      .from(schema.teams)
      .innerJoin(schema.churches, eq(schema.teams.churchId, schema.churches.id))
      .where(eq(schema.teams.meetId, meetId))
      .orderBy(schema.churches.name, schema.teams.number),
  ])

  const meetDivisions: string[] = meetRow ? (JSON.parse(meetRow.divisions) as string[]) : []

  return c.json({ teams: rows, meetDivisions })
})

/**
 * GET /api/meets/:meetId/roster/export
 *
 * Returns a flat list of all quizzers across all teams in a meet,
 * with church and team metadata. Any authenticated user can read.
 */
churches.get('/meets/:meetId/roster/export', async (c) => {
  const meetId = Number(c.req.param('meetId'))
  if (Number.isNaN(meetId)) return c.json({ error: 'Invalid meet ID' }, 400)

  const db = getDb(c)

  const rows = await db
    .select({
      churchId: schema.churches.id,
      churchName: schema.churches.name,
      churchShortName: schema.churches.shortName,
      teamId: schema.teams.id,
      teamNumber: schema.teams.number,
      division: schema.teams.division,
      quizzerName: schema.teamRosters.name,
    })
    .from(schema.churches)
    .innerJoin(schema.teams, eq(schema.teams.churchId, schema.churches.id))
    .innerJoin(schema.teamRosters, eq(schema.teamRosters.teamId, schema.teams.id))
    .where(eq(schema.churches.meetId, meetId))
    .orderBy(schema.churches.id, schema.teams.number, schema.teamRosters.name)

  return c.json({ entries: rows })
})

// ---- Roster import ----

/**
 * POST /api/meets/:meetId/roster/import
 *
 * Bulk-import roster entries parsed from CSV.
 * Matches churches by name/shortName, creates missing ones.
 * Deduplicates teams per church+division+teamName within the payload.
 * Skips quizzers already on a team by name.
 * Requires admin or superuser.
 */
churches.post('/meets/:meetId/roster/import', async (c) => {
  const meetId = Number(c.req.param('meetId'))
  if (Number.isNaN(meetId)) return c.json({ error: 'Invalid meet ID' }, 400)

  const user = getUser(c)
  const db = getDb(c)

  if (!(await isAdminOrSuperuser(db, user.id, user.role, meetId))) {
    return c.json({ error: 'Admin or superuser access required' }, 403)
  }

  const body =
    await c.req.json<
      Array<{ church: string; division: string; teamName: string; quizzerName: string }>
    >()
  if (!Array.isArray(body) || body.length === 0) {
    return c.json({ error: 'Payload must be a non-empty array of roster entries' }, 400)
  }

  const existingChurches = await db
    .select()
    .from(schema.churches)
    .where(eq(schema.churches.meetId, meetId))

  // churchName (lowered) → Church row
  const churchByName = new Map<string, schema.Church>()
  const churchByShortName = new Map<string, schema.Church>()
  for (const ch of existingChurches) {
    churchByName.set(ch.name.toLowerCase(), ch)
    churchByShortName.set(ch.shortName.toLowerCase(), ch)
  }

  // Collect unique church names from payload and resolve/create
  const churchNameToId = new Map<string, number>() // raw name → churchId
  const uniqueChurchNames = [...new Set(body.map((e) => e.church.trim()).filter(Boolean))]

  let churchesCreated = 0
  for (const rawName of uniqueChurchNames) {
    const lower = rawName.toLowerCase()
    const existing = churchByName.get(lower) ?? churchByShortName.get(lower) ?? null
    if (existing) {
      churchNameToId.set(rawName, existing.id)
    } else {
      const coachCode = generateCode()
      const coachCodeHash = await hashCode(coachCode)
      const [created] = await db
        .insert(schema.churches)
        .values({ meetId, name: rawName, shortName: rawName, coachCodeHash })
        .returning()
      churchNameToId.set(rawName, created!.id)
      churchByName.set(lower, created!)
      churchesCreated++
    }
  }

  // Group entries by (churchId, division, teamName) — each unique combination is one team
  interface GroupKey {
    churchId: number
    division: string
    teamName: string
  }
  const teamGroupMap = new Map<string, { key: GroupKey; quizzerNames: string[] }>()
  for (const entry of body) {
    const churchName = entry.church.trim()
    const churchId = churchNameToId.get(churchName)
    if (!churchId) continue
    const division = entry.division.trim()
    const teamName = entry.teamName.trim()
    const quizzerName = entry.quizzerName.trim()
    if (!teamName || !quizzerName) continue
    const key = `${churchId}|${division}|${teamName}`
    if (!teamGroupMap.has(key)) {
      teamGroupMap.set(key, { key: { churchId, division, teamName }, quizzerNames: [] })
    }
    const group = teamGroupMap.get(key)!
    if (!group.quizzerNames.includes(quizzerName)) {
      group.quizzerNames.push(quizzerName)
    }
  }

  // Load existing teams + rosters across all involved churches in two queries.
  const allChurchIds = [...new Set([...teamGroupMap.values()].map((g) => g.key.churchId))]
  const existingTeams =
    allChurchIds.length > 0
      ? await db.select().from(schema.teams).where(inArray(schema.teams.churchId, allChurchIds))
      : []
  const existingRosterRows =
    existingTeams.length > 0
      ? await db
          .select()
          .from(schema.teamRosters)
          .where(
            inArray(
              schema.teamRosters.teamId,
              existingTeams.map((t) => t.id),
            ),
          )
      : []

  const rosterByTeam = new Map<number, string[]>()
  for (const row of existingRosterRows) {
    if (!rosterByTeam.has(row.teamId)) rosterByTeam.set(row.teamId, [])
    rosterByTeam.get(row.teamId)!.push(row.name)
  }
  const nextNumberByChurch = new Map<number, number>(allChurchIds.map((cid) => [cid, 1]))
  const existingTeamRosters = new Map<
    number,
    Array<{ teamId: number; division: string; quizzerNames: Set<string> }>
  >(allChurchIds.map((cid) => [cid, []]))
  for (const t of existingTeams) {
    existingTeamRosters.get(t.churchId)!.push({
      teamId: t.id,
      division: t.division,
      quizzerNames: new Set(rosterByTeam.get(t.id) ?? []),
    })
    const nextNum = t.number + 1
    if (nextNum > nextNumberByChurch.get(t.churchId)!) {
      nextNumberByChurch.set(t.churchId, nextNum)
    }
  }

  // Decide new teams + their quizzer lists up front, then write in two phases:
  // (1) batch-insert teams, (2) batch-create quizzers pairing identity ids by slot.
  const teamPlans: Array<{
    insert: { meetId: number; churchId: number; division: string; number: number }
    names: string[]
  }> = []
  for (const { key, quizzerNames } of teamGroupMap.values()) {
    const existing = existingTeamRosters.get(key.churchId) ?? []
    const isDuplicate = existing.some(
      (t) =>
        t.division === key.division &&
        t.quizzerNames.size === quizzerNames.length &&
        quizzerNames.every((n) => t.quizzerNames.has(n)),
    )
    if (isDuplicate) continue

    const number = nextNumberByChurch.get(key.churchId)!
    nextNumberByChurch.set(key.churchId, number + 1)
    teamPlans.push({
      insert: { meetId, churchId: key.churchId, division: key.division, number },
      names: quizzerNames,
    })
  }

  const insertedTeams =
    teamPlans.length > 0
      ? await db
          .insert(schema.teams)
          .values(teamPlans.map((p) => p.insert))
          .returning()
      : []

  const quizzerSlots: Array<{ teamId: number; name: string }> = []
  insertedTeams.forEach((team, idx) => {
    for (const name of teamPlans[idx]!.names) {
      quizzerSlots.push({ teamId: team.id, name })
    }
  })
  await batchCreateQuizzers(db, quizzerSlots)

  return c.json(
    { churchesCreated, teamsCreated: insertedTeams.length, quizzersAdded: quizzerSlots.length },
    201,
  )
})

// ---- Helpers ----

/**
 * Create N new quizzers in two batched writes: allocate identities, then insert
 * rosters pairing `slots[i]` with `identities[i].id`. Relies on Drizzle
 * preserving input order in `.returning()`.
 */
async function batchCreateQuizzers(
  db: Db,
  slots: Array<{ teamId: number; name: string }>,
): Promise<number[]> {
  if (slots.length === 0) return []
  const identities = await db
    .insert(schema.quizzerIdentities)
    .values(Array.from({ length: slots.length }, () => ({})))
    .returning()
  const rosterRows = slots.map((slot, idx) => ({
    teamId: slot.teamId,
    quizzerId: identities[idx]!.id,
    name: slot.name,
  }))
  await db.insert(schema.teamRosters).values(rosterRows)
  return identities.map((i) => i.id)
}

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

export { requireSuperuser }
