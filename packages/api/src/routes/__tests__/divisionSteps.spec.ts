import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import {
  DEFAULT_STATS_SETTINGS,
  PlacementFormula,
  newScheduleDocument,
  type DivisionStats,
  type QuizFile,
  type ScheduleQuiz,
} from '@qzr/shared'
import { eq } from 'drizzle-orm'
import { fifteenQuestionQuizFile } from '../../../../shared/src/scoring/__tests__/fixtures/fifteenQuestionQuiz'
import type { Bindings } from '../../bindings'
import type { SessionVariables } from '../../middleware/session'
import { phase } from '../phase'
import { results } from '../results'
import { stats } from '../stats'
import * as schema from '../../db/schema'
import { mockSession, mockDb, testSuperuser, jsonOf, jsonRequest, seedMeet } from '../../test-utils'
import { createTestDb } from '../../test-db'
import type { Db } from '../../lib/db'

// A division's steps through the day, and the orders each one confirms
// (specs/006-meet-stats, User Story 4: FR-019a to FR-019d)

const env = {
  ENVIRONMENT: 'test',
  BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
} as unknown as Bindings

let db: Db
let meetId: number

function admin() {
  const app = new Hono<{ Bindings: Bindings; Variables: SessionVariables & { db: Db } }>()
  app.use('*', mockSession(testSuperuser))
  app.use('*', mockDb(db))
  app.route('/api/meets', results)
  app.route('/api/meets', stats)
  app.route('/api/meets', phase)
  return app
}

const scheduled = (id: string, label: string, phase: 'prelim' | 'elim'): ScheduleQuiz => ({
  id,
  label,
  division: '1',
  phase,
  ...(phase === 'elim' ? { lane: 0 } : {}),
  cell: null,
  // Seated by letters the meet hasn't drawn, so any three teams play it
  seats: ['a', 'b', 'c'].map((letter) => ({ kind: 'letter' as const, letter })),
  pinned: false,
})

beforeEach(async () => {
  db = await createTestDb()
  meetId = (await seedMeet(db, 'Steps Meet', { phase: 'live' })).id
  await db
    .update(schema.quizMeets)
    .set({ divisions: JSON.stringify(['1']) })
    .where(eq(schema.quizMeets.id, meetId))
  const document = newScheduleDocument('Steps Meet')
  document.quizzes = [
    scheduled('p1', 'Div 1 Quiz 1', 'prelim'),
    scheduled('p2', 'Div 1 Quiz 2', 'prelim'),
    scheduled('eA', 'Div 1 Quiz A', 'elim'),
  ]
  await db.insert(schema.meetScheduleVersions).values({
    meetId,
    version: 1,
    document: JSON.stringify(document),
    publishedAt: new Date(),
    publishedByName: 'Test Admin',
  })
})

/** Add an intermediate to the schedule, on its first line */
async function publishIntermediate() {
  const document = newScheduleDocument('Steps Meet')
  document.quizzes = [
    scheduled('p1', 'Div 1 Quiz 1', 'prelim'),
    scheduled('p2', 'Div 1 Quiz 2', 'prelim'),
    { ...scheduled('iX', 'Div 1 Quiz X', 'elim'), line: 0 },
    scheduled('eA', 'Div 1 Quiz A', 'elim'),
  ]
  await db.insert(schema.meetScheduleVersions).values({
    meetId,
    version: 2,
    document: JSON.stringify(document),
    publishedAt: new Date(),
    publishedByName: 'Test Admin',
  })
}

/** Store a quiz of division 1, which links itself to the scheduled quiz of its name */
async function store(quizNumber: string, change: (file: QuizFile) => void = () => {}) {
  const quizFile = fifteenQuestionQuizFile()
  quizFile.quiz.quizNumber = quizNumber
  change(quizFile)
  const res = await admin().request(
    `/api/meets/${meetId}/results`,
    jsonRequest('POST', { quizFile }),
    env,
  )
  expect(res.status).toBe(201)
  return (await jsonOf<{ id: number }>(res)).id
}

const move = (state: string, confirm?: boolean) =>
  admin().request(
    `/api/meets/${meetId}/divisions/1/state`,
    jsonRequest('POST', { state, ...(confirm ? { confirm } : {}) }),
    env,
  )

