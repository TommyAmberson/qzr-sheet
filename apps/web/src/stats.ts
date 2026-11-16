import {
  validationMessage,
  type QuizProblem,
  type QuizzerFlag,
  type StatsWarning,
  type TieBreak,
} from '@qzr/shared'

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
  if (problem.kind === 'unanswered') {
    const many = problem.questions.length > 1
    return `Question${many ? 's' : ''} ${problem.questions.join(', ')} ${many ? 'have' : 'has'} no answer.`
  }
  if (problem.kind === 'undecided') return 'Teams are still level: the overtime is not finished.'
  const seat = [problem.team, problem.quizzer].filter((part) => part).join(', ')
  const where = [seat, problem.question && `question ${problem.question}`]
    .filter((part) => part)
    .join(', ')
  return `${where}: ${validationMessage(problem.code)}`
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
    case 'finalTie':
      return `${warning.teams.join(', ')} are tied for the last places in the final. Settle it away from the app.`
  }
}
