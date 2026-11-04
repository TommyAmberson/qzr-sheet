import { Hono, type Context } from 'hono'
import { eq, and, sql } from 'drizzle-orm'
import type { Bindings } from '../bindings'
import type { SessionVariables } from '../middleware/session'
import { requireAuth, requireAuthOrGuest, requireSuperuser, getUser } from '../middleware/session'
import { asOne, createDb, isUniqueViolation, viewerCodeIs, type Db } from '../lib/db'
import { generateCode, hashCode, wantsClearMembers } from '../lib/codes'
import { isAdminOrSuperuser, isViewerOf } from '../lib/permissions'
import * as schema from '../db/schema'
import { AccountRole, MeetRole } from '@qzr/shared'

export interface MeetsVariables extends SessionVariables {
  db: Db
}

type Env = { Bindings: Bindings; Variables: MeetsVariables }

const meets = new Hono<Env>()

// Reads admit guest JWTs (scoped per-meet); mutations gate via requireAuth on the
// individual route below.
meets.use('*', requireAuthOrGuest())

// Inject DB from env binding (overridable in tests via the db variable)
meets.use('*', async (c, next) => {
  if (!c.get('db')) {
    c.set('db', createDb(c.env.DB) as unknown as Db)
  }
  await next()
})

function getDb(c: { get(key: 'db'): Db }): Db {
  return c.get('db')
}

// ---- Meet CRUD ----

/** A path parameter made only of digits names a meet by id; anything else is a viewer code */
const MEET_ID = /^\d+$/

/** Top-level portal paths a meet's viewer code can't take. */
const RESERVED_VIEWER_CODES = new Set(['account', 'builder', 'roadmap'])

/**
 * Why a viewer code is refused, or null. Codes are slugs, and never all digits so a `?meet=` link
 * can't be read as a meet id.
 */
function viewerCodeProblem(code: string): string | null {
  if (!/^[A-Za-z0-9-]+$/.test(code)) return 'Viewer code may use only letters, digits, and hyphens'
  if (MEET_ID.test(code)) return "Viewer code can't be only digits; add a letter"
  // The portal's own pages sit beside meets at the top level.
  if (RESERVED_VIEWER_CODES.has(code.toLowerCase())) return 'That viewer code is reserved'
  return null
}

function viewerCodeTaken(c: Context<Env>) {
  return c.json({ error: 'Another meet already uses that viewer code' }, 409)
}

meets.post('/', requireSuperuser(), async (c) => {
  const body = await c.req.json<{
    name: string
    dateFrom: string
    dateTo?: string
    viewerCode: string
    divisions: string[]
  }>()
  if (!body.name?.trim() || !body.dateFrom?.trim() || !body.viewerCode?.trim()) {
    return c.json({ error: 'name, dateFrom, and viewerCode are required' }, 400)
  }
  if (!Array.isArray(body.divisions) || body.divisions.length === 0) {
    return c.json({ error: 'divisions must be a non-empty array' }, 400)
  }
  const viewerCode = body.viewerCode.trim()
  const problem = viewerCodeProblem(viewerCode)
  if (problem) return c.json({ error: problem }, 400)

  const adminCode = generateCode()
  const adminHash = await hashCode(adminCode)

  try {
    const [meet] = await getDb(c)
      .insert(schema.quizMeets)
      .values({
        name: body.name.trim(),
        dateFrom: body.dateFrom.trim(),
        dateTo: body.dateTo?.trim() ?? null,
        viewerCode,
        divisions: JSON.stringify(body.divisions.map((d) => d.trim()).filter(Boolean)),
        adminCodeHash: adminHash,
        createdAt: new Date(),
      })
      .returning()
    return c.json({ meet: formatMeet(meet!), adminCode }, 201)
  } catch (e) {
    if (isUniqueViolation(e, schema.VIEWER_CODE_INDEX)) return viewerCodeTaken(c)
    throw e
  }
})

