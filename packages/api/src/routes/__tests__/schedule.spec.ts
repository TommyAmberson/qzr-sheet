import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import type { Bindings } from '../../bindings'
import type { SessionVariables } from '../../middleware/session'
import { publishedSchedule, schedule } from '../schedule'
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
import {
  MeetRole,
  defaultElims,
  generateSchedule,
  newScheduleDocument,
  resultName,
  type MeetPhase,
  type ScheduleDocument,
} from '@qzr/shared'

const env = { ENVIRONMENT: 'test' } as unknown as Bindings

function createApp(user: typeof testSuperuser | typeof testUser | null, db: Db) {
  const app = new Hono<{ Bindings: Bindings; Variables: SessionVariables & { db: Db } }>()
  app.use('*', mockSession(user))
  app.use('*', mockDb(db))
  app.route('/api/meets', schedule)
  return app
}

const patchJson = (body: Record<string, unknown>) => jsonRequest('PATCH', body)

async function seedRoom(db: Db, meetId: number, name: string, sortOrder = 0) {
  const [room] = await db.insert(schema.meetRooms).values({ meetId, name, sortOrder }).returning()
  return room!
}

async function seedSlot(db: Db, meetId: number, sortOrder = 0) {
  const [slot] = await db
    .insert(schema.meetSlots)
    .values({
      meetId,
      startAt: new Date('2026-01-01T20:00:00Z'),
      durationMinutes: 25,
      kind: 'quiz',
      sortOrder,
    })
    .returning()
  return slot!
}

async function seedQuizWithSeats(
  db: Db,
  meetId: number,
  slotId: number,
  roomId: number,
  seats: { seatNumber: number; letter?: string; seedRef?: string }[],
  overrides: Partial<typeof schema.scheduledQuizzes.$inferInsert> = {},
) {
  const [quiz] = await db
    .insert(schema.scheduledQuizzes)
    .values({
      meetId,
      slotId,
      roomId,
      division: '1',
      phase: 'prelim',
      label: 'D1-Q1',
      ...overrides,
    })
    .returning()
  await db.insert(schema.scheduledQuizSeats).values(
    seats.map((s) => ({
      quizId: quiz!.id,
      seatNumber: s.seatNumber,
      letter: s.letter ?? null,
      seedRef: s.seedRef ?? null,
    })),
  )
  return quiz!
}

describe('GET /api/meets/:id/rooms', () => {
  let db: Db
  let app: ReturnType<typeof createApp>

  beforeEach(async () => {
    db = await createTestDb()
    app = createApp(testSuperuser, db)
  })

  it('returns rooms ordered by sortOrder then id', async () => {
    const meet = await seedMeet(db)
    await seedRoom(db, meet.id, 'Room B', 1)
    await seedRoom(db, meet.id, 'Room A', 0)

    const res = await app.request(`/api/meets/${meet.id}/rooms`, {}, env)
    expect(res.status).toBe(200)
    const body = await jsonOf<{ rooms: { name: string; sortOrder: number; hasCode: boolean }[] }>(
      res,
    )
    expect(body.rooms.map((r) => r.name)).toEqual(['Room A', 'Room B'])
    expect(body.rooms[0]!.hasCode).toBe(false)
  })

  it('reflects hasCode when codeHash is set', async () => {
    const meet = await seedMeet(db)
    await db.insert(schema.meetRooms).values({
      meetId: meet.id,
      name: 'Room A',
      sortOrder: 0,
      codeHash: 'somehash',
    })

    const res = await app.request(`/api/meets/${meet.id}/rooms`, {}, env)
    const body = await jsonOf<{ rooms: { hasCode: boolean }[] }>(res)
    expect(body.rooms[0]!.hasCode).toBe(true)
  })
})

describe('PATCH /api/meets/:id/rooms/:roomId', () => {
  let db: Db
  let app: ReturnType<typeof createApp>

  beforeEach(async () => {
    db = await createTestDb()
    app = createApp(testSuperuser, db)
  })

  it('renames a room', async () => {
    const meet = await seedMeet(db)
    const room = await seedRoom(db, meet.id, 'Room A')

    const res = await app.request(
      `/api/meets/${meet.id}/rooms/${room.id}`,
      patchJson({ name: 'Sanctuary' }),
      env,
    )
    expect(res.status).toBe(200)
    const body = await jsonOf<{ room: { name: string } }>(res)
    expect(body.room.name).toBe('Sanctuary')
  })

  it('updates sortOrder', async () => {
    const meet = await seedMeet(db)
    const room = await seedRoom(db, meet.id, 'Room A', 0)

    const res = await app.request(
      `/api/meets/${meet.id}/rooms/${room.id}`,
      patchJson({ sortOrder: 5 }),
      env,
    )
    expect(res.status).toBe(200)
    const body = await jsonOf<{ room: { sortOrder: number } }>(res)
    expect(body.room.sortOrder).toBe(5)
  })

  it('rejects unknown room', async () => {
    const meet = await seedMeet(db)
    const res = await app.request(
      `/api/meets/${meet.id}/rooms/9999`,
      patchJson({ name: 'Nope' }),
      env,
    )
    expect(res.status).toBe(404)
  })

  it('requires admin', async () => {
    const meet = await seedMeet(db)
    const room = await seedRoom(db, meet.id, 'Room A')
    const userApp = createApp(testUser, db)
    const res = await userApp.request(
      `/api/meets/${meet.id}/rooms/${room.id}`,
      patchJson({ name: 'Nope' }),
      env,
    )
    expect(res.status).toBe(403)
  })
})

