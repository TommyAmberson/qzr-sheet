import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import {
  MeetRole,
  newScheduleDocument,
  type DivisionStats,
  type QuizFile,
  type ScheduleQuiz,
} from '@qzr/shared'
import { eq } from 'drizzle-orm'
import { fifteenQuestionQuizFile } from '../../../../shared/src/scoring/__tests__/fixtures/fifteenQuestionQuiz'
import type { Bindings } from '../../bindings'
import type { SessionUser, SessionVariables } from '../../middleware/session'
import { codeTagFor, type GuestPayload } from '../../lib/jwt'
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

// Stages, links to the schedule, roster and schedule errors, and accepting a quiz as scored
// (specs/006-meet-stats, User Stories 2 and 3)

const SECRET = 'test-secret-at-least-32-characters-long'
const env = { ENVIRONMENT: 'test', BETTER_AUTH_SECRET: SECRET } as unknown as Bindings

let db: Db
let meetId: number
let room1: number
let room2: number
let officialOf: (roomId: number) => GuestPayload
let teamIds: number[]

function as(user: SessionUser | null, guest: GuestPayload | null = null) {
  const app = new Hono<{ Bindings: Bindings; Variables: SessionVariables & { db: Db } }>()
  app.use('*', mockSession(user, guest))
  app.use('*', mockDb(db))
  app.route('/api/meets', results)
  app.route('/api/meets', stats)
  return app
}
const admin = () => as(testSuperuser)

const TEAMS = ['First Church 1', 'Grace 1', 'Hope 1']

/** A scheduled prelim of division 1 seating the meet's three teams, and an elimination quiz */
const PRELIM: ScheduleQuiz = {
  id: 'p3',
  label: 'Div 1 Quiz 3',
  division: '1',
  phase: 'prelim',
  cell: null,
  seats: ['a', 'b', 'c'].map((letter) => ({ kind: 'letter' as const, letter })),
  pinned: false,
}
const ELIM: ScheduleQuiz = {
  id: 'eA',
  label: 'Div 1 Quiz A',
  division: '1',
  phase: 'elim',
  lane: 0,
  cell: null,
  seats: [1, 2, 3].map((rank) => ({ kind: 'rank' as const, rank })),
  pinned: false,
}

beforeEach(async () => {
  db = await createTestDb()
  meetId = (await seedMeet(db, 'Decisions Meet', { phase: 'live' })).id
  await db
    .update(schema.quizMeets)
    .set({ divisions: JSON.stringify(['1']) })
    .where(eq(schema.quizMeets.id, meetId))
  const rooms = await db
    .insert(schema.meetRooms)
    .values([
      { meetId, name: 'Room 1', codeHash: 'hash-1' },
      { meetId, name: 'Room 2', codeHash: 'hash-2' },
    ])
    .returning()
  room1 = rooms[0]!.id
  room2 = rooms[1]!.id
  const tags = new Map<number, string>()
  for (const room of rooms) tags.set(room.id, await codeTagFor('room', room.codeHash!, SECRET))
  officialOf = (roomId) => ({
    meetId,
    role: MeetRole.Official,
    label: 'Room',
    roomId,
    codeTag: tags.get(roomId),
  })

  // The meet's roster: three churches with a team each in division 1
  teamIds = []
  for (const [name, shortName] of [
    ['First Church', 'FC'],
    ['Grace', 'Grace'],
    ['Hope', 'Hope'],
  ] as const) {
    const [church] = await db
      .insert(schema.churches)
      .values({ meetId, name, shortName, coachCodeHash: 'x' })
      .returning()
    const [team] = await db
      .insert(schema.teams)
      .values({ meetId, churchId: church!.id, division: '1', number: 1 })
      .returning()
    teamIds.push(team!.id)
  }
  const document = newScheduleDocument('Decisions Meet')
  document.quizzes = [PRELIM, ELIM]
  document.draw = {
    '1': {
      stale: false,
      teams: teamIds.map((teamId, i) => ({
        teamId,
        late: false,
        absent: false,
        letter: 'abc'[i]!,
      })),
    },
  }
  await db.insert(schema.meetScheduleVersions).values({
    meetId,
    version: 1,
    document: JSON.stringify(document),
    publishedAt: new Date(),
    publishedByName: 'Test Admin',
  })
})

