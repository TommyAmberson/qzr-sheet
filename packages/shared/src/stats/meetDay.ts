import type { QuizProblem } from './quizProblems'
import type { QuizResult } from './divisionStats'
import type { SettledBench } from '../schedule/resolve'
import type { ScheduleQuiz, Seat } from '../schedule/scheduleFile'
import type { MeetPhase } from '../phases'
import { viewersSeeStats, type ViewerHas } from './settings'
import { scheduledStage, type Stage } from './stages'

/**
 * The meet day: the published schedule's quizzes with their results and settled benches, and the
 * stored quizzes it doesn't have, each cut to the reader as a division's stats are
 * (`GET /api/meets/:id/day`, specs/010-meet-day/contracts/meet-day-api.md).
 */
export interface MeetDay {
  phase: MeetPhase
  /** The published schedule's version these quizzes belong to; null with none published */
  scheduleVersion: number | null
  /** One per quiz of the published schedule, in its order */
  quizzes: DayQuiz[]
  /** Settled benches by `benchKey`; a bench the reader may not see yet is left out */
  benches: Record<string, SettledBench>
  /**
   * Stored quizzes no scheduled quiz has, every one with no published schedule. Admins: all of them;
   * officials: theirs too; everyone else: only those with a stage whose results they may see
   */
  notOnSchedule: DayResult[]
  /** Admins: how many things need attention */
  attention?: number
}

/** A stored quiz's team as the reader may see it */
export interface DayTeam {
  /** As the stored quiz names the team */
  name: string
  place?: 1 | 2 | 3
  tiedWith?: number
  score?: number
}

/** `notCounted` only for an admin or the quiz's official: one set not to count is `notIn` to others */
export type DayStatus = 'played' | 'attention' | 'underReview' | 'notCounted' | 'hidden' | 'notIn'

export interface DayQuiz {
  /** The schedule quiz id */
  id: string
  status: DayStatus
  /** The stored quiz's teams, in its order; empty when not in or hidden */
  teams: DayTeam[]
  /** Admins, and the official of the quiz's room */
  storedId?: number
  problems?: QuizProblem[]
}

export interface DayResult {
  name: string
  division: string
  stage: Stage | null
  status: Exclude<DayStatus, 'hidden' | 'notIn'>
  teams: DayTeam[]
  /** Admins, and the official of the quiz's room */
  storedId?: number
  problems?: QuizProblem[]
}

/**
 * A scheduled quiz's status for one reader (data-model.md): a stage the reader may not see yet
 * hides every quiz of it, in or not, so nobody learns early that one has been played
 */
export function dayQuizStatus(
  /**
   * The stored quiz's result as an admin has it; with no stage, `notCounted` where an admin set it
   * so and `unstaged` where nothing gives it one
   */
  result: QuizResult | 'notCounted' | 'unstaged' | undefined,
  reader: {
    /** May see this quiz's stage's results, or the quiz is theirs to see whatever the stage */
    sees: boolean
    /** An admin, or the official of the quiz's room, who is told what is wrong with it */
    told: boolean
  },
): DayStatus {
  if (!reader.sees) return 'hidden'
  if (!result) return 'notIn'
  if (result === 'notCounted') return reader.told ? 'notCounted' : 'notIn'
  if (result === 'unstaged') return reader.told ? 'attention' : 'notIn'
  if (result.status === 'underReview') return reader.told ? 'attention' : 'underReview'
  return 'played'
}

/**
 * Whether a reader may see the team settled onto a bench: a drawn team once viewers see the meet's
 * stats, a rank or re-rank once they have that order, and a quiz's place or a round robin's once
 * they may see the results of the quiz it comes from
 */
export function benchShown(
  /** The schedule's quizzes by id */
  quizzes: Map<string, ScheduleQuiz>,
  quiz: ScheduleQuiz,
  bench: Seat,
  has: ViewerHas,
  phase: MeetPhase,
): boolean {
  switch (bench.kind) {
    case 'letter':
      return viewersSeeStats(phase)
    // A confirmed order's team, once the reader has the order as confirmed rather than a preview
    case 'rank':
      return has.prelimStandings === 'lockedIn'
    case 'new':
      return has.rerank === 'lockedIn'
    case 'place': {
      const source = quizzes.get(bench.quiz)
      return !!source && !!has.results[scheduledStage(source)]
    }
    case 'points':
      // From the round robin of the holder's lane, in that lane's stage, whatever the holder's own
      return !!has.results[scheduledStage({ ...quiz, deciding: false })]
    case 'empty':
      return false
  }
}
