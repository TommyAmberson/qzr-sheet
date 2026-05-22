/**
 * Helpers for deriving scoresheet quiz-meta fields (division, quiz
 * number, consolation flag) from a scheduled quiz row.
 */

export interface ScheduledQuizMetaInput {
  phase: 'prelim' | 'elim'
  lane: 'main' | 'consolation' | 'intermediate' | null
  label: string
  bracketLabel: string | null
}

/**
 * Best-effort quiz-number extraction. Elim quizzes carry their letter
 * in `bracketLabel` (e.g. 'A', 'D', 'X'). Prelim quizzes follow the
 * `D{div}-Q{n}` label convention from commit 457394a; pull the token
 * after the last 'Q'. Hand-edited labels fall through to the raw
 * label so the user at least sees what they typed.
 */
export function quizNumberFromScheduledQuiz(q: ScheduledQuizMetaInput): string {
  if (q.bracketLabel) return q.bracketLabel
  const m = q.label.match(/Q([^\s]+)$/)
  if (m) return m[1]!
  return q.label
}

/** Consolation lanes flip the scoresheet's consolation flag so the
 *  team-picker dropdown filters down to the consolation-bracket teams. */
export function consolationFromScheduledQuiz(q: { lane: ScheduledQuizMetaInput['lane'] }): boolean {
  return q.lane === 'consolation'
}
