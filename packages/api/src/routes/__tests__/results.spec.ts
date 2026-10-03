import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { CellValue, MeetRole, PlacementFormula, type QuizFile } from '@qzr/shared'
import { eq } from 'drizzle-orm'
import type { Bindings } from '../../bindings'
import type { SessionUser, SessionVariables } from '../../middleware/session'
import { roomCodeTag, type GuestPayload } from '../../lib/jwt'
import { results } from '../results'
import * as schema from '../../db/schema'
import {
  mockSession,
  mockDb,
  testSuperuser,
  testUser,
  jsonOf,
  jsonRequest,
  seedMeet,
} from '../../test-utils'
import { createTestDb } from '../../test-db'
import type { Db } from '../../lib/db'

const SECRET = 'test-secret-at-least-32-characters-long'
const env = { ENVIRONMENT: 'test', BETTER_AUTH_SECRET: SECRET } as unknown as Bindings

function createApp(db: Db, user: SessionUser | null, guest: GuestPayload | null = null) {
  const app = new Hono<{ Bindings: Bindings; Variables: SessionVariables & { db: Db } }>()
  app.use('*', mockSession(user, guest))
  app.use('*', mockDb(db))
  app.route('/api/meets', results)
  return app
}

function quizFile(overrides: Partial<QuizFile['quiz']> = {}): QuizFile {
  return {
    version: 2,
    quiz: {
      division: '1',
      quizNumber: '3',
      overtime: false,
      placementFormula: PlacementFormula.Rules,
      questionTypes: [],
      ...overrides,
    },
    teams: [
      {
        id: 1,
        name: 'Calgary 1',
        onTime: true,
        seatOrder: 0,
        quizzers: [{ id: 11, name: 'Ann', seatOrder: 0 }],
      },
    ],
    answers: [{ quizzerId: 11, columnKey: '1', value: CellValue.Correct }],
    noJumps: [],
  }
}

interface ListedResult {
  id: number
  origin: { action: string; name: string }
  counted: boolean
  revision: number
  action: string
  savedBy: { name: string }
  quizFile: QuizFile
}

let db: Db
let meetId: number
let otherMeetId: number
let room1: number
let room2: number

/** Each room's code tag, as an official token issued for its current code carries it */
const codeTags = new Map<number, string>()

const official = (roomId: number | undefined, forMeet = () => meetId): GuestPayload => ({
  meetId: forMeet(),
  role: MeetRole.Official,
  label: 'Room',
  ...(roomId !== undefined ? { roomId, codeTag: codeTags.get(roomId) } : {}),
})

beforeEach(async () => {
  db = await createTestDb()
  meetId = (await seedMeet(db, 'Practice Meet')).id
  otherMeetId = (await seedMeet(db, 'Other Meet')).id
  const rooms = await db
    .insert(schema.meetRooms)
    .values([
      { meetId, name: 'Room 1', codeHash: 'hash-1' },
      { meetId, name: 'Room 2', codeHash: 'hash-2' },
    ])
    .returning()
  for (const room of rooms) codeTags.set(room.id, await roomCodeTag(room.codeHash!, SECRET))
  room1 = rooms[0]!.id
  room2 = rooms[1]!.id
})

async function submit(guest: GuestPayload, body: Record<string, unknown> = {}) {
  return createApp(db, null, guest).request(
    `/api/meets/${meetId}/results`,
    jsonRequest('POST', { quizFile: quizFile(), ...body }),
    env,
  )
}

function asAdmin(body: Record<string, unknown> = {}) {
  return createApp(db, testSuperuser).request(
    `/api/meets/${meetId}/results`,
    jsonRequest('POST', { quizFile: quizFile(), ...body }),
    env,
  )
}

async function list() {
  const res = await createApp(db, testSuperuser).request(`/api/meets/${meetId}/results`, {}, env)
  expect(res.status).toBe(200)
  return jsonOf<ListedResult[]>(res)
}

