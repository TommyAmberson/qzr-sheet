import { describe, it, expect } from 'vitest'
import * as schema from '../../db/schema'
import { createAuthTestApp, postAuth, signUpWithPassword } from '../../test-utils'

describe('password sign-in rate limit', () => {
  it('refuses guesses past the limit, counting in the database', async () => {
    const test = await createAuthTestApp({ ENVIRONMENT: 'production' })
    await signUpWithPassword(test, 'coach@example.com')

    const statuses: number[] = []
    for (let i = 0; i < 6; i++) {
      const res = await postAuth(test, 'sign-in/email', {
        email: 'coach@example.com',
        password: 'not-the-password',
      })
      statuses.push(res.status)
    }

    expect(statuses.slice(0, 5)).not.toContain(429)
    expect(statuses[5]).toBe(429)
    // In D1, so every Worker isolate sees the same count.
    expect((await test.db.select().from(schema.rateLimit)).length).toBeGreaterThan(0)
  })
})