/** A complete, valid quiz of division 1 between the meet's three teams, in any seats */
function quiz(quizNumber: string, change: (file: QuizFile) => void = () => {}): QuizFile {
  const file = fifteenQuestionQuizFile()
  file.quiz.quizNumber = quizNumber
  file.teams.forEach((team, i) => (team.name = TEAMS[i]!))
  change(file)
  return file
}
/** A quiz nobody jumped in: every team has its on-time 20, so they end level */
function level(quizNumber: string, overtime = false): QuizFile {
  return quiz(quizNumber, (file) => {
    file.answers = []
    file.noJumps = Array.from({ length: 15 }, (_, i) => String(i + 1))
    file.quiz.overtime = overtime
  })
}

interface Listed {
  id: number
  revision: number
  stage: string | null
  stageFrom: string | null
  link: { scheduleQuizId: string; how: string } | null
  suggestedLink?: { scheduleQuizId: string; label: string }
  problems: { kind: string; [more: string]: unknown }[] | null
  accepted: boolean
}

async function submit(body: Record<string, unknown>, app = as(null, officialOf(room1))) {
  return app.request(`/api/meets/${meetId}/results`, jsonRequest('POST', body), env)
}
async function stored(body: Record<string, unknown>, app = as(null, officialOf(room1))) {
  const res = await submit(body, app)
  expect(res.status).toBe(201)
  return jsonOf<{ id: number; link: Listed['link'] }>(res)
}
async function listed(id: number): Promise<Listed> {
  const res = await admin().request(`/api/meets/${meetId}/results`, {}, env)
  return (await jsonOf<Listed[]>(res)).find((quiz) => quiz.id === id)!
}
async function division(): Promise<DivisionStats> {
  const res = await admin().request(`/api/meets/${meetId}/stats/1`, {}, env)
  expect(res.status).toBe(200)
  return jsonOf<DivisionStats>(res)
}
const put = (path: string, body: unknown, app = admin()) =>
  app.request(`/api/meets/${meetId}/results/${path}`, jsonRequest('PUT', body), env)
const setStage = (ids: number[], stage: string | null) =>
  admin().request(`/api/meets/${meetId}/results/stage`, jsonRequest('PATCH', { ids, stage }), env)

describe('a submission and the schedule', () => {
  it('arrives linked when the sheet names its scheduled quiz, and counts with nothing more done', async () => {
    const { id, link } = await stored({ quizFile: quiz('3'), scheduleQuizId: 'p3' })
    expect(link).toEqual({ scheduleQuizId: 'p3', how: 'sheet' })
    expect(await listed(id)).toMatchObject({
      stage: 'prelim',
      stageFrom: 'schedule',
      link: { scheduleQuizId: 'p3', how: 'sheet' },
      problems: [],
    })
    const stats = await division()
    expect(stats.results[0]!.quizzes[0]).toMatchObject({ name: 'D1 Q3', status: 'counted' })
    expect(stats.prelimStandings!.teams.map((t) => t.name)).toEqual([
      'First Church 1',
      'Hope 1',
      'Grace 1',
    ])
  })

  it('refuses a scheduled quiz the published schedule does not have', async () => {
    const res = await submit({ quizFile: quiz('3'), scheduleQuizId: 'nope' })
    expect(res.status).toBe(400)
    expect(await db.select().from(schema.quizResults)).toEqual([])
  })

  it('links itself when its name and its teams match, whatever seats and spelling they are in', async () => {
    const file = quiz('3', (f) => {
      f.teams[0]!.name = 'fc 1'
      f.teams[1]!.name = 'grace  1'
    })
    const { link } = await stored({ quizFile: file })
    expect(link).toEqual({ scheduleQuizId: 'p3', how: 'matched' })
  })

  it('links a quiz to a scheduled quiz that names no teams yet by its name alone', async () => {
    const { id, link } = await stored({ quizFile: quiz('A') })
    expect(link).toEqual({ scheduleQuizId: 'eA', how: 'matched' })
    expect(await listed(id)).toMatchObject({ stage: 'elimination', stageFrom: 'schedule' })
  })

  it('stays unlinked, and not counted, when its teams are not the scheduled ones', async () => {
    const { id, link } = await stored({
      quizFile: quiz('3', (f) => (f.teams[2]!.name = 'Faith 1')),
    })
    expect(link).toBeNull()
    expect(await listed(id)).toMatchObject({ stage: null, link: null })
    expect((await division()).results).toEqual([])
  })

  it('offers the scheduled quiz it misses by a slightly different team name, and does not take it', async () => {
    const { id, link } = await stored({
      quizFile: quiz('3', (f) => (f.teams[0]!.name = 'First Churchh 1')),
    })
    expect(link).toBeNull()
    expect((await listed(id)).suggestedLink).toEqual({ scheduleQuizId: 'p3', label: 'D1 Q3' })
  })

  it('runs the match again when a revision changes a team name', async () => {
    const { id } = await stored({ quizFile: quiz('3', (f) => (f.teams[2]!.name = 'Faith 1')) })
    const edited = await put(String(id), { quizFile: quiz('3') })
    expect(edited.status).toBe(200)
    expect((await listed(id)).link).toEqual({ scheduleQuizId: 'p3', how: 'matched' })
  })

  it('keeps a submission for a scheduled quiz another stored quiz holds, unlinked', async () => {
    await stored({ quizFile: quiz('3'), scheduleQuizId: 'p3' })
    const { id, link } = await stored({ quizFile: quiz('9'), scheduleQuizId: 'p3' })
    expect(link).toBeNull()
    expect((await listed(id)).link).toBeNull()
  })
})

