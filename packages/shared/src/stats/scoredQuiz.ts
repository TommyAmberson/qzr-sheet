import { CellValue, type QuizFile } from '../quizFile'
import { deserialize } from '../quizFileCodec'
import { quizName } from '../results'
import {
  computeOtCheckpointScores,
  computeRegulationScores,
  incompleteQuestions,
} from '../scoring/overtime'
import { computePlacements } from '../scoring/placement'
import { assessStoredQuiz } from '../scoring/quizOutcome'
import type { QuizzerFigures } from '../scoring/quizzerStandings'
import { ValidationCode } from '../scoring/validation'
import type { PlaceKey } from '../types/scoresheet'

export interface ScoredTeam {
  name: string
  score: number
  /** What placement points are worked out from: the score before any overtime (rules §1.e.4) */
  regulationScore: number
  /** Every error the team made, whether or not it cost points; fouls aren't errors */
  errors: number
  /**
   * The team's place by score, overtime deciding a tie where it was played. Given whatever the
   * quiz's errors, since a quiz accepted as scored is placed by it; null only while teams are still
   * level in an unfinished overtime, which is itself a problem of the quiz.
   */
  place: PlaceKey | null
  /** The quizzers named on the sheet, in seat order */
  quizzers: QuizzerFigures[]
}

/** What is wrong with a quiz that the quiz alone shows */
export type ScoringProblem =
  | {
      kind: 'validation'
      team: string
      /** Null for an error that belongs to the team as a whole */
      quizzer: string | null
      question: string | null
      code: ValidationCode
    }
  | { kind: 'unanswered'; questions: string[] }
  /** Teams are still level in an overtime that has not been played out, so they have no place */
  | { kind: 'undecided' }

/**
 * What scoring makes of one stored quiz. It depends on nothing but the quiz file, so it can be kept
 * beside a stored revision: no placement points, no stage and no ranking, which a meet's settings
 * and later decisions change.
 */
export interface ScoredQuiz {
  /** The quiz's name, as officials know it: "D1 Q3" */
  name: string
  /** Whether it is a quiz of the division's consolation bracket */
  consolation: boolean
  /** In seat order */
  teams: ScoredTeam[]
  /**
   * Whether any overtime question was played: anything marked in an overtime column. Overtime
   * switched on but never played leaves the result as it would have been without it.
   */
  overtimePlayed: boolean
  /** Empty for a quiz that can be placed */
  problems: ScoringProblem[]
}

export function scoreStoredQuiz(file: QuizFile): ScoredQuiz {
  const content = deserialize(file)
  const { quiz } = content
  const { rules, columns, seated, cells, onTimes, noJumpColumns, assessment, scorings } =
    assessStoredQuiz(content)

  const regulationScores = computeRegulationScores(cells, columns, onTimes, rules)
  const places = computePlacements(
    regulationScores,
    computeOtCheckpointScores(cells, columns, onTimes, noJumpColumns, rules),
    true,
    assessment.visibleOtRounds > 0,
  )

  const teams = seated.map(({ team, quizzers }, teamIdx): ScoredTeam => {
    const scoring = scorings[teamIdx]!
    return {
      name: team.name,
      score: scoring.total,
      regulationScore: regulationScores[teamIdx]!,
      errors: scoring.teamErrorCount,
      place: places[teamIdx] ?? null,
      quizzers: quizzers.flatMap((quizzer, seatIdx) => {
        if (!quizzer.name.trim()) return []
        const figures = scoring.quizzers[seatIdx]!
        const types: Record<string, number> = {}
        cells[teamIdx]![seatIdx]!.forEach((cell, colIdx) => {
          const column = columns[colIdx]!
          const type = quiz.questionTypes.get(column.key)
          if (cell !== CellValue.Correct || column.isOvertime || !type) return
          types[type] = (types[type] ?? 0) + 1
        })
        return [
          {
            name: quizzer.name,
            points: figures.points,
            errors: figures.errorCount,
            correct: figures.correctCount,
            types,
          },
        ]
      }),
    }
  })

  const problems: ScoringProblem[] = []
  const invalid = (
    teamIdx: number,
    seatIdx: number | null,
    colIdx: number | null,
    code: ValidationCode,
  ) =>
    problems.push({
      kind: 'validation',
      team: seated[teamIdx]!.team.name,
      quizzer: seatIdx === null ? null : (seated[teamIdx]!.quizzers[seatIdx]?.name ?? null),
      question: colIdx === null ? null : columns[colIdx]!.key,
      code,
    })
  for (const [colIdx, seats] of [...assessment.validationErrors].sort(([a], [b]) => a - b)) {
    for (const [seat, codes] of seats) {
      const [teamIdx, seatIdx] = seat.split(':').map(Number) as [number, number]
      for (const code of codes) invalid(teamIdx, seatIdx, colIdx, code)
    }
  }
  for (const [teamIdx, columnIdxs] of assessment.timeoutErrorsByTeam) {
    for (const colIdx of columnIdxs) {
      invalid(teamIdx, null, colIdx, ValidationCode.TimeoutAfterErrorPoints)
    }
  }
  for (const teamIdx of assessment.tooManyTimeoutsTeams) {
    invalid(teamIdx, null, null, ValidationCode.TooManyTimeouts)
  }
  const unanswered = incompleteQuestions(
    cells,
    columns,
    noJumpColumns,
    1,
    rules.regulationQuestions,
  )
  if (unanswered.length > 0) {
    problems.push({ kind: 'unanswered', questions: unanswered.map(String) })
  } else if (places.some((place) => place === null)) {
    problems.push({ kind: 'undecided' })
  }

  return {
    name: quizName(quiz),
    consolation: quiz.consolation ?? false,
    teams,
    overtimePlayed: columns.some(
      (column, colIdx) =>
        column.isOvertime &&
        cells.some((seats) => seats.some((seat) => seat[colIdx] !== CellValue.Empty)),
    ),
    problems,
  }
}
