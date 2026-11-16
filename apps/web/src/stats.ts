import {
  validationMessage,
  type QuizProblem,
  type QuizzerFlag,
  type StageChoice,
  type StatsWarning,
  type TieBreak,
} from '@qzr/shared'
import type { HistoryEntry } from './api'

/** What a stage is called */
export const STAGE_LABELS: Record<StageChoice, string> = {
  prelim: 'Prelim',
  intermediate: 'Intermediate',
  elimination: 'Elimination',
  finals: 'Finals',
  notCounted: 'Not counted',
}

/** A decision in a stored quiz's history, as a few words */
export function changeText(
  change: Omit<Extract<HistoryEntry, { kind: 'change' }>, 'kind' | 'changedBy' | 'changedAt'>,
): string {
  switch (change.what) {
    case 'stage':
      return change.stage
        ? `Stage set to ${STAGE_LABELS[change.stage]}`
        : 'Stage left to the schedule'
    case 'link':
      if (!change.scheduleQuizId) return 'Unlinked from the schedule'
      return change.how === 'sheet'
        ? 'Linked to the schedule by the scoresheet'
        : change.how === 'matched'
          ? 'Linked to the schedule by its name and teams'
          : 'Linked to the schedule by hand'
    case 'acceptance':
      return `Revision ${change.revision} ${change.accepted ? 'accepted as scored' : 'no longer accepted'}`
    case 'kept':
      return 'Kept as it is'
  }
}

/** How a standings table names the tie-breaker that separated a team from those level with it */
export const TIE_BREAKS: Record<TieBreak, string> = {
  headToHead: 'head-to-head',
  points: 'total points',
  errors: 'fewest errors',
}

const ORDINALS = ['', '1st', '2nd', '3rd']

/** A team's place in a quiz: "2nd", or "tied 1st" when teams share it */
export function placeLabel(place: number, tiedWith = 1): string {
  const label = ORDINALS[place] ?? String(place)
  return tiedWith > 1 ? `tied ${label}` : label
}

/** One thing wrong with a stored quiz, as a line an admin can act on */
export function problemText(problem: QuizProblem): string {
  switch (problem.kind) {
    case 'validation': {
      const seat = [problem.team, problem.quizzer].filter((part) => part).join(', ')
      const where = [seat, problem.question && `question ${problem.question}`]
        .filter((part) => part)
        .join(', ')
      return `${where}: ${validationMessage(problem.code)}`
    }
    case 'unanswered': {
      const many = problem.questions.length > 1
      return `Question${many ? 's' : ''} ${problem.questions.join(', ')} ${many ? 'have' : 'has'} no answer.`
    }
    case 'undecided':
      return 'Teams are still level: the overtime is not finished.'
    case 'teamNotOnRoster': {
      const team = problem.team ? `${problem.team} is` : 'A team with no name is'
      return `${team} not one of the division's teams.${problem.near ? ` The roster has ${problem.near}.` : ''}`
    }
    case 'quizzerNotOnRoster':
      return `${problem.team}: ${problem.quizzer} is not on the roster.${problem.near ? ` The roster has ${problem.near}.` : ''}`
    case 'quizzerMissing':
      return `${problem.team}: ${problem.quizzer} is on the roster and not in this quiz.`
    case 'tooManyQuizzers':
      return `${problem.team} lists ${problem.listed} quizzers; its roster has ${problem.roster}.`
    case 'nameDiffers':
      return `It is linked to ${problem.scheduled}, which is not its name.`
    case 'teamsDiffer':
      return `Its teams are not the schedule's: ${problem.scheduled.join(', ')}.`
    case 'tieLeftStanding':
      return 'It ended level with no overtime, and this quiz must have a winner.'
  }
}

/** A flag on a quizzer's line in the standings, for the admin */
export function flagText(flag: QuizzerFlag): string {
  switch (flag.kind) {
    case 'quizCount':
      return `listed in ${flag.listed} of the team's ${flag.teamQuizzes} quizzes`
    case 'incompleteTypes':
      return 'question types incomplete'
  }
}

/** A warning on a division's stats, as a sentence */
export function warningText(warning: StatsWarning): string {
  switch (warning.kind) {
    case 'inError': {
      const count = warning.problems.length
      return `${warning.quiz.name} has ${count === 1 ? 'an error' : `${count} errors`}, so it adds nothing.`
    }
    case 'unequalPrelims':
      return `Teams have played different numbers of counted quizzes: ${warning.teams
        .map((team) => `${team.name} ${team.quizzes}`)
        .join(', ')}.`
    case 'lookAlikeTeams':
      return `${warning.names[0]} and ${warning.names[1]} look like one team spelt two ways.`
    case 'twoFinals':
      return `${warning.quizzes.map((quiz) => quiz.name).join(' and ')} are both the ${warning.consolation ? 'consolation ' : ''}Finals, so neither gives its first three. Set all but one to another stage.`
    case 'finalTie':
      return `${warning.teams.join(', ')} are tied for the last places in the final. Settle it away from the app.`
  }
}