describe('PUT /api/meets/:id/results/:resultId/link', () => {
  it("links, relinks and unlinks by hand, for an admin and for an official of the quiz's room", async () => {
    const { id } = await stored({ quizFile: quiz('9') })
    const linked = await put(`${id}/link`, { scheduleQuizId: 'p3' }, as(null, officialOf(room1)))
    expect(linked.status).toBe(200)
    expect(await jsonOf(linked)).toEqual({ link: { scheduleQuizId: 'p3', how: 'hand' } })
    expect((await put(`${id}/link`, { scheduleQuizId: 'eA' })).status).toBe(200)
    expect(await listed(id)).toMatchObject({
      link: { scheduleQuizId: 'eA', how: 'hand' },
      stage: 'elimination',
    })
    expect((await put(`${id}/link`, { scheduleQuizId: null })).status).toBe(200)
    expect(await listed(id)).toMatchObject({ link: null, stage: null })
  })

  it("is not for another room's official, nor for an account with no access", async () => {
    const { id } = await stored({ quizFile: quiz('9') })
    const body = { scheduleQuizId: 'p3' }
    expect((await put(`${id}/link`, body, as(null, officialOf(room2)))).status).toBe(403)
    expect((await put(`${id}/link`, body, as(testUser))).status).toBe(403)
  })

  it('refuses a scheduled quiz another stored quiz holds, naming that quiz', async () => {
    const holder = await stored({ quizFile: quiz('3'), scheduleQuizId: 'p3' })
    const { id } = await stored({ quizFile: quiz('9') })
    const res = await put(`${id}/link`, { scheduleQuizId: 'p3' })
    expect(res.status).toBe(409)
    expect(await jsonOf(res)).toEqual({
      error: 'D1 Q3 is already linked to D1 Q3',
      existing: { id: holder.id },
    })
  })

  it('refuses a scheduled quiz the published schedule does not have, and a malformed body', async () => {
    const { id } = await stored({ quizFile: quiz('9') })
    expect((await put(`${id}/link`, { scheduleQuizId: 'nope' })).status).toBe(400)
    expect((await put(`${id}/link`, {})).status).toBe(400)
  })
})