describe('POST /api/meets/:id/results', () => {
  it("stores a guest official's quiz as submitted from their room", async () => {
    const res = await submit(official(room1))
    expect(res.status).toBe(201)
    expect(await jsonOf(res)).toMatchObject({ revision: 1 })

    const [stored] = await list()
    expect(stored).toMatchObject({
      origin: { action: 'submitted', name: 'Room 1' },
      counted: false,
      revision: 1,
      action: 'submitted',
      savedBy: { name: 'Room 1' },
    })
    expect(stored!.quizFile.teams[0]!.name).toBe('Calgary 1')
  })

  it("stores an admin's upload with no room as uploaded", async () => {
    const res = await asAdmin({ upload: true })
    expect(res.status).toBe(201)
    const [stored] = await list()
    expect(stored).toMatchObject({
      origin: { action: 'uploaded', name: 'Test Admin' },
      action: 'uploaded',
      savedBy: { name: 'Test Admin' },
    })
  })

  it("records an admin's save for no room as their edit", async () => {
    expect((await asAdmin()).status).toBe(201)
    expect((await list())[0]).toMatchObject({ action: 'edited', savedBy: { name: 'Test Admin' } })
  })

  it('lets an admin submit for any room of the meet, recorded as from that room', async () => {
    expect((await asAdmin({ roomId: room2 })).status).toBe(201)
    expect((await list())[0]).toMatchObject({
      origin: { action: 'submitted', name: 'Test Admin, Room 2' },
      savedBy: { name: 'Test Admin, Room 2' },
    })
  })

  it('refuses an admin naming a room of another meet', async () => {
    const [elsewhere] = await db
      .insert(schema.meetRooms)
      .values({ meetId: otherMeetId, name: 'Room X', codeHash: 'hash-x' })
      .returning()
    expect((await asAdmin({ roomId: elsewhere!.id })).status).toBe(404)
    expect(await list()).toEqual([])
  })

  it("labels an official's upload as uploaded, for their room", async () => {
    expect((await submit(official(room1), { upload: true })).status).toBe(201)
    expect((await list())[0]).toMatchObject({
      origin: { action: 'uploaded', name: 'Room 1' },
      savedBy: { name: 'Room 1' },
    })
  })

  it('lets a signed-in official submit only for one of their rooms', async () => {
    await db
      .insert(schema.officialMemberships)
      .values({ accountId: testUser.id, meetId, roomId: room1 })
    const app = createApp(db, testUser)
    const post = (body: Record<string, unknown>) =>
      app.request(
        `/api/meets/${meetId}/results`,
        jsonRequest('POST', { quizFile: quizFile(), ...body }),
        env,
      )

    expect((await post({ roomId: room1 })).status).toBe(201)
    expect((await post({ roomId: room2 })).status).toBe(403)
    expect((await post({})).status).toBe(403)
    const [stored] = await list()
    expect(stored).toMatchObject({
      origin: { action: 'submitted', name: 'Test User, Room 1' },
      savedBy: { name: 'Test User, Room 1' },
    })
  })

  it('refuses an invalid quiz file with the reason', async () => {
    const res = await submit(official(room1), { quizFile: { version: 2, quiz: {} } })
    expect(res.status).toBe(400)
    expect((await jsonOf<{ error: string }>(res)).error).toBeTruthy()
  })

  it('refuses a file from a newer scoresheet', async () => {
    const res = await submit(official(room1), { quizFile: { ...quizFile(), version: 99 } })
    expect(res.status).toBe(422)
    expect(await jsonOf(res)).toEqual({
      error: 'This file was saved by a newer version of the scoresheet',
    })
  })

  it('asks an official whose token names no room to rejoin', async () => {
    const res = await submit(official(undefined))
    expect(res.status).toBe(403)
    expect(await jsonOf(res)).toEqual({ error: 'Rejoin with your room code' })
  })

  it('refuses viewers and officials of another meet', async () => {
    const viewer: GuestPayload = { meetId, role: MeetRole.Viewer }
    expect((await submit(viewer)).status).toBe(403)
    expect((await submit(official(room1, () => otherMeetId))).status).toBe(403)
    expect(await list()).toEqual([])
  })
})

