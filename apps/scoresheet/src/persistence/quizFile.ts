import { Value } from '@sinclair/typebox/value'
import {
  QuizFileSchema,
  FILE_VERSION,
  BonusRule,
  PlacementFormula,
  QuestionCategory,
  CellValue,
  QuizFormat,
} from '@qzr/shared'
import type { QuizFile } from '@qzr/shared'
import { buildKeyToIdx, buildColumns } from '../types/scoresheet'
import { quizRules } from '../scoring/quizRules'
import type { Quiz, Team, Quizzer, Answer, Timeout } from '../types/scoresheet'
import { toQuizzerId } from '../types/indices'
import type { QuizStore } from '../stores/quizStore'

export { QuizFileSchema, FILE_VERSION }

/**
 * The version needed to read a quiz of this format (contracts: "version needed to read").
 * 20-question files stay version 2 so installs from before quiz formats can still open them.
 */
export function fileVersionFor(format: QuizFormat): 2 | 3 {
  return format === QuizFormat.TwentyQuestion ? 2 : 3
}

export type { QuizFile } from '@qzr/shared'

// ---- Serialize ----

export interface SerializeInput {
  quiz: Quiz
  teams: Team[]
  quizzers: Quizzer[]
  answers: Answer[]
  noJumps: Map<string, boolean>
  timeouts: Map<number, Timeout[]>
}

export function serialize(input: SerializeInput): QuizFile {
  const { quiz, teams, quizzers, answers, noJumps, timeouts } = input
  const sortedTeams = [...teams].sort((a, b) => a.seatOrder - b.seatOrder)

  return {
    version: fileVersionFor(quiz.format),
    quiz: {
      division: quiz.division,
      quizNumber: quiz.quizNumber,
      overtime: quiz.overtime,
      consolation: quiz.consolation,
      placementFormula: quiz.placementFormula,
      bonusRule: quiz.bonusRule,
      // 20-question files leave the format out so older installs read them unchanged
      ...(quiz.format !== QuizFormat.TwentyQuestion ? { format: quiz.format } : {}),
      questionTypes: [...quiz.questionTypes.entries()],
    },
    teams: sortedTeams.map((team) => {
      const teamTimeouts = timeouts.get(team.id) ?? []
      return {
        id: team.id,
        name: team.name,
        onTime: team.onTime,
        seatOrder: team.seatOrder,
        quizzers: quizzers
          .filter((q) => q.teamId === team.id)
          .sort((a, b) => a.seatOrder - b.seatOrder)
          .map((q) => ({ id: q.id, name: q.name, seatOrder: q.seatOrder })),
        ...(teamTimeouts.length > 0 ? { timeouts: teamTimeouts } : {}),
      }
    }),
    answers: answers.filter((a) => a.value !== CellValue.Empty),
    noJumps: [...noJumps.entries()].filter(([, v]) => v).map(([k]) => k),
  }
}

// ---- Deserialize ----

export interface DeserializeResult {
  quiz: Omit<Quiz, 'id'>
  teams: Omit<Team, 'quizId'>[]
  quizzers: Quizzer[]
  answers: Answer[]
  noJumps: Map<string, boolean>
  timeouts: Map<number, Timeout[]>
}

/** The format a file records: none before version 3 (20-question), required from version 3 */
function fileFormat(file: QuizFile): QuizFormat {
  if (file.version < 3) {
    // Our writers never produce this; reading it as 20-question could score it by the wrong rules
    if (file.quiz.format !== undefined) {
      throw new Error(`A version ${file.version} quiz file can't record a quiz format`)
    }
    return QuizFormat.TwentyQuestion
  }
  if (file.quiz.format === undefined) throw new Error('This quiz file is missing its quiz format')
  return file.quiz.format
}

export function deserialize(file: QuizFile): DeserializeResult {
  const format = fileFormat(file)
  // Column keys mean different things per format (16A is overtime in a 15-question quiz)
  const allCols = buildColumns(quizRules(format), 20) // generous upper bound for OT
  const validKeys = buildKeyToIdx(allCols)

  const answers: Answer[] = file.answers
    .filter((a) => validKeys.has(a.columnKey) && a.value !== CellValue.Empty)
    .map((a) => ({
      quizzerId: toQuizzerId(a.quizzerId),
      columnKey: a.columnKey,
      value: a.value,
    }))

  const noJumps = new Map<string, boolean>()
  for (const key of file.noJumps) {
    if (validKeys.has(key)) noJumps.set(key, true)
  }

  const questionTypes = new Map<string, QuestionCategory>()
  for (const [key, cat] of file.quiz.questionTypes) {
    if (validKeys.has(key)) questionTypes.set(key, cat)
  }

  const teams: Omit<Team, 'quizId'>[] = []
  const quizzers: Quizzer[] = []
  const timeouts = new Map<number, Timeout[]>()

  for (const t of file.teams) {
    teams.push({ id: t.id, name: t.name, onTime: t.onTime, seatOrder: t.seatOrder })
    if (t.timeouts && t.timeouts.length > 0) {
      timeouts.set(t.id, t.timeouts)
    }
    for (const q of t.quizzers) {
      quizzers.push({
        id: toQuizzerId(q.id),
        teamId: t.id,
        name: q.name,
        seatOrder: q.seatOrder,
      })
    }
  }

  return {
    quiz: {
      division: file.quiz.division,
      quizNumber: file.quiz.quizNumber,
      overtime: file.quiz.overtime,
      consolation: file.quiz.consolation ?? false,
      placementFormula: file.quiz.placementFormula ?? PlacementFormula.Rules,
      bonusRule: file.quiz.bonusRule ?? BonusRule.Seat,
      format,
      questionTypes,
    },
    teams,
    quizzers,
    answers,
    noJumps,
    timeouts,
  }
}

// ---- Parse ----

/** The schema's error for a bad enum value doesn't say which value, so name it here */
function assertKnownFormat(raw: unknown): void {
  const format = (raw as { quiz?: { format?: unknown } } | null)?.quiz?.format
  if (format !== undefined && !Object.values<unknown>(QuizFormat).includes(format)) {
    throw new Error(`Unknown quiz format "${String(format)}"`)
  }
}

/** Parse and validate a JSON string, returning a DeserializeResult or throwing on invalid input */
export function parseQuizFile(json: string): DeserializeResult {
  const raw: unknown = JSON.parse(json)
  assertKnownFormat(raw)
  return deserialize(Value.Parse(QuizFileSchema, raw))
}

/** Serialize store state to a JSON string */
export function serializeStore(
  store: QuizStore,
  noJumps: Map<string, boolean>,
  timeouts: Map<number, Timeout[]>,
): string {
  return JSON.stringify(
    serialize({
      quiz: store.quiz,
      teams: store.teams,
      quizzers: store.quizzers,
      answers: store.answers,
      noJumps,
      timeouts,
    }),
    null,
    2,
  )
}