describe('GET /api/meets/:id/quizzes/:quizId/teams', () => {
  let db: Db
  let app: ReturnType<typeof createApp>

  beforeEach(async () => {
    db = await createTestDb()
    app = createApp(testSuperuser, db)
  })

  async function seedChurchTeams(meetId: number) {
    const [church] = await db
      .insert(schema.churches)
      .values({ meetId, name: 'Grace Church', shortName: 'Grace', coachCodeHash: 'x' })
      .returning()
    const teams = await db
      .insert(schema.teams)
      .values([
        { meetId, churchId: church!.id, division: '1', number: 1 },
        { meetId, churchId: church!.id, division: '1', number: 2 },
        { meetId, churchId: church!.id, division: '1', number: 3 },
      ])
      .returning()
    for (const team of teams) {
      const identities = await db.insert(schema.quizzerIdentities).values([{}, {}, {}]).returning()
      await db.insert(schema.teamRosters).values([
        { teamId: team.id, quizzerId: identities[0]!.id, name: `${team.number}-Alice` },
        { teamId: team.id, quizzerId: identities[1]!.id, name: `${team.number}-Bob` },
        { teamId: team.id, quizzerId: identities[2]!.id, name: `${team.number}-Carol` },
      ])
    }
    return { church: church!, teams }
  }

  it('returns 3 resolved teams + rosters for a prelim quiz', async () => {
    const meet = await seedMeet(db)
    const room = await seedRoom(db, meet.id, 'Room A')
    const slot = await seedSlot(db, meet.id)
    const { teams } = await seedChurchTeams(meet.id)
    const now = new Date()
    await db.insert(schema.prelimAssignments).values([
      { meetId: meet.id, division: '1', letter: 'A', teamId: teams[0]!.id, assignedAt: now },
      { meetId: meet.id, division: '1', letter: 'B', teamId: teams[1]!.id, assignedAt: now },
      { meetId: meet.id, division: '1', letter: 'C', teamId: teams[2]!.id, assignedAt: now },
    ])
    const quiz = await seedQuizWithSeats(db, meet.id, slot.id, room.id, [
      { seatNumber: 1, letter: 'A' },
      { seatNumber: 2, letter: 'B' },
      { seatNumber: 3, letter: 'C' },
    ])

    const res = await app.request(`/api/meets/${meet.id}/quizzes/${quiz.id}/teams`, {}, env)
    expect(res.status).toBe(200)
    const body = await jsonOf<{
      quiz: { id: number; division: string; phase: string; label: string; roomName: string }
      seats: Array<{
        seatNumber: number
        letter: string | null
        seedRef: string | null
        team: { id: number; churchShortName: string; number: number } | null
        quizzers: Array<{ name: string }>
      }>
    }>(res)

    expect(body.quiz.id).toBe(quiz.id)
    expect(body.quiz.division).toBe('1')
    expect(body.quiz.phase).toBe('prelim')
    expect(body.quiz.label).toBe('D1-Q1')
    expect(body.quiz.roomName).toBe('Room A')
    expect(body.seats).toHaveLength(3)
    expect(body.seats.map((s) => s.seatNumber)).toEqual([1, 2, 3])
    expect(body.seats[0]!.team!.id).toBe(teams[0]!.id)
    expect(body.seats[0]!.team!.churchShortName).toBe('Grace')
    expect(body.seats[0]!.quizzers.map((q) => q.name)).toEqual(['1-Alice', '1-Bob', '1-Carol'])
    expect(body.seats[2]!.team!.number).toBe(3)
  })

  it('returns team: null + quizzers: [] for unresolved elim seedRefs', async () => {
    const meet = await seedMeet(db)
    const room = await seedRoom(db, meet.id, 'Room A')
    const slot = await seedSlot(db, meet.id)
    const { teams } = await seedChurchTeams(meet.id)
    const now = new Date()
    await db.insert(schema.seedResolutions).values([
      { meetId: meet.id, seedRef: '1stA', teamId: teams[0]!.id, resolvedAt: now },
      // '2ndA' and '1stB' deliberately unresolved
    ])
    const quiz = await seedQuizWithSeats(
      db,
      meet.id,
      slot.id,
      room.id,
      [
        { seatNumber: 1, seedRef: '1stA' },
        { seatNumber: 2, seedRef: '2ndA' },
        { seatNumber: 3, seedRef: '1stB' },
      ],
      { phase: 'elim', lane: 'main', label: 'D1-QA', bracketLabel: 'A' },
    )

    const res = await app.request(`/api/meets/${meet.id}/quizzes/${quiz.id}/teams`, {}, env)
    expect(res.status).toBe(200)
    const body = await jsonOf<{
      quiz: { phase: string; lane: string | null; bracketLabel: string | null }
      seats: Array<{
        seedRef: string | null
        team: { id: number } | null
        quizzers: Array<{ name: string }>
      }>
    }>(res)

    expect(body.quiz.phase).toBe('elim')
    expect(body.quiz.lane).toBe('main')
    expect(body.quiz.bracketLabel).toBe('A')
    expect(body.seats[0]!.team!.id).toBe(teams[0]!.id)
    expect(body.seats[0]!.quizzers).toHaveLength(3)
    expect(body.seats[1]!.team).toBeNull()
    expect(body.seats[1]!.quizzers).toEqual([])
    expect(body.seats[2]!.team).toBeNull()
  })

  it('404s when the quiz belongs to a different meet', async () => {
    const meetA = await seedMeet(db, 'Meet A')
    const meetB = await seedMeet(db, 'Meet B')
    const roomA = await seedRoom(db, meetA.id, 'Room A')
    const slotA = await seedSlot(db, meetA.id)
    const quiz = await seedQuizWithSeats(db, meetA.id, slotA.id, roomA.id, [
      { seatNumber: 1, letter: 'A' },
    ])

    const res = await app.request(`/api/meets/${meetB.id}/quizzes/${quiz.id}/teams`, {}, env)
    expect(res.status).toBe(404)
  })

  it('404s when the quiz does not exist', async () => {
    const meet = await seedMeet(db)
    const res = await app.request(`/api/meets/${meet.id}/quizzes/99999/teams`, {}, env)
    expect(res.status).toBe(404)
  })

  it('401s when not signed in', async () => {
    const meet = await seedMeet(db)
    const room = await seedRoom(db, meet.id, 'Room A')
    const slot = await seedSlot(db, meet.id)
    const quiz = await seedQuizWithSeats(db, meet.id, slot.id, room.id, [
      { seatNumber: 1, letter: 'A' },
    ])
    const anonApp = createApp(null, db)
    const res = await anonApp.request(`/api/meets/${meet.id}/quizzes/${quiz.id}/teams`, {}, env)
    expect(res.status).toBe(401)
  })
})

