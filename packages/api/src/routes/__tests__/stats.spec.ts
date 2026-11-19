import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import {
  DEFAULT_STATS_SETTINGS,
  MeetRole,
  PlacementFormula,
  type DivisionStateValue,
  type DivisionStats,
  type QuizFile,
  type StatsSettings,
} from '@qzr/shared'
import { eq, sql } from 'drizzle-orm'
import { fifteenQuestionQuizFile } from '../../../../shared/src/scoring/__tests__/fixtures/fifteenQuestionQuiz'
import type { Bindings } from '../../bindings'
import type { SessionUser, SessionVariables } from '../../middleware/session'
import type { GuestPayload } from '../../lib/jwt'
import { SHARED_VERSION } from '../../lib/scores'
import { results } from '../results'
import { stats } from '../stats'
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

const env = {
  ENVIRONMENT: 'test',
  BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
} as unknown as Bindings

function as(user: SessionUser | null, guest: GuestPayload | null = null) {
  const app = new Hono<{ Bindings: Bindings; Variables: SessionVariables & { db: Db } }>()
  app.use('*', mockSession(user, guest))
  app.use('*', mockDb(db))
  app.route('/api/meets', results)
  app.route('/api/meets', stats)
  return app
}

let db: Db
let meetId: number

beforeEach(async () => {
  db = await createTestDb()
  meetId = (await seedMeet(db, 'Stats Meet', { phase: 'live' })).id
  await db
    .update(schema.quizMeets)
    .set({ divisions: JSON.stringify(['1', '2']) })
    .where(eq(schema.quizMeets.id, meetId))
})

/** A complete, valid quiz of division 1 */
function quiz(quizNumber: string, change: (file: QuizFile) => void = () => {}): QuizFile {
  const file = fifteenQuestionQuizFile()
  file.quiz.quizNumber = quizNumber
  change(file)
  return file
}

/** Store a quiz as the admin, counted unless told otherwise; answers its id */
async function store(quizFile: QuizFile, counted = true): Promise<number> {
  const res = await as(testSuperuser).request(
    `/api/meets/${meetId}/results`,
    jsonRequest('POST', { quizFile }),
    env,
  )
  expect(res.status).toBe(201)
  const { id } = await jsonOf<{ id: number }>(res)
  if (counted) {
    const counting = await as(testSuperuser).request(
      `/api/meets/${meetId}/results/stage`,
      jsonRequest('PATCH', { ids: [id], stage: 'prelim' }),
      env,
    )
    expect(counting.status).toBe(200)
  }
  return id
}

const scoreRows = () => db.select().from(schema.quizResultScores)
const division = (name: string, user: SessionUser | null = testSuperuser) =>
  as(user).request(`/api/meets/${meetId}/stats/${name}`, {}, env)

describe('keeping what scoring makes of a revision', () => {
  it('scores a revision when it is saved, by the running shared version', async () => {
    await store(quiz('1'))
    const rows = await scoreRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.sharedVersion).toBe(SHARED_VERSION)
    expect(JSON.parse(rows[0]!.scored)).toMatchObject({
      name: 'D1 Q1',
      teams: [{ name: 'Team A', score: 200 }, { name: 'Team B' }, { name: 'Team C' }],
    })
  })

  it('scores each new revision, and none for a revision that restores an earlier one', async () => {
    const id = await store(quiz('1'))
    const edited = await as(testSuperuser).request(
      `/api/meets/${meetId}/results/${id}`,
      jsonRequest('PUT', {
        quizFile: quiz('1', (file) => (file.teams[0]!.name = 'Team Z')),
        baseRevision: 1,
      }),
      env,
    )
    expect(edited.status).toBe(200)
    expect(await scoreRows()).toHaveLength(2)

    const restored = await as(testSuperuser).request(
      `/api/meets/${meetId}/results/${id}/restore`,
      jsonRequest('POST', { revision: 1 }),
      env,
    )
    expect(restored.status).toBe(200)
    expect(await scoreRows()).toHaveLength(2)
    // The stats show the restored content, from the score kept for the revision restored
    const body = await jsonOf<DivisionStats>(await division('1'))
    expect(body.results[0]!.quizzes[0]!.teams[0]!.name).toBe('Team A')
  })
})

describe('a save whose score cannot be kept', () => {
  it('still stores the quiz, and the score is made when stats are next read', async () => {
    db.run(sql`create trigger refuse_scores before insert on quiz_result_scores
      begin select raise(abort, 'refused'); end`)
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    await store(quiz('1'))
    expect(logged).toHaveBeenCalled()
    logged.mockRestore()
    expect(await scoreRows()).toHaveLength(0)

    db.run(sql`drop trigger refuse_scores`)
    const res = await division('1')
    expect(res.status).toBe(200)
    expect((await jsonOf<DivisionStats>(res)).results[0]!.quizzes[0]!.name).toBe('D1 Q1')
    expect(await scoreRows()).toHaveLength(1)
  })
})

