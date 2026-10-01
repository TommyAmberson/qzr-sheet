import { describe, it, expect } from 'vitest'
import { testBindings as env } from '../../test-utils'
import { createAuth } from '../auth'

// verse-vault also runs Better Auth on www.versevault.ca with the default cookie
// names, so the two apps overwrote each other's sessions. qzr's cookies carry
// their own prefix.
describe('session cookie prefix', () => {
  it('names every auth cookie with the qzr prefix', async () => {
    const { authCookies } = await createAuth(env).$context
    const names = Object.values(authCookies).map((cookie) => cookie.name)
    expect(names.length).toBeGreaterThan(0)
    for (const name of names) {
      expect(name).toMatch(/^(__Secure-)?qzr\./)
    }
  })
})
