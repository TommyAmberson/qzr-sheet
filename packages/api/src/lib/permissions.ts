import { eq, and, sql } from 'drizzle-orm'
import type { Context } from 'hono'
import { AccountRole } from '@qzr/shared'
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