describe('submitting a name the meet already has', () => {
  interface Existing {
    error: string
    existing: { id: number; name: string; revision: number; savedBy: { name: string } }
  }

  it('warns with the stored revision, then adds a revision when asked', async () => {
    const { id } = await jsonOf<{ id: number }>(await submit(official(room1)))

    const again = await submit(official(room1))
    expect(again.status).toBe(409)
    const warning = await jsonOf<Existing>(again)
    expect(warning.error).toBe('D1 Q3 was already submitted')
    expect(warning.existing).toMatchObject({
      id,
      name: 'D1 Q3',
      revision: 1,
      savedBy: { name: 'Room 1' },
    })

    const res = await submit(official(room1), { onExisting: 'newRevision' })
    expect(res.status).toBe(200)
    expect(await jsonOf(res)).toEqual({ id, revision: 2, created: false, keptCurrent: false })
    expect(await list()).toHaveLength(1)
  })

  it('treats another room the same way, recording that room on the revision', async () => {
    const { id } = await jsonOf<{ id: number }>(await submit(official(room1)))
    expect((await submit(official(room2))).status).toBe(409)
    expect(await jsonOf(await submit(official(room2), { onExisting: 'newRevision' }))).toEqual({
      id,
      revision: 2,
      created: false,
      keptCurrent: false,
    })
    expect((await list())[0]).toMatchObject({
      origin: { action: 'submitted', name: 'Room 1' },
      savedBy: { name: 'Room 2' },
    })
  })

  it('stores the submission and keeps the current revision when asked', async () => {
    const { id } = await jsonOf<{ id: number }>(await submit(official(room1)))
    const changed = quizFile()
    changed.teams[0]!.name = 'Calgary 2'
    const res = await submit(official(room1), { quizFile: changed, onExisting: 'keepCurrent' })
    // The submission is revision 2; revision 3 selects revision 1, keeping it current
    expect(await jsonOf(res)).toEqual({ id, revision: 2, created: false, keptCurrent: true })

    const [stored] = await list()
    expect(stored).toMatchObject({ revision: 3, action: 'restored', savedBy: { name: 'Room 1' } })
    expect(stored!.quizFile.teams[0]!.name).toBe('Calgary 1')
    expect((await jsonOf<Existing>(await submit(official(room1)))).existing.revision).toBe(3)

    // Keeping the current revision again still points at the original content, not a selection
    await submit(official(room1), { quizFile: changed, onExisting: 'keepCurrent' })
    expect((await list())[0]!.quizFile.teams[0]!.name).toBe('Calgary 1')
  })

  it('reports again unless told what to do with the existing quiz', async () => {
    await submit(official(room1))
    expect((await submit(official(room1), { onExisting: 'whatever' })).status).toBe(409)
  })

  it('matches names regardless of case and spaces, and keeps consolation apart', async () => {
    await submit(official(room1), { quizFile: quizFile({ quizNumber: '3a' }) })
    expect(
      (await submit(official(room1), { quizFile: quizFile({ quizNumber: ' 3A ' }) })).status,
    ).toBe(409)
    expect(
      (
        await submit(official(room1), {
          quizFile: quizFile({ quizNumber: '3a', consolation: true }),
        })
      ).status,
    ).toBe(201)
  })

  it('stores a different name as a new quiz', async () => {
    await submit(official(room1))
    const res = await submit(official(room1), { quizFile: quizFile({ quizNumber: '4' }) })
    expect(res.status).toBe(201)
    expect(await list()).toHaveLength(2)
  })
})