describe('GET /api/meets/:id/stats', () => {
  it("lists the meet's divisions in its order, then any only a stored quiz names", async () => {
    await store(quiz('1', (file) => (file.quiz.division = 'Open')))
    // A quiz with no division is in none
    await store(quiz('2', (file) => (file.quiz.division = '')))
    await db.insert(schema.divisionStates).values({
      meetId,
      division: '2',
      state: 'stats_break',
      transitionedAt: new Date(),
    })
    const res = await as(testSuperuser).request(`/api/meets/${meetId}/stats`, {}, env)
    expect(res.status).toBe(200)
    expect(await jsonOf(res)).toEqual({
      phase: 'live',
      admin: true,
      divisions: [
        { division: '1', state: 'prelim_running' },
        { division: '2', state: 'stats_break' },
        { division: 'open', state: 'prelim_running' },
      ],
    })
  })

  it('refuses an account with no access to the meet, and a caller with none', async () => {
    expect((await as(testUser).request(`/api/meets/${meetId}/stats`, {}, env)).status).toBe(403)
    expect((await as(null).request(`/api/meets/${meetId}/stats`, {}, env)).status).toBe(401)
  })
})

describe('GET /api/meets/:id/stats/:division', () => {
  it("gives an admin the division's quizzes and prelim standings", async () => {
    await store(quiz('1'))
    await store(quiz('2'), false)
    await store(quiz('1', (file) => (file.quiz.division = '2')))
    const res = await division('1')
    expect(res.status).toBe(200)
    const body = await jsonOf<DivisionStats>(res)
    expect(body).toMatchObject({ division: '1', state: 'prelim_running', phase: 'live' })
    // The quiz that is not counted is not listed, nor the other division's
    expect(body.results).toEqual([
      {
        stage: 'prelim',
        level: 'scores',
        quizzes: [expect.objectContaining({ name: 'D1 Q1', status: 'counted' })],
      },
    ])
    expect(body.prelimStandings!.teams.map((t) => [t.name, t.rank, t.placementPoints])).toEqual([
      ['Team A', 1, 20],
      ['Team C', 2, 9],
      ['Team B', 3, 1],
    ])
    expect(body.quizzers!.lists[0]!.quizzers[0]).toMatchObject({
      name: 'A0',
      team: 'Team A',
      place: 1,
      average: 70,
      // The quiz records no question types, so the counts by type can't add up
      flags: [{ kind: 'incompleteTypes' }],
    })
  })

  it('answers for a division of the meet with no quiz yet, and 404 for one it does not have', async () => {
    const empty = await division('2')
    expect(empty.status).toBe(200)
    expect((await jsonOf<DivisionStats>(empty)).results).toEqual([])
    expect((await division('7')).status).toBe(404)
  })

  it('refuses an account with no access to the meet, and a caller with none', async () => {
    expect((await division('1', testUser)).status).toBe(403)
    expect((await division('1', null)).status).toBe(401)
  })

  it('scores what is missing a few revisions at a time, asking the caller to come back', async () => {
    for (let n = 1; n <= 12; n++) await store(quiz(String(n)))
    // As if these quizzes were stored before scores were kept
    await db.delete(schema.quizResultScores)

    const first = await division('1')
    expect(first.status).toBe(503)
    expect(first.headers.get('Retry-After')).toBe('1')
    expect(await jsonOf(first)).toEqual({ error: 'Stats are being prepared' })
    const afterFirst = (await scoreRows()).length
    expect(afterFirst).toBeGreaterThan(0)
    expect(afterFirst).toBeLessThan(12)

    let res = await division('1')
    for (let tries = 0; res.status === 503 && tries < 12; tries++) res = await division('1')
    expect(res.status).toBe(200)
    expect(await scoreRows()).toHaveLength(12)
    expect((await jsonOf<DivisionStats>(res)).results[0]!.quizzes).toHaveLength(12)
  })

  it('scores again what another shared version scored', async () => {
    await store(quiz('1'))
    await db
      .update(schema.quizResultScores)
      .set({ sharedVersion: '0.0.1', scored: JSON.stringify({ stale: true }) })
    const res = await division('1')
    expect(res.status).toBe(200)
    expect((await jsonOf<DivisionStats>(res)).results[0]!.quizzes[0]!.name).toBe('D1 Q1')
    expect((await scoreRows())[0]!.sharedVersion).toBe(SHARED_VERSION)
  })
})