describe("a stored quiz's problems", () => {
  it('puts a linked quiz whose name differs from its scheduled quiz in error, so it does not count', async () => {
    const { id } = await stored({ quizFile: quiz('9') })
    await put(`${id}/link`, { scheduleQuizId: 'p3' })
    expect((await listed(id)).problems).toEqual([{ kind: 'nameDiffers', scheduled: 'D1 Q3' }])
    const stats = await division()
    expect(stats.results[0]!.quizzes[0]).toMatchObject({ status: 'underReview' })
    expect(stats.prelimStandings!.teams).toEqual([])
  })

  it('puts a linked quiz whose teams differ from the scheduled ones in error', async () => {
    const { id } = await stored({
      quizFile: quiz('3', (f) => (f.teams[2]!.name = 'Grace 1')),
      scheduleQuizId: 'p3',
    })
    expect((await listed(id)).problems).toContainEqual({
      kind: 'teamsDiffer',
      scheduled: ['First Church 1', 'Grace 1', 'Hope 1'],
    })
  })

  it('names a roster error, and clears it when the roster is corrected, with no new revision', async () => {
    await db.insert(schema.quizzerIdentities).values([{}, {}, {}, {}, {}])
    const identities = await db.select().from(schema.quizzerIdentities)
    // First Church's roster has its five quizzers, the last under another name than the sheet's
    await db.insert(schema.teamRosters).values(
      ['A0', 'A1', 'A2', 'A3', 'Avery Four'].map((name, i) => ({
        teamId: teamIds[0]!,
        quizzerId: identities[i]!.id,
        name,
      })),
    )
    const { id } = await stored({ quizFile: quiz('3'), scheduleQuizId: 'p3' })
    expect((await listed(id)).problems).toEqual([
      { kind: 'quizzerNotOnRoster', team: 'First Church 1', quizzer: 'A4' },
      { kind: 'quizzerMissing', team: 'First Church 1', quizzer: 'Avery Four' },
    ])
    expect((await division()).prelimStandings!.teams).toEqual([])

    await db
      .update(schema.teamRosters)
      .set({ name: 'A4' })
      .where(eq(schema.teamRosters.name, 'Avery Four'))
    expect(await listed(id)).toMatchObject({ problems: [], revision: 1 })
    expect((await division()).prelimStandings!.teams).toHaveLength(3)
  })

  it('lists every scoring error with its team, quizzer, question and code', async () => {
    const { id } = await stored({
      quizFile: quiz('3', (f) => (f.teams[0]!.quizzers[3]!.name = '')),
      scheduleQuizId: 'p3',
    })
    expect((await listed(id)).problems).toEqual([
      {
        kind: 'validation',
        team: 'First Church 1',
        quizzer: '',
        question: '12A',
        code: 'empty-seat',
      },
    ])
  })

  it('lets a prelim end level, and not an elimination or a Finals', async () => {
    const { id } = await stored({ quizFile: level('3'), scheduleQuizId: 'p3' })
    expect((await listed(id)).problems).toEqual([])
    await setStage([id], 'elimination')
    expect((await listed(id)).problems).toEqual([{ kind: 'tieLeftStanding' }])
    await setStage([id], 'finals')
    expect((await listed(id)).problems).toEqual([{ kind: 'tieLeftStanding' }])
    expect((await division()).results[0]).toMatchObject({
      stage: 'finals',
      medals: [],
      quizzes: [{ status: 'underReview' }],
    })
  })

  it('calls a quiz still level in an overtime not played out undecided', async () => {
    const { id } = await stored({ quizFile: level('A', true) })
    expect((await listed(id)).problems).toEqual([{ kind: 'undecided' }])
  })
})

