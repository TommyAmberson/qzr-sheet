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

/** Names in the order people count them: Q2 before Q10, division 2 before division 10 */
export const byNumber = new Intl.Collator('en', { numeric: true })

/** One division's team names, which a meet's admin lists for its scoresheets to offer (Story 6) */
export interface DivisionTeamNames {
  division: string
  names: string[]
}

/** How many single-character insertions, deletions or substitutions turn one string into another */
export function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) {
      current[j] =
        a[i - 1] === b[j - 1]
          ? previous[j - 1]!
          : 1 + Math.min(previous[j]!, current[j - 1]!, previous[j - 1]!)
    }
    previous = current
  }
  return previous[b.length]!
}

/**
 * The key a meet stores a quiz's results under: division, consolation and quiz number, folded for
 * case and spaces, so `Div 2c Quiz A` and `div 2C quiz a` are one quiz
 */
export function resultKey(
  quiz: Pick<QuizFile['quiz'], 'division' | 'consolation' | 'quizNumber'>,
): string {
  return [foldName(quiz.division), quiz.consolation ? 'c' : '', foldName(quiz.quizNumber)].join('|')
}

/** The division a result key names, folded as the key folds it */
export function resultKeyDivision(key: string): string {
  return key.split('|')[0]!
}

/** The name a result key gives its quiz, as `quizName` gives it, from the key's folded parts */
export function resultKeyName(key: string): string {
  const [division = '', consolation, quizNumber = ''] = key.split('|')
  return quizName({ division, consolation: consolation === 'c', quizNumber })
}

/** How a stored quiz came to be linked to a scheduled quiz: named by the sheet, matched, by hand */
export const LINK_HOWS = ['sheet', 'matched', 'hand'] as const
export type LinkHow = (typeof LINK_HOWS)[number]

/** The kinds of decision recorded about a stored quiz */
export const CHANGE_KINDS = ['stage', 'link', 'acceptance', 'kept'] as const
export type ChangeKind = (typeof CHANGE_KINDS)[number]

/** A quiz's name, as officials know it: "D1 Q3", or "D1c Q3" in consolation */
export function quizName(
  quiz: Pick<QuizFile['quiz'], 'division' | 'consolation' | 'quizNumber'>,
): string {
  return `D${quiz.division}${quiz.consolation ? 'c' : ''} Q${quiz.quizNumber}`
}

/** What a file name shows where the quiz has no division or number */
export const BLANK_IN_FILE_NAME = '_'

/**
 * A quiz's file name without its extension: its name without the space, "D1Q3" or "D1cQ3". A blank
 * division or number shows as "_", so a new quiz saves as "D_Q_" and the name still says which part
 * is which; a "_" copied back off a file name counts as blank too.
 */
export function quizFileStem(
  quiz: Pick<QuizFile['quiz'], 'division' | 'consolation' | 'quizNumber'>,
): string {
  const part = (value: string) => {
    // A slash would make a folder of the name, and Windows refuses the rest in a file name
    const trimmed = value.trim().replace(/[/\\:*?"<>|]/g, '-')
    return trimmed === '' || trimmed === BLANK_IN_FILE_NAME ? BLANK_IN_FILE_NAME : trimmed
  }
  const named = { ...quiz, division: part(quiz.division), quizNumber: part(quiz.quizNumber) }
  return quizName(named).replace(' Q', 'Q')
}
