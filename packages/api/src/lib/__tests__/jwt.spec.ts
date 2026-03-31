import { describe, it, expect } from 'vitest'
import { signGuestJwt, verifyGuestJwt } from '../jwt'
import { MeetRole } from '@qzr/shared'

const SECRET = 'test-secret-that-is-at-least-32-chars-long'

describe('signGuestJwt', () => {
  it('returns a JWT string', async () => {
    const token = await signGuestJwt({ meetId: 1, role: MeetRole.Official }, SECRET)
    expect(token).toBeTypeOf('string')
    expect(token.split('.')).toHaveLength(3)
  })
})

describe('verifyGuestJwt', () => {
  it('decodes a valid token', async () => {
    const token = await signGuestJwt(
      { meetId: 42, role: MeetRole.Official, label: 'Room A' },
      SECRET,
    )
    const payload = await verifyGuestJwt(token, SECRET)
    expect(payload).not.toBeNull()
    expect(payload!.meetId).toBe(42)
    expect(payload!.role).toBe(MeetRole.Official)
    expect(payload!.label).toBe('Room A')
  })

  it('returns null for an invalid token', async () => {
    const payload = await verifyGuestJwt('not.a.jwt', SECRET)
    expect(payload).toBeNull()
  })

  it('returns null for a token signed with a different secret', async () => {
    const token = await signGuestJwt({ meetId: 1, role: MeetRole.Viewer }, SECRET)
    const payload = await verifyGuestJwt(token, 'wrong-secret-that-is-at-least-32-chars')
    expect(payload).toBeNull()
  })

  it('omits label when not provided', async () => {
    const token = await signGuestJwt({ meetId: 1, role: MeetRole.Viewer }, SECRET)
    const payload = await verifyGuestJwt(token, SECRET)
    expect(payload).not.toBeNull()
    expect(payload!.label).toBeUndefined()
  })
})