describe('the stats settings', () => {
  const read = (user: SessionUser | null, guest: GuestPayload | null = null) =>
    as(user, guest).request(`/api/meets/${meetId}/stats/settings`, {}, env)
  const save = (settings: unknown) =>
    as(testSuperuser).request(
      `/api/meets/${meetId}/stats/settings`,
      jsonRequest('PUT', { settings }),
      env,
    )
  const scoresForPrelims = {
    ...DEFAULT_STATS_SETTINGS,
    results: { ...DEFAULT_STATS_SETTINGS.results, prelim: { from: 'start', level: 'scores' } },
  }

  it('tell admins how many stored quizzes score level teams another way', async () => {
    await store(quiz('1', (file) => (file.quiz.placementFormula = PlacementFormula.Legacy)))
    expect(await jsonOf(await read(testSuperuser))).toMatchObject({ otherFormula: 1 })
  })

  it('are the defaults until an admin saves them, and any member may read them', async () => {
    const viewer = { meetId, role: MeetRole.Viewer } as GuestPayload
    const res = await read(null, viewer)
    expect(res.status).toBe(200)
    expect(await jsonOf(res)).toEqual({ settings: DEFAULT_STATS_SETTINGS })
    expect((await read(testUser)).status).toBe(403)
    expect((await read(null)).status).toBe(401)
  })

  it('keep each save with who made it and when, the newest being the settings', async () => {
    expect((await save(DEFAULT_STATS_SETTINGS)).status).toBe(200)
    const res = await save(scoresForPrelims)
    expect(res.status).toBe(200)
    expect(await jsonOf(res)).toMatchObject({
      settings: scoresForPrelims,
      changed: { by: testSuperuser.name },
    })
    expect(await db.select().from(schema.meetStatsSettings)).toHaveLength(2)
    // Who changed them is for admins
    const viewer = { meetId, role: MeetRole.Viewer } as GuestPayload
    expect(await jsonOf(await read(null, viewer))).toEqual({ settings: scoresForPrelims })
  })

  it("refuse a document that isn't one, and a stage's results shown before it is played", async () => {
    expect((await save({ ...DEFAULT_STATS_SETTINGS, tieBreaks: 'coinToss' })).status).toBe(400)
    const early = {
      ...DEFAULT_STATS_SETTINGS,
      results: { ...DEFAULT_STATS_SETTINGS.results, finals: { from: 'start', level: 'places' } },
    }
    expect((await save(early)).status).toBe(400)
    expect(await db.select().from(schema.meetStatsSettings)).toHaveLength(0)
  })

  it('are saved by admins alone, and not once the meet is done', async () => {
    const viewer = { meetId, role: MeetRole.Viewer } as GuestPayload
    const byViewer = await as(null, viewer).request(
      `/api/meets/${meetId}/stats/settings`,
      jsonRequest('PUT', { settings: DEFAULT_STATS_SETTINGS }),
      env,
    )
    expect(byViewer.status).toBe(403)
    await db.update(schema.quizMeets).set({ phase: 'done' }).where(eq(schema.quizMeets.id, meetId))
    const done = await save(DEFAULT_STATS_SETTINGS)
    expect(done.status).toBe(409)
    expect(await jsonOf(done)).toMatchObject({ meetPhase: 'done' })
  })
})

