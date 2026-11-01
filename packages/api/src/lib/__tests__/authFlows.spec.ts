import { describe, it, expect } from 'vitest'
import { createAuthTestApp, postAuth, providerSignIn, signUpWithPassword } from '../../test-utils'
import * as schema from '../../db/schema'

describe('auth test harness', () => {
  it('signs up and signs in with a password', async () => {
    const test = await createAuthTestApp()
    const { cookie } = await signUpWithPassword(test, 'coach@example.com', 'correct-horse-battery')

    const session = await test.app.request('/api/auth/get-session', { headers: { cookie } })
    expect(((await session.json()) as { user: { email: string } }).user.email).toBe(
      'coach@example.com',
    )
    const signIn = await postAuth(test, 'sign-in/email', {
      email: 'coach@example.com',
      password: 'correct-horse-battery',
    })
    expect(signIn.status).toBe(200)
  })

  it('signs up through a stubbed GitHub and Google sign-in', async () => {
    const test = await createAuthTestApp()
    for (const [provider, email] of [
      ['github', 'gh@example.com'],
      ['google', 'g@gmail.com'],
    ] as const) {
      const res = await providerSignIn(test, provider, { id: '42', email, verified: true })
      expect(res.headers.get('location')).not.toContain('error=')
    }
    const emails = (await test.db.select().from(schema.user).all()).map((u) => u.email)
    expect(emails).toEqual(expect.arrayContaining(['g@gmail.com', 'gh@example.com']))
  })
})
