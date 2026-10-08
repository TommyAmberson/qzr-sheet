import { describe, it, expect, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { codeTagFor, currentGuest, signGuestJwt, verifyGuestJwt } from '../jwt'
import { MeetRole } from '@qzr/shared'
import * as schema from '../../db/schema'
import { createTestDb } from '../../test-db'
import { seedMeet } from '../../test-utils'
import type { Db } from '../db'

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

describe('codeTagFor', () => {
  it('tags a viewer code and a room code hash differently, even for the same string', async () => {
    const viewer = await codeTagFor('viewer', 'same-value', SECRET)
    const room = await codeTagFor('room', 'same-value', SECRET)
    expect(viewer).not.toBe(room)
  })

  it('changes when the code changes', async () => {
    expect(await codeTagFor('viewer', 'fall-2025', SECRET)).not.toBe(
      await codeTagFor('viewer', 'fall-2026', SECRET),
    )
    expect(await codeTagFor('room', 'hash-1', SECRET)).not.toBe(
      await codeTagFor('room', 'hash-2', SECRET),
    )
  })

  it('is the same for the same code', async () => {
    expect(await codeTagFor('viewer', 'fall-2025', SECRET)).toBe(
      await codeTagFor('viewer', 'fall-2025', SECRET),
    )
  })
})

describe('currentGuest', () => {
  let db: Db
  let meet: Awaited<ReturnType<typeof seedMeet>>
  let roomId: number
  beforeEach(async () => {
    db = await createTestDb()
    meet = await seedMeet(db, 'Guest Meet')
    const [room] = await db
      .insert(schema.meetRooms)
      .values({ meetId: meet.id, name: 'Room 1', codeHash: 'hash-1' })
      .returning()
    roomId = room!.id
  })

  const viewerToken = async (viewerCode?: string) =>
    signGuestJwt(
      {
        meetId: meet.id,
        role: MeetRole.Viewer,
        codeTag: viewerCode && (await codeTagFor('viewer', viewerCode, SECRET)),
      },
      SECRET,
    )
  const officialToken = async (codeHash?: string, room: number | null = roomId) =>
    signGuestJwt(
      {
        meetId: meet.id,
        role: MeetRole.Official,
        roomId: room ?? undefined,
        codeTag: codeHash && (await codeTagFor('room', codeHash, SECRET)),
      },
      SECRET,
    )

  it("accepts a viewer token for the meet's current viewer code", async () => {
    expect(await currentGuest(db, await viewerToken(meet.viewerCode), SECRET)).toMatchObject({
      meetId: meet.id,
      role: MeetRole.Viewer,
    })
  })

  it('refuses a viewer token once the viewer code has changed', async () => {
    const token = await viewerToken(meet.viewerCode)
    await db
      .update(schema.quizMeets)
      .set({ viewerCode: 'new-code' })
      .where(eq(schema.quizMeets.id, meet.id))
    expect(await currentGuest(db, token, SECRET)).toBeNull()
  })

  it('refuses a token without a code tag', async () => {
    expect(await currentGuest(db, await viewerToken(), SECRET)).toBeNull()
    expect(await currentGuest(db, await officialToken(), SECRET)).toBeNull()
  })

  it("accepts an official token for the room's current code", async () => {
    expect(await currentGuest(db, await officialToken('hash-1'), SECRET)).toMatchObject({ roomId })
  })

  it("refuses an official token once the room's code is rotated", async () => {
    const token = await officialToken('hash-1')
    await db
      .update(schema.meetRooms)
      .set({ codeHash: 'hash-rotated' })
      .where(eq(schema.meetRooms.id, roomId))
    expect(await currentGuest(db, token, SECRET)).toBeNull()
  })

  it('refuses an official token once its room is deleted', async () => {
    const token = await officialToken('hash-1')
    await db.delete(schema.meetRooms).where(eq(schema.meetRooms.id, roomId))
    expect(await currentGuest(db, token, SECRET)).toBeNull()
  })

  it('refuses an official token without a room', async () => {
    expect(await currentGuest(db, await officialToken('hash-1', null), SECRET)).toBeNull()
  })

  it("refuses an official token naming another meet's room", async () => {
    const other = await seedMeet(db, 'Other Meet')
    const [otherRoom] = await db
      .insert(schema.meetRooms)
      .values({ meetId: other.id, name: 'Room 9', codeHash: 'hash-9' })
      .returning()
    expect(await currentGuest(db, await officialToken('hash-9', otherRoom!.id), SECRET)).toBeNull()
  })

  it('refuses a token that fails verification', async () => {
    expect(await currentGuest(db, 'not.a.jwt', SECRET)).toBeNull()
  })
})