describe('what viewers, coaches and officials are given (FR-017 to FR-021, SC-005)', () => {
  const viewer = () => ({ meetId, role: MeetRole.Viewer }) as GuestPayload
  const asViewer = (path = '1') =>
    as(null, viewer()).request(`/api/meets/${meetId}/stats/${path}`, {}, env)
  const viewed = async () => jsonOf<DivisionStats>(await asViewer())
  const saveSettings = (change: (s: StatsSettings) => void) => {
    const settings = structuredClone(DEFAULT_STATS_SETTINGS)
    change(settings)
    return as(testSuperuser).request(
      `/api/meets/${meetId}/stats/settings`,
      jsonRequest('PUT', { settings }),
      env,
    )
  }
  const setState = (state: DivisionStateValue) =>
    db
      .insert(schema.divisionStates)
      .values({ meetId, division: '1', state, transitionedAt: new Date() })

  it('gives prelim results with places only by default, and no standings, warnings or ids', async () => {
    await store(quiz('1'))
    const body = await viewed()
    expect(body.results).toEqual([
      {
        stage: 'prelim',
        level: 'places',
        quizzes: [
          {
            name: 'D1 Q1',
            status: 'counted',
            teams: [
              { name: 'Team A', place: 1 },
              { name: 'Team B', place: 3 },
              { name: 'Team C', place: 2 },
            ],
          },
        ],
      },
    ])
    expect(body.prelimStandings).toBeUndefined()
    expect(body.rerank).toBeUndefined()
    expect(body.quizzers).toBeUndefined()
    expect(body.warnings).toBeUndefined()
  })

  it('gives scores where the stage is set to them, and live standings where set', async () => {
    await store(quiz('1'))
    expect(
      (
        await saveSettings((s) => {
          s.results.prelim.level = 'scores'
          s.prelimStandingsLive = true
        })
      ).status,
    ).toBe(200)
    const body = await viewed()
    expect(body.results[0]!.quizzes[0]!.teams[0]).toEqual({ name: 'Team A', place: 1, score: 200 })
    expect(body.prelimStandings).toMatchObject({ state: 'livePreview' })
    // The quizzes behind each total stay with admins
    expect(body.prelimStandings!.teams.every((team) => team.lines.length === 0)).toBe(true)
  })

  it('lists a quiz in error as under review with its teams alone, and never one not counted', async () => {
    await store(
      quiz('1', (file) => (file.answers = file.answers.filter((a) => a.columnKey !== '15'))),
    )
    await store(quiz('2'), false)
    const [prelims] = (await viewed()).results
    expect(prelims!.quizzes).toEqual([
      {
        name: 'D1 Q1',
        status: 'underReview',
        teams: [{ name: 'Team A' }, { name: 'Team B' }, { name: 'Team C' }],
      },
    ])
  })

  it('gives each thing only from its moment', async () => {
    await store(quiz('1'))
    await saveSettings((s) => (s.quizzers = { from: 'prelimsConfirmed', update: 'byStage' }))
    expect((await viewed()).quizzers).toBeUndefined()
    await setState('stats_break')
    const body = await viewed()
    // Moved on with no order recorded as confirmed, the current order is no more than a preview
    expect(body.prelimStandings).toMatchObject({ state: 'livePreview' })
    expect(body.quizzers).toMatchObject({ state: 'preview', through: 'prelim' })
    expect(body.quizzers!.lists[0]!.quizzers[0]!.flags).toEqual([])
  })

  it('gives an official what is wrong with the quizzes of their own rooms, and not of others', async () => {
    const rooms = await db
      .insert(schema.meetRooms)
      .values([
        { meetId, name: 'Room 1' },
        { meetId, name: 'Room 2' },
      ])
      .returning()
    const unanswered = (n: string) =>
      quiz(n, (file) => (file.answers = file.answers.filter((a) => a.columnKey !== '15')))
    const ours = await store(unanswered('1'))
    const theirs = await store(unanswered('2'))
    for (const [id, room] of [
      [ours, rooms[0]!.id],
      [theirs, rooms[1]!.id],
    ]) {
      await db
        .update(schema.quizResultRevisions)
        .set({ savedByRoomId: room })
        .where(eq(schema.quizResultRevisions.resultId, id!))
    }
    const official = { meetId, role: MeetRole.Official, roomId: rooms[0]!.id } as GuestPayload
    const body = await jsonOf<DivisionStats>(
      await as(null, official).request(`/api/meets/${meetId}/stats/1`, {}, env),
    )
    const [first, second] = body.results[0]!.quizzes
    // The fixture records no question types, so its types are incomplete
    expect(first).toMatchObject({
      id: ours,
      problems: [{ kind: 'unanswered' }],
      incompleteTypes: true,
    })
    expect(second!.id).toBeUndefined()
    expect(second!.problems).toBeUndefined()
    expect(second!.incompleteTypes).toBeUndefined()
    expect(body.warnings).toBeUndefined()
  })

  it('gives an admin the page as a viewer sees it, when asked', async () => {
    await store(quiz('1'))
    const res = await as(testSuperuser).request(`/api/meets/${meetId}/stats/1?as=viewer`, {}, env)
    const body = await jsonOf<DivisionStats>(res)
    expect(body.results[0]!.level).toBe('places')
    expect(body.warnings).toBeUndefined()
  })

  it('gives a signed-in member what a viewer gets', async () => {
    await db.insert(schema.viewerMemberships).values({ accountId: testUser.id, meetId })
    await store(quiz('1'))
    const body = await jsonOf<DivisionStats>(await division('1', testUser))
    expect(body.results[0]!.level).toBe('places')
    expect(body.warnings).toBeUndefined()
  })

  it('gives anyone but an admin nothing while the meet is in registration or build', async () => {
    await store(quiz('1'))
    await saveSettings((s) => (s.prelimStandingsLive = true))
    for (const phase of ['registration', 'build'] as const) {
      await db.update(schema.quizMeets).set({ phase }).where(eq(schema.quizMeets.id, meetId))
      const body = await viewed()
      expect(body.results).toEqual([])
      expect(body.prelimStandings).toBeUndefined()
      const list = await as(null, viewer()).request(`/api/meets/${meetId}/stats`, {}, env)
      expect(await jsonOf(list)).toEqual({ phase, admin: false, divisions: [] })
      // An admin still sees everything
      expect((await jsonOf<DivisionStats>(await division('1'))).results).toHaveLength(1)
    }
  })

  it("lists the meet's divisions for a member", async () => {
    const res = await as(null, viewer()).request(`/api/meets/${meetId}/stats`, {}, env)
    expect(res.status).toBe(200)
    expect(await jsonOf(res)).toMatchObject({ divisions: [{ division: '1' }, { division: '2' }] })
  })
})

