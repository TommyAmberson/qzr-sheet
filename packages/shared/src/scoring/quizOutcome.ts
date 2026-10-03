import type { QuizFormat } from '../quizFile'
import type { DeserializeResult } from '../quizFileCodec'
import { buildColumns, type PlaceKey, type Quizzer } from '../types/scoresheet'
import { assessQuiz } from './assessQuiz'
import { answerLookup, buildCellGrid, inSeatOrder, type AnswerLookup } from './cellGrid'
import { computeOvertimeRounds } from './overtime'
import { quizRules } from './quizRules'
import { scoreTeam } from './scoreTeam'

/** "teamIdx:seatIdx" keys of seats whose quizzer has no name; answers there are invalid */
export function emptySeatKeys(seatedQuizzers: Pick<Quizzer, 'name'>[][]): Set<string> {
  const keys = new Set<string>()
  seatedQuizzers.forEach((quizzers, teamIdx) =>
    quizzers.forEach((q, seatIdx) => {
      if (!q.name.trim()) keys.add(`${teamIdx}:${seatIdx}`)
    }),
  )
  return keys
}

/**
 * The overtime rounds a loaded quiz's answers reach, so its columns can hold them: at least one
 * when overtime is on, none otherwise.
 */
export function overtimeRoundsNeeded(
  quiz: { overtime: boolean; format: QuizFormat },
  teams: DeserializeResult['teams'],
  quizzers: DeserializeResult['quizzers'],
  answerAt: AnswerLookup,
  noJumps: Map<string, boolean>,
): number {
  if (!quiz.overtime) return 0
  const rules = quizRules(quiz.format)
  const cols = buildColumns(rules, 20) // generous upper bound for OT
  return Math.max(
    1,
    computeOvertimeRounds(
      buildCellGrid(teams, quizzers, cols, answerAt),
      cols,
      inSeatOrder(teams, quizzers).map(({ team }) => team.onTime),
      cols.map((c) => noJumps.get(c.key) ?? false),
      rules,
    ),
  )
}

export interface TeamOutcome {
  name: string
  score: number
  place: PlaceKey | null
  placementPoints: number | null
  /** Every error the team made, whether or not it cost points; fouls aren't errors */
  errors: number
}

export interface QuizOutcome {
  /** False when the quiz can't be placed: questions unanswered, or validation errors */
  placed: boolean
  /** In seat order */
  teams: TeamOutcome[]
}

/** A stored quiz's result, scored and placed exactly as the scoresheet shows it */
export function quizOutcome(content: DeserializeResult): QuizOutcome {
  const { quiz, teams, quizzers, answers, noJumps, timeouts } = content
  const rules = quizRules(quiz.format)
  const answerAt = answerLookup(answers)
  const columns = buildColumns(
    rules,
    overtimeRoundsNeeded(quiz, teams, quizzers, answerAt, noJumps),
  )
  const seated = inSeatOrder(teams, quizzers)
  const cells = buildCellGrid(teams, quizzers, columns, answerAt)
  const onTimes = seated.map(({ team }) => team.onTime)

  const assessment = assessQuiz({
    cells,
    columns,
    rules,
    noJumps: columns.map((c) => noJumps.get(c.key) ?? false),
    onTimes,
    overtime: quiz.overtime,
    bonusRule: quiz.bonusRule,
    placementFormula: quiz.placementFormula,
    emptySeats: emptySeatKeys(seated.map((s) => s.quizzers)),
    timeouts: seated.map(({ team }) => timeouts.get(team.id) ?? []),
  })

  return {
    placed: assessment.placements.every((p) => p !== null),
    teams: seated.map(({ team }, teamIdx) => {
      const scoring = scoreTeam(cells[teamIdx]!, columns, team.onTime, rules)
      return {
        name: team.name,
        score: scoring.total,
        place: assessment.placements[teamIdx] ?? null,
        placementPoints: assessment.placementPoints[teamIdx] ?? null,
        errors: scoring.teamErrorCount,
      }
    }),
  }
}
