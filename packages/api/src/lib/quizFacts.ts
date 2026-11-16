import { asc, desc, eq } from 'drizzle-orm'
import {
  divisionName,
  foldName,
  matchScheduledQuiz,
  resultKeyDivision,
  scheduledQuizOf,
  storedStage,
  type NamedQuiz,
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

/** Who made a decision about a stored quiz, in the decision's own columns */
export type Changer = Pick<
  typeof schema.quizResultChanges.$inferInsert,
  'changedByAccountId' | 'changedByRoomId' | 'changedByName'
>

/** How a stored quiz came to be linked to a scheduled quiz */
export type LinkHow = 'sheet' | 'matched' | 'hand'

export interface QuizLink {
  scheduleQuizId: string
  how: LinkHow
}

/** A stored quiz's current decisions: the newest of each kind */
interface Decisions {
  /** The admin's choice of stage; null when there is none, or it was removed */
  stage: StageChoice | null
  link: QuizLink | null
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
 * published schedule, and the meet's teams with their quizzers
 */
export interface MeetFacts {
  decisions: Map<number, Decisions>
  schedule: { document: ScheduleDocument; quizzes: Map<string, ScheduleQuiz> } | null
  /** Null for a meet with no teams entered: it has no roster to hold names against */
  teams: MeetTeam[] | null
}

export async function meetFacts(db: Db, meetId: number): Promise<MeetFacts> {
  const [changes, [version], teams, quizzers] = await Promise.all([
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
    db
      .select({ document: schema.meetScheduleVersions.document })
      .from(schema.meetScheduleVersions)
      .where(eq(schema.meetScheduleVersions.meetId, meetId))
      .orderBy(desc(schema.meetScheduleVersions.version))
      .limit(1),
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
  ])

  // Rows come oldest first, so each kind's last row is its current value
  const decisions = new Map<number, Decisions>()
  for (const change of changes) {
    let quiz = decisions.get(change.resultId)
    if (!quiz) {
      quiz = { stage: null, link: null, accepted: new Map() }
      decisions.set(change.resultId, quiz)
    }
    if (change.kind === 'stage') quiz.stage = change.stage
    else if (change.kind === 'link') {
      quiz.link =
        change.scheduleQuizId === null
          ? null
          : { scheduleQuizId: change.scheduleQuizId, how: change.how ?? 'hand' }
    } else if (change.kind === 'acceptance' && change.revision !== null) {
      quiz.accepted.set(change.revision, change.accepted ?? false)
    }
  }

  const document = version ? (JSON.parse(version.document) as ScheduleDocument) : null
  return {
    decisions,
    schedule: document && {
      document,
      quizzes: new Map(document.quizzes.map((quiz) => [quiz.id, quiz])),
    },
    teams:
      teams.length === 0
        ? null
        : teams.map((team) => ({
            id: team.id,
            division: team.division,
            name: `${team.churchName} ${team.number}`,
            shortName: `${team.churchShortName} ${team.number}`,
            quizzers: quizzers.filter((q) => q.teamId === team.id).map((q) => q.name),
          })),
  }
}

/** A scheduled quiz of the meet's schedule, as stored quizzes are held against it */
export function scheduledQuiz(facts: MeetFacts, scheduleQuizId: string): ScheduledQuiz | null {
  const quiz = facts.schedule?.quizzes.get(scheduleQuizId)
  if (!facts.schedule || !quiz) return null
  return scheduledQuizOf(facts.schedule.document, quiz, (teamId) =>
    facts.teams?.find((team) => team.id === teamId),
  )
}

/** The stored quiz linked to a scheduled quiz, if any */
export function linkedTo(facts: MeetFacts, scheduleQuizId: string): number | undefined {
  for (const [resultId, quiz] of facts.decisions) {
    if (quiz.link?.scheduleQuizId === scheduleQuizId) return resultId
  }
  return undefined
}

/**
 * The scheduled quiz a quiz that is not linked matches (`match`), and one it misses only by a
 * slightly different team name (`near`), each among the scheduled quizzes no stored quiz holds
 */
export function scheduleMatch(
  facts: MeetFacts,
  quiz: NamedQuiz,
): { match?: string; near?: { scheduleQuizId: string; label: string } } {
  if (!facts.schedule) return {}
  const found: ReturnType<typeof scheduleMatch> = {}
  for (const id of facts.schedule.quizzes.keys()) {
    if (linkedTo(facts, id) !== undefined) continue
    const scheduled = scheduledQuiz(facts, id)!
    const result = matchScheduledQuiz(quiz, scheduled)
    if (result === 'match') return { match: id }
    if (result === 'near') found.near ??= { scheduleQuizId: id, label: scheduled.name }
  }
  return found
}

/** The meet's teams of a quiz's division, by the division its result key names */
function rosterOf(facts: MeetFacts, quizKey: string): RosterTeam[] | null {
  if (facts.teams === null) return null
  const division = resultKeyDivision(quizKey)
  // A meet names a division "2" where its schedule and its quizzes say "Div 2"
  return facts.teams.filter(
    (team) =>
      foldName(team.division) === division || foldName(divisionName(team.division)) === division,
  )
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
} {
  const decided = facts.decisions.get(quiz.id)
  const link = decided?.link ?? null
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
    linked: link && scheduleQuiz ? scheduledQuiz(facts, link.scheduleQuizId) : null,
    line: scheduleQuiz?.line,
    accepted: decided?.accepted.get(quiz.contentRevision) ?? false,
    roster: rosterOf(facts, quiz.quizKey),
  }
}

/** Whether the schedule has an intermediate or an elimination quiz for a division, by folded name */
export function hasLaterStages(facts: MeetFacts, foldedDivision: string): boolean {
  if (!facts.schedule) return false
  for (const quiz of facts.schedule.quizzes.values()) {
    if (quiz.phase === 'elim' && foldName(quiz.division) === foldedDivision && !quiz.deciding) {
      return true
    }
  }
  return false
}
