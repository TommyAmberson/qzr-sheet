import { SignJWT, jwtVerify, type JWTPayload } from 'jose'
import { MeetRole } from '@qzr/shared'

export interface GuestPayload extends JWTPayload {
  meetId: number
  role: MeetRole.Official | MeetRole.Viewer
  label?: string
}

const GUEST_ISSUER = 'qzr-guest'
const GUEST_AUDIENCE = 'qzr-api'
const DEFAULT_EXPIRY = '24h'

/**
 * Sign a short-lived guest JWT for officials/viewers without accounts.
 */
export async function signGuestJwt(
  payload: { meetId: number; role: MeetRole.Official | MeetRole.Viewer; label?: string },
  secret: string,
): Promise<string> {
  const key = await importKey(secret)
  const jwt = await new SignJWT({
    meetId: payload.meetId,
    role: payload.role,
    ...(payload.label ? { label: payload.label } : {}),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(GUEST_ISSUER)
    .setAudience(GUEST_AUDIENCE)
    .setExpirationTime(DEFAULT_EXPIRY)
    .sign(key)

  return jwt
}

/**
 * Verify and decode a guest JWT, returning the payload or null if invalid.
 */
export async function verifyGuestJwt(token: string, secret: string): Promise<GuestPayload | null> {
  try {
    const key = await importKey(secret)
    const { payload } = await jwtVerify(token, key, {
      issuer: GUEST_ISSUER,
      audience: GUEST_AUDIENCE,
    })
    return payload as GuestPayload
  } catch {
    return null
  }
}

async function importKey(secret: string): Promise<CryptoKey> {
  const encoded = new TextEncoder().encode(secret)
  return crypto.subtle.importKey('raw', encoded, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ])
}
