import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import type { Bindings } from '../bindings'
import type { SessionVariables } from '../middleware/session'
import { requireAuth, getUser } from '../middleware/session'
import { createDb, type Db } from '../lib/db'
import * as schema from '../db/schema'
import { MeetRole, AccountRole } from '@qzr/shared'

export interface MembershipsVariables extends SessionVariables {
  db: Db
}

type Env = { Bindings: Bindings; Variables: MembershipsVariables }

const memberships = new Hono<Env>()

memberships.use('*', requireAuth())

// Inject DB (overridable in tests)
memberships.use('*', async (c, next) => {
  if (!c.get('db')) {
    c.set('db', createDb(c.env.DB) as unknown as Db)
  }
  await next()
})

function getDb(c: { get(key: 'db'): Db }): Db {
  return c.get('db')
}

interface MeetMembership {
  meetId: number
  meetName: string
  role: MeetRole
  label?: string
}

/**
 * GET /api/my-meets
 *
 * Returns all meets the authenticated user has joined, with their role(s).
 */
memberships.get('/', async (c) => {
  const user = getUser(c)
  const db = getDb(c)

  // Superusers have implicit access to all meets
  if (user.role === AccountRole.Superuser) {
    const rows = await db.select().from(schema.quizMeets)
    return c.json({
      memberships: rows.map((m) => ({
        meetId: m.id,
        meetName: m.name,
        role: MeetRole.Superuser,
      })),
    })
  }

  const result: MeetMembership[] = []

  // Coach memberships
  const coachRows = await db
    .select({
      meetId: schema.coachMemberships.meetId,
      meetName: schema.quizMeets.name,
    })
    .from(schema.coachMemberships)
    .innerJoin(schema.quizMeets, eq(schema.coachMemberships.meetId, schema.quizMeets.id))
    .where(eq(schema.coachMemberships.accountId, user.id))

  for (const row of coachRows) {
    result.push({ meetId: row.meetId, meetName: row.meetName, role: MeetRole.HeadCoach })
  }

  // Official memberships
  const officialRows = await db
    .select({
      meetId: schema.officialMemberships.meetId,
      meetName: schema.quizMeets.name,
      label: schema.officialCodes.label,
    })
    .from(schema.officialMemberships)
    .innerJoin(schema.quizMeets, eq(schema.officialMemberships.meetId, schema.quizMeets.id))
    .innerJoin(
      schema.officialCodes,
      eq(schema.officialMemberships.officialCodeId, schema.officialCodes.id),
    )
    .where(eq(schema.officialMemberships.accountId, user.id))

  for (const row of officialRows) {
    result.push({
      meetId: row.meetId,
      meetName: row.meetName,
      role: MeetRole.Official,
      label: row.label,
    })
  }

  // Viewer memberships
  const viewerRows = await db
    .select({
      meetId: schema.viewerMemberships.meetId,
      meetName: schema.quizMeets.name,
    })
    .from(schema.viewerMemberships)
    .innerJoin(schema.quizMeets, eq(schema.viewerMemberships.meetId, schema.quizMeets.id))
    .where(eq(schema.viewerMemberships.accountId, user.id))

  for (const row of viewerRows) {
    result.push({ meetId: row.meetId, meetName: row.meetName, role: MeetRole.Viewer })
  }

  return c.json({ memberships: result })
})

export { memberships }
