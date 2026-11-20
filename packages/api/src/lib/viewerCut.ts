import type { Context } from 'hono'
import { and, eq, inArray } from 'drizzle-orm'
import {
  STAGES,
  type DivisionStats,
  type QuizResult,
  type ResultsLevel,
  type ViewerHas,
} from '@qzr/shared'
import * as schema from '../db/schema'
import type { SessionVariables } from '../middleware/session'
import type { Db } from './db'
import { officialRoomsOf } from './permissions'

/**
 * A quiz's result as anyone but an admin has it (FR-018 to FR-021 of meet stats), rebuilt
 * from the fields they may have so a field added for admins stays with them: its teams' places,
 * scores only at the scores level, and for an official's own quiz what is wrong with it (FR-020a).
 * The one cut every route giving a reader quizzes goes through.
 */
export function cutQuizResult(quiz: QuizResult, level: ResultsLevel, own: boolean): QuizResult {
  return {
    name: quiz.name,
    status: quiz.status,
    teams: quiz.teams.map(({ name, place, tiedWith, score }) => ({
      name,
      place,
      tiedWith,
      score: level === 'scores' ? score : undefined,
    })),
    ...(quiz.id !== undefined && own
      ? {
          id: quiz.id,
          problems: quiz.problems,
          withdrawnOrder: quiz.withdrawnOrder,
          incompleteTypes: quiz.incompleteTypes,
        }
      : {}),
  }
}

/**
 * Who reads a meet's stats, worked out once per request: an admin; an official of its rooms, with
 * the stored quizzes saved from those rooms; or a viewer or coach. The routes cut by `kind` alone
 */
export interface StatsReader {
  kind: 'admin' | 'official' | 'viewer'
  /** An official's own stored quizzes, whose problems they are shown; empty for anyone else */
  own: Set<number>
}

export async function statsReaderOf<E extends { Variables: SessionVariables }>(
  c: Context<E>,
  db: Db,
  meetId: number,
  /** Whether the caller is an admin, asked alongside their rooms rather than before */
  admin: boolean | Promise<boolean>,
): Promise<StatsReader> {
  if (admin === true) return { kind: 'admin', own: new Set() }
  const [isAdmin, rooms] = await Promise.all([admin, officialRoomsOf(c, db, meetId)])
  if (isAdmin) return { kind: 'admin', own: new Set() }
  if (rooms.length === 0) return { kind: 'viewer', own: new Set() }
  return { kind: 'official', own: await quizzesOfRooms(db, meetId, rooms) }
}

/** An admin looking at the page as its viewers see it */
export const VIEWER_PREVIEW: StatsReader = { kind: 'viewer', own: new Set() }

/** The stored quizzes saved from any of the rooms */
async function quizzesOfRooms(db: Db, meetId: number, rooms: number[]): Promise<Set<number>> {
  const rows = await db
    .selectDistinct({ id: schema.quizResultRevisions.resultId })
    .from(schema.quizResultRevisions)
    .innerJoin(schema.quizResults, eq(schema.quizResults.id, schema.quizResultRevisions.resultId))
    .where(
      and(
        eq(schema.quizResults.meetId, meetId),
        inArray(schema.quizResultRevisions.savedByRoomId, rooms),
      ),
    )
  return new Set(rows.map((row) => row.id))
}

/** Whether the caller is an official of one of the meet's rooms */
export async function isOfficialOf<E extends { Variables: SessionVariables }>(
  c: Context<E>,
  db: Db,
  meetId: number,
): Promise<boolean> {
  return (await officialRoomsOf(c, db, meetId)).length > 0
}

/**
 * Every stage's results at the scores level, as officials have them: the viewer settings are for
 * viewers and coaches, and an official sees the meet's results as an admin does (FR-019)
 */
const ALL_RESULTS: ViewerHas['results'] = Object.fromEntries(
  STAGES.map((stage) => [stage, 'scores' as const]),
)

/**
 * What an official has of a division's stats: every table as it stands and every stage's results,
 * as an admin has them; only the warnings, and what is wrong with other rooms' quizzes, are left out
 */
export function officialHas(stats: DivisionStats): ViewerHas {
  return {
    ...OFFICIAL_RESULTS,
    quizzers: stats.quizzers
      ? { state: stats.quizzers.state, through: stats.quizzers.through }
      : null,
  }
}

/** The same for a reader of results and benches alone, as the meet day is, with no quizzer tables */
export const OFFICIAL_RESULTS: ViewerHas = {
  results: ALL_RESULTS,
  prelimStandings: 'lockedIn',
  rerank: 'lockedIn',
  quizzers: null,
}
