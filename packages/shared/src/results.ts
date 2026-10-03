import type { QuizFile } from './quizFile'

/** How a revision of a stored quiz was saved */
export const RESULT_ACTIONS = ['submitted', 'uploaded', 'edited', 'merged', 'restored'] as const
export type ResultAction = (typeof RESULT_ACTIONS)[number]

/** A name as shown: surrounding spaces trimmed, and each run of spaces made one */
export function tidyName(name: string): string {
  return name.trim().replace(/\s+/g, ' ')
}

/**
 * A name folded for case and spaces, so "calgary  1" and "Calgary 1" match: the identity of a team
 * in the standings, and part of a stored quiz's key
 */
export function foldName(name: string): string {
  return tidyName(name).toLowerCase()
}

/** A quiz's name, as officials know it: "D1 Q3", or "D1c Q3" in consolation */
export function quizName(
  quiz: Pick<QuizFile['quiz'], 'division' | 'consolation' | 'quizNumber'>,
): string {
  return `D${quiz.division}${quiz.consolation ? 'c' : ''} Q${quiz.quizNumber}`
}
