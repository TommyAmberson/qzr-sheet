import { foldName, tidyName } from '../results'
import type { ScheduleQuiz } from './scheduleFile'

/** 1st, 2nd, 3rd, 11th, 21st */
export function ordinal(n: number): string {
  const suffix = ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'
  return `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : suffix}`
}

/** A quiz's own name within its division, its label's last word: `A` of `Div 2 Quiz A` */
export function quizNumber(q: Pick<ScheduleQuiz, 'label'>): string {
  return q.label.trim().split(/\s+/).pop() ?? ''
}

/** A meet team as the portal, the builder and the scoresheet show it: `Grace 2` */
export function teamDisplayName(team: { shortName: string; number: number }): string {
  return `${team.shortName} ${team.number}`
}

/**
 * A division's name as typed, without a prefix typed before it: `Div 2`, `Division 2`, `D2` and `2`
 * are all `2`, and `Junior` stays `Junior`. A division is stored bare and shown with its prefix, so
 * this is for names being typed; a stored name is shown as it is, so a prefix saved by mistake
 * shows. `D` is a prefix only before a digit, so `Dover` keeps its name.
 */
export function bareDivision(name: string): string {
  const spaced = tidyName(name)
  // One prefix only, so a division named `D1` typed as `Div D1` keeps its name
  const bare = spaced.replace(
    /^(?:(?:division|div)(?=[\s.:\-\d]|$)[.:-]?\s*|d[.:-]?\s*(?=\d))/i,
    '',
  )
  return bare || spaced
}

/** A division shown on its own: `Division 2`, `Division Junior` */
export function divisionTitle(name: string): string {
  return `Division ${name}`
}

/** A division shown on a schedule and in its quizzes' labels, from its bare name: `Div 2` */
export function divisionName(name: string): string {
  return `Div ${name}`
}

/**
 * Whether two names are one division, ignoring case and spacing: `2c` and ` 2C` are one. `Div 2` and
 * `2` are not, so a division saved with its prefix by mistake shows as one the meet doesn't have.
 */
export function sameDivision(a: string, b: string): boolean {
  return foldName(a) === foldName(b)
}

/** The division of a list that a name is, by `sameDivision`, as the list spells it */
export function findDivision(divisions: readonly string[], name: string): string | undefined {
  return divisions.find((division) => sameDivision(division, name))
}