meets.get('/', requireSuperuser(), async (c) => {
  const rows = await getDb(c).select().from(schema.quizMeets)
  return c.json({ meets: rows.map((m) => formatMeet(m)) })
})

meets.get('/:id', async (c) => {
  const param = c.req.param('id')
  const db = getDb(c)

  const [meet] = MEET_ID.test(param)
    ? await db
        .select()
        .from(schema.quizMeets)
        .where(eq(schema.quizMeets.id, Number(param)))
    : await db.select().from(schema.quizMeets).where(viewerCodeIs(param))

  if (!meet) return c.json({ error: 'Meet not found' }, 404)

  const id = meet.id

  if (!(await isViewerOf(c, db, id))) return c.json({ error: 'Forbidden' }, 403)

  const codes = await db
    .select({ id: schema.meetRooms.id, label: schema.meetRooms.name })
    .from(schema.meetRooms)
    .where(eq(schema.meetRooms.meetId, id))

  // Every viewer gets the viewer code, guests included, so they can share the meet's link; guests
  // don't get the room list
  const isGuest = !!c.get('guest')
  return c.json({ meet: formatMeet(meet), officialCodes: isGuest ? [] : codes })
})

meets.patch('/:id', requireAuth(), async (c) => {
  const id = Number(c.req.param('id'))
  if (Number.isNaN(id)) return c.json({ error: 'Invalid meet ID' }, 400)

  const user = getUser(c)
  const db = getDb(c)
  if (!(await isAdminOrSuperuser(db, user.id, user.role, id))) {
    return c.json({ error: 'Admin or superuser access required' }, 403)
  }

  const body = await c.req.json<{
    name?: string
    dateFrom?: string
    dateTo?: string
    viewerCode?: string
    divisions?: string[]
    registrationClosesAt?: string | number | null
    meetStartsAt?: string | number | null
  }>()
  const updates: Record<string, string | number | Date | null> = {}
  if (body.name?.trim()) updates.name = body.name.trim()
  if (body.dateFrom?.trim()) updates.dateFrom = body.dateFrom.trim()
  if ('dateTo' in body) updates.dateTo = body.dateTo?.trim() ?? null
  const viewerCode = body.viewerCode?.trim()
  if (viewerCode) {
    const problem = viewerCodeProblem(viewerCode)
    if (problem) return c.json({ error: problem }, 400)
    updates.viewerCode = viewerCode
  }
  if (Array.isArray(body.divisions) && body.divisions.length > 0) {
    updates.divisions = JSON.stringify(body.divisions.map((d: string) => d.trim()).filter(Boolean))
  }
  if ('registrationClosesAt' in body) {
    if (body.registrationClosesAt == null) {
      updates.registrationClosesAt = null
    } else {
      const d = new Date(body.registrationClosesAt)
      if (Number.isNaN(d.getTime())) return c.json({ error: 'Invalid registrationClosesAt' }, 400)
      updates.registrationClosesAt = d
    }
  }
  if ('meetStartsAt' in body) {
    if (body.meetStartsAt == null) {
      updates.meetStartsAt = null
    } else {
      const d = new Date(body.meetStartsAt)
      if (Number.isNaN(d.getTime())) return c.json({ error: 'Invalid meetStartsAt' }, 400)
      updates.meetStartsAt = d
    }
  }

  if (Object.keys(updates).length === 0) {
    return c.json({ error: 'No valid fields to update' }, 400)
  }

  let updated: typeof schema.quizMeets.$inferSelect | undefined
  try {
    ;[updated] = await db
      .update(schema.quizMeets)
      .set(updates)
      .where(eq(schema.quizMeets.id, id))
      .returning()
  } catch (e) {
    if (isUniqueViolation(e, schema.VIEWER_CODE_INDEX)) return viewerCodeTaken(c)
    throw e
  }

  if (!updated) return c.json({ error: 'Meet not found' }, 404)
  return c.json({ meet: formatMeet(updated) })
})

