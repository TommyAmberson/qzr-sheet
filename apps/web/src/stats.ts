import { validationMessage, type QuizProblem, type StatsWarning, type TieBreak } from '@qzr/shared'

/** How a standings table names the tie-breaker that separated a team from those level with it */
export const TIE_BREAKS: Record<TieBreak, string> = {
  headToHead: 'head-to-head',
  points: 'total points',
  errors: 'fewest errors',
}

const ORDINALS = ['', '1st', '2nd', '3rd']

/** A team's place in a quiz: "2nd", or "tied 1st" when teams share it */
export function placeLabel(place: number, tiedWith?: number): string {
  const label = ORDINALS[place] ?? String(place)
  return tiedWith ? `tied ${label}` : label
}

/** One thing wrong with a stored quiz, as a line an admin can act on */
export function problemText(problem: QuizProblem): string {
  if (problem.kind === 'unanswered') {
    const many = problem.questions.length > 1
    return `Question${many ? 's' : ''} ${problem.questions.join(', ')} ${many ? 'have' : 'has'} no answer.`
  }
  const seat = [problem.team, problem.quizzer].filter((part) => part).join(', ')
  const where = [seat, problem.question && `question ${problem.question}`]
    .filter((part) => part)
    .join(', ')
  return `${where}: ${validationMessage(problem.code)}`
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
