import { and, eq, inArray, sql } from 'drizzle-orm'
import {
  attentionOf,
  countingTeams,
  findDivision,
  foldName,
  resultKeyDivision,
  resultKeyName,
  sameDivision,
  type AttentionItem,
  type DivisionStats,
  type DivisionStateValue,
  type DivisionStatsInput,
  type MeetPhase,
  type NameDismissal,
  type QuizzerStage,
  type ScoredQuiz,
  type SettledBench,
  type Stage,
  type StatsQuiz,
  type StatsSettings,
} from '@qzr/shared'
import * as schema from '../db/schema'
import type { Db } from './db'
import {
  hasLaterStages,
  meetFacts,
  quizFacts,
  rosterOf,
  scheduleDivisionId,
  scheduledQuiz,
  type MeetFacts,
} from './quizFacts'
import { divisionBenches } from './benches'
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
      /** The settled benches of the division's scheduled quizzes, by `benchKey` */
      benches: Map<string, SettledBench>
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
  const inputWith = (settled?: Map<string, SettledBench>): DivisionStatsInput => ({
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
        linked:
          of.link && settled ? scheduledQuiz(facts, of.link.scheduleQuizId, settled) : of.linked,
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
  })
  // An elimination quiz's teams are checked once the benches they come from are settled: first which
  // quizzes count with no bench's team yet known, which settles the benches. A quiz those benches then
  // show was played by the wrong team stops counting, unsettling the benches it feeds, so they are
  // settled again until nothing changes. Benches only come from earlier quizzes, so each round
  // settles at least one more, and there are never more rounds than linked quizzes.
  const links = new Map(
    held.flatMap(({ quiz, facts: of }) => (of.link ? [[quiz.id, of.link.scheduleQuizId]] : [])),
  )
  const scheduleId = scheduleDivisionId(facts, folded)
  const scheduled = (facts.schedule?.document.quizzes ?? []).filter(
    (q) => q.division === scheduleId,
  )
  // Only benches filled from results need to know which quizzes count, and only a quiz whose own
  // benches aren't drawn is checked against them
  const fromResults = scheduled.some((q) =>
    q.seats.some((bench) => bench.kind === 'place' || bench.kind === 'points'),
  )
  const checked = [...links.values()].some((id) =>
    facts.schedule?.quizzes.get(id)?.seats.some((b) => b.kind !== 'letter' && b.kind !== 'empty'),
  )
  let settled = divisionBenches(
    facts,
    folded,
    fromResults ? countingTeams(inputWith()) : new Map(),
    links,
    ground.settings.tieBreaks,
  )
  for (let round = 0; fromResults && checked && round <= links.size; round++) {
    const next = divisionBenches(
      facts,
      folded,
      countingTeams(inputWith(settled)),
      links,
      ground.settings.tieBreaks,
    )
    if (sameBenches(next, settled)) break
    settled = next
  }
  return {
    kind: 'ready',
    division: named ?? folded,
    input: inputWith(settled),
    quizzes: held.map(({ quiz, scored, facts: of }) => ({
      id: quiz.id,
      name: scored.name,
      stage: of.stage,
      admin: of.stageFrom === 'admin',
      scheduleQuizId: of.link?.scheduleQuizId ?? null,
    })),
    benches: settled,
  }
}

function sameBenches(a: Map<string, SettledBench>, b: Map<string, SettledBench>): boolean {
  if (a.size !== b.size) return false
  for (const [key, bench] of a) {
    const other = b.get(key)
    if (!other || JSON.stringify(other) !== JSON.stringify(bench)) return false
  }
  return true
}

export type ReadyDivision = Extract<DivisionAnswer, { kind: 'ready' }>

/**
 * Every division the meet lists or a stored quiz names, and quizzes in none, which have no
 * standings but can still be unstaged, read under one scoring budget for the whole request, as the
 * divisions' states are; `preparing` while some revisions are still to be scored
 */
export async function meetDivisions(
  db: Db,
  meetId: number,
): Promise<{ ground: StatsGround; divisions: ReadyDivision[] } | 'notFound' | 'preparing'> {
  const [ground, keys] = await Promise.all([
    statsGround(db, meetId),
    db
      .select({ quizKey: schema.quizResults.quizKey })
      .from(schema.quizResults)
      .where(eq(schema.quizResults.meetId, meetId)),
  ])
  if (!ground) return 'notFound'
  const listed = new Set(ground.meet.divisions.map(foldName))
  const divisions = [
    ...ground.meet.divisions,
    ...new Set(keys.map(({ quizKey }) => resultKeyDivision(quizKey)).filter((d) => !listed.has(d))),
  ]
  const scoring = { left: REVISIONS_SCORED_PER_REQUEST }
  const ready: ReadyDivision[] = []
  for (const division of divisions) {
    const answer = await divisionOf(db, meetId, ground, division, undefined, scoring)
    if (answer.kind === 'notFound') continue
    if (answer.kind === 'preparing') return 'preparing'
    ready.push(answer)
  }
  return { ground, divisions: ready }
}

/**
 * What needs attention across the meet (FR-030 of meet stats), from each division read and its
 * stats: stored quizzes with no stage but by an admin's choice, each division's warnings and flags,
 * and quizzes scored another way than the meet
 */
export function attentionItems(
  divisions: { answer: ReadyDivision; stats: DivisionStats }[],
  otherFormula: { id: number; quizKey: string }[],
): AttentionItem[] {
  const items: AttentionItem[] = []
  for (const { answer, stats } of divisions) {
    // A quiz an admin set not to count has no stage by their choice, which needs nothing
    for (const quiz of answer.quizzes) {
      if (quiz.stage === null && !quiz.admin) {
        items.push({ kind: 'noStage', quiz: { id: quiz.id, name: quiz.name } })
      }
    }
    if (answer.division !== '') items.push(...attentionOf(stats))
  }
  if (otherFormula.length > 0) {
    items.push({
      kind: 'otherFormula',
      quizzes: otherFormula.map(({ id, quizKey }) => ({ id, name: resultKeyName(quizKey) })),
    })
  }
  return items
}