describe('PUT /api/meets/:id/results/:resultId', () => {
  async function submitted(number = '3') {
    const res = await submit(official(room1), { quizFile: quizFile({ quizNumber: number }) })
    return (await jsonOf<{ id: number }>(res)).id
  }

  const put = (app: ReturnType<typeof createApp>, id: number, body: Record<string, unknown> = {}) =>
    app.request(
      `/api/meets/${meetId}/results/${id}`,
      jsonRequest('PUT', { quizFile: quizFile({ division: '2' }), ...body }),
      env,
    )

  it("records an admin's save as edited, and a merge as merged", async () => {
    const id = await submitted()
    const admin = createApp(db, testSuperuser)
    expect((await put(admin, id)).status).toBe(200)
    expect((await list())[0]).toMatchObject({ revision: 2, action: 'edited' })
    expect((await list())[0]!.quizFile.quiz.division).toBe('2')
    expect((await put(admin, id, { action: 'merged' })).status).toBe(200)
    expect((await list())[0]).toMatchObject({ revision: 3, action: 'merged' })
  })

  it("lets the quiz's room official edit it, recorded for their room", async () => {
    const id = await submitted()
    expect((await put(createApp(db, null, official(room1)), id)).status).toBe(200)
    expect((await list())[0]).toMatchObject({ action: 'edited', savedBy: { name: 'Room 1' } })
  })

  it('records an official of several rooms for a room the quiz already has', async () => {
    await db.insert(schema.officialMemberships).values([
      { accountId: testUser.id, meetId, roomId: room1 },
      { accountId: testUser.id, meetId, roomId: room2 },
    ])
    const res = await submit(official(room2))
    const id = (await jsonOf<{ id: number }>(res)).id
    expect((await put(createApp(db, testUser), id)).status).toBe(200)
    expect((await list())[0]).toMatchObject({ savedBy: { name: 'Test User, Room 2' } })
  })

  it('refuses an official of a room that never saved the quiz', async () => {
    const id = await submitted()
    expect((await put(createApp(db, null, official(room2)), id)).status).toBe(403)
    expect((await put(createApp(db, testUser), id)).status).toBe(403)
  })

  it("refuses renaming a quiz to another quiz's name", async () => {
    await submitted('3')
    const four = await submitted('4')
    const res = await put(createApp(db, testSuperuser), four, {
      quizFile: quizFile({ quizNumber: '3' }),
    })
    expect(res.status).toBe(409)
  })

  it('404s for a quiz of another meet', async () => {
    const id = await submitted()
    const res = await createApp(db, testSuperuser).request(
      `/api/meets/${otherMeetId}/results/${id}`,
      jsonRequest('PUT', { quizFile: quizFile() }),
      env,
    )
    expect(res.status).toBe(404)
  })
})

describe('GET /api/meets/:id/results', () => {
  async function listAs(user: SessionUser | null, guest: GuestPayload | null = null) {
    const res = await createApp(db, user, guest).request(`/api/meets/${meetId}/results`, {}, env)
    return {
      status: res.status,
      names: res.ok ? (await jsonOf<ListedResult[]>(res)).map(nameOf) : [],
    }
  }
  const nameOf = (r: ListedResult) => r.quizFile.quiz.quizNumber

  beforeEach(async () => {
    await submit(official(room1), { quizFile: quizFile({ quizNumber: '1' }) })
    await submit(official(room2), { quizFile: quizFile({ quizNumber: '2' }) })
    await asAdmin({ quizFile: quizFile({ quizNumber: '3' }), upload: true })
  })

  it('lists every quiz for an admin', async () => {
    expect((await listAs(testSuperuser)).names.toSorted()).toEqual(['1', '2', '3'])
  })

  it('lists an official only the quizzes their room has saved', async () => {
    expect(await listAs(null, official(room1))).toEqual({ status: 200, names: ['1'] })
  })

  it("adds another room's quiz once the official saves its name", async () => {
    await submit(official(room1), {
      quizFile: quizFile({ quizNumber: '2' }),
      onExisting: 'newRevision',
    })
    expect((await listAs(null, official(room1))).names.toSorted()).toEqual(['1', '2'])
  })

  it("lists a signed-in official of two rooms both rooms' quizzes", async () => {
    await db.insert(schema.officialMemberships).values([
      { accountId: testUser.id, meetId, roomId: room1 },
      { accountId: testUser.id, meetId, roomId: room2 },
    ])
    expect((await listAs(testUser)).names.toSorted()).toEqual(['1', '2'])
  })

  it('refuses anyone who is neither an admin nor an official', async () => {
    expect((await listAs(testUser)).status).toBe(403)
    const viewer: GuestPayload = { meetId, role: MeetRole.Viewer, label: 'Viewer' }
    expect((await listAs(null, viewer)).status).toBe(403)
  })
})

