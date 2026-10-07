import { SignJWT, jwtVerify, type JWTPayload } from 'jose'
import { and, eq } from 'drizzle-orm'
import { MeetRole } from '@qzr/shared'
import * as schema from '../db/schema'
import type { Db } from './db'

export interface GuestPayload extends JWTPayload {
  meetId: number
  role: MeetRole.Official | MeetRole.Viewer
  label?: string
  /** The room an official's code belongs to; absent on viewer tokens and older official ones */
  roomId?: number
  /** Ties the token to the current code it was issued for, so changing that code revokes it */
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
 * A tag for the code a guest token was issued for, keyed with the server secret: a room code's hash
 * for an official token, the meet's viewer code for a viewer token. A token stops being current
 * once the code changes. Each kind has its own prefix, so one kind's tag never matches the other's.
 */
export async function codeTagFor(
  kind: 'room' | 'viewer',
  code: string,
  secret: string,
): Promise<string> {
  const key = await importKey(secret)
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${kind}:${code}`))
  return [...new Uint8Array(mac)]
    .slice(0, 12)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * The guest a Bearer token stands for, or null: a token must verify and still be current, its
 * `codeTagFor` tag matching the code it was issued for now (the meet's viewer code for a viewer, the
 * room's code hash, with the room in the token's meet, for an official). So changing a code or
 * deleting a room revokes every token issued for it.
 */
export async function currentGuest(
  db: Db,
  token: string,
  secret: string,
): Promise<GuestPayload | null> {
  const guest = await verifyGuestJwt(token, secret)
  if (!guest?.codeTag) return null
  if (guest.role === MeetRole.Viewer) {
    const [meet] = await db
      .select({ viewerCode: schema.quizMeets.viewerCode })
      .from(schema.quizMeets)
      .where(eq(schema.quizMeets.id, guest.meetId))
    return meet && guest.codeTag === (await codeTagFor('viewer', meet.viewerCode, secret))
      ? guest
      : null
  }
  if (guest.roomId === undefined) return null
  const [room] = await db
    .select({ codeHash: schema.meetRooms.codeHash })
    .from(schema.meetRooms)
    .where(and(eq(schema.meetRooms.id, guest.roomId), eq(schema.meetRooms.meetId, guest.meetId)))
  return room?.codeHash && guest.codeTag === (await codeTagFor('room', room.codeHash, secret))
    ? guest
    : null
}

async function importKey(secret: string): Promise<CryptoKey> {
  const encoded = new TextEncoder().encode(secret)
  return crypto.subtle.importKey('raw', encoded, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ])
}
