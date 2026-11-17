import { asc, eq } from 'drizzle-orm'
import {
  resultKeyDivision,
  resultName,
  sameDivision,
  scheduledQuizOf,
  scheduledStage,
  storedStage,
  teamDisplayName,
  type LinkHow,
  type RosterTeam,
  type ScheduleDocument,
  type ScheduleQuiz,
  type ScheduledQuiz,
  type Stage,
  type StageChoice,
  type StageFrom,
} from '@qzr/shared'
import * as schema from '../db/schema'
import { inChunks, type Db } from './db'
import { newestVersion } from './scheduleVersions'

/** Who made a decision about a stored quiz, in the decision's own columns */
export type Changer = Pick<
  typeof schema.quizResultChanges.$inferInsert,
  'changedByAccountId' | 'changedByRoomId' | 'changedByName'
>

export interface QuizLink {
  scheduleQuizId: string
  how: LinkHow
}

/** A stored quiz's current decisions: the newest of each kind */
interface Decisions {
  /** The admin's choice of stage; null when there is none, or it was removed */
  stage: StageChoice | null
  link: QuizLink | null
  /** How the newest link decision was made, a removal included; null while there is none */
  linkBy: LinkHow | null
  /** Each revision's newest acceptance: accepted as scored, or withdrawn */
  accepted: Map<number, boolean>
}

type Change = typeof schema.quizResultChanges.$inferInsert

/** Record decisions about stored quizzes, each as a row that is never changed afterwards */
export async function recordChanges(db: Db, changes: Omit<Change, 'changedAt'>[]) {
  const changedAt = new Date()
  await inChunks(
    changes.map((change) => ({
      stage: null,
      scheduleQuizId: null,
      how: null,
      revision: null,
      accepted: null,
      changedByAccountId: null,
      changedByRoomId: null,
      ...change,
      changedAt,
    })),
    11,
    (chunk) =>
      db
        .insert(schema.quizResultChanges)
        .values(chunk)
        .returning({ id: schema.quizResultChanges.id }),
  )
}

/** A team of the meet's roster, with the division it is in as the meet names it */
type MeetTeam = RosterTeam & { division: string }

/**
 * What a meet's stored quizzes are held against: the decisions made about them, the newest
 * published schedule, and the meet's teams with their quizzers. Read once per request, so each
 * index here is built once.
 */
export interface MeetFacts {
  decisions: Map<number, Decisions>
  schedule: {
    document: ScheduleDocument
    quizzes: Map<string, ScheduleQuiz>
    /** The scheduled quizzes by the result key they name their results under */
    byKey: Map<string, string[]>
  } | null
  /** The stored quiz an explicit link, by the sheet or by hand, gives each scheduled quiz */
  claimed: Map<string, number>
  /** Each stored quiz's link: its explicit link, else the scheduled quiz of its name */
  links: Map<number, QuizLink | null>
  /** Null for a meet with no teams entered: it has no roster to hold names against */
  teams: MeetTeam[] | null
}

export async function meetFacts(db: Db, meetId: number): Promise<MeetFacts> {
  const [changes, version, teams, quizzers, stored] = await Promise.all([
    db
      .select({
        resultId: schema.quizResultChanges.resultId,
        kind: schema.quizResultChanges.kind,
        stage: schema.quizResultChanges.stage,
        scheduleQuizId: schema.quizResultChanges.scheduleQuizId,
        how: schema.quizResultChanges.how,
        revision: schema.quizResultChanges.revision,
        accepted: schema.quizResultChanges.accepted,
      })
      .from(schema.quizResultChanges)
      .innerJoin(schema.quizResults, eq(schema.quizResults.id, schema.quizResultChanges.resultId))
      .where(eq(schema.quizResults.meetId, meetId))
      .orderBy(asc(schema.quizResultChanges.id)),
    newestVersion(db, meetId),
    db
      .select({
        id: schema.teams.id,
        division: schema.teams.division,
        number: schema.teams.number,
        churchName: schema.churches.name,
        churchShortName: schema.churches.shortName,
      })
      .from(schema.teams)
      .innerJoin(schema.churches, eq(schema.teams.churchId, schema.churches.id))
      .where(eq(schema.teams.meetId, meetId)),
    db
      .select({ teamId: schema.teamRosters.teamId, name: schema.teamRosters.name })
      .from(schema.teamRosters)
      .innerJoin(schema.teams, eq(schema.teams.id, schema.teamRosters.teamId))
      .where(eq(schema.teams.meetId, meetId)),
    db
      .select({ id: schema.quizResults.id, quizKey: schema.quizResults.quizKey })
      .from(schema.quizResults)
      .where(eq(schema.quizResults.meetId, meetId)),
  ])

  // Rows come oldest first, so each kind's last row is its current value
  const decisions = new Map<number, Decisions>()
  for (const change of changes) {
    let quiz = decisions.get(change.resultId)
    if (!quiz) {
      quiz = { stage: null, link: null, linkBy: null, accepted: new Map() }
      decisions.set(change.resultId, quiz)
    }
    if (change.kind === 'stage') quiz.stage = change.stage
    else if (change.kind === 'link') {
      quiz.linkBy = change.how ?? 'hand'
      quiz.link =
        change.scheduleQuizId === null
          ? null
          : { scheduleQuizId: change.scheduleQuizId, how: change.how ?? 'hand' }
    } else if (change.kind === 'acceptance' && change.revision !== null) {
      quiz.accepted.set(change.revision, change.accepted ?? false)
    }
  }

  const document = version ? (JSON.parse(version.document) as ScheduleDocument) : null
  const byKey = new Map<string, string[]>()
  for (const quiz of document?.quizzes ?? []) {
    const key = resultName(quiz)
    byKey.set(key, [...(byKey.get(key) ?? []), quiz.id])
  }
  const quizzersOf = new Map<number, string[]>()
  for (const { teamId, name } of quizzers) {
    quizzersOf.set(teamId, [...(quizzersOf.get(teamId) ?? []), name])
  }

  const facts: MeetFacts = {
    decisions,
    schedule: document && {
      document,
      quizzes: new Map(document.quizzes.map((quiz) => [quiz.id, quiz])),
      byKey,
    },
    claimed: new Map(),
    links: new Map(),
    teams:
      teams.length === 0
        ? null
        : teams.map((team) => ({
            id: team.id,
            division: team.division,
            name: `${team.churchName} ${team.number}`,
            shortName: teamDisplayName({ shortName: team.churchShortName, number: team.number }),
            quizzers: quizzersOf.get(team.id) ?? [],
          })),
  }
  // Explicit links first, so a link by name never takes a scheduled quiz one of them holds
  for (const [resultId, quiz] of decisions) {
    if (quiz.link && facts.schedule?.quizzes.has(quiz.link.scheduleQuizId)) {
      facts.claimed.set(quiz.link.scheduleQuizId, resultId)
    }
  }
  for (const { id, quizKey } of stored) facts.links.set(id, linkOf(facts, id, quizKey))
  return facts
}