describe('PUT /api/meets/:id/results/:resultId/acceptance', () => {
  /** A linked prelim with one scoring error */
  const broken = () => quiz('3', (f) => (f.teams[0]!.quizzers[3]!.name = ''))
  const accept = (id: number, revision: number, accepted = true, app = admin()) =>
    put(`${id}/acceptance`, { revision, accepted }, app)

  it('counts a quiz in error once an admin accepts it as scored, and marks it', async () => {
    const { id } = await stored({ quizFile: broken(), scheduleQuizId: 'p3' })
    expect((await division()).prelimStandings!.teams).toEqual([])

    const res = await accept(id, 1)
    expect(res.status).toBe(200)
    expect(await jsonOf(res)).toEqual({ revision: 1, accepted: true })
    expect(await listed(id)).toMatchObject({ accepted: true, problems: [{ kind: 'validation' }] })
    const stats = await division()
    expect(stats.results[0]!.quizzes[0]).toMatchObject({ status: 'accepted' })
    expect(stats.prelimStandings!.teams.map((t) => [t.name, t.placementPoints])).toEqual([
      ['First Church 1', 20],
      ['Hope 1', 9],
      ['Grace 1', 1],
    ])
    expect(stats.warnings).toEqual([])
  })

  it('drops it out again when the acceptance is withdrawn', async () => {
    const { id } = await stored({ quizFile: broken(), scheduleQuizId: 'p3' })
    await accept(id, 1)
    expect((await accept(id, 1, false)).status).toBe(200)
    expect((await listed(id)).accepted).toBe(false)
    expect((await division()).prelimStandings!.teams).toEqual([])
  })

  it('is of the revision accepted: a later one in error needs its own, and restoring brings it back', async () => {
    const { id } = await stored({ quizFile: broken(), scheduleQuizId: 'p3' })
    await accept(id, 1)
    // Another revision, still in error: the same unnamed seat, and a quizzer renamed
    await put(String(id), {
      quizFile: quiz('3', (f) => {
        f.teams[0]!.quizzers[3]!.name = ''
        f.teams[1]!.quizzers[0]!.name = 'Bea'
      }),
    })
    expect(await listed(id)).toMatchObject({ revision: 2, accepted: false })
    expect((await division()).prelimStandings!.teams).toEqual([])
    // An admin accepts only the quiz as it is now
    const stale = await accept(id, 1)
    expect(stale.status).toBe(409)
    expect(await jsonOf(stale)).toMatchObject({ revision: 2 })

    const restored = await admin().request(
      `/api/meets/${meetId}/results/${id}/restore`,
      jsonRequest('POST', { revision: 1 }),
      env,
    )
    expect(restored.status).toBe(200)
    expect(await listed(id)).toMatchObject({ revision: 3, accepted: true })
  })

  it('needs no acceptance once a later revision has no errors', async () => {
    const { id } = await stored({ quizFile: broken(), scheduleQuizId: 'p3' })
    await put(String(id), { quizFile: quiz('3') })
    expect(await listed(id)).toMatchObject({ problems: [], accepted: false })
    expect((await division()).results[0]!.quizzes[0]).toMatchObject({ status: 'counted' })
  })

  it('stays accepted when a later change to the roster gives its revision a new error', async () => {
    const { id } = await stored({ quizFile: broken(), scheduleQuizId: 'p3' })
    await accept(id, 1)
    await db.insert(schema.quizzerIdentities).values({})
    const [identity] = await db.select().from(schema.quizzerIdentities)
    await db
      .insert(schema.teamRosters)
      .values({ teamId: teamIds[1]!, quizzerId: identity!.id, name: 'Somebody Else' })
    expect((await listed(id)).problems!.map((p) => p.kind)).toContain('quizzerNotOnRoster')
    expect((await division()).results[0]!.quizzes[0]).toMatchObject({ status: 'accepted' })
  })

  it('is for admins only, and for a revision the quiz has', async () => {
    const { id } = await stored({ quizFile: broken(), scheduleQuizId: 'p3' })
    expect((await accept(id, 1, true, as(null, officialOf(room1)))).status).toBe(403)
    expect((await accept(id, 1, true, as(testUser))).status).toBe(403)
    expect((await accept(id, 7)).status).toBe(404)
    expect((await put(`${id}/acceptance`, { revision: 1 })).status).toBe(400)
  })

  it('shows in the history with the links and stages, newest first', async () => {
    const { id } = await stored({ quizFile: broken(), scheduleQuizId: 'p3' })
    await accept(id, 1)
    await setStage([id], 'intermediate')
    const res = await admin().request(`/api/meets/${meetId}/results/${id}/revisions`, {}, env)
    expect(await jsonOf(res)).toMatchObject([
      { kind: 'change', what: 'stage', stage: 'intermediate', changedBy: { name: 'Test Admin' } },
      { kind: 'change', what: 'acceptance', revision: 1, accepted: true },
      {
        kind: 'change',
        what: 'link',
        scheduleQuizId: 'p3',
        how: 'sheet',
        changedBy: { name: 'Room 1' },
      },
      { kind: 'revision', revision: 1 },
    ])
  })
})

describe('decisions by the phase of the meet', () => {
  it('are refused once the meet is done, and left to the admin in review', async () => {
    const { id } = await stored({ quizFile: quiz('9') })
    const inPhase = (phase: 'review' | 'done') =>
      db.update(schema.quizMeets).set({ phase }).where(eq(schema.quizMeets.id, meetId))
    const official = as(null, officialOf(room1))

    await inPhase('review')
    expect((await put(`${id}/link`, { scheduleQuizId: 'p3' }, official)).status).toBe(409)
    expect((await put(`${id}/link`, { scheduleQuizId: 'p3' })).status).toBe(200)
    expect((await put(`${id}/acceptance`, { revision: 1, accepted: true })).status).toBe(200)

    await inPhase('done')
    expect((await put(`${id}/link`, { scheduleQuizId: null })).status).toBe(409)
    expect((await put(`${id}/acceptance`, { revision: 1, accepted: false })).status).toBe(409)
    expect((await setStage([id], 'prelim')).status).toBe(409)
  })
})