meets.delete('/:id', requireSuperuser(), async (c) => {
  const id = Number(c.req.param('id'))
  if (Number.isNaN(id)) return c.json({ error: 'Invalid meet ID' }, 400)

  const deleted = await getDb(c)
    .delete(schema.quizMeets)
    .where(eq(schema.quizMeets.id, id))
    .returning({ id: schema.quizMeets.id })

  if (deleted.length === 0) return c.json({ error: 'Meet not found' }, 404)
  return c.json({ deleted: true })
})

// ---- Admin code rotation ----

meets.post('/:id/rotate-admin-code', requireAuth(), async (c) => {
  const id = Number(c.req.param('id'))
  if (Number.isNaN(id)) return c.json({ error: 'Invalid meet ID' }, 400)

  const user = getUser(c)
  const db = getDb(c)

  if (!(await isAdminOrSuperuser(db, user.id, user.role, id))) {
    return c.json({ error: 'Admin or superuser access required' }, 403)
  }
  const clearMembers = await wantsClearMembers(c.req)
  if (clearMembers && user.role !== AccountRole.Superuser) {
    return c.json({ error: 'Only superusers can clear admin memberships' }, 403)
  }

  const adminCode = generateCode()
  const adminHash = await hashCode(adminCode)

  const rotate = db
    .update(schema.quizMeets)
    .set({ adminCodeHash: adminHash })
    .where(eq(schema.quizMeets.id, id))
    .returning({ id: schema.quizMeets.id })
  // Rotate and clear removes the old code's admins in the same batch, so neither happens alone
  const clear = db.delete(schema.adminMemberships).where(eq(schema.adminMemberships.meetId, id))
  const [rotated] = await asOne(db, clearMembers ? [rotate, clear] : [rotate])
  const [updated] = rotated as Awaited<typeof rotate>

  if (!updated) return c.json({ error: 'Meet not found' }, 404)
  return c.json({ adminCode })
})

// ---- Division team counts (drives schedule editor advice) ----

meets.get('/:id/team-counts', async (c) => {
  const meetId = Number(c.req.param('id'))
  if (Number.isNaN(meetId)) return c.json({ error: 'Invalid meet ID' }, 400)

  const db = getDb(c)
  if (!(await isViewerOf(c, db, meetId))) return c.json({ error: 'Forbidden' }, 403)

  const rows = await db
    .select({
      division: schema.teams.division,
      count: sql<number>`count(${schema.teams.id})`.mapWith(Number),
    })
    .from(schema.teams)
    .where(eq(schema.teams.meetId, meetId))
    .groupBy(schema.teams.division)

  const counts: Record<string, number> = {}
  for (const r of rows) counts[r.division] = r.count
  return c.json({ counts })
})

// ---- Official codes ----

meets.post('/:id/official-codes', requireAuth(), async (c) => {
  const meetId = Number(c.req.param('id'))
  if (Number.isNaN(meetId)) return c.json({ error: 'Invalid meet ID' }, 400)

  const user = getUser(c)
  const db = getDb(c)
  if (!(await isAdminOrSuperuser(db, user.id, user.role, meetId))) {
    return c.json({ error: 'Admin or superuser access required' }, 403)
  }

  const body = await c.req.json<{ label: string }>()
  if (!body.label?.trim()) return c.json({ error: 'label is required' }, 400)

  const [meet] = await db
    .select({ id: schema.quizMeets.id })
    .from(schema.quizMeets)
    .where(eq(schema.quizMeets.id, meetId))
  if (!meet) return c.json({ error: 'Meet not found' }, 404)

  const code = generateCode()
  const codeHash = await hashCode(code)

  const [created] = await db
    .insert(schema.meetRooms)
    .values({ meetId, name: body.label.trim(), codeHash })
    .returning()

  return c.json({ officialCode: { id: created!.id, label: created!.name }, code }, 201)
})

