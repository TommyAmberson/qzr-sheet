import type { TeamOutcome } from '../scoring/quizOutcome'
import { placeRank, placeTieCount } from '../scoring/placement'
import { divisionStandings, type CountedQuiz, type TieBreakOrder } from '../scoring/standings'
import type { DivisionDraw, ScheduleDocument, ScheduleQuiz, Seat } from './scheduleFile'

/**
 * Which team sits on a schedule's benches, from where each bench's team comes from (its def) and what
 * has since been settled: confirmed orders and quizzes that count. The schedule itself keeps only
 * the defs (docs/scheduling.md, "Def vs resolution layering"), so a withdrawn order or a quiz that
 * stops counting unsettles its benches again with nothing to undo. The schedule calls a quiz's
 * benches its `seats` (docs/architecture.md, "Terms").
 */

/** A team of a confirmed order, at the rank it holds */
export interface OrderedTeam {
  name: string
  rank: number
  /** Level with another team the order couldn't separate, which the admin settles away from the app */
  tied: boolean
}

/**
 * A team of a quiz that counts: its place, how many share it, the placement points it took, and
 * the score and errors a round robin's tie-breakers read
 */
export interface PlacedTeam extends TeamOutcome {
  placementPoints: number
}

export interface BenchSources {
  /** By the schedule's division id: the confirmed prelim order and re-rank, best first */
  orders: Map<string, { prelims?: OrderedTeam[]; rerank?: OrderedTeam[] }>
  /** By schedule quiz id: the teams of each quiz that counts */
  placed: Map<string, PlacedTeam[]>
  /** How the meet breaks ties in its prelim standings, which a round robin is ranked by too */
  tieBreaks: TieBreakOrder
  /** A meet team's name by its id, for a drawn team of a schedule linked to the meet */
  teamName?: (teamId: number) => string | undefined
  /**
   * The meet team a name of the results is, matched against the division's roster as stored
   * quizzes' names are; undefined for a name not on it
   */
  teamIdOf?: (name: string) => number | undefined
}

/** A settled bench: its team, or teams level across it that the admin has yet to settle */
export type SettledBench =
  /** `teamId`, the meet team's, where the draw or the division's roster names one */
  { team: string; teamId?: number } | { tied: true }

/** How a bench is keyed, by its quiz and its place in the quiz's benches */
export function benchKey(quizId: string, index: number): string {
  return `${quizId}:${index}`
}

/** A letter bench's team in the division's draw */
export function drawnTeam(
  doc: ScheduleDocument,
  quiz: ScheduleQuiz,
  bench: Seat,
): DivisionDraw['teams'][number] | undefined {
  if (bench.kind !== 'letter') return undefined
  return doc.draw[quiz.division]?.teams.find((t) => t.letter === bench.letter)
}

/**
 * Every bench of a division's quizzes whose team is settled, by `benchKey`; the rest are left out. A
 * division's benches come only from its own orders and quizzes, so each is resolved on its own.
 */
export function resolveBenches(
  doc: ScheduleDocument,
  /** The schedule's id of the division */
  division: string,
  sources: BenchSources,
): Map<string, SettledBench> {
  const settled = new Map<string, SettledBench>()
  for (const quiz of doc.quizzes) {
    if (quiz.division !== division) continue
    quiz.seats.forEach((bench, index) => {
      const team = benchTeam(doc, quiz, bench, sources)
      if (!team) return
      // A team the results name is the meet's by the division's roster, so a reader needn't guess
      const teamId = 'team' in team ? (team.teamId ?? sources.teamIdOf?.(team.team)) : undefined
      settled.set(benchKey(quiz.id, index), teamId === undefined ? team : { ...team, teamId })
    })
  }
  return settled
}

function benchTeam(
  doc: ScheduleDocument,
  quiz: ScheduleQuiz,
  bench: Seat,
  sources: BenchSources,
): SettledBench | undefined {
  switch (bench.kind) {
    case 'letter': {
      // As the roster spells the team now, where the draw names a team of the meet's; a team marked
      // absent sits on no bench
      const drawn = drawnTeam(doc, quiz, bench)
      if (drawn?.absent) return undefined
      const name =
        (drawn?.teamId !== undefined ? sources.teamName?.(drawn.teamId) : undefined) ?? drawn?.name
      return name
        ? { team: name, ...(drawn?.teamId !== undefined ? { teamId: drawn.teamId } : {}) }
        : undefined
    }
    case 'rank':
    case 'new': {
      // A position in the confirmed order, even among teams it still marks tied: three tie-breakers
      // leave next to none, and the app has no way yet to record how the admin settled one
      const orders = sources.orders.get(quiz.division)
      const row = (bench.kind === 'rank' ? orders?.prelims : orders?.rerank)?.[bench.rank - 1]
      return row && { team: row.name }
    }
    case 'place':
      return inPlace(sources.placed.get(bench.quiz), bench.place)
    case 'points':
      return inPoints(doc, quiz, bench.place, sources)
    case 'empty':
      return undefined
  }
}

/** The team in place `place` of a quiz that counts; teams sharing it leave the bench tied */
function inPlace(teams: PlacedTeam[] | undefined, place: number): SettledBench | undefined {
  if (!teams) return undefined
  const covering = teams.filter(
    (t) =>
      t.place !== null &&
      placeRank(t.place) <= place &&
      place < placeRank(t.place) + placeTieCount(t.place),
  )
  if (covering.length === 0) return undefined
  if (covering.length > 1 || placeTieCount(covering[0]!.place!) > 1) return { tied: true }
  return { team: covering[0]!.name }
}

/**
 * The team in place `place` of the round robin of the holding quiz's lane, once every quiz of it
 * counts, ranked as the prelims are: by placement points, ties broken the meet's way. Teams still
 * level after them still go by their place in the standings, as in a confirmed order.
 */
function inPoints(
  doc: ScheduleDocument,
  holder: ScheduleQuiz,
  place: number,
  sources: BenchSources,
): SettledBench | undefined {
  // Only a lane the settings make a round robin has one to rank
  const lane = doc.settings.divisions.find((d) => d.id === holder.division)?.elims.lanes[
    holder.lane ?? -1
  ]
  if (lane?.format !== 'roundRobin') return undefined
  const laneQuizzes = doc.quizzes.filter(
    (q) => q.division === holder.division && q.phase === 'elim' && q.lane === holder.lane,
  )
  const inLane = new Set(laneQuizzes.map((q) => q.id))
  const robin = laneQuizzes.filter(
    (q) =>
      !q.deciding &&
      q.id !== holder.id &&
      // A quiz seated from the round robin's points, or from a place in this lane, comes after
      // it; a place in a play-in before the lane is how some of the robin's teams arrive
      !q.seats.some((s) => s.kind === 'points' || (s.kind === 'place' && inLane.has(s.quiz))),
  )
  if (robin.length === 0) return undefined
  const quizzes: CountedQuiz[] = []
  for (const q of robin) {
    const teams = sources.placed.get(q.id)
    if (!teams) return undefined
    quizzes.push({ name: q.id, teams })
  }
  // A position in the standings, as a confirmed order's is taken
  const row = divisionStandings(quizzes, { finalists: false, tieBreaks: sources.tieBreaks }).teams[
    place - 1
  ]
  return row && { team: row.name }
}
