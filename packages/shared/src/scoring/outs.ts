import { CellValue } from '../types/scoresheet'
import type { QuizRules } from './quizRules'

/** Errors after which a quizzer leaves the bench */
export const ERRORS_TO_ERROR_OUT = 3
/** Fouls after which a quizzer leaves the bench */
export const FOULS_TO_FOUL_OUT = 3

/**
 * A quizzer's marks so far that count towards going out. Every question counts, overtime
 * included: overtime gives a quizzer no points, but still puts them out.
 */
export interface OutTally {
  correct: number
  errors: number
  fouls: number
}

export function newOutTally(): OutTally {
  return { correct: 0, errors: 0, fouls: 0 }
}

/** Counts a mark towards going out; bonus answers count for nothing */
export function countTowardsOut(tally: OutTally, value: CellValue): void {
  if (value === CellValue.Correct) tally.correct++
  else if (value === CellValue.Error) tally.errors++
  else if (value === CellValue.Foul) tally.fouls++
}

/** Quizzed out: stays on the bench, and may still answer bonuses */
export function isQuizzedOut(tally: OutTally, rules: QuizRules): boolean {
  return tally.correct >= rules.quizOutCorrect
}

export function isErroredOut(tally: OutTally): boolean {
  return tally.errors >= ERRORS_TO_ERROR_OUT
}

export function isFouledOut(tally: OutTally): boolean {
  return tally.fouls >= FOULS_TO_FOUL_OUT
}

/** Errored or fouled out: the quizzer leaves the bench, and can only be called for a foul */
export function hasLeftBench(tally: OutTally): boolean {
  return isErroredOut(tally) || isFouledOut(tally)
}
