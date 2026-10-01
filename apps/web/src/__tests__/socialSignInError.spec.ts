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
