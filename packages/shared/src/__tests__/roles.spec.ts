import { describe, it, expect } from 'vitest'
import { AccountRole, effectiveAccountRole } from '../roles'

describe('effectiveAccountRole', () => {
  it('counts superuser only on a verified address', () => {
    expect(effectiveAccountRole({ role: 'superuser', emailVerified: true })).toBe(
      AccountRole.Superuser,
    )
    expect(effectiveAccountRole({ role: 'superuser', emailVerified: false })).toBe(
      AccountRole.Normal,
    )
    expect(effectiveAccountRole({ role: 'normal', emailVerified: true })).toBe(AccountRole.Normal)
  })
})
