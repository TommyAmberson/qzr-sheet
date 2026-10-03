import { SignJWT, jwtVerify, type JWTPayload } from 'jose'
import { MeetRole } from '@qzr/shared'

export interface GuestPayload extends JWTPayload {
  meetId: number
  role: MeetRole.Official | MeetRole.Viewer
  label?: string
  /** The room an official's code belongs to; absent on viewer tokens and older official ones */
  roomId?: number
  /** Ties an official token to the room's current code, so rotating the code revokes it */
  codeTag?: string
}

const GUEST_ISSUER = 'qzr-guest'
const GUEST_AUDIENCE = 'qzr-api'
const DEFAULT_EXPIRY = '24h'

/**
 * Sign a short-lived guest JWT for officials/viewers without accounts.
 */
export async function signGuestJwt(
  payload: {
    meetId: number
    role: MeetRole.Official | MeetRole.Viewer
    label?: string
    roomId?: number
    codeTag?: string
  },
  secret: string,
): Promise<string> {
  const key = await importKey(secret)
  const jwt = await new SignJWT({
    meetId: payload.meetId,
    role: payload.role,
    ...(payload.label ? { label: payload.label } : {}),
    ...(payload.roomId !== undefined ? { roomId: payload.roomId } : {}),
    ...(payload.codeTag ? { codeTag: payload.codeTag } : {}),
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

/**
 * A tag for a room code's hash, keyed with the server secret so it reveals nothing about the code.
 * An official token carries it, and stops working once the room's code changes.
 */
export async function roomCodeTag(codeHash: string, secret: string): Promise<string> {
  const key = await importKey(secret)
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`room:${codeHash}`))
  return [...new Uint8Array(mac)]
    .slice(0, 12)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function importKey(secret: string): Promise<CryptoKey> {
  const encoded = new TextEncoder().encode(secret)
  return crypto.subtle.importKey('raw', encoded, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ])
}
