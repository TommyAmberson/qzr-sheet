import { eq, and, sql } from 'drizzle-orm'
import type { Context } from 'hono'
import { AccountRole, MeetRole } from '@qzr/shared'
import * as schema from '../db/schema'
import type { Db } from './db'
import type { SessionVariables } from '../middleware/session'

/** True if the user is a superuser or has an admin membership for the given meet. */
export async function isAdminOrSuperuser(
  db: Db,
  userId: string,
  role: AccountRole,
  meetId: number,
): Promise<boolean> {
  if (role === AccountRole.Superuser) return true
  const [row] = await db
    .select()
    .from(schema.adminMemberships)
    .where(
      and(
        eq(schema.adminMemberships.accountId, userId),
        eq(schema.adminMemberships.meetId, meetId),
      ),
    )
  return !!row
}

/**
 * True if the requester can view the given meet — superuser, any signed-in
 * member of the meet (admin / coach / official / viewer), or a guest whose
 * JWT was issued for this meetId. Use as a per-request gate before serving
 * meet/church/team/quizzer reads.
 */
export async function isViewerOf<E extends { Variables: SessionVariables }>(
  c: Context<E>,
  db: Db,
  meetId: number,
): Promise<boolean> {
  const guest = c.get('guest')
  if (guest && guest.meetId === meetId) return true

  const user = c.get('user')
  if (!user) return false
  if (user.role === AccountRole.Superuser) return true

  // Single round-trip: any membership row across the four tables means viewer.
  const result = await db.get<{ found: number }>(
    sql`SELECT EXISTS (
      SELECT 1 FROM ${schema.adminMemberships}
        WHERE ${schema.adminMemberships.accountId} = ${user.id}
          AND ${schema.adminMemberships.meetId} = ${meetId}
      UNION ALL
      SELECT 1 FROM ${schema.coachMemberships}
        WHERE ${schema.coachMemberships.accountId} = ${user.id}
          AND ${schema.coachMemberships.meetId} = ${meetId}
      UNION ALL
      SELECT 1 FROM ${schema.officialMemberships}
        WHERE ${schema.officialMemberships.accountId} = ${user.id}
          AND ${schema.officialMemberships.meetId} = ${meetId}
      UNION ALL
      SELECT 1 FROM ${schema.viewerMemberships}
        WHERE ${schema.viewerMemberships.accountId} = ${user.id}
          AND ${schema.viewerMemberships.meetId} = ${meetId}
    ) AS found`,
  )
  return Boolean(result?.found)
}

/**
 * True if the requester officiates the given room of the meet: a guest whose official token names
 * that room, or a signed-in official with a membership for it. Analogous to `isViewerOf`. A guest
 * token whose room code has changed never gets this far (`currentGuest` in `lib/jwt.ts`).
 */
export async function isOfficialOfRoom<E extends { Variables: SessionVariables }>(
  c: Context<E>,
  db: Db,
  meetId: number,
  roomId: number,
): Promise<boolean> {
  const guest = c.get('guest')
  if (guest) {
    return guest.meetId === meetId && guest.role === MeetRole.Official && guest.roomId === roomId
  }
  const user = c.get('user')
  if (!user) return false
  const [row] = await db
    .select()
    .from(schema.officialMemberships)
    .where(
      and(
        eq(schema.officialMemberships.accountId, user.id),
        eq(schema.officialMemberships.meetId, meetId),
        eq(schema.officialMemberships.roomId, roomId),
      ),
    )
  return !!row
}

/**
 * The rooms of the meet the requester officiates: a guest official's room, or every room a
 * signed-in account officiates there. Empty for anyone else.
 */
export async function officialRoomsOf<E extends { Variables: SessionVariables }>(
  c: Context<E>,
  db: Db,
  meetId: number,
): Promise<number[]> {
  const guest = c.get('guest')
  if (guest) {
    const official = guest.meetId === meetId && guest.role === MeetRole.Official
    return official && guest.roomId !== undefined ? [guest.roomId] : []
  }
  const user = c.get('user')
  if (!user) return []
  const rows = await db
    .select({ roomId: schema.officialMemberships.roomId })
    .from(schema.officialMemberships)
    .where(
      and(
        eq(schema.officialMemberships.accountId, user.id),
        eq(schema.officialMemberships.meetId, meetId),
      ),
    )
  return rows.map((row) => row.roomId)
}