describe('GET schedule reads: per-meet membership gate', () => {
  let db: Db
  let userApp: ReturnType<typeof createApp>
  let meetId: number
  let roomId: number
  let quizId: number

  beforeEach(async () => {
    db = await createTestDb()
    userApp = createApp(testUser, db)
    const meet = await seedMeet(db)
    const room = await seedRoom(db, meet.id, 'Room A')
    const slot = await seedSlot(db, meet.id)
    const [quiz] = await db
      .insert(schema.scheduledQuizzes)
      .values({
        meetId: meet.id,
        slotId: slot.id,
        roomId: room.id,
        division: '1',
        phase: 'prelim',
        label: 'D1-Q1',
      })
      .returning()
    meetId = meet.id
    roomId = room.id
    quizId = quiz!.id
  })

  const routes: [string, () => string][] = [
    ['rooms', () => `/api/meets/${meetId}/rooms`],
    ['slots', () => `/api/meets/${meetId}/slots`],
    ['quizzes', () => `/api/meets/${meetId}/quizzes`],
    ['quiz teams', () => `/api/meets/${meetId}/quizzes/${quizId}/teams`],
    ['prelim-assignments', () => `/api/meets/${meetId}/prelim-assignments`],
  ]

  it.each(routes)('%s: 403s for a signed-in non-member', async (_name, path) => {
    const res = await userApp.request(path(), {}, env)
    expect(res.status).toBe(403)
  })

  it.each(routes)('%s: 403s for a member of a different meet', async (_name, path) => {
    const otherMeet = await seedMeet(db, 'Other Meet')
    await db
      .insert(schema.viewerMemberships)
      .values({ accountId: testUser.id, meetId: otherMeet.id })
    const res = await userApp.request(path(), {}, env)
    expect(res.status).toBe(403)
  })

  const memberships: [string, () => Promise<unknown>][] = [
    ['admin', () => db.insert(schema.adminMemberships).values({ accountId: testUser.id, meetId })],
    [
      'coach',
      async () => {
        const [church] = await db
          .insert(schema.churches)
          .values({ meetId, name: 'Grace Church', shortName: 'Grace', coachCodeHash: 'x' })
          .returning()
        await db
          .insert(schema.coachMemberships)
          .values({ accountId: testUser.id, churchId: church!.id, meetId })
      },
    ],
    [
      'official',
      () =>
        db.insert(schema.officialMemberships).values({ accountId: testUser.id, meetId, roomId }),
    ],
    [
      'viewer',
      () => db.insert(schema.viewerMemberships).values({ accountId: testUser.id, meetId }),
    ],
  ]

  it.each(memberships)('admits a %s member of the meet on every read', async (_role, seed) => {
    await seed()
    for (const [name, path] of routes) {
      const res = await userApp.request(path(), {}, env)
      expect(res.status, name).toBe(200)
    }
  })

  it('quiz teams: 403s before revealing whether the quiz exists', async () => {
    const res = await userApp.request(`/api/meets/${meetId}/quizzes/99999/teams`, {}, env)
    expect(res.status).toBe(403)
  })
})

