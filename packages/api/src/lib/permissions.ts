import { eq, and } from 'drizzle-orm'
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

  const [[admin], [coach], [official], [viewer]] = await Promise.all([
    db
      .select({ id: schema.adminMemberships.accountId })
      .from(schema.adminMemberships)
      .where(
        and(
          eq(schema.adminMemberships.accountId, user.id),
          eq(schema.adminMemberships.meetId, meetId),
        ),
      ),
    db
      .select({ id: schema.coachMemberships.accountId })
      .from(schema.coachMemberships)
      .where(
        and(
          eq(schema.coachMemberships.accountId, user.id),
          eq(schema.coachMemberships.meetId, meetId),
        ),
      ),
    db
      .select({ id: schema.officialMemberships.accountId })
      .from(schema.officialMemberships)
      .where(
        and(
          eq(schema.officialMemberships.accountId, user.id),
          eq(schema.officialMemberships.meetId, meetId),
        ),
      ),
    db
      .select({ id: schema.viewerMemberships.accountId })
      .from(schema.viewerMemberships)
      .where(
        and(
          eq(schema.viewerMemberships.accountId, user.id),
          eq(schema.viewerMemberships.meetId, meetId),
        ),
      ),
  ])
  return !!(admin || coach || official || viewer)
}
