import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'
import type { Bindings } from '../bindings'
import type { SessionVariables } from '../middleware/session'
import { requireAuth, requireAdmin, getUser } from '../middleware/session'
import { createDb, type Db } from '../lib/db'
import { generateCode, hashCode } from '../lib/codes'
import * as schema from '../db/schema'
import { AccountRole } from '@qzr/shared'

export interface MeetsVariables extends SessionVariables {
  db: Db
}

type Env = { Bindings: Bindings; Variables: MeetsVariables }

const meets = new Hono<Env>()

// All meet management routes require auth; mutations require superuser
meets.use('*', requireAuth())

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

meets.post('/', requireAdmin(), async (c) => {
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

  const coachCode = generateCode()
  const coachHash = await hashCode(coachCode)

  const [meet] = await getDb(c)
    .insert(schema.quizMeets)
    .values({
      name: body.name.trim(),
      dateFrom: body.dateFrom.trim(),
      dateTo: body.dateTo?.trim() ?? null,
      viewerCode: body.viewerCode.trim(),
      divisions: JSON.stringify(body.divisions.map((d) => d.trim()).filter(Boolean)),
      coachCodeHash: coachHash,
      createdAt: new Date(),
    })
    .returning()

  return c.json({ meet: formatMeet(meet!), coachCode }, 201)
})

meets.get('/', requireAdmin(), async (c) => {
  const rows = await getDb(c).select().from(schema.quizMeets)
  return c.json({ meets: rows.map(formatMeet) })
})

meets.get('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (Number.isNaN(id)) return c.json({ error: 'Invalid meet ID' }, 400)

  const user = getUser(c)
  const db = getDb(c)

  // Superusers have access to all meets; others must have a membership
  if (user.role !== AccountRole.Superuser) {
    const [[coach], [official], [viewer]] = await Promise.all([
      db
        .select({ meetId: schema.coachMemberships.meetId })
        .from(schema.coachMemberships)
        .where(
          and(
            eq(schema.coachMemberships.accountId, user.id),
            eq(schema.coachMemberships.meetId, id),
          ),
        ),
      db
        .select({ meetId: schema.officialMemberships.meetId })
        .from(schema.officialMemberships)
        .where(
          and(
            eq(schema.officialMemberships.accountId, user.id),
            eq(schema.officialMemberships.meetId, id),
          ),
        ),
      db
        .select({ meetId: schema.viewerMemberships.meetId })
        .from(schema.viewerMemberships)
        .where(
          and(
            eq(schema.viewerMemberships.accountId, user.id),
            eq(schema.viewerMemberships.meetId, id),
          ),
        ),
    ])
    if (!coach && !official && !viewer) return c.json({ error: 'Forbidden' }, 403)
  }

  const [meet] = await db.select().from(schema.quizMeets).where(eq(schema.quizMeets.id, id))
  if (!meet) return c.json({ error: 'Meet not found' }, 404)

  const codes = await db
    .select({ id: schema.officialCodes.id, label: schema.officialCodes.label })
    .from(schema.officialCodes)
    .where(eq(schema.officialCodes.meetId, id))

  return c.json({ meet: formatMeet(meet), officialCodes: codes })
})

meets.patch('/:id', requireAdmin(), async (c) => {
  const id = Number(c.req.param('id'))
  if (Number.isNaN(id)) return c.json({ error: 'Invalid meet ID' }, 400)

  const body = await c.req.json<{
    name?: string
    dateFrom?: string
    dateTo?: string
    viewerCode?: string
    divisions?: string[]
  }>()
  const updates: Record<string, string | null> = {}
  if (body.name?.trim()) updates.name = body.name.trim()
  if (body.dateFrom?.trim()) updates.dateFrom = body.dateFrom.trim()
  if ('dateTo' in body) updates.dateTo = body.dateTo?.trim() ?? null
  if (body.viewerCode?.trim()) updates.viewerCode = body.viewerCode.trim()
  if (Array.isArray(body.divisions) && body.divisions.length > 0) {
    updates.divisions = JSON.stringify(body.divisions.map((d: string) => d.trim()).filter(Boolean))
  }

  if (Object.keys(updates).length === 0) {
    return c.json({ error: 'No valid fields to update' }, 400)
  }

  const [updated] = await getDb(c)
    .update(schema.quizMeets)
    .set(updates)
    .where(eq(schema.quizMeets.id, id))
    .returning()

  if (!updated) return c.json({ error: 'Meet not found' }, 404)
  return c.json({ meet: formatMeet(updated) })
})