// ---- Linked schedules (specs/005-schedule-redesign/contracts/api.md) ----

function guestApp(db: Db, meetId: number) {
  const app = new Hono<{ Bindings: Bindings; Variables: SessionVariables & { db: Db } }>()
  app.use('*', mockSession(null, { meetId, role: MeetRole.Viewer }))
  app.use('*', mockDb(db))
  app.route('/api/meets', publishedSchedule)
  return app
}

/** A meet with six Div 1 teams, two rooms, and a generated schedule linked to it */
async function linkedMeet(db: Db, phase: MeetPhase = 'registration') {
  const meet = await seedMeet(db, 'Linked Meet', { phase })
  const [church] = await db
    .insert(schema.churches)
    .values({ meetId: meet.id, name: 'Grace Church', shortName: 'Grace', coachCodeHash: 'x' })
    .returning()
  const teams = await db
    .insert(schema.teams)
    .values(
      Array.from({ length: 6 }, (_, i) => ({
        meetId: meet.id,
        churchId: church!.id,
        division: '1',
        number: i + 1,
      })),
    )
    .returning()
  const base = newScheduleDocument('Linked Meet')
  base.settings.divisions = [{ id: '1', name: 'Div 1', teams: 6, elims: defaultElims(6) }]
  const doc = generateSchedule(base)
  doc.link = { meetId: meet.id, timeZone: 'America/Winnipeg' }
  doc.draw['1'] = {
    stale: false,
    teams: teams.map((t, i) => ({ teamId: t.id, late: false, absent: false, letter: 'ABCDEF'[i] })),
  }
  return { meet, teams, doc }
}

const put = (body: unknown) => jsonRequest('PUT', body)
const post = (body: unknown) => jsonRequest('POST', body)

