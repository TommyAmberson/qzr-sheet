import { describe, it, expect } from 'vitest'
import { codeErrorMessage, providersDisconnectedBy } from '../authCodes'

describe('codeErrorMessage', () => {
  it('explains each code error without a raw error', () => {
    expect(codeErrorMessage({ code: 'INVALID_OTP' })).toMatch(/isn't valid.*send a new one/)
    expect(codeErrorMessage({ code: 'OTP_EXPIRED' })).toMatch(/expired/)
    expect(codeErrorMessage({ code: 'TOO_MANY_ATTEMPTS' })).toMatch(/Send a new code/)
    expect(
      codeErrorMessage({
        status: 429,
        message: 'Too many requests for this address. Try again later.',
      }),
    ).toMatch(/Try again later/)
    expect(codeErrorMessage(null)).toBeNull()
  })
})

describe('providersDisconnectedBy', () => {
  it('reads the providers a reset disconnected', () => {
    expect(providersDisconnectedBy({ success: true, providersDisconnected: ['github'] })).toEqual([
      'github',
    ])
    expect(providersDisconnectedBy({ success: true })).toEqual([])
    expect(providersDisconnectedBy(null)).toEqual([])
  })
})
