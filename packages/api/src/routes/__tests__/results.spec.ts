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

  it("stores an admin's quiz as uploaded, with no room", async () => {
    const res = await createApp(db, testSuperuser).request(
      `/api/meets/${meetId}/results`,
      jsonRequest('POST', { quizFile: quizFile() }),
      env,
    )
    expect(res.status).toBe(201)
    const [stored] = await list()
    expect(stored).toMatchObject({
      origin: { action: 'uploaded', name: 'Test Admin' },
      action: 'uploaded',
      savedBy: { name: 'Test Admin' },
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

  it('is for admins; officials resubmit by name', async () => {
    const id = await submitted()
    expect((await put(createApp(db, null, official(room1)), id)).status).toBe(403)
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
  it('is for admins only', async () => {
    await submit(official(room1))
    const asOfficial = await createApp(db, null, official(room1)).request(
      `/api/meets/${meetId}/results`,
      {},
      env,
    )
    expect(asOfficial.status).toBe(403)
    const asUser = await createApp(db, testUser).request(`/api/meets/${meetId}/results`, {}, env)
    expect(asUser.status).toBe(403)
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