meets.delete('/:id/official-codes/:codeId', requireAuth(), async (c) => {
  const meetId = Number(c.req.param('id'))
  const codeId = Number(c.req.param('codeId'))
  if (Number.isNaN(meetId) || Number.isNaN(codeId)) {
    return c.json({ error: 'Invalid ID' }, 400)
  }

  const user = getUser(c)
  const db = getDb(c)
  if (!(await isAdminOrSuperuser(db, user.id, user.role, meetId))) {
    return c.json({ error: 'Admin or superuser access required' }, 403)
  }

  const deleted = await db
    .delete(schema.meetRooms)
    .where(and(eq(schema.meetRooms.id, codeId), eq(schema.meetRooms.meetId, meetId)))
    .returning({ id: schema.meetRooms.id })

  if (deleted.length === 0) return c.json({ error: 'Official code not found' }, 404)
  return c.json({ deleted: true })
})

/**
 * POST /api/meets/:id/official-codes/:codeId/rotate
 *
 * Gives the room a new code. With `{ clearMembers: true }` it also removes the room's official
 * memberships, which the old code granted.
 */
meets.post('/:id/official-codes/:codeId/rotate', requireAuth(), async (c) => {
  const meetId = Number(c.req.param('id'))
  const codeId = Number(c.req.param('codeId'))
  if (Number.isNaN(meetId) || Number.isNaN(codeId)) {
    return c.json({ error: 'Invalid ID' }, 400)
  }

  const user = getUser(c)
  const db = getDb(c)
  if (!(await isAdminOrSuperuser(db, user.id, user.role, meetId))) {
    return c.json({ error: 'Admin or superuser access required' }, 403)
  }

  const clearMembers = await wantsClearMembers(c.req)
  const code = generateCode()
  const codeHash = await hashCode(code)

  const rotate = db
    .update(schema.meetRooms)
    .set({ codeHash })
    .where(and(eq(schema.meetRooms.id, codeId), eq(schema.meetRooms.meetId, meetId)))
    .returning({ id: schema.meetRooms.id, label: schema.meetRooms.name })
  // Rotate and clear removes the room's officials in the same batch, so neither happens alone. Both
  // are scoped to this meet, so another meet's room is left alone.
  const clear = db
    .delete(schema.officialMemberships)
    .where(
      and(
        eq(schema.officialMemberships.roomId, codeId),
        eq(schema.officialMemberships.meetId, meetId),
      ),
    )
  const [rotated] = await asOne(db, clearMembers ? [rotate, clear] : [rotate])
  const [updated] = rotated as Awaited<typeof rotate>

  if (!updated) return c.json({ error: 'Official code not found' }, 404)
  return c.json({ officialCode: updated, code })
})

// ---- Members ----

interface MeetMember {
  userId: string
  name: string
  email: string
  role: MeetRole
  churchId?: number
  officialCodeId?: number // preserved API field name (maps to room id)
}

meets.get('/:id/members', requireAuth(), async (c) => {
  const meetId = Number(c.req.param('id'))
  if (Number.isNaN(meetId)) return c.json({ error: 'Invalid meet ID' }, 400)

  const user = getUser(c)
  const db = getDb(c)
  if (!(await isAdminOrSuperuser(db, user.id, user.role, meetId))) {
    return c.json({ error: 'Admin or superuser access required' }, 403)
  }

  const [admins, coaches, officials, viewers] = await Promise.all([
    db
      .select({
        userId: schema.adminMemberships.accountId,
        name: schema.user.name,
        email: schema.user.email,
      })
      .from(schema.adminMemberships)
      .innerJoin(schema.user, eq(schema.adminMemberships.accountId, schema.user.id))
      .where(eq(schema.adminMemberships.meetId, meetId)),
    db
      .select({
        userId: schema.coachMemberships.accountId,
        name: schema.user.name,
        email: schema.user.email,
        churchId: schema.coachMemberships.churchId,
      })
      .from(schema.coachMemberships)
      .innerJoin(schema.user, eq(schema.coachMemberships.accountId, schema.user.id))
      .where(eq(schema.coachMemberships.meetId, meetId)),
    db
      .select({
        userId: schema.officialMemberships.accountId,
        name: schema.user.name,
        email: schema.user.email,
        officialCodeId: schema.officialMemberships.roomId,
      })
      .from(schema.officialMemberships)
      .innerJoin(schema.user, eq(schema.officialMemberships.accountId, schema.user.id))
      .where(eq(schema.officialMemberships.meetId, meetId)),
    db
      .select({
        userId: schema.viewerMemberships.accountId,
        name: schema.user.name,
        email: schema.user.email,
      })
      .from(schema.viewerMemberships)
      .innerJoin(schema.user, eq(schema.viewerMemberships.accountId, schema.user.id))
      .where(eq(schema.viewerMemberships.meetId, meetId)),
  ])

  const members: MeetMember[] = [
    ...admins.map((r) => ({ ...r, role: MeetRole.Admin })),
    ...coaches.map((r) => ({ ...r, role: MeetRole.HeadCoach })),
    ...officials.map((r) => ({ ...r, role: MeetRole.Official })),
    ...viewers.map((r) => ({ ...r, role: MeetRole.Viewer })),
  ]

  return c.json({ members })
})

