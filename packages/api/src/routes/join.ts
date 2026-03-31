import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'
import type { Bindings } from '../bindings'
import type { SessionVariables } from '../middleware/session'
import { requireAuth, getUser } from '../middleware/session'
import { createDb, type Db } from '../lib/db'
import { hashCode } from '../lib/codes'
import * as schema from '../db/schema'
import { MeetRole } from '@qzr/shared'

export interface JoinVariables extends SessionVariables {
  db: Db
}

type Env = { Bindings: Bindings; Variables: JoinVariables }

const join = new Hono<Env>()

// Inject DB (overridable in tests)
join.use('*', async (c, next) => {
  if (!c.get('db')) {
    c.set('db', createDb(c.env.DB) as unknown as Db)
  }
  await next()
})

function getDb(c: { get(key: 'db'): Db }): Db {
  return c.get('db')
}

/**
 * POST /api/meets/join
 *
 * Accepts { code } and determines which meet and role it corresponds to:
 * 1. Check viewer codes (plaintext slug match)
 * 2. Check coach code hashes (SHA-256 match)
 * 3. Check official code hashes (SHA-256 match)
 *
 * Creates the appropriate membership row and returns the meet + role.
 */
join.post('/', requireAuth(), async (c) => {
  const body = await c.req.json<{ code: string }>()
  if (!body.code?.trim()) {
    return c.json({ error: 'code is required' }, 400)
  }

  const code = body.code.trim()
  const user = getUser(c)
  const db = getDb(c)

  // 1. Try viewer code (plaintext slug match)
  const [viewerMatch] = await db
    .select()
    .from(schema.quizMeets)
    .where(eq(schema.quizMeets.viewerCode, code))

  if (viewerMatch) {
    // Check for existing membership (idempotent)
    const [existing] = await db
      .select()
      .from(schema.viewerMemberships)
      .where(
        and(
          eq(schema.viewerMemberships.accountId, user.id),
          eq(schema.viewerMemberships.meetId, viewerMatch.id),
        ),
      )

    if (!existing) {
      await db
        .insert(schema.viewerMemberships)
        .values({ accountId: user.id, meetId: viewerMatch.id })
    }

    return c.json({
      meet: { id: viewerMatch.id, name: viewerMatch.name },
      role: MeetRole.Viewer,
    })
  }

  // 2. Try coach code (SHA-256 hash match)
  const codeHash = await hashCode(code)

  const [coachMatch] = await db
    .select()
    .from(schema.quizMeets)
    .where(eq(schema.quizMeets.coachCodeHash, codeHash))

  if (coachMatch) {
    const [existing] = await db
      .select()
      .from(schema.coachMemberships)
      .where(
        and(
          eq(schema.coachMemberships.accountId, user.id),
          eq(schema.coachMemberships.meetId, coachMatch.id),
        ),
      )

    if (!existing) {
      await db.insert(schema.coachMemberships).values({ accountId: user.id, meetId: coachMatch.id })
    }

    return c.json({
      meet: { id: coachMatch.id, name: coachMatch.name },
      role: MeetRole.HeadCoach,
    })
  }

  // 3. Try official codes (SHA-256 hash match across all rooms)
  const [officialMatch] = await db
    .select({
      codeId: schema.officialCodes.id,
      meetId: schema.officialCodes.meetId,
      label: schema.officialCodes.label,
    })
    .from(schema.officialCodes)
    .where(eq(schema.officialCodes.codeHash, codeHash))

  if (officialMatch) {
    const [meet] = await db
      .select({ id: schema.quizMeets.id, name: schema.quizMeets.name })
      .from(schema.quizMeets)
      .where(eq(schema.quizMeets.id, officialMatch.meetId))

    if (meet) {
      const [existing] = await db
        .select()
        .from(schema.officialMemberships)
        .where(
          and(
            eq(schema.officialMemberships.accountId, user.id),
            eq(schema.officialMemberships.meetId, officialMatch.meetId),
            eq(schema.officialMemberships.officialCodeId, officialMatch.codeId),
          ),
        )

      if (!existing) {
        await db.insert(schema.officialMemberships).values({
          accountId: user.id,
          meetId: officialMatch.meetId,
          officialCodeId: officialMatch.codeId,
        })
      }

      return c.json({
        meet: { id: meet.id, name: meet.name },
        role: MeetRole.Official,
        label: officialMatch.label,
      })
    }
  }

  return c.json({ error: 'Invalid code' }, 404)
})

export { join }
