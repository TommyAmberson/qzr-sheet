import { Value } from '@sinclair/typebox/value'
import {
  QuizFileSchema,
  FILE_VERSION,
  PlacementFormula,
  QuestionCategory,
  CellValue,
} from '@qzr/shared'
import type { QuizFile } from '@qzr/shared'
import { buildKeyToIdx, buildColumns } from '../types/scoresheet'
import type { Quiz, Team, Quizzer, Answer, Timeout } from '../types/scoresheet'
import { toQuizzerId } from '../types/indices'
import type { QuizStore } from '../stores/quizStore'

export { QuizFileSchema, FILE_VERSION }
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
    version: FILE_VERSION,
    quiz: {
      division: quiz.division,
      quizNumber: quiz.quizNumber,
      overtime: quiz.overtime,
      consolation: quiz.consolation,
      placementFormula: quiz.placementFormula,
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

export function deserialize(file: QuizFile): DeserializeResult {
  const allCols = buildColumns(20) // generous upper bound for OT
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

/** Parse and validate a JSON string, returning a DeserializeResult or throwing on invalid input */
export function parseQuizFile(json: string): DeserializeResult {
  const raw: unknown = JSON.parse(json)
  const parsed = Value.Parse(QuizFileSchema, raw)
  return deserialize(parsed)
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