describe('malformed requests', () => {
  it('refuses a body that is not JSON', async () => {
    const res = await createApp(db, null, official(room1)).request(
      `/api/meets/${meetId}/results`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{not json' },
      env,
    )
    expect(res.status).toBe(400)
  })

  it('404s a meet id that is not a number, even for a superuser', async () => {
    const res = await createApp(db, testSuperuser).request(
      '/api/meets/abc/results',
      jsonRequest('POST', { quizFile: quizFile() }),
      env,
    )
    expect(res.status).toBe(404)
  })
})

describe('revoking official tokens', () => {
  it('asks an official to rejoin once their room code is rotated', async () => {
    await db
      .update(schema.meetRooms)
      .set({ codeHash: 'hash-rotated' })
      .where(eq(schema.meetRooms.id, room1))
    const res = await submit(official(room1))
    expect(res.status).toBe(403)
    expect(await jsonOf(res)).toEqual({ error: 'Rejoin with your room code' })
  })

  it('keeps where a quiz came from once its room is deleted', async () => {
    await submit(official(room1))
    await db.delete(schema.meetRooms).where(eq(schema.meetRooms.id, room1))
    expect((await list())[0]!.origin).toEqual({ action: 'submitted', name: 'Room 1' })
  })

  it('refuses an official of a deleted room', async () => {
    await db.delete(schema.meetRooms).where(eq(schema.meetRooms.id, room1))
    expect((await submit(official(room1))).status).toBe(403)
  })
})

describe('stored files', () => {
  it('refuses values the parser would have to convert', async () => {
    const loose = quizFile() as unknown as { teams: { onTime: unknown }[] }
    loose.teams[0]!.onTime = 'false'
    const res = await submit(official(room1), { quizFile: loose })
    expect(res.status).toBe(400)
  })
})

describe('PATCH /api/meets/:id/results/counted', () => {
  function setCounted(
    ids: number[],
    counted: boolean,
    user: SessionUser | null = testSuperuser,
    guest: GuestPayload | null = null,
  ) {
    return createApp(db, user, guest).request(
      `/api/meets/${meetId}/results/counted`,
      jsonRequest('PATCH', { ids, counted }),
      env,
    )
  }

  async function storeQuizzes(...quizNumbers: string[]): Promise<number[]> {
    const ids: number[] = []
    for (const quizNumber of quizNumbers) {
      const res = await submit(official(room1), { quizFile: quizFile({ quizNumber }) })
      ids.push((await jsonOf<{ id: number }>(res)).id)
    }
    return ids
  }

  const countRecords = async () =>
    (await db.select().from(schema.quizResultCountChanges)).map((r) => [
      r.resultId,
      r.counted,
      r.changedByName,
    ])

  const countedOf = async (id: number) => (await list()).find((r) => r.id === id)!.counted

  it('counts and uncounts quizzes for an admin, recording each change', async () => {
    const [q1, q2] = (await storeQuizzes('1', '2')) as [number, number]
    expect(await countedOf(q1)).toBe(false)

    const res = await setCounted([q1, q2], true)
    expect(res.status).toBe(200)
    expect(await jsonOf(res)).toEqual({ changed: [q1, q2] })
    expect([await countedOf(q1), await countedOf(q2)]).toEqual([true, true])

    expect(await jsonOf(await setCounted([q1], false))).toEqual({ changed: [q1] })
    expect([await countedOf(q1), await countedOf(q2)]).toEqual([false, true])
    expect(await countRecords()).toEqual([
      [q1, true, 'Test Admin'],
      [q2, true, 'Test Admin'],
      [q1, false, 'Test Admin'],
    ])
  })

  it('records only the quizzes whose value changes', async () => {
    const [q1, q2] = (await storeQuizzes('1', '2')) as [number, number]
    await setCounted([q1], true)
    expect(await jsonOf(await setCounted([q1, q2], true))).toEqual({ changed: [q2] })
    expect(await countRecords()).toHaveLength(2)
  })

  it('counts more quizzes than one D1 statement can bind', async () => {
    const ids = await storeQuizzes(...Array.from({ length: 95 }, (_, i) => String(i + 1)))
    const { changed } = await jsonOf<{ changed: number[] }>(await setCounted(ids, true))
    expect(changed.toSorted((a, b) => a - b)).toEqual(ids)
    expect((await list()).every((r) => r.counted)).toBe(true)
    expect(await countRecords()).toHaveLength(95)
  })

  it('is for admins only', async () => {
    const [q1] = (await storeQuizzes('1')) as [number]
    expect((await setCounted([q1], true, testUser)).status).toBe(403)
    expect((await setCounted([q1], true, null, official(room1))).status).toBe(403)
    expect(await countRecords()).toEqual([])
  })

  it('changes nothing when an id is not a quiz of this meet', async () => {
    const [q1] = (await storeQuizzes('1')) as [number]
    const other = await createApp(db, testSuperuser).request(
      `/api/meets/${otherMeetId}/results`,
      jsonRequest('POST', { quizFile: quizFile() }),
      env,
    )
    const otherId = (await jsonOf<{ id: number }>(other)).id
    expect((await setCounted([q1, otherId], true)).status).toBe(404)
    expect(await countRecords()).toEqual([])
    expect(await countedOf(q1)).toBe(false)
  })

  it('refuses a malformed body', async () => {
    const res = await createApp(db, testSuperuser).request(
      `/api/meets/${meetId}/results/counted`,
      jsonRequest('PATCH', { ids: ['1'], counted: 'yes' }),
      env,
    )
    expect(res.status).toBe(400)
  })
})

describe('GET /api/meets/:id/results/sender', () => {
  async function senderAs(user: SessionUser | null, guest: GuestPayload | null = null) {
    const res = await createApp(db, user, guest).request(
      `/api/meets/${meetId}/results/sender`,
      {},
      env,
    )
    return { status: res.status, body: res.ok ? await jsonOf(res) : null }
  }

  it('gives an admin every room of the meet', async () => {
    expect(await senderAs(testSuperuser)).toEqual({
      status: 200,
      body: {
        admin: true,
        rooms: [
          { id: room1, name: 'Room 1' },
          { id: room2, name: 'Room 2' },
        ],
      },
    })
  })

  it("gives a guest official their token's room", async () => {
    expect((await senderAs(null, official(room2))).body).toEqual({
      admin: false,
      rooms: [{ id: room2, name: 'Room 2' }],
    })
  })

  it('gives a signed-in official their rooms of this meet', async () => {
    await db.insert(schema.officialMemberships).values([
      { accountId: testUser.id, meetId, roomId: room1 },
      { accountId: testUser.id, meetId, roomId: room2 },
    ])
    expect((await senderAs(testUser)).body).toEqual({
      admin: false,
      rooms: [
        { id: room1, name: 'Room 1' },
        { id: room2, name: 'Room 2' },
      ],
    })
  })

  it('refuses anyone who may not send to the meet', async () => {
    expect((await senderAs(testUser)).status).toBe(403)
    const viewer: GuestPayload = { meetId, role: MeetRole.Viewer, label: 'Viewer' }
    expect((await senderAs(null, viewer)).status).toBe(403)
  })
})

describe('history and restore', () => {
  type HistoryEntry =
    | {
        kind: 'revision'
        revision: number
        action: string
        restoredFrom?: number
        savedBy: { name: string }
        current: boolean
        quizFile: QuizFile
      }
    | { kind: 'counting'; counted: boolean; changedBy: { name: string } }

  let id: number

  /** Submitted by room 1 as D1 Q3, then edited by the admin into division 2 */
  beforeEach(async () => {
    const res = await submit(official(room1))
    id = (await jsonOf<{ id: number }>(res)).id
    await createApp(db, testSuperuser).request(
      `/api/meets/${meetId}/results/${id}`,
      jsonRequest('PUT', { quizFile: quizFile({ division: '2' }) }),
      env,
    )
  })

  const as = (user: SessionUser | null, guest: GuestPayload | null = null) =>
    createApp(db, user, guest)
  const history = async (app = as(testSuperuser)) => {
    const res = await app.request(`/api/meets/${meetId}/results/${id}/revisions`, {}, env)
    return { status: res.status, entries: res.ok ? await jsonOf<HistoryEntry[]>(res) : [] }
  }
  const revisionOf = async (revision: number, app = as(testSuperuser)) => {
    const res = await app.request(
      `/api/meets/${meetId}/results/${id}/revisions/${revision}`,
      {},
      env,
    )
    return {
      status: res.status,
      body: res.ok ? await jsonOf<{ quizFile: QuizFile }>(res) : null,
    }
  }
  const restore = (revision: number, app = as(testSuperuser)) =>
    app.request(
      `/api/meets/${meetId}/results/${id}/restore`,
      jsonRequest('POST', { revision }),
      env,
    )

  it('lists saves and counting records, newest first, with who and how', async () => {
    await as(testSuperuser).request(
      `/api/meets/${meetId}/results/counted`,
      jsonRequest('PATCH', { ids: [id], counted: true }),
      env,
    )
    const { entries } = await history()
    expect(entries).toMatchObject([
      { kind: 'counting', counted: true, changedBy: { name: 'Test Admin' } },
      { kind: 'revision', revision: 2, action: 'edited', savedBy: { name: 'Test Admin' } },
      { kind: 'revision', revision: 1, action: 'submitted', savedBy: { name: 'Room 1' } },
    ])
  })

  it("gives any revision's file", async () => {
    const { body } = await revisionOf(1)
    expect(body!.quizFile.quiz.division).toBe('1')
    expect((await revisionOf(9)).status).toBe(404)
  })

  it('restores an earlier revision as a new one, keeping every newer one (FR-005a)', async () => {
    const res = await restore(1)
    expect(res.status).toBe(200)
    expect(await jsonOf(res)).toEqual({ id, revision: 3 })
    const [stored] = await list()
    expect(stored).toMatchObject({ revision: 3, action: 'restored' })
    expect(stored!.quizFile.quiz.division).toBe('1')
    expect((await history()).entries.map((e) => (e.kind === 'revision' ? e.revision : 0))).toEqual([
      3, 2, 1,
    ])
  })

  it('shows a restoring revision as the file it restores, naming it', async () => {
    await restore(1)
    expect((await revisionOf(3)).body!.quizFile.quiz.division).toBe('1')
    const [newest] = (await history()).entries
    expect(newest).toMatchObject({ revision: 3, restoredFrom: 1 })
    expect(newest!.kind === 'revision' && newest.quizFile.quiz.division).toBe('1')
  })

  it('gives each save its file, and marks those showing the current content', async () => {
    await restore(1)
    const saves = (await history()).entries.filter((e) => e.kind === 'revision')
    expect(saves.map((e) => [e.revision, e.current, e.quizFile.quiz.division])).toEqual([
      [3, true, '1'],
      [2, false, '2'],
      [1, true, '1'],
    ])
  })

  it('points a restore of a restoring revision at the revision with the file', async () => {
    await restore(1)
    await restore(2)
    await restore(3)
    expect((await history()).entries[0]).toMatchObject({ revision: 5, restoredFrom: 1 })
  })

  it('adds nothing when restoring the content already current', async () => {
    const res = await restore(2)
    expect(await jsonOf(res)).toEqual({ id, revision: 2 })
    await restore(1)
    expect(await jsonOf(await restore(1))).toEqual({ id, revision: 3 })
    expect((await list())[0]!.revision).toBe(3)
  })

  it("moves the quiz's name with a restore, so the restored name finds it", async () => {
    // Revision 1 is D1 Q3; the beforeEach edit made revision 2 D2 Q3
    await restore(1)
    const res = await submit(official(room1))
    expect(res.status).toBe(409)
    expect((await jsonOf<{ existing: { id: number } }>(res)).existing.id).toBe(id)
    expect(await list()).toHaveLength(1)
  })

  it('refuses a restore onto a name another quiz has taken since', async () => {
    await submit(official(room2))
    const res = await restore(1)
    expect(res.status).toBe(409)
    expect(await jsonOf(res)).toEqual({ error: 'Another quiz is already named D1 Q3' })
    expect((await history()).entries[0]).toMatchObject({ revision: 2 })
  })

  it("lets the quiz's room officials read and restore it, recorded for their room", async () => {
    const officialApp = as(null, official(room1))
    expect((await history(officialApp)).status).toBe(200)
    expect((await revisionOf(1, officialApp)).status).toBe(200)
    expect((await restore(1, officialApp)).status).toBe(200)
    expect((await list())[0]).toMatchObject({ action: 'restored', savedBy: { name: 'Room 1' } })
  })

  it('refuses everyone else, and quizzes of another meet', async () => {
    const otherRoom = as(null, official(room2))
    expect((await history(otherRoom)).status).toBe(403)
    expect((await revisionOf(1, otherRoom)).status).toBe(403)
    expect((await restore(1, otherRoom)).status).toBe(403)
    expect((await history(as(testUser))).status).toBe(403)
    const elsewhere = await as(testSuperuser).request(
      `/api/meets/${otherMeetId}/results/${id}/revisions`,
      {},
      env,
    )
    expect(elsewhere.status).toBe(404)
    expect((await restore(9)).status).toBe(404)
  })
})
