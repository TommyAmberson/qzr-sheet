import { describe, it, expect } from 'vitest'
import type { MeetMembership } from '../api'
import { coachChurchIds, isAdminOrSuperuser, canAccessChurchRoster } from '../meetAccess'

function m(
  overrides: Partial<MeetMembership> & { meetId: number; role: MeetMembership['role'] },
): MeetMembership {
  return { meetName: 'Test', ...overrides }
}

describe('coachChurchIds', () => {
  it('returns church IDs where the user is head_coach for the meet', () => {
    const memberships: MeetMembership[] = [
      m({ meetId: 1, role: 'head_coach', churchId: 10 }),
      m({ meetId: 1, role: 'head_coach', churchId: 20 }),
      m({ meetId: 2, role: 'head_coach', churchId: 30 }),
    ]
    const ids = coachChurchIds(memberships, 1)
    expect(ids).toEqual(new Set([10, 20]))
  })

  it('ignores non-coach roles', () => {
    const memberships: MeetMembership[] = [
      m({ meetId: 1, role: 'admin' }),
      m({ meetId: 1, role: 'viewer' }),
      m({ meetId: 1, role: 'official' }),
    ]
    expect(coachChurchIds(memberships, 1)).toEqual(new Set())
  })

  it('ignores coach memberships without a churchId', () => {
    const memberships: MeetMembership[] = [m({ meetId: 1, role: 'head_coach' })]
    expect(coachChurchIds(memberships, 1)).toEqual(new Set())
  })

  it('returns empty set when no memberships match the meet', () => {
    const memberships: MeetMembership[] = [m({ meetId: 99, role: 'head_coach', churchId: 10 })]
    expect(coachChurchIds(memberships, 1)).toEqual(new Set())
  })
})

describe('isAdminOrSuperuser', () => {
  it('returns true when accountRole is superuser regardless of memberships', () => {
    expect(isAdminOrSuperuser([], 1, 'superuser')).toBe(true)
  })

  it('returns true when any membership for the meet has admin role', () => {
    const memberships: MeetMembership[] = [m({ meetId: 1, role: 'admin' })]
    expect(isAdminOrSuperuser(memberships, 1, undefined)).toBe(true)
  })

  it('returns false for admin membership on a different meet', () => {
    const memberships: MeetMembership[] = [m({ meetId: 2, role: 'admin' })]
    expect(isAdminOrSuperuser(memberships, 1, undefined)).toBe(false)
  })

  it('returns false for non-admin, non-superuser', () => {
    const memberships: MeetMembership[] = [
      m({ meetId: 1, role: 'head_coach', churchId: 10 }),
      m({ meetId: 1, role: 'viewer' }),
    ]
    expect(isAdminOrSuperuser(memberships, 1, undefined)).toBe(false)
  })

  it('returns false when accountRole is undefined and no admin membership', () => {
    expect(isAdminOrSuperuser([], 1, undefined)).toBe(false)
  })
})

describe('canAccessChurchRoster', () => {
  it('admin can access any church roster', () => {
    const memberships: MeetMembership[] = [m({ meetId: 1, role: 'admin' })]
    expect(canAccessChurchRoster(memberships, 1, 10, undefined)).toBe(true)
    expect(canAccessChurchRoster(memberships, 1, 99, undefined)).toBe(true)
  })

  it('superuser can access any church roster', () => {
    expect(canAccessChurchRoster([], 1, 10, 'superuser')).toBe(true)
  })

  it('coach can access their own church roster', () => {
    const memberships: MeetMembership[] = [m({ meetId: 1, role: 'head_coach', churchId: 10 })]
    expect(canAccessChurchRoster(memberships, 1, 10, undefined)).toBe(true)
  })

  it('coach cannot access a different church roster', () => {
    const memberships: MeetMembership[] = [m({ meetId: 1, role: 'head_coach', churchId: 10 })]
    expect(canAccessChurchRoster(memberships, 1, 20, undefined)).toBe(false)
  })

  it('viewer cannot access any church roster', () => {
    const memberships: MeetMembership[] = [m({ meetId: 1, role: 'viewer' })]
    expect(canAccessChurchRoster(memberships, 1, 10, undefined)).toBe(false)
  })

  it('official cannot access any church roster', () => {
    const memberships: MeetMembership[] = [m({ meetId: 1, role: 'official' })]
    expect(canAccessChurchRoster(memberships, 1, 10, undefined)).toBe(false)
  })

  it("coach on a different meet cannot access this meet's roster", () => {
    const memberships: MeetMembership[] = [m({ meetId: 2, role: 'head_coach', churchId: 10 })]
    expect(canAccessChurchRoster(memberships, 1, 10, undefined)).toBe(false)
  })
})