meets.delete('/:id', requireAdmin(), async (c) => {
  const id = Number(c.req.param('id'))
  if (Number.isNaN(id)) return c.json({ error: 'Invalid meet ID' }, 400)

  const deleted = await getDb(c)
    .delete(schema.quizMeets)
    .where(eq(schema.quizMeets.id, id))
    .returning({ id: schema.quizMeets.id })

  if (deleted.length === 0) return c.json({ error: 'Meet not found' }, 404)
  return c.json({ deleted: true })
})

// ---- Coach code rotation ----

meets.post('/:id/rotate-coach-code', requireAdmin(), async (c) => {
  const id = Number(c.req.param('id'))
  if (Number.isNaN(id)) return c.json({ error: 'Invalid meet ID' }, 400)

  const coachCode = generateCode()
  const coachHash = await hashCode(coachCode)

  const [updated] = await getDb(c)
    .update(schema.quizMeets)
    .set({ coachCodeHash: coachHash })
    .where(eq(schema.quizMeets.id, id))
    .returning({ id: schema.quizMeets.id })

  if (!updated) return c.json({ error: 'Meet not found' }, 404)
  return c.json({ coachCode })
})

// ---- Official codes ----

meets.post('/:id/official-codes', requireAdmin(), async (c) => {
  const meetId = Number(c.req.param('id'))
  if (Number.isNaN(meetId)) return c.json({ error: 'Invalid meet ID' }, 400)

  const body = await c.req.json<{ label: string }>()
  if (!body.label?.trim()) return c.json({ error: 'label is required' }, 400)

  // Verify meet exists
  const [meet] = await getDb(c)
    .select({ id: schema.quizMeets.id })
    .from(schema.quizMeets)
    .where(eq(schema.quizMeets.id, meetId))
  if (!meet) return c.json({ error: 'Meet not found' }, 404)

  const code = generateCode()
  const codeHash = await hashCode(code)

  const [created] = await getDb(c)
    .insert(schema.officialCodes)
    .values({ meetId, label: body.label.trim(), codeHash })
    .returning()

  return c.json({ officialCode: { id: created!.id, label: created!.label }, code }, 201)
})

meets.delete('/:id/official-codes/:codeId', requireAdmin(), async (c) => {
  const meetId = Number(c.req.param('id'))
  const codeId = Number(c.req.param('codeId'))
  if (Number.isNaN(meetId) || Number.isNaN(codeId)) {
    return c.json({ error: 'Invalid ID' }, 400)
  }

  const deleted = await getDb(c)
    .delete(schema.officialCodes)
    .where(eq(schema.officialCodes.id, codeId))
    .returning({ id: schema.officialCodes.id })

  if (deleted.length === 0) return c.json({ error: 'Official code not found' }, 404)
  return c.json({ deleted: true })
})

meets.post('/:id/official-codes/:codeId/rotate', requireAdmin(), async (c) => {
  const codeId = Number(c.req.param('codeId'))
  if (Number.isNaN(codeId)) return c.json({ error: 'Invalid code ID' }, 400)

  const code = generateCode()
  const codeHash = await hashCode(code)

  const [updated] = await getDb(c)
    .update(schema.officialCodes)
    .set({ codeHash })
    .where(eq(schema.officialCodes.id, codeId))
    .returning({ id: schema.officialCodes.id, label: schema.officialCodes.label })

  if (!updated) return c.json({ error: 'Official code not found' }, 404)
  return c.json({ officialCode: updated, code })
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
  }
}

export { meets }