/** A scheduled quiz of the meet's schedule, as stored quizzes are held against it */
export function scheduledQuiz(facts: MeetFacts, scheduleQuizId: string): ScheduledQuiz | null {
  const quiz = facts.schedule?.quizzes.get(scheduleQuizId)
  if (!facts.schedule || !quiz) return null
  return scheduledQuizOf(facts.schedule.document, quiz, (teamId) =>
    facts.teams?.find((team) => team.id === teamId),
  )
}

/**
 * A stored quiz's link. An explicit link, made by the sheet on submitting or by hand, holds while
 * its scheduled quiz is in the schedule; an admin's unlink holds too. Otherwise a quiz is linked to
 * the scheduled quiz of its name, unless an explicit link holds that one: a quiz is the quiz its
 * name says, and a quiz the schedule has no name for is linked to none.
 */
export function linkOf(facts: MeetFacts, resultId: number, quizKey: string): QuizLink | null {
  const decided = facts.decisions.get(resultId)
  if (decided?.link && facts.schedule?.quizzes.has(decided.link.scheduleQuizId)) {
    return decided.link
  }
  if (decided?.linkBy === 'hand' && decided.link === null) return null
  const named = facts.schedule?.byKey.get(quizKey)?.find((id) => !facts.claimed.has(id))
  return named === undefined ? null : { scheduleQuizId: named, how: 'matched' }
}

/**
 * Link a stored quiz to a scheduled quiz explicitly, recording how. A scheduled quiz holds one
 * stored quiz, so where another quiz's explicit link holds it nothing is recorded and that quiz's
 * id is the answer. A link by name gives way.
 */
export async function linkTo(
  db: Db,
  facts: MeetFacts,
  resultId: number,
  scheduleQuizId: string,
  how: LinkHow,
  changer: Changer,
): Promise<{ link: QuizLink } | { heldBy: number }> {
  const holder = facts.claimed.get(scheduleQuizId)
  if (holder !== undefined && holder !== resultId) return { heldBy: holder }
  await recordChanges(db, [{ resultId, kind: 'link', scheduleQuizId, how, ...changer }])
  facts.claimed.set(scheduleQuizId, resultId)
  return { link: { scheduleQuizId, how } }
}

/** The meet's teams of a division, null for a meet with no roster */
export function rosterOf(facts: MeetFacts, division: string): RosterTeam[] | null {
  return facts.teams?.filter((team) => sameDivision(team.division, division)) ?? null
}

/** A stored quiz's stage, link and acceptance, and what its problems are worked out against */
export function quizFacts(
  facts: MeetFacts,
  quiz: {
    id: number
    quizKey: string
    /** Its newest counting record, from before quizzes had stages */
    counted: boolean
    /** The revision whose content is current: a restoring revision's is the one it restores */
    contentRevision: number
  },
): {
  stage: Stage | null
  stageFrom: StageFrom | null
  link: QuizLink | null
  linked: ScheduledQuiz | null
  line: number | undefined
  accepted: boolean
  roster: RosterTeam[] | null
  schedulePublished: boolean
} {
  const decided = facts.decisions.get(quiz.id)
  // An unlinked quiz is cached as null, which is an answer, not a miss
  const link = facts.links.has(quiz.id)
    ? facts.links.get(quiz.id)!
    : linkOf(facts, quiz.id, quiz.quizKey)
  const scheduleQuiz = link ? facts.schedule?.quizzes.get(link.scheduleQuizId) : undefined
  const { stage, from } = storedStage({
    chosen: decided?.stage ?? null,
    linked: scheduleQuiz ?? null,
    counted: quiz.counted,
  })
  return {
    stage,
    stageFrom: from,
    link,
    linked: link ? scheduledQuiz(facts, link.scheduleQuizId) : null,
    line: scheduleQuiz?.line,
    accepted: decided?.accepted.get(quiz.contentRevision) ?? false,
    roster: rosterOf(facts, resultKeyDivision(quiz.quizKey)),
    schedulePublished: facts.schedule !== null,
  }
}

/** Whether the schedule has an intermediate or an elimination quiz for a division */
export function hasLaterStages(facts: MeetFacts, division: string): boolean {
  for (const quiz of facts.schedule?.quizzes.values() ?? []) {
    const stage = scheduledStage(quiz)
    if (
      sameDivision(quiz.division, division) &&
      (stage === 'intermediate' || stage === 'elimination')
    ) {
      return true
    }
  }
  return false
}
