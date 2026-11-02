export enum AccountRole {
  Superuser = 'superuser',
  Normal = 'normal',
}

/** An account's role as every check reads it. Superusers are seeded by hand,
 *  and an unverified address may belong to whoever registered it first, so
 *  superuser counts only once the address is verified (FR-027). */
export function effectiveAccountRole(user: {
  role?: unknown
  emailVerified?: unknown
}): AccountRole {
  return user.role === AccountRole.Superuser && user.emailVerified === true
    ? AccountRole.Superuser
    : AccountRole.Normal
}

export enum MeetRole {
  Admin = 'admin',
  HeadCoach = 'head_coach',
  Official = 'official',
  Viewer = 'viewer',
  Superuser = 'superuser',
}
