import { eq, and } from 'drizzle-orm'
import { AccountRole } from '@qzr/shared'
import * as schema from '../db/schema'
import type { Db } from './db'

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