describe('linked schedule routes', () => {
  let db: Db
  let app: ReturnType<typeof createApp>

  beforeEach(async () => {
    db = await createTestDb()
    app = createApp(testSuperuser, db)
  })

  it('admits only admins and superusers to the draft, publish, versions, restore and unlink routes', async () => {
    const { meet } = await linkedMeet(db)
    await db.insert(schema.viewerMemberships).values({ accountId: testUser.id, meetId: meet.id })
    const userApp = createApp(testUser, db)
    const base = `/api/meets/${meet.id}/schedule`
    const calls: [string, RequestInit][] = [
      [base, {}],
      [`${base}/draft`, put({ document: {}, baseRevision: 0 })],
      [`${base}/publish`, post({ baseRevision: 0 })],
      [`${base}/versions`, {}],
      [`${base}/versions/1`, {}],
      [`${base}/versions/1/restore`, post({ baseRevision: 0 })],
      [base, { method: 'DELETE' }],
    ]
    for (const [path, init] of calls) {
      const res = await userApp.request(path, init, env)
      expect(res.status, `${init.method ?? 'GET'} ${path}`).toBe(403)
    }
  })

  it('refuses a stale draft save with the newer draft, and an invalid one saying why', async () => {
    const { meet, doc } = await linkedMeet(db)
    const path = `/api/meets/${meet.id}/schedule/draft`
    const first = await app.request(path, put({ document: doc, baseRevision: 0 }), env)
    expect(await jsonOf(first)).toMatchObject({ draftRevision: 1 })

    const stale = await app.request(path, put({ document: doc, baseRevision: 0 }), env)
    expect(stale.status).toBe(409)
    expect(await jsonOf(stale)).toMatchObject({ draftRevision: 1, draft: { id: doc.id } })

    const invalid = await app.request(
      path,
      put({ document: { ...doc, rooms: 'x' }, baseRevision: 1 }),
      env,
    )
    expect(invalid.status).toBe(400)
    expect((await jsonOf<{ error: string }>(invalid)).error).toMatch(/Not a valid schedule/)
  })

  it("refuses a draw naming another meet's team", async () => {
    const { meet, doc } = await linkedMeet(db)
    const other = await linkedMeet(db)
    doc.draw['1']!.teams[0]!.teamId = other.teams[0]!.id
    const res = await app.request(
      `/api/meets/${meet.id}/schedule/draft`,
      put({ document: doc, baseRevision: 0 }),
      env,
    )
    expect(res.status).toBe(400)
  })

  it('refuses a save over a different draft at the same revision, unless replacing', async () => {
    const { meet, doc } = await linkedMeet(db)
    const path = `/api/meets/${meet.id}/schedule/draft`
    await app.request(path, put({ document: doc, baseRevision: 0 }), env)
    const other = { ...doc, id: 'another-draft' }
    const stale = await app.request(path, put({ document: other, baseRevision: 1 }), env)
    expect(stale.status).toBe(409)
    const replaced = await app.request(
      path,
      put({ document: other, baseRevision: 1, replace: true }),
      env,
    )
    expect(replaced.status).toBe(200)
  })

  it('publishes past hard conflicts only when confirmed, adding a version each time', async () => {
    const { meet, doc } = await linkedMeet(db)
    // Two quizzes in one cell is a hard conflict
    doc.quizzes[1]!.cell = doc.quizzes[0]!.cell
    const base = `/api/meets/${meet.id}/schedule`
    await app.request(`${base}/draft`, put({ document: doc, baseRevision: 0 }), env)

    const refused = await app.request(`${base}/publish`, post({ baseRevision: 1 }), env)
    expect(refused.status).toBe(409)
    expect((await jsonOf<{ conflicts: unknown[] }>(refused)).conflicts.length).toBeGreaterThan(0)

    const published = await app.request(
      `${base}/publish`,
      post({ baseRevision: 1, confirmConflicts: true }),
      env,
    )
    expect(await jsonOf(published)).toMatchObject({ version: 1, draftRevision: 2 })
    await app.request(`${base}/publish`, post({ baseRevision: 2, confirmConflicts: true }), env)

    const versions = await jsonOf<{ version: number; publishedBy: string }[]>(
      await app.request(`${base}/versions`, {}, env),
    )
    expect(versions).toEqual([
      expect.objectContaining({ version: 2, publishedBy: 'Test Admin' }),
      expect.objectContaining({ version: 1, publishedBy: 'Test Admin' }),
    ])
  })

  it('keeps every version when unlinking, and relinking continues the numbering', async () => {
    const { meet, doc } = await linkedMeet(db)
    const base = `/api/meets/${meet.id}/schedule`
    await app.request(`${base}/draft`, put({ document: doc, baseRevision: 0 }), env)
    await app.request(`${base}/publish`, post({ baseRevision: 1 }), env)
    await app.request(base, { method: 'DELETE' }, env)
    expect((await jsonOf<{ draft: unknown }>(await app.request(base, {}, env))).draft).toBeNull()

    await app.request(`${base}/draft`, put({ document: doc, baseRevision: 0 }), env)
    const again = await app.request(`${base}/publish`, post({ baseRevision: 1 }), env)
    expect(await jsonOf(again)).toMatchObject({ version: 2 })
  })

  it('restores a version into the draft and publishes nothing', async () => {
    const { meet, doc } = await linkedMeet(db)
    const base = `/api/meets/${meet.id}/schedule`
    await app.request(`${base}/draft`, put({ document: doc, baseRevision: 0 }), env)
    await app.request(`${base}/publish`, post({ baseRevision: 1 }), env)
    await app.request(
      `${base}/draft`,
      put({ document: { ...doc, name: 'Changed' }, baseRevision: 2 }),
      env,
    )

    const restored = await app.request(`${base}/versions/1/restore`, post({ baseRevision: 3 }), env)
    expect(await jsonOf(restored)).toMatchObject({ draftRevision: 4 })
    const state = await jsonOf<{ draft: { name: string }; version: number }>(
      await app.request(base, {}, env),
    )
    expect(state).toMatchObject({ draft: { name: 'Linked Meet' }, version: 1 })
  })

  it('restores a version without the teams the meet has lost since, its draw to redo', async () => {
    const { meet, teams, doc } = await linkedMeet(db)
    const base = `/api/meets/${meet.id}/schedule`
    await app.request(`${base}/draft`, put({ document: doc, baseRevision: 0 }), env)
    await app.request(`${base}/publish`, post({ baseRevision: 1 }), env)
    await db.delete(schema.teams).where(eq(schema.teams.id, teams[0]!.id))

    const restored = await app.request(`${base}/versions/1/restore`, post({ baseRevision: 2 }), env)
    expect(restored.status).toBe(200)
    const state = await jsonOf<{ draft: ScheduleDocument }>(await app.request(base, {}, env))
    // The restore answers with the draft it saved, for the page to open
    expect((await jsonOf<{ document: ScheduleDocument }>(restored)).document).toEqual(state.draft)
    const draw = state.draft.draw['1']!
    expect(draw.teams.map((t) => t.teamId)).not.toContain(teams[0]!.id)
    expect(draw.stale).toBe(true)
  })

  it('refuses to publish a draft naming a team the meet has lost since, saying which', async () => {
    const { meet, teams, doc } = await linkedMeet(db)
    const base = `/api/meets/${meet.id}/schedule`
    await app.request(`${base}/draft`, put({ document: doc, baseRevision: 0 }), env)
    await db.delete(schema.teams).where(eq(schema.teams.id, teams[0]!.id))
    const res = await app.request(`${base}/publish`, post({ baseRevision: 1 }), env)
    expect(res.status).toBe(400)
    expect(await jsonOf(res)).toMatchObject({ teamId: teams[0]!.id })
  })

  it("makes the meet's rooms match: adds, renames, and keeps an unused room with an official code", async () => {
    const { meet, doc } = await linkedMeet(db)
    const kept = await seedRoom(db, meet.id, 'Gym')
    await db.update(schema.meetRooms).set({ codeHash: 'h' }).where(eq(schema.meetRooms.id, kept.id))
    const gone = await seedRoom(db, meet.id, 'Chapel')
    const renamed = await seedRoom(db, meet.id, 'Room 1')
    doc.rooms[0] = { ...doc.rooms[0]!, name: 'Sanctuary', meetRoomId: renamed.id }
    const base = `/api/meets/${meet.id}/schedule`
    await app.request(`${base}/draft`, put({ document: doc, baseRevision: 0 }), env)

    const res = await jsonOf<{ unusedRooms: { name: string }[]; rooms: { meetRoomId: number }[] }>(
      await app.request(`${base}/publish`, post({ baseRevision: 1 }), env),
    )
    expect(res.unusedRooms.map((r) => r.name)).toEqual(['Gym'])
    const rooms = await db
      .select()
      .from(schema.meetRooms)
      .where(eq(schema.meetRooms.meetId, meet.id))
    expect(rooms.map((r) => r.name).sort()).toEqual(
      ['Gym', 'Sanctuary', ...doc.rooms.slice(1).map((r) => r.name)].sort(),
    )
    expect(rooms.some((r) => r.id === gone.id)).toBe(false)
    expect(res.rooms.every((r) => typeof r.meetRoomId === 'number')).toBe(true)
  })

  it('takes back a meet room of the same name rather than adding a second', async () => {
    const { meet, doc } = await linkedMeet(db)
    const existing = await seedRoom(db, meet.id, doc.rooms[0]!.name)
    const base = `/api/meets/${meet.id}/schedule`
    await app.request(`${base}/draft`, put({ document: doc, baseRevision: 0 }), env)
    const res = await jsonOf<{ rooms: { meetRoomId: number }[] }>(
      await app.request(`${base}/publish`, post({ baseRevision: 1 }), env),
    )
    expect(res.rooms[0]!.meetRoomId).toBe(existing.id)
  })

  it('keeps an unused room that has an official, even without a code', async () => {
    const { meet, doc } = await linkedMeet(db)
    const staffed = await seedRoom(db, meet.id, 'Chapel')
    await db
      .insert(schema.officialMemberships)
      .values({ accountId: testUser.id, meetId: meet.id, roomId: staffed.id })
    const base = `/api/meets/${meet.id}/schedule`
    await app.request(`${base}/draft`, put({ document: doc, baseRevision: 0 }), env)
    const res = await jsonOf<{ unusedRooms: { name: string }[] }>(
      await app.request(`${base}/publish`, post({ baseRevision: 1 }), env),
    )
    expect(res.unusedRooms.map((r) => r.name)).toEqual(['Chapel'])
  })

  it('lists the result names that have results', async () => {
    const { meet } = await linkedMeet(db)
    await db
      .insert(schema.quizResults)
      .values({ meetId: meet.id, quizKey: 'div 1 quiz 1', createdAt: new Date() })
    const body = await jsonOf<{ results: string[] }>(
      await app.request(`/api/meets/${meet.id}/schedule`, {}, env),
    )
    expect(body.results).toEqual(['div 1 quiz 1'])
  })
})