async function moved(...states: string[]) {
  for (const state of states) expect((await move(state, true)).status).toBe(200)
}

interface StateRow {
  division: string
  state: string
  ready: boolean
  missing: { name: string }[]
  confirmed: { prelims?: { by: string }; rerank?: { by: string } }
}
const states = async () =>
  (
    await jsonOf<{ divisionStates: StateRow[] }>(
      await admin().request(`/api/meets/${meetId}/divisions/state`, {}, env),
    )
  ).divisionStates
const divisionStats = async () =>
  jsonOf<DivisionStats>(await admin().request(`/api/meets/${meetId}/stats/1`, {}, env))
const confirmations = () => db.select().from(schema.divisionConfirmations)

describe('the Finals step', () => {
  it('comes between the eliminations and done, one step at a time', async () => {
    await moved('stats_break', 'elim_running')
    expect((await move('division_done')).status).toBe(400)
    expect((await move('finals', true)).status).toBe(200)
    expect((await move('division_done', true)).status).toBe(200)
  })
})

describe("a division's readiness", () => {
  it('waits for every scheduled quiz of the stage it ends, stored and counting', async () => {
    await store('1')
    expect(await states()).toEqual([
      expect.objectContaining({
        division: '1',
        state: 'prelim_running',
        ready: false,
        missing: [{ name: 'D1 Q2' }],
        confirmed: {},
        stages: ['prelim', 'elimination'],
      }),
    ])
    // Stored and not counting is missing too
    await store('2', (file) => {
      file.answers = file.answers.filter((answer) => answer.columnKey !== '15')
    })
    expect((await states())[0]!.missing).toEqual([{ name: 'D1 Q2' }])
  })

  it('is ready once they all count', async () => {
    await store('1')
    await store('2')
    expect((await states())[0]).toMatchObject({ ready: true, missing: [] })
  })
})

describe('reading every division at once', () => {
  it('scores a few revisions for the whole request, not a few for each division', async () => {
    await db
      .update(schema.quizMeets)
      .set({ divisions: JSON.stringify(['1', '2']) })
      .where(eq(schema.quizMeets.id, meetId))
    for (const n of ['1', '2', '3', '4']) {
      await store(n)
      await store(n, (file) => (file.quiz.division = '2'))
    }
    // As if these quizzes were stored before scores were kept
    await db.delete(schema.quizResultScores)
    const res = await admin().request(`/api/meets/${meetId}/divisions/state`, {}, env)
    expect(res.status).toBe(503)
    expect(await db.select().from(schema.quizResultScores)).toHaveLength(5)
  })
})

describe('moving a division on', () => {
  it('warns of scheduled quizzes missing, and moves on once told to', async () => {
    await store('1')
    const warned = await move('stats_break')
    expect(warned.status).toBe(409)
    expect(await jsonOf(warned)).toMatchObject({ missing: [{ name: 'D1 Q2' }] })
    expect((await states())[0]!.state).toBe('prelim_running')

    const res = await move('stats_break', true)
    expect(res.status).toBe(200)
    expect(await jsonOf(res)).toMatchObject({
      state: 'stats_break',
      confirmed: { what: 'prelims', by: testSuperuser.name },
    })
  })

  it('records the prelim order as confirmed, which stands when a prelim changes later', async () => {
    await store('1')
    const second = await store('2')
    await moved('stats_break')
    const [row] = await confirmations()
    expect(row).toMatchObject({ division: '1', what: 'prelims', confirmed: true })
    const confirmed = await divisionStats()
    expect(confirmed.prelimStandings).toMatchObject({
      state: 'lockedIn',
      confirmed: { by: testSuperuser.name },
    })
    expect(confirmed.prelimStandings!.current).toBeUndefined()

    // Team B wins quiz 2 on correction; the confirmed order stays, the current one beside it
    const res = await admin().request(
      `/api/meets/${meetId}/results/${second}`,
      jsonRequest('PUT', {
        quizFile: (() => {
          const file = fifteenQuestionQuizFile()
          file.quiz.quizNumber = '2'
          ;[file.teams[0]!.name, file.teams[1]!.name] = ['Team B', 'Team A']
          return file
        })(),
        baseRevision: 1,
      }),
      env,
    )
    expect(res.status).toBe(200)
    const after = await divisionStats()
    expect(after.prelimStandings!.teams).toEqual(confirmed.prelimStandings!.teams)
    expect(after.prelimStandings!.current).toBeDefined()
    expect(after.warnings).toContainEqual({ kind: 'orderChanged', division: '1', what: 'prelims' })
  })

  it('keeps a confirmed order as it was when a setting changes later (FR-022)', async () => {
    await store('1')
    await store('2')
    await moved('stats_break')
    const confirmed = (await divisionStats()).prelimStandings!
    const settings = {
      ...DEFAULT_STATS_SETTINGS,
      tieBreaks: 'pointsThenErrors',
      levelTeams: PlacementFormula.Legacy,
    }
    const saved = await admin().request(
      `/api/meets/${meetId}/stats/settings`,
      jsonRequest('PUT', { settings }),
      env,
    )
    expect(saved.status).toBe(200)
    expect((await divisionStats()).prelimStandings!.teams).toEqual(confirmed.teams)
  })

  it('records the re-rank where the division has intermediates', async () => {
    await publishIntermediate()
    await store('1')
    await store('2')
    await store('X')
    await moved('stats_break', 'elim_running')
    expect((await confirmations()).map((row) => [row.what, row.confirmed])).toEqual([
      ['prelims', true],
      ['rerank', true],
    ])
    expect((await states())[0]!.confirmed).toEqual({
      prelims: expect.objectContaining({ by: testSuperuser.name }),
      rerank: expect.objectContaining({ by: testSuperuser.name }),
    })
  })
})

