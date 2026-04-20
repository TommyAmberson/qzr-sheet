import { AccountRole, MeetRole } from '@qzr/shared'
import type { MeetMembership } from './api'

/** Church IDs the current user coaches in a given meet. */
export function coachChurchIds(memberships: MeetMembership[], meetId: number): Set<number> {
  return new Set(
    memberships
      .filter((m) => m.meetId === meetId && m.role === MeetRole.HeadCoach && m.churchId != null)
      .map((m) => m.churchId!),
  )
}

/**
 * Whether the user has admin-level access for a meet.
 *
 * True when the account-level role is superuser OR any membership
 * for the meet has the admin role.
 */
export function isAdminOrSuperuser(
  memberships: MeetMembership[],
  meetId: number,
  accountRole: string | undefined,
): boolean {
  return (
    accountRole === AccountRole.Superuser ||
    memberships.some((m) => m.meetId === meetId && m.role === MeetRole.Admin)
  )
}

/**
 * Whether the user may view / edit a specific church's roster.
 *
 * Admins (and superusers) can see all rosters.
 * Coaches can see only their own church's roster.
 */
export function canAccessChurchRoster(
  memberships: MeetMembership[],
  meetId: number,
  churchId: number,
  accountRole: string | undefined,
): boolean {
  return (
    isAdminOrSuperuser(memberships, meetId, accountRole) ||
    coachChurchIds(memberships, meetId).has(churchId)
  )
}
