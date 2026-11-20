import {
  drawnTeam,
  foldName,
  benchKey,
  type DayQuiz,
  type DayTeam,
  type ScheduleDocument,
  type ScheduleQuiz,
  type SettledBench,
} from '@qzr/shared'

/**
 * What the meet day adds to a published schedule (specs/010-meet-day, FR-009 to FR-011): each
 * scheduled quiz's status and result, and each bench's settled team. The builder passes none.
 */
export interface ScheduleMarks {
  /** By schedule quiz id */
  quizzes: Map<string, DayQuiz>
  /** Settled benches by `benchKey` */
  benches: Record<string, SettledBench>
}

/** A quiz's benches as marked: each bench's team and its result, and results no bench holds */
export interface MarkedQuiz {
  benches: { settled?: SettledBench; result?: DayTeam }[]
  /** Teams of the result the quiz's benches don't name, listed under it */
  unplaced: DayTeam[]
}

/**
 * Each bench's settled team and the result line of the team on it, matched by folded name: the
 * settled team, or for a drawn letter the draw's team as the sheet shows it
 */
export function markQuiz(
  doc: ScheduleDocument,
  quiz: ScheduleQuiz,
  marks: ScheduleMarks,
): MarkedQuiz {
  const result = marks.quizzes.get(quiz.id)?.teams ?? []
  const left = [...result]
  const benches = quiz.seats.map((bench, index) => {
    const settled = marks.benches[benchKey(quiz.id, index)]
    const name =
      settled && 'team' in settled
        ? settled.team
        : bench.kind === 'letter'
          ? drawnTeam(doc, quiz, bench)?.name
          : undefined
    const at = name === undefined ? -1 : left.findIndex((t) => foldName(t.name) === foldName(name))
    const team = at < 0 ? undefined : left.splice(at, 1)[0]
    return { settled, result: team }
  })
  return { benches, unplaced: left }
}

/** A place as a schedule reader says it */
export function placeText(place: number): string {
  return place === 1 ? '1st' : place === 2 ? '2nd' : place === 3 ? '3rd' : `${place}th`
}