meets.delete('/:id/members/:userId', requireAuth(), async (c) => {
  const meetId = Number(c.req.param('id'))
  if (Number.isNaN(meetId)) return c.json({ error: 'Invalid meet ID' }, 400)
  const targetUserId = c.req.param('userId')

  const user = getUser(c)
  const db = getDb(c)
  if (!(await isAdminOrSuperuser(db, user.id, user.role, meetId))) {
    return c.json({ error: 'Admin or superuser access required' }, 403)
  }

  const body = await c.req.json<{
    role: MeetRole
    churchId?: number
    officialCodeId?: number
  }>()

  let deleted = 0

  if (body.role === MeetRole.Admin) {
    if (user.role !== AccountRole.Superuser) {
      return c.json({ error: 'Only superusers can revoke admin memberships' }, 403)
    }
    const rows = await db
      .delete(schema.adminMemberships)
      .where(
        and(
          eq(schema.adminMemberships.accountId, targetUserId),
          eq(schema.adminMemberships.meetId, meetId),
        ),
      )
      .returning()
    deleted = rows.length
  } else if (body.role === MeetRole.HeadCoach && body.churchId) {
    const rows = await db
      .delete(schema.coachMemberships)
      .where(
        and(
          eq(schema.coachMemberships.accountId, targetUserId),
          eq(schema.coachMemberships.meetId, meetId),
          eq(schema.coachMemberships.churchId, body.churchId),
        ),
      )
      .returning()
    deleted = rows.length
  } else if (body.role === MeetRole.Official && body.officialCodeId) {
    const rows = await db
      .delete(schema.officialMemberships)
      .where(
        and(
          eq(schema.officialMemberships.accountId, targetUserId),
          eq(schema.officialMemberships.meetId, meetId),
          eq(schema.officialMemberships.roomId, body.officialCodeId),
        ),
      )
      .returning()
    deleted = rows.length
  } else if (body.role === MeetRole.Viewer) {
    const rows = await db
      .delete(schema.viewerMemberships)
      .where(
        and(
          eq(schema.viewerMemberships.accountId, targetUserId),
          eq(schema.viewerMemberships.meetId, meetId),
        ),
      )
      .returning()
    deleted = rows.length
  } else {
    return c.json({ error: 'Invalid role or missing scope' }, 400)
  }

  if (deleted === 0) return c.json({ error: 'Membership not found' }, 404)
  return c.json({ deleted: true })
})

// ---- Helpers ----

function formatMeet(meet: schema.QuizMeet) {
  return {
    id: meet.id,
    name: meet.name,
    dateFrom: meet.dateFrom,
    dateTo: meet.dateTo,
    viewerCode: meet.viewerCode,
    divisions: JSON.parse(meet.divisions) as string[],
    createdAt: meet.createdAt,
    phase: meet.phase,
    registrationClosesAt: meet.registrationClosesAt,
    meetStartsAt: meet.meetStartsAt,
  }
}

export { meets }
