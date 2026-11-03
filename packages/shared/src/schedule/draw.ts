import { letterOf } from './letters'
import type { DivisionDraw, ScheduleDocument } from './scheduleFile'

/**
 * A division's draw: which team holds which letter (FR-039 to FR-042b). The draw never changes the
 * schedule. Late teams get letters that put them in as few prelim quizzes as possible, preferring
 * the letters whose quizzes start latest; everyone else is random (FR-041, W-2).
 */
export function drawDivision(
  doc: ScheduleDocument,
  divisionId: string,
  random: () => number = Math.random,
): DivisionDraw {
  const division = doc.settings.divisions.find((d) => d.id === divisionId)
  const teams = structuredClone(doc.draw[divisionId]?.teams ?? [])
  if (!division) return { teams, stale: false }
  while (teams.length < division.teams) teams.push({ late: false, absent: false })
  teams.length = division.teams

  const letters = Array.from({ length: division.teams }, (_, i) => letterOf(i))
  const order = new Map(
    doc.frame.flatMap((r) => (r.kind === 'slot' ? [r.id] : [])).map((id, i) => [id, i]),
  )
  const prelims = doc.quizzes.filter((q) => q.division === divisionId && q.phase === 'prelim')
  const quizzesOf = (letter: string) =>
    prelims.filter((q) => q.seats.some((s) => s.kind === 'letter' && s.letter === letter))
  const start = (letter: string) =>
    Math.min(
      ...quizzesOf(letter).map((q) => (q.cell ? (order.get(q.cell.slot) ?? Infinity) : Infinity)),
    )

  const lateTeams = teams.map((t, i) => (t.late ? i : -1)).filter((i) => i >= 0)
  const chosen: string[] = []
  while (chosen.length < lateTeams.length) {
    // The next late letter: the fewest quizzes it adds to the late teams', then the latest start
    const theirs = new Set(chosen.flatMap(quizzesOf))
    const next = letters
      .filter((l) => !chosen.includes(l))
      .map((l) => ({
        l,
        added: quizzesOf(l).filter((q) => !theirs.has(q)).length,
        start: start(l),
        r: random(),
      }))
      .sort((a, b) => a.added - b.added || b.start - a.start || a.r - b.r)[0]!
    chosen.push(next.l)
  }
  const shuffle = <T>(xs: T[]) =>
    xs
      .map((x) => [random(), x] as const)
      .sort((a, b) => a[0] - b[0])
      .map(([, x]) => x)
  const lateOrder = shuffle(lateTeams)
  lateOrder.forEach((team, k) => (teams[team]!.letter = chosen[k]))
  const rest = shuffle(letters.filter((l) => !chosen.includes(l)))
  teams.forEach((t, i) => {
    if (!lateTeams.includes(i)) t.letter = rest.shift()
  })
  return { teams, stale: false }
}

/** A division's draw cleared: its seats show letters again (FR-040) */
export function clearDraw(draw: DivisionDraw): DivisionDraw {
  return {
    teams: draw.teams.map(({ letter: _letter, ...t }) => t),
    stale: false,
  }
}
