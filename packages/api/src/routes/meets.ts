import { Hono, type Context } from 'hono'
import { eq, and, sql } from 'drizzle-orm'
import type { Bindings } from '../bindings'
import type { SessionVariables } from '../middleware/session'
import { requireAuth, requireAuthOrGuest, requireSuperuser, getUser } from '../middleware/session'
import { asOne, createDb, isUniqueViolation, viewerCodeIs, type Db } from '../lib/db'
import { generateCode, hashCode, wantsClearMembers } from '../lib/codes'
import { isAdminOrSuperuser, isViewerOf } from '../lib/permissions'
import * as schema from '../db/schema'
import { meetIdOf } from '../lib/request'
import { AccountRole, isBlankSheet, MeetRole, readOds } from '@qzr/shared'

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

/**
 * Top-level paths under `/qzr/` a meet's viewer code can't take: the portal's own pages, the
 * scoresheet app, this API, and the portal's build files.
 */
const RESERVED_VIEWER_CODES = new Set([
  'account',
  'api',
  'assets',
  'builder',
  'roadmap',
  'scoresheet',
])

/**
 * Why a viewer code is refused, or null. Codes are slugs, and never all digits so a `?meet=` link
 * can't be read as a meet id.
 */
function viewerCodeProblem(code: string): string | null {
  if (!/^[A-Za-z0-9-]+$/.test(code)) return 'Viewer code may use only letters, digits, and hyphens'
  if (MEET_ID.test(code)) return "Viewer code can't be only digits; add a letter"
  if (RESERVED_VIEWER_CODES.has(code.toLowerCase())) return 'That viewer code is reserved'
  return null
}

async function currentViewerCode(db: Db, id: number): Promise<string | undefined> {
  const [meet] = await db
    .select({ viewerCode: schema.quizMeets.viewerCode })
    .from(schema.quizMeets)
    .where(eq(schema.quizMeets.id, id))
  return meet?.viewerCode
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
    // The edit form sends the code with every change, so a meet keeps the address it has, even one a
    // later rule refuses; only a new address is checked, and case doesn't change an address
    const current = problem ? await currentViewerCode(db, id) : undefined
    if (problem && viewerCode.toLowerCase() !== current?.toLowerCase()) {
      return c.json({ error: problem }, 400)
    }
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

// ---- Scoring template ----

/** D1 keeps a row up to 2,000,000 bytes, file name included; a scoring template is about 100 KB */
const MAX_TEMPLATE_BYTES = 1_900_000

/**
 * The meet's scoring template, for anyone who may read the meet's rosters (guests of the meet,
 * officials among them, members and superusers), so a room can carry on in spreadsheets. HEAD
 * answers from this route with the headers alone.
 */
meets.get('/:id/template', async (c) => {
  const meetId = meetIdOf(c)
  if (meetId === null) return c.json({ error: 'Invalid meet ID' }, 400)

  const db = getDb(c)
  if (!(await isViewerOf(c, db, meetId))) return c.json({ error: 'Forbidden' }, 403)

  // A HEAD asks only whether there is one, so the bytes stay in the database
  const facts = {
    fileName: schema.meetTemplates.fileName,
    uploadedAt: schema.meetTemplates.uploadedAt,
  }
  const head = c.req.method === 'HEAD'
  const [row] = await db
    .select(head ? facts : { ...facts, bytes: schema.meetTemplates.bytes })
    .from(schema.meetTemplates)
    .where(eq(schema.meetTemplates.meetId, meetId))
  if (!row) return c.json({ error: 'The meet has no scoring template yet' }, 404)
  const body = 'bytes' in row ? new Uint8Array(row.bytes as Buffer) : null
  return new Response(body, {
    headers: {
      // As uploaded: a template, or a sheet kept as one
      'Content-Type': /\.ods$/i.test(row.fileName)
        ? 'application/vnd.oasis.opendocument.spreadsheet'
        : 'application/vnd.oasis.opendocument.spreadsheet-template',
      'Content-Disposition': `attachment; filename*=UTF-8''${rfc5987(row.fileName)}`,
      'Last-Modified': row.uploadedAt.toUTCString(),
    },
  })
})

/**
 * Store the meet's scoring template, replacing any earlier one. The body is the file itself and
 * X-File-Name its name. Only a spreadsheet with the Quiz sheet the scoresheet fills is kept, so a
 * wrong file is refused here rather than failing every download made from it later.
 */
meets.put('/:id/template', requireAuth(), async (c) => {
  const meetId = meetIdOf(c)
  if (meetId === null) return c.json({ error: 'Invalid meet ID' }, 400)

  const user = getUser(c)
  const db = getDb(c)
  if (!(await isAdminOrSuperuser(db, user.id, user.role, meetId))) {
    return c.json({ error: 'Admin or superuser access required' }, 403)
  }
  const [meet] = await db
    .select({ phase: schema.quizMeets.phase })
    .from(schema.quizMeets)
    .where(eq(schema.quizMeets.id, meetId))
  if (!meet) return c.json({ error: 'Meet not found' }, 404)
  if (meet.phase === 'done') {
    return c.json({ error: 'The template stays as it is once the meet is done' }, 409)
  }

  // A size the client declares is refused before the body is read
  if (Number(c.req.header('Content-Length') ?? 0) > MAX_TEMPLATE_BYTES) {
    return c.json({ error: 'A scoring template is at most 1.9 MB' }, 400)
  }
  const bytes = new Uint8Array(await c.req.arrayBuffer())
  if (bytes.length > MAX_TEMPLATE_BYTES) {
    return c.json({ error: 'A scoring template is at most 1.9 MB' }, 400)
  }
  let read: ReturnType<typeof readOds>
  try {
    read = readOds(bytes)
  } catch (e) {
    const tooLarge = e instanceof Error && /too large/.test(e.message)
    const error = tooLarge
      ? 'Not a scoring template: its files unpack to far more than a sheet holds'
      : 'Not a scoring template: it has no Quiz sheet to fill'
    return c.json({ error }, 400)
  }
  // Filling patches only the cells a quiz uses, so a filled sheet would leave its own marks behind
  if (!isBlankSheet(read)) {
    return c.json({ error: 'That sheet is filled in: upload the blank Scoresheet.ots' }, 400)
  }

  // Sent encoded, since a header carries only Latin-1
  const fileName = decodedName(c.req.header('X-File-Name')) || 'Scoresheet.ots'
  const values = {
    fileName,
    bytes: Buffer.from(bytes),
    uploadedAt: new Date(),
    uploadedById: user.id,
  }
  await db
    .insert(schema.meetTemplates)
    .values({ meetId, ...values })
    .onConflictDoUpdate({ target: schema.meetTemplates.meetId, set: values })
  return c.json({ fileName, uploadedAt: values.uploadedAt.toISOString() })
})

/** A file name as a Content-Disposition filename* carries it, which also escapes ' ( ) * */
function rfc5987(name: string): string {
  return encodeURIComponent(name).replace(
    /['()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

/** A file name as the client encoded it for its header; as sent when it isn't encoded */
function decodedName(header: string | undefined): string {
  if (!header) return ''
  try {
    return decodeURIComponent(header).trim()
  } catch {
    return header.trim()
  }
}

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
