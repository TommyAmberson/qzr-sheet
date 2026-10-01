import { QuizFormat } from '@qzr/shared'

/**
 * The structural numbers that differ between quiz formats. Everything else about scoring
 * (error-out, foul-out, bonus chains, deductions) is shared by every format.
 */
export interface QuizRules {
  /** Last regulation question number */
  readonly regulationQuestions: number
  /** First question with A/B sub-questions, where all teams must stay eligible */
  readonly firstAbQuestion: number
  /** First question where every error deducts and bonuses drop to 10 points */
  readonly firstErrorPointsQuestion: number
  /** Correct answers that quiz a quizzer out (and earn the quiz-out bonus with no errors) */
  readonly quizOutCorrect: number
  /** Questions per overtime round */
  readonly overtimeRoundSize: number
}

export const TWENTY_QUESTION_RULES: QuizRules = Object.freeze({
  regulationQuestions: 20,
  firstAbQuestion: 16,
  firstErrorPointsQuestion: 17,
  quizOutCorrect: 4,
  overtimeRoundSize: 3,
})

export function quizRules(format: QuizFormat): QuizRules {
  switch (format) {
    case QuizFormat.TwentyQuestion:
      return TWENTY_QUESTION_RULES
    case QuizFormat.FifteenQuestion:
      throw new Error('15-question rules are not implemented yet')
  }
}

export function firstOvertimeQuestion(rules: QuizRules): number {
  return rules.regulationQuestions + 1
}

/** Timeouts end when error points begin, so the last one may follow the question before. */
export function lastTimeoutQuestion(rules: QuizRules): number {
  return rules.firstErrorPointsQuestion - 1
}