describe('moving a division back', () => {
  it('withdraws the confirmed order freely while no later quiz is stored', async () => {
    await store('1')
    await store('2')
    await moved('stats_break')
    const res = await move('prelim_running')
    expect(res.status).toBe(200)
    expect((await confirmations()).map((row) => row.confirmed)).toEqual([true, false])
    expect((await divisionStats()).prelimStandings!.state).toBe('livePreview')
  })

  it('names the quizzes seated from the order, and flags them until each is kept', async () => {
    await store('1')
    await store('2')
    await moved('stats_break')
    const elimination = await store('A')
    const warned = await move('prelim_running')
    expect(warned.status).toBe(409)
    expect(await jsonOf(warned)).toMatchObject({ affected: [{ id: elimination, name: 'D1 QA' }] })

    await moved('prelim_running')
    const flagged = await divisionStats()
    expect(flagged.warnings).toContainEqual({
      kind: 'withdrawnOrder',
      quiz: { id: elimination, name: 'D1 QA' },
    })
    // It is still stored, with its stage
    const elims = flagged.results.find((stage) => stage.stage === 'elimination')!
    expect(elims.quizzes[0]).toMatchObject({ id: elimination, withdrawnOrder: true })

    const listed = await jsonOf<{ id: number; withdrawnOrder?: true }[]>(
      await admin().request(`/api/meets/${meetId}/results`, {}, env),
    )
    expect(listed.find((quiz) => quiz.id === elimination)?.withdrawnOrder).toBe(true)

    const kept = await admin().request(
      `/api/meets/${meetId}/results/${elimination}/keep`,
      { method: 'POST' },
      env,
    )
    expect(kept.status).toBe(200)
    expect(
      (await divisionStats()).warnings!.filter((warning) => warning.kind === 'withdrawnOrder'),
    ).toEqual([])
  })

  it('clears the flag when the quiz is set to not count', async () => {
    await store('1')
    await store('2')
    await moved('stats_break')
    const elimination = await store('A')
    await moved('prelim_running')
    await admin().request(
      `/api/meets/${meetId}/results/stage`,
      jsonRequest('PATCH', { ids: [elimination], stage: 'notCounted' }),
      env,
    )
    expect(
      (await divisionStats()).warnings!.filter((warning) => warning.kind === 'withdrawnOrder'),
    ).toEqual([])
  })
})

describe('confirming prelims with none counted', () => {
  it('moves the division on and confirms no order, since there is none', async () => {
    const res = await move('stats_break', true)
    expect(res.status).toBe(200)
    expect(await jsonOf(res)).not.toHaveProperty('confirmed')
    expect(await confirmations()).toEqual([])
  })
})
