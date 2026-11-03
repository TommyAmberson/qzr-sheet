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
