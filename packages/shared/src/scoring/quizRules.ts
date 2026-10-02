import { QuizFormat } from '../quizFile'

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

/**
 * Three-team practice-meet quiz: the 20-question structure moved five questions earlier, with the
 * two-team tie-breaker's quiz-out of 3. Not in the rulebook; see docs/scoring-rules-explained.md.
 */
const FIFTEEN_QUESTION_RULES: QuizRules = Object.freeze({
  regulationQuestions: 15,
  firstAbQuestion: 11,
  firstErrorPointsQuestion: 12,
  quizOutCorrect: 3,
  overtimeRoundSize: 3,
})

export function quizRules(format: QuizFormat): QuizRules {
  switch (format) {
    case QuizFormat.TwentyQuestion:
      return TWENTY_QUESTION_RULES
    case QuizFormat.FifteenQuestion:
      return FIFTEEN_QUESTION_RULES
  }
}

export function firstOvertimeQuestion(rules: QuizRules): number {
  return rules.regulationQuestions + 1
}

/** Timeouts end when error points begin, so the last one may follow the question before. */
export function lastTimeoutQuestion(rules: QuizRules): number {
  return rules.firstErrorPointsQuestion - 1
}

/** Last question number once `rounds` overtime rounds are played (0 = end of regulation) */
export function lastQuestionThroughRound(rules: QuizRules, rounds: number): number {
  return rules.regulationQuestions + rounds * rules.overtimeRoundSize
}

/** First and last question numbers of overtime round `roundIdx` (0-based) */
export function otRoundRange(
  rules: QuizRules,
  roundIdx: number,
): { firstQ: number; lastQ: number } {
  return {
    firstQ: lastQuestionThroughRound(rules, roundIdx) + 1,
    lastQ: lastQuestionThroughRound(rules, roundIdx + 1),
  }
}

/** Whether question `n` is the last of regulation or of an overtime round */
export function endsRound(rules: QuizRules, n: number): boolean {
  return (
    n >= rules.regulationQuestions &&
    (n - rules.regulationQuestions) % rules.overtimeRoundSize === 0
  )
}

/** Whether question `n` is the first of an overtime round */
export function startsOtRound(rules: QuizRules, n: number): boolean {
  return n > rules.regulationQuestions && endsRound(rules, n - 1)
}
