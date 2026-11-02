import { describe, it, expect, vi } from 'vitest'
import {
  BREACHED_PASSWORD,
  codeFor,
  createAuthTestApp,
  postAuth,
  signUpWithPassword,
} from '../../test-utils'

describe('breached passwords', () => {
  it('refuses one at sign-up', async () => {
    const test = await createAuthTestApp()

    const res = await postAuth(test, 'sign-up/email', {
      email: 'new@example.com',
      password: BREACHED_PASSWORD,
      name: 'new@example.com',
    })

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'PASSWORD_COMPROMISED' })
  })

  it('refuses one at reset, keeping the old password and the code', async () => {
    const test = await createAuthTestApp()
    await signUpWithPassword(test, 'reset@example.com', 'the-old-password')
    await postAuth(test, 'email-otp/request-password-reset', { email: 'reset@example.com' })
    const otp = codeFor(test, 'reset@example.com')

    const res = await postAuth(test, 'email-otp/reset-password', {
      email: 'reset@example.com',
      otp,
      password: BREACHED_PASSWORD,
    })

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'PASSWORD_COMPROMISED' })
    const signIn = await postAuth(test, 'sign-in/email', {
      email: 'reset@example.com',
      password: 'the-old-password',
    })
    expect(signIn.status).toBe(200)
    // The same code still sets a better password.
    const retry = await postAuth(test, 'email-otp/reset-password', {
      email: 'reset@example.com',
      otp,
      password: 'a-much-better-password',
    })
    expect(retry.status).toBe(200)
  })

  it("refuses a password it can't check, rather than accepting it", async () => {
    const test = await createAuthTestApp()
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('unavailable', { status: 503 }))

    const res = await postAuth(test, 'sign-up/email', {
      email: 'later@example.com',
      password: 'a-fine-password-1',
      name: 'later@example.com',
    })
    spy.mockRestore()

    expect(res.status).toBe(503)
  })

  it('accepts one that is not listed', async () => {
    const test = await createAuthTestApp()
    await expect(signUpWithPassword(test, 'fine@example.com')).resolves.toBeTruthy()
  })

  it('refuses one as a new password for a signed-in account', async () => {
    const test = await createAuthTestApp()
    const { cookie } = await signUpWithPassword(test, 'change@example.com', 'the-old-password')

    const res = await postAuth(
      test,
      'change-password',
      { currentPassword: 'the-old-password', newPassword: BREACHED_PASSWORD },
      cookie,
    )

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'PASSWORD_COMPROMISED' })
  })
})
