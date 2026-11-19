import { and, eq, inArray, sql } from 'drizzle-orm'
import {
  findDivision,
  foldName,
  sameDivision,
  type DivisionStateValue,
  type DivisionStatsInput,
  type MeetPhase,
  type NameDismissal,
  type QuizzerStage,
  type ScoredQuiz,
  type Stage,
  type StatsQuiz,
  type StatsSettings,
} from '@qzr/shared'
import * as schema from '../db/schema'
import type { Db } from './db'
import { hasLaterStages, meetFacts, quizFacts, rosterOf, type MeetFacts } from './quizFacts'
import { content, current, isCounted, toContent, toCurrent } from './resultsSql'
import { SHARED_VERSION, keepScores } from './scores'
import { statsSettingsOf } from './statsSettings'

/**
 * How many revisions one request scores when their kept scores are missing or were made by another
 * shared version. Scoring is the costly part of a request, and the Workers free plan allows 10 ms
 * of CPU, so a request scores a few and asks the caller to come back for the rest.
 */
export const REVISIONS_SCORED_PER_REQUEST = 5

/**
 * A division's stored quizzes, each with its current content's revision and that revision's score.
 * `foldedDivision` is the division as a result key folds it.
 */
function storedQuizzes(db: Db, meetId: number, foldedDivision: string) {
  // A result key starts with its division and a bar
  const prefix = `${foldedDivision}|`
  return (
    db
      .select({
        id: schema.quizResults.id,
        quizKey: schema.quizResults.quizKey,
        counted: isCounted,
        revisionId: content.id,
        contentRevision: content.revision,
        sharedVersion: schema.quizResultScores.sharedVersion,
        scored: schema.quizResultScores.scored,
      })
      .from(schema.quizResults)
      .innerJoin(current, toCurrent)
      // The content shown is the one scored
      .innerJoin(content, toContent)
      .leftJoin(schema.quizResultScores, eq(schema.quizResultScores.revisionId, content.id))
      .where(
        and(
          eq(schema.quizResults.meetId, meetId),
          sql`substr(${schema.quizResults.quizKey}, 1, ${prefix.length}) = ${prefix}`,
        ),
      )
  )
}

export function meetQuery(db: Db, meetId: number) {
  return db
    .select({ phase: schema.quizMeets.phase, divisions: schema.quizMeets.divisions })
    .from(schema.quizMeets)
    .where(eq(schema.quizMeets.id, meetId))
}

export function divisionStatesQuery(db: Db, meetId: number) {
  return db
    .select({
      id: schema.divisionStates.id,
      division: schema.divisionStates.division,
      state: schema.divisionStates.state,
      transitionedAt: schema.divisionStates.transitionedAt,
    })
    .from(schema.divisionStates)
    .where(eq(schema.divisionStates.meetId, meetId))
}

export type StateRows = Awaited<ReturnType<typeof divisionStatesQuery>>

/** A division's state; one the admin has not moved is running its prelims */
export function stateOf(rows: StateRows, division: string): DivisionStateValue {
  return rows.find((row) => sameDivision(row.division, division))?.state ?? 'prelim_running'
}

/** What every division's stats are worked out against, read once per request */
export interface StatsGround {
  meet: { phase: MeetPhase; divisions: string[] }
  states: StateRows
  facts: MeetFacts
  settings: StatsSettings
  /** Look-alike pairs an admin said are different names, by folded division */
  dismissed: Map<string, NameDismissal[]>
}

export async function statsGround(db: Db, meetId: number): Promise<StatsGround | null> {
  const [meets, states, facts, { settings }, dismissals] = await Promise.all([
    meetQuery(db, meetId),
    divisionStatesQuery(db, meetId),
    meetFacts(db, meetId),
    statsSettingsOf(db, meetId),
    db
      .select({
        division: schema.meetNameDismissals.division,
        team: schema.meetNameDismissals.team,
        nameA: schema.meetNameDismissals.nameA,
        nameB: schema.meetNameDismissals.nameB,
      })
      .from(schema.meetNameDismissals)
      .where(eq(schema.meetNameDismissals.meetId, meetId)),
  ])
  const meet = meets[0]
  if (!meet) return null
  return {
    meet: { phase: meet.phase, divisions: JSON.parse(meet.divisions) as string[] },
    states,
    facts,
    settings,
    dismissed: Map.groupBy(
      dismissals.map(({ division, team, nameA, nameB }) => ({
        division,
        team,
        names: [nameA, nameB] as [string, string],
      })),
      (dismissal) => dismissal.division,
    ),
  }
}

