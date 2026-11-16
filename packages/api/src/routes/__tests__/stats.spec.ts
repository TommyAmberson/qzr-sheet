import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import { MeetRole, type DivisionStats, type QuizFile } from '@qzr/shared'
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

  it('refuses an account with no access to the meet, a guest viewer for now, and a caller with none', async () => {
    expect((await division('1', testUser)).status).toBe(403)
    const viewer = { meetId, role: MeetRole.Viewer } as GuestPayload
    expect((await as(null, viewer).request(`/api/meets/${meetId}/stats/1`, {}, env)).status).toBe(
      403,
    )
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
