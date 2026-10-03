import { eq, and, sql } from 'drizzle-orm'
import type { Context } from 'hono'
import { AccountRole, MeetRole } from '@qzr/shared'
import * as schema from '../db/schema'
import type { Db } from './db'
import type { SessionVariables } from '../middleware/session'
import type { Bindings } from '../bindings'
import { roomCodeTag } from './jwt'

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
 * True if the requester officiates the given room of the meet: a guest whose official token was
 * issued for that room's current code, or a signed-in official with a membership for it. Analogous
 * to `isViewerOf`. Rotating the room's code, or deleting the room, revokes guest tokens at once.
 */
export async function isOfficialOfRoom<
  E extends { Bindings: Bindings; Variables: SessionVariables },
>(c: Context<E>, db: Db, meetId: number, roomId: number): Promise<boolean> {
  const guest = c.get('guest')
  if (guest) {
    if (guest.meetId !== meetId || guest.role !== MeetRole.Official) return false
    if (guest.roomId !== roomId || !guest.codeTag) return false
    const [room] = await db
      .select({ codeHash: schema.meetRooms.codeHash })
      .from(schema.meetRooms)
      .where(and(eq(schema.meetRooms.id, roomId), eq(schema.meetRooms.meetId, meetId)))
    if (!room?.codeHash) return false
    return guest.codeTag === (await roomCodeTag(room.codeHash, c.env.BETTER_AUTH_SECRET))
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