describe('GET /api/meets/:id/schedule/published', () => {
  let db: Db

  beforeEach(async () => {
    db = await createTestDb()
  })

  async function publish(phase: MeetPhase) {
    const linked = await linkedMeet(db, phase)
    const app = createApp(testSuperuser, db)
    const base = `/api/meets/${linked.meet.id}/schedule`
    await app.request(`${base}/draft`, put({ document: linked.doc, baseRevision: 0 }), env)
    await app.request(`${base}/publish`, post({ baseRevision: 1 }), env)
    return linked
  }

  type Published = { view: string; document: ScheduleDocument }

  it('404s before anything is published', async () => {
    const { meet } = await linkedMeet(db)
    const res = await guestApp(db, meet.id).request(
      `/api/meets/${meet.id}/schedule/published`,
      {},
      env,
    )
    expect(res.status).toBe(404)
  })

  it('gives a guest letters in registration and build, with the teams removed (FR-052)', async () => {
    for (const phase of ['registration', 'build'] as const) {
      const { meet } = await publish(phase)
      const res = await guestApp(db, meet.id).request(
        `/api/meets/${meet.id}/schedule/published`,
        {},
        env,
      )
      const body = await jsonOf<Published>(res)
      expect(body.view).toBe('letters')
      expect(body.document.draw['1']!.teams.every((t) => !t.teamId && !t.name)).toBe(true)
    }
  })

  it('lists letters in letter order, so they cannot be paired with the meet team list', async () => {
    const linked = await linkedMeet(db, 'build')
    linked.doc.draw['1']!.teams.reverse()
    const app = createApp(testSuperuser, db)
    const base = `/api/meets/${linked.meet.id}/schedule`
    await app.request(`${base}/draft`, put({ document: linked.doc, baseRevision: 0 }), env)
    await app.request(`${base}/publish`, post({ baseRevision: 1 }), env)
    const res = await guestApp(db, linked.meet.id).request(`${base}/published`, {}, env)
    const body = await jsonOf<Published>(res)
    expect(body.document.draw['1']!.teams.map((t) => t.letter)).toEqual([
      'A',
      'B',
      'C',
      'D',
      'E',
      'F',
    ])
  })

  it('shows no late or absent marks in letters, which could name a team', async () => {
    const linked = await linkedMeet(db, 'build')
    linked.doc.draw['1']!.teams[2]!.late = true
    const app = createApp(testSuperuser, db)
    const base = `/api/meets/${linked.meet.id}/schedule`
    await app.request(`${base}/draft`, put({ document: linked.doc, baseRevision: 0 }), env)
    await app.request(`${base}/publish`, post({ baseRevision: 1 }), env)
    const body = await jsonOf<Published>(
      await guestApp(db, linked.meet.id).request(`${base}/published`, {}, env),
    )
    expect(body.document.draw['1']!.teams.some((t) => t.late)).toBe(false)
  })

  it('keeps the draw from non-admins on the old routes too, before the meet is live', async () => {
    const { meet } = await publish('build')
    await db.insert(schema.viewerMemberships).values({ accountId: testUser.id, meetId: meet.id })
    const res = await createApp(testUser, db).request(
      `/api/meets/${meet.id}/prelim-assignments`,
      {},
      env,
    )
    expect(await jsonOf(res)).toEqual({ assignments: [] })
  })

  it('gives team names, read from the meet, from live on', async () => {
    for (const phase of ['live', 'done'] as const) {
      const { meet } = await publish(phase)
      const res = await guestApp(db, meet.id).request(
        `/api/meets/${meet.id}/schedule/published`,
        {},
        env,
      )
      const body = await jsonOf<Published>(res)
      expect(body.view).toBe('teams')
      expect(body.document.draw['1']!.teams[0]!.name).toBe('Grace 1')
    }
  })

  it('403s for a guest of another meet', async () => {
    const { meet } = await publish('live')
    const res = await guestApp(db, meet.id + 100).request(
      `/api/meets/${meet.id}/schedule/published`,
      {},
      env,
    )
    expect(res.status).toBe(403)
  })
})