describe("quizzes scored another way than the meet's (FR-023a, FR-023b)", () => {
  const legacy = (n: string) =>
    quiz(n, (file) => (file.quiz.placementFormula = PlacementFormula.Legacy))
  const listed = async () =>
    jsonOf<{ id: number; revision: number; otherFormula?: true; accepted: boolean }[]>(
      await as(testSuperuser).request(`/api/meets/${meetId}/results`, {}, env),
    )
  const setToMeet = () =>
    as(testSuperuser).request(`/api/meets/${meetId}/results/formula`, { method: 'POST' }, env)

  it('carry a note, and still count', async () => {
    await store(legacy('1'))
    await store(quiz('2'))
    expect((await listed()).map((q) => q.otherFormula)).toEqual([true, undefined])
    expect((await jsonOf<DivisionStats>(await division('1'))).results[0]!.quizzes).toHaveLength(2)
  })

  it("are set to the meet's way in one action, each by a new edited revision", async () => {
    const id = await store(legacy('1'))
    await store(quiz('2'))
    const res = await setToMeet()
    expect(res.status).toBe(200)
    expect(await jsonOf(res)).toEqual({ changed: 1, remaining: 0 })
    const after = await listed()
    expect(after.find((q) => q.id === id)).toMatchObject({ revision: 2 })
    expect(after.every((q) => q.otherFormula === undefined)).toBe(true)
    expect(await jsonOf(await setToMeet())).toEqual({ changed: 0, remaining: 0 })
  })

  it('keep an acceptance across the new revision', async () => {
    const id = await store(
      quiz('1', (file) => {
        file.quiz.placementFormula = PlacementFormula.Legacy
        file.answers = file.answers.filter((a) => a.columnKey !== '15')
      }),
    )
    const accepted = await as(testSuperuser).request(
      `/api/meets/${meetId}/results/${id}/acceptance`,
      jsonRequest('PUT', { revision: 1, accepted: true }),
      env,
    )
    expect(accepted.status).toBe(200)
    await setToMeet()
    expect((await listed())[0]).toMatchObject({ revision: 2, accepted: true })
  })

  it('take a file that names no way of its own as scoring by the rulebook', async () => {
    const settings = { ...DEFAULT_STATS_SETTINGS, levelTeams: PlacementFormula.Legacy }
    await as(testSuperuser).request(
      `/api/meets/${meetId}/stats/settings`,
      jsonRequest('PUT', { settings }),
      env,
    )
    const id = await store(quiz('1'))
    // As an older file might be stored, with no way of its own
    const [revision] = await db.select().from(schema.quizResultRevisions)
    const file = JSON.parse(revision!.quizFile!) as { quiz: Record<string, unknown> }
    delete file.quiz.placementFormula
    await db
      .update(schema.quizResultRevisions)
      .set({ quizFile: JSON.stringify(file) })
      .where(eq(schema.quizResultRevisions.resultId, id))
    expect((await listed())[0]!.otherFormula).toBe(true)
    expect(await jsonOf(await setToMeet())).toEqual({ changed: 1, remaining: 0 })
  })

  it('change no stored quiz when the setting is switched', async () => {
    await store(legacy('1'))
    const before = await scoreRows()
    const settings = { ...DEFAULT_STATS_SETTINGS, levelTeams: PlacementFormula.Legacy }
    await as(testSuperuser).request(
      `/api/meets/${meetId}/stats/settings`,
      jsonRequest('PUT', { settings }),
      env,
    )
    expect(await scoreRows()).toEqual(before)
    expect((await listed())[0]!.otherFormula).toBeUndefined()
  })
})