/** A stored quiz of a division, as a division's steps hold it against the schedule */
export interface DivisionQuiz {
  id: number
  name: string
  stage: Stage | null
  /** An admin's choice, where the stage is theirs; with no stage, set not to count */
  admin: boolean
  scheduleQuizId: string | null
}

export type DivisionAnswer =
  | { kind: 'notFound' }
  /** Some revisions are still to be scored; the caller comes back for the rest */
  | { kind: 'preparing' }
  | {
      kind: 'ready'
      /** As the meet spells it */
      division: string
      /** What its stats are worked out from, for `divisionStats` or `heldQuizzes` */
      input: DivisionStatsInput
      quizzes: DivisionQuiz[]
    }

/**
 * A division's stored quizzes as scored when they were saved, scoring a few that are missing their
 * kept score, with everything they are held against. `division` is the name asked for.
 */
export async function divisionOf(
  db: Db,
  meetId: number,
  ground: StatsGround,
  division: string,
  quizzersThrough?: QuizzerStage,
  /** How many more revisions this request may score, shared by every division it reads */
  scoring: { left: number } = { left: REVISIONS_SCORED_PER_REQUEST },
): Promise<DivisionAnswer> {
  const folded = foldName(division)
  const quizzes = await storedQuizzes(db, meetId, folded)
  const named = findDivision(ground.meet.divisions, division)
  if (named === undefined && quizzes.length === 0) return { kind: 'notFound' }

  const unscored = quizzes
    .filter((quiz) => quiz.scored === null || quiz.sharedVersion !== SHARED_VERSION)
    .map((quiz) => quiz.revisionId)
  const rescored = new Map<number, ScoredQuiz>()
  const batch = unscored.slice(0, scoring.left)
  if (batch.length > 0) {
    scoring.left -= batch.length
    const files = await db
      .select({
        id: schema.quizResultRevisions.id,
        quizFile: schema.quizResultRevisions.quizFile,
      })
      .from(schema.quizResultRevisions)
      .where(inArray(schema.quizResultRevisions.id, batch))
    const scored = await keepScores(
      db,
      files.flatMap(({ id, quizFile }) => (quizFile === null ? [] : [{ id, quizFile }])),
    )
    for (const [revisionId, score] of scored) rescored.set(revisionId, score)
  }
  // The rest wait for the caller to come back
  if (batch.length < unscored.length) return { kind: 'preparing' }

  const { facts } = ground
  // Kept scores are read only now, once it is known the stats can be answered. A revision with no
  // file to score, if one is ever current, is left out rather than holding every request back
  const held = quizzes.flatMap((quiz) => {
    const kept = quiz.scored === null ? null : (JSON.parse(quiz.scored) as ScoredQuiz)
    const scored = rescored.get(quiz.revisionId) ?? kept
    return scored ? [{ quiz, scored, facts: quizFacts(facts, quiz) }] : []
  })
  return {
    kind: 'ready',
    division: named ?? folded,
    input: {
      division: named ?? folded,
      state: stateOf(ground.states, division),
      phase: ground.meet.phase,
      quizzes: held.map(
        ({ quiz, scored, facts: of }): StatsQuiz => ({
          id: quiz.id,
          name: scored.name,
          key: quiz.quizKey,
          stage: of.stage,
          scored,
          linked: of.linked,
          line: of.line,
          accepted: of.accepted,
          withdrawnOrder: of.withdrawnOrder,
        }),
      ),
      // Every quiz of the division is held against the same teams
      roster: rosterOf(facts, folded),
      laterStagesScheduled: hasLaterStages(facts, folded),
      schedulePublished: facts.schedule !== null,
      settings: ground.settings,
      confirmed: facts.confirmed.get(folded),
      quizzersThrough,
      dismissed: ground.dismissed.get(folded),
    },
    quizzes: held.map(({ quiz, scored, facts: of }) => ({
      id: quiz.id,
      name: scored.name,
      stage: of.stage,
      admin: of.stageFrom === 'admin',
      scheduleQuizId: of.link?.scheduleQuizId ?? null,
    })),
  }
}
