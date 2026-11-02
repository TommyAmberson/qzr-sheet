import { describe, it, expect } from 'vitest'
import { socialSignInError, withoutErrorParam } from '@qzr/shared'

describe('socialSignInError', () => {
  it('is null when the callback carried no error', () => {
    expect(socialSignInError('')).toBeNull()
    expect(socialSignInError('?meet=abc')).toBeNull()
  })

  it('points a refused link at the password form', () => {
    const result = socialSignInError('?error=account_not_linked')
    expect(result?.passwordAccount).toBe(true)
    expect(result?.message).toMatch(/already has an account/)
    expect(result?.message).toMatch(/account settings/)
  })

  it('points an account with no password to its provider or a reset', () => {
    const result = socialSignInError('?error=sign_in_with_provider')
    expect(result?.passwordAccount).toBe(true)
    expect(result?.message).toMatch(/Forgot password/)
  })

  it("explains an address the provider doesn't report verified", () => {
    const result = socialSignInError('?error=provider_email_unverified')
    expect(result?.message).toMatch(/isn't verified/)
  })

  it('explains a failed connection from account settings', () => {
    const result = socialSignInError('?error=verify_email_first')
    expect(result?.passwordAccount).toBe(false)
    expect(result?.message).toMatch(/Verify your email address first/)
  })

  it('reports other codes as a generic failure', () => {
    const result = socialSignInError('?error=invalid_code&error_description=bad')
    expect(result?.passwordAccount).toBe(false)
    expect(result?.message).toMatch(/try again/)
  })
})

describe('withoutErrorParam', () => {
  it('drops error and error_description but keeps the rest', () => {
    expect(
      withoutErrorParam('https://www.versevault.ca/qzr/meet?keep=1&error=x&error_description=y'),
    ).toBe('https://www.versevault.ca/qzr/meet?keep=1')
  })

  it('leaves a URL without them unchanged', () => {
    expect(withoutErrorParam('https://www.versevault.ca/qzr/')).toBe(
      'https://www.versevault.ca/qzr/',
    )
  })
})
