import { describe, it, expect } from 'vitest'
import {
  codeFor,
  createAuthTestApp,
  postAuth,
  signUpWithPassword,
  type AuthTestApp,
} from '../../test-utils'
import { PER_CLIENT_SIGNUP, signUpKey, takeAllowance } from '../emailLimits'

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

  it('limits requests to 30 per client per day', async () => {
    const test = await createAuthTestApp()
    const statuses = []
    for (let i = 0; i < 31; i++) {
      const res = await fromClient(
        test,
        'email-otp/request-password-reset',
        { email: `p${i}@example.com` },
        '10.9.9.9',
      )
      statuses.push(res.status)
    }
    expect(statuses.slice(0, 30).every((s) => s === 200)).toBe(true)
    expect(statuses[30]).toBe(429)
  })

  it("doesn't let a client over its limit use up an address's allowance", async () => {
    const test = await createAuthTestApp()
    await signUpWithPassword(test, 'victim@example.com')
    for (let i = 0; i < 30; i++) {
      await fromClient(
        test,
        'email-otp/request-password-reset',
        { email: `x${i}@example.com` },
        '1.1.1.1',
      )
    }
    for (let i = 0; i < 3; i++) {
      await fromClient(
        test,
        'email-otp/request-password-reset',
        { email: 'victim@example.com' },
        '1.1.1.1',
      )
    }

    const owner = await fromClient(
      test,
      'email-otp/request-password-reset',
      { email: 'victim@example.com' },
      '2.2.2.2',
    )

    expect(owner.status).toBe(200)
  })

  it("doesn't charge the network for requests the address limit refuses", async () => {
    const test = await createAuthTestApp()
    for (let i = 0; i < 10; i++) {
      await fromClient(
        test,
        'email-otp/request-password-reset',
        { email: 'impatient@example.com' },
        '4.4.4.4',
      )
    }
    // Only 3 of those counted for the network, so 27 more addresses fit.
    for (let i = 0; i < 27; i++) {
      const res = await fromClient(
        test,
        'email-otp/request-password-reset',
        { email: `other${i}@example.com` },
        '4.4.4.4',
      )
      expect(res.status).toBe(200)
    }
    const over = await fromClient(
      test,
      'email-otp/request-password-reset',
      { email: 'one-too-many@example.com' },
      '4.4.4.4',
    )
    expect(over.status).toBe(429)
  })

  it('counts an overlong address too', async () => {
    const test = await createAuthTestApp()
    const email = `${'a'.repeat(300)}@example.com`
    const statuses: number[] = []
    for (let i = 0; i < 4; i++) {
      const res = await fromClient(
        test,
        'email-otp/request-password-reset',
        { email },
        `3.3.3.${i}`,
      )
      statuses.push(res.status)
    }
    expect(statuses[3]).toBe(429)
  })

  it("doesn't let resets on a network stop its sign-up codes", async () => {
    const test = await createAuthTestApp()
    for (let i = 0; i < 30; i++) {
      await fromClient(
        test,
        'email-otp/request-password-reset',
        { email: `r${i}@example.com` },
        '10.7.7.7',
      )
    }
    const res = await fromClient(
      test,
      'sign-up/email',
      { email: 'venue@example.com', password: 'correct-horse-battery', name: 'Venue' },
      '10.7.7.7',
    )
    expect(await res.json()).not.toHaveProperty('codeSkipped')
    expect(test.emails.some((e) => e.to === 'venue@example.com')).toBe(true)
  })

  it('still signs up past the daily sign-up limit, skipping the code', async () => {
    const test = await createAuthTestApp()
    for (let i = 0; i < 30; i++) {
      await takeAllowance(test.db, signUpKey('10.8.8.8'), PER_CLIENT_SIGNUP)
    }
    const res = await fromClient(
      test,
      'sign-up/email',
      { email: 'late@example.com', password: 'correct-horse-battery', name: 'Late' },
      '10.8.8.8',
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      codeSkipped: true,
      user: { email: 'late@example.com' },
    })
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
