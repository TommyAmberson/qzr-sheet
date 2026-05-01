import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'
import type { Bindings } from '../bindings'
import type { SessionVariables } from '../middleware/session'
import { requireAuth, getUser } from '../middleware/session'
import { createDb, type Db } from '../lib/db'
import { hashCode } from '../lib/codes'
import { signGuestJwt } from '../lib/jwt'
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
 * 2. Hash the code, then check:
 *    a. quizMeets.adminCodeHash  → AdminMembership
 *    b. churches.coachCodeHash   → CoachMembership
 *    c. officialCodes.codeHash   → OfficialMembership
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
    return c.json({ meet: { id: viewerMatch.id, name: viewerMatch.name }, role: MeetRole.Viewer })
  }

  const codeHash = await hashCode(code)

  // 2a. Try admin code
  const [adminMatch] = await db
    .select()
    .from(schema.quizMeets)
    .where(eq(schema.quizMeets.adminCodeHash, codeHash))

  if (adminMatch) {
    const [existing] = await db
      .select()
      .from(schema.adminMemberships)
      .where(
        and(
          eq(schema.adminMemberships.accountId, user.id),
          eq(schema.adminMemberships.meetId, adminMatch.id),
        ),
      )
    if (!existing) {
      await db.insert(schema.adminMemberships).values({ accountId: user.id, meetId: adminMatch.id })
    }
    return c.json({ meet: { id: adminMatch.id, name: adminMatch.name }, role: MeetRole.Admin })
  }

  // 2b. Try church coach code
  const [coachMatch] = await db
    .select({ church: schema.churches, meet: schema.quizMeets })
    .from(schema.churches)
    .innerJoin(schema.quizMeets, eq(schema.churches.meetId, schema.quizMeets.id))
    .where(eq(schema.churches.coachCodeHash, codeHash))

  if (coachMatch) {
    const [existing] = await db
      .select()
      .from(schema.coachMemberships)
      .where(
        and(
          eq(schema.coachMemberships.accountId, user.id),
          eq(schema.coachMemberships.churchId, coachMatch.church.id),
        ),
      )
    if (!existing) {
      await db.insert(schema.coachMemberships).values({
        accountId: user.id,
        churchId: coachMatch.church.id,
        meetId: coachMatch.church.meetId,
      })
    }
    return c.json({
      meet: { id: coachMatch.meet.id, name: coachMatch.meet.name },
      church: { id: coachMatch.church.id, name: coachMatch.church.name },
      role: MeetRole.HeadCoach,
    })
  }

  // 2c. Try official codes
  const [officialMatch] = await db
    .select({
      codeId: schema.meetRooms.id,
      meetId: schema.meetRooms.meetId,
      label: schema.meetRooms.name,
    })
    .from(schema.meetRooms)
    .where(eq(schema.meetRooms.codeHash, codeHash))

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
            eq(schema.officialMemberships.roomId, officialMatch.codeId),
          ),
        )
      if (!existing) {
        await db.insert(schema.officialMemberships).values({
          accountId: user.id,
          meetId: officialMatch.meetId,
          roomId: officialMatch.codeId,
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

/**
 * POST /api/join/guest
 *
 * Unauthenticated endpoint. Accepts { code } for official or viewer codes,
 * and returns a short-lived guest JWT (no account required).
 *
 * Coach codes are not accepted — coaches must have an account.
 */
join.post('/guest', async (c) => {
  const body = await c.req.json<{ code: string }>()
  if (!body.code?.trim()) {
    return c.json({ error: 'code is required' }, 400)
  }

  const code = body.code.trim()
  const db = getDb(c)
  const secret = c.env.BETTER_AUTH_SECRET

  // 1. Try viewer code (plaintext slug match)
  const [viewerMatch] = await db
    .select({ id: schema.quizMeets.id, name: schema.quizMeets.name })
    .from(schema.quizMeets)
    .where(eq(schema.quizMeets.viewerCode, code))

  if (viewerMatch) {
    const token = await signGuestJwt({ meetId: viewerMatch.id, role: MeetRole.Viewer }, secret)
    return c.json({
      token,
      meet: { id: viewerMatch.id, name: viewerMatch.name },
      role: MeetRole.Viewer,
    })
  }

  // 2. Try official codes (SHA-256 hash match)
  const codeHash = await hashCode(code)

  const [officialMatch] = await db
    .select({
      codeId: schema.meetRooms.id,
      meetId: schema.meetRooms.meetId,
      label: schema.meetRooms.name,
    })
    .from(schema.meetRooms)
    .where(eq(schema.meetRooms.codeHash, codeHash))

  if (officialMatch) {
    const [meet] = await db
      .select({ id: schema.quizMeets.id, name: schema.quizMeets.name })
      .from(schema.quizMeets)
      .where(eq(schema.quizMeets.id, officialMatch.meetId))

    if (meet) {
      const token = await signGuestJwt(
        { meetId: meet.id, role: MeetRole.Official, label: officialMatch.label },
        secret,
      )
      return c.json({
        token,
        meet: { id: meet.id, name: meet.name },
        role: MeetRole.Official,
        label: officialMatch.label,
      })
    }
  }

  return c.json({ error: 'Invalid code' }, 404)
})

export { join }
