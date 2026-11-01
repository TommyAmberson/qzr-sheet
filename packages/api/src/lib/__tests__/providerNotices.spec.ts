import { describe, it, expect } from 'vitest'
import {
  accountRequest,
  codeFor,
  createAuthTestApp,
  postAuth,
  providerLink,
  providerSignIn,
  TEST_PASSWORD as PASSWORD,
  verifiedAccount,
  type AuthTestApp,
} from '../../test-utils'

async function withGitHub(test: AuthTestApp, email: string) {
  const account = await verifiedAccount(test, email)
  await providerLink(test, account.cookie, 'github', { id: '31', email, verified: true })
  return account
}

const subjectsTo = (test: AuthTestApp, to: string) =>
  test.emails.filter((e) => e.to === to).map((e) => e.subject)

describe('connection notices', () => {
  it('tells the owner when a provider is connected', async () => {
    const test = await createAuthTestApp()
    await withGitHub(test, 'coach@example.com')

    expect(subjectsTo(test, 'coach@example.com')).toContain(
      'GitHub was connected to your qzr account',
    )
  })

  it('tells the owner when a provider is disconnected', async () => {
    const test = await createAuthTestApp()
    const { cookie } = await withGitHub(test, 'gone@example.com')

    await accountRequest(test, 'disconnect', cookie, { provider: 'github', password: PASSWORD })

    expect(subjectsTo(test, 'gone@example.com')).toContain(
      'GitHub was disconnected from your qzr account',
    )
  })

  it('sends none for a new provider sign-up', async () => {
    const test = await createAuthTestApp()
    await providerSignIn(test, 'google', { id: 'g-41', email: 'new@gmail.com', verified: true })

    expect(subjectsTo(test, 'new@gmail.com')).toEqual([])
  })

  it("leaves a reset's disconnection to the reset notice", async () => {
    const test = await createAuthTestApp()
    await withGitHub(test, 'reset@example.com')
    await postAuth(test, 'email-otp/request-password-reset', { email: 'reset@example.com' })
    await postAuth(test, 'email-otp/reset-password', {
      email: 'reset@example.com',
      otp: codeFor(test, 'reset@example.com'),
      password: 'another-good-password',
    })

    const subjects = subjectsTo(test, 'reset@example.com')
    expect(subjects).toContain('Your qzr password was reset')
    expect(subjects).not.toContain('GitHub was disconnected from your qzr account')
  })
})