describe('meets built with the old editor (FR-053)', () => {
  let db: Db
  let app: ReturnType<typeof createApp>

  beforeEach(async () => {
    db = await createTestDb()
    app = createApp(testSuperuser, db)
  })

  /** Two prelims and an elim whose seats name a prelim rank and a quiz's place, like seed-schedule.sql */
  async function oldMeet() {
    const meet = await seedMeet(db)
    const [church] = await db
      .insert(schema.churches)
      .values({ meetId: meet.id, name: 'Grace Church', shortName: 'Grace', coachCodeHash: 'x' })
      .returning()
    const teams = await db
      .insert(schema.teams)
      .values(
        [false, true, false].map((lateness, i) => ({
          meetId: meet.id,
          churchId: church!.id,
          division: '1',
          number: i + 1,
          lateness,
        })),
      )
      .returning()
    await db.insert(schema.prelimAssignments).values(
      teams.map((t, i) => ({
        meetId: meet.id,
        division: '1',
        letter: 'ABC'[i]!,
        teamId: t.id,
        assignedAt: new Date(),
      })),
    )
    const room = await seedRoom(db, meet.id, 'Room A')
    const slot = await seedSlot(db, meet.id)
    const prelim = await seedQuizWithSeats(
      db,
      meet.id,
      slot.id,
      room.id,
      [
        { seatNumber: 1, letter: 'A' },
        { seatNumber: 2, letter: 'B' },
        { seatNumber: 3, letter: 'C' },
      ],
      { label: 'Div 1 Quiz 1' },
    )
    const later = await seedSlot(db, meet.id, 1)
    const x = await seedQuizWithSeats(
      db,
      meet.id,
      later.id,
      room.id,
      [
        { seatNumber: 1, seedRef: '1st of prelims' },
        { seatNumber: 2, seedRef: '1st Quiz 1' },
        { seatNumber: 3, seedRef: 'winner of the raffle' },
      ],
      { phase: 'elim', lane: 'main', label: 'Div 1 Quiz X', bracketLabel: 'X' },
    )
    return { meet, teams, room, slot, prelim, x }
  }

  it('converts on first open: pinned, old ids, late marks, unknown seats empty, draft and version 1', async () => {
    const { meet, teams, slot, prelim, x } = await oldMeet()
    const res = await app.request(`/api/meets/${meet.id}/schedule?timeZone=UTC`, {}, env)
    const body = await jsonOf<{ draft: ScheduleDocument; version: number }>(res)
    expect(body.version).toBe(1)
    const doc = body.draft
    expect(doc.quizzes.every((q) => q.pinned)).toBe(true)
    expect(doc.quizzes.map((q) => q.id).sort()).toEqual([String(prelim.id), String(x.id)].sort())
    expect(doc.quizzes.find((q) => q.id === String(prelim.id))!.cell).toEqual({
      slot: String(slot.id),
      room: expect.any(String),
    })
    expect(doc.quizzes.find((q) => q.id === String(x.id))!.seats).toEqual([
      { kind: 'rank', rank: 1 },
      { kind: 'place', quiz: String(prelim.id), place: 1 },
      { kind: 'empty' },
    ])
    expect(doc.draw['1']!.teams).toEqual(
      teams.map((t, i) => ({ teamId: t.id, late: i === 1, absent: false, letter: 'ABC'[i] })),
    )
    const frame = doc.frame.filter((r) => r.kind === 'slot')
    expect(frame[0]).toMatchObject({ at: 20 * 60, minutes: 25 })

    // Opening again converts nothing more
    await app.request(`/api/meets/${meet.id}/schedule`, {}, env)
    const versions = await jsonOf<unknown[]>(
      await app.request(`/api/meets/${meet.id}/schedule/versions`, {}, env),
    )
    expect(versions).toHaveLength(1)
  })

  it("relabels the old editor's quizzes so their result names match results already saved", async () => {
    const { meet, slot, room } = await oldMeet()
    const old = await seedQuizWithSeats(
      db,
      meet.id,
      slot.id,
      room.id,
      [{ seatNumber: 1, letter: 'A' }],
      {
        label: 'D1-Q3',
      },
    )
    const { draft } = await jsonOf<{ draft: ScheduleDocument }>(
      await app.request(`/api/meets/${meet.id}/schedule?timeZone=UTC`, {}, env),
    )
    const quiz = draft.quizzes.find((q) => q.id === String(old.id))!
    expect(quiz.label).toBe('Div 1 Quiz 3')
    expect(resultName(quiz)).toBe('1||3')

    const { quizzes } = await jsonOf<{ quizzes: { id: number; bracketLabel: string }[] }>(
      await app.request(`/api/meets/${meet.id}/quizzes`, {}, env),
    )
    expect(quizzes.find((q) => q.id === old.id)!.bracketLabel).toBe('3')
  })

  it('shows readers a meet still on the old tables before anyone opens the builder', async () => {
    const { meet, prelim } = await oldMeet()
    const res = await guestApp(db, meet.id).request(
      `/api/meets/${meet.id}/schedule/published?timeZone=UTC`,
      {},
      env,
    )
    const body = await jsonOf<{ document: ScheduleDocument }>(res)
    expect(body.document.quizzes.some((q) => q.id === String(prelim.id))).toBe(true)
    expect(await db.select().from(schema.meetScheduleVersions)).toEqual([])
  })

  it('reads a time zone it does not know as UTC rather than failing', async () => {
    const { meet } = await oldMeet()
    const res = await guestApp(db, meet.id).request(
      `/api/meets/${meet.id}/schedule/published?timeZone=Nowhere/Atlantis`,
      {},
      env,
    )
    expect(res.status).toBe(200)
  })

  it('does not convert again after unlinking', async () => {
    const { meet } = await oldMeet()
    const base = `/api/meets/${meet.id}/schedule`
    await app.request(`${base}?timeZone=UTC`, {}, env)
    await app.request(base, { method: 'DELETE' }, env)
    const again = await jsonOf<{ draft: unknown; version: number }>(
      await app.request(`${base}?timeZone=UTC`, {}, env),
    )
    expect(again).toMatchObject({ draft: null, version: 1 })
  })

  it('answers the old read routes from the newest published version in their old shapes', async () => {
    const { meet, room, slot, prelim, teams } = await oldMeet()
    await app.request(`/api/meets/${meet.id}/schedule?timeZone=UTC`, {}, env)
    // Change the old rows; the routes no longer read them
    await db.delete(schema.scheduledQuizzes).where(eq(schema.scheduledQuizzes.meetId, meet.id))

    const slots = await jsonOf<{ slots: { id: number; startAt: string }[] }>(
      await app.request(`/api/meets/${meet.id}/slots`, {}, env),
    )
    expect(slots.slots[0]).toMatchObject({ id: slot.id, startAt: '2026-01-01T20:00:00.000Z' })

    const quizzes = await jsonOf<{
      quizzes: {
        id: number
        roomId: number
        seats: { letter: string | null; seedRef: string | null }[]
      }[]
    }>(await app.request(`/api/meets/${meet.id}/quizzes`, {}, env))
    expect(quizzes.quizzes.find((q) => q.id === prelim.id)).toMatchObject({
      roomId: room.id,
      seats: [{ letter: 'A' }, { letter: 'B' }, { letter: 'C' }],
    })
    expect(quizzes.quizzes.find((q) => q.id !== prelim.id)!.seats.map((s) => s.seedRef)).toEqual([
      '1st place',
      '1st Quiz 1',
      null,
    ])

    const quiz = await jsonOf<{
      quiz: { label: string }
      seats: { team: { id: number } | null }[]
    }>(await app.request(`/api/meets/${meet.id}/quizzes/${prelim.id}/teams`, {}, env))
    expect(quiz.quiz.label).toBe('Div 1 Quiz 1')
    expect(quiz.seats.map((s) => s.team?.id)).toEqual(teams.map((t) => t.id))
  })
})
