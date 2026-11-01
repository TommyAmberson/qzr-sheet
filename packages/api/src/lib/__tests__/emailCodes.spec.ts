import { describe, it, expect } from 'vitest'
import {
  codeFor,
  createAuthTestApp,
  postAuth,
  signUpWithPassword,
  type AuthTestApp,
} from '../../test-utils'

const fromClient = (test: AuthTestApp, path: string, body: unknown, ip: string) =>
  test.app.request(`/api/auth/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': ip },
    body: JSON.stringify(body),
  })

describe('email codes', () => {
  it('sends a code at sign-up', async () => {
    const test = await createAuthTestApp()
    await signUpWithPassword(test, 'new@example.com')
    expect(codeFor(test, 'new@example.com')).toMatch(/^\d{6}$/)
  })

  it('emails a reset code to an account and answers an unknown address the same, sending nothing', async () => {
    const test = await createAuthTestApp()
    await signUpWithPassword(test, 'known@example.com')
    const before = test.emails.length

    const known = await postAuth(test, 'email-otp/request-password-reset', {
      email: 'known@example.com',
    })
    const unknown = await postAuth(test, 'email-otp/request-password-reset', {
      email: 'nobody@example.com',
    })

    expect(known.status).toBe(unknown.status)
    expect(await known.json()).toEqual(await unknown.json())
    expect(test.emails.slice(before).map((e) => e.to)).toEqual(['known@example.com'])
  })

  it('keeps only the newest code for a purpose', async () => {
    const test = await createAuthTestApp()
    await signUpWithPassword(test, 'twice@example.com')
    await postAuth(test, 'email-otp/request-password-reset', { email: 'twice@example.com' })
    const older = codeFor(test, 'twice@example.com')
    await postAuth(test, 'email-otp/request-password-reset', { email: 'twice@example.com' })
    const newer = codeFor(test, 'twice@example.com')

    const withOlder = await postAuth(test, 'email-otp/reset-password', {
      email: 'twice@example.com',
      otp: older,
      password: 'another-good-password',
    })
    expect(newer).not.toBe(older)
    expect(withOlder.status).not.toBe(200)
  })

  it('limits requests to 3 per address per hour', async () => {
    const test = await createAuthTestApp()
    const statuses = []
    for (let i = 0; i < 4; i++) {
      const res = await fromClient(
        test,
        'email-otp/request-password-reset',
        { email: 'a@example.com' },
        `10.0.0.${i}`,
      )
      statuses.push(res.status)
    }
    expect(statuses).toEqual([200, 200, 200, 429])
  })

  it('limits requests to 10 per client per day', async () => {
    const test = await createAuthTestApp()
    const statuses = []
    for (let i = 0; i < 11; i++) {
      const res = await fromClient(
        test,
        'email-otp/request-password-reset',
        { email: `p${i}@example.com` },
        '10.9.9.9',
      )
      statuses.push(res.status)
    }
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true)
    expect(statuses[10]).toBe(429)
  })

  it('still signs up past the daily limit, skipping the code', async () => {
    const test = await createAuthTestApp()
    for (let i = 0; i < 10; i++) {
      await fromClient(
        test,
        'email-otp/request-password-reset',
        { email: `q${i}@example.com` },
        '10.8.8.8',
      )
    }
    const res = await fromClient(
      test,
      'sign-up/email',
      { email: 'late@example.com', password: 'correct-horse-battery', name: 'Late' },
      '10.8.8.8',
    )
    expect(res.status).toBe(200)
    expect(test.emails.some((e) => e.to === 'late@example.com')).toBe(false)
  })

  it('refuses the routes this app does not use', async () => {
    const test = await createAuthTestApp()
    for (const path of [
      'sign-in/email-otp',
      'request-password-reset',
      'email-otp/check-verification-otp',
    ]) {
      expect((await postAuth(test, path, { email: 'x@example.com' })).status).toBe(404)
    }
    const signInCode = await postAuth(test, 'email-otp/send-verification-otp', {
      email: 'x@example.com',
      type: 'sign-in',
    })
    expect(signInCode.status).toBe(404)
  })
})
