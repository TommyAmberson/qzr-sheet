import Type from 'typebox'
import Value from 'typebox/value'
import {
  PlacementFormula,
  QuestionCategory,
  CellValue,
  buildKeyToIdx,
  buildColumns,
} from '../types/scoresheet'
import type { Quiz, Team, Quizzer, Answer } from '../types/scoresheet'
import type { QuizStore } from '../stores/quizStore'

export const FILE_VERSION = 1

// ---- Schema ----

const QuizFileSchema = Type.Object({
  version: Type.Literal(FILE_VERSION),
  quiz: Type.Object({
    division: Type.String(),
    quizNumber: Type.String(),
    overtime: Type.Boolean(),
    placementFormula: Type.Enum(PlacementFormula),
    /** Map serialized as an array of [columnKey, category] pairs */
    questionTypes: Type.Array(Type.Tuple([Type.String(), Type.Enum(QuestionCategory)])),
  }),
  teams: Type.Array(
    Type.Object({
      id: Type.Number(),
      name: Type.String(),
      onTime: Type.Boolean(),
      seatOrder: Type.Number(),
      quizzers: Type.Array(
        Type.Object({
          id: Type.Number(),
          name: Type.String(),
          seatOrder: Type.Number(),
        }),
      ),
    }),
  ),
  /** Only non-empty answers are stored */
  answers: Type.Array(
    Type.Object({
      quizzerId: Type.Number(),
      columnKey: Type.String(),
      value: Type.Enum(CellValue),
    }),
  ),
  /** Column keys where no-jump is set */
  noJumps: Type.Array(Type.String()),
})

export type QuizFile = Type.Static<typeof QuizFileSchema>

// ---- Serialize ----

export interface SerializeInput {
  quiz: Quiz
  teams: Team[]
  quizzers: Quizzer[]
  answers: Answer[]
  noJumps: Map<string, boolean>
}

export function serialize(input: SerializeInput): QuizFile {
  const { quiz, teams, quizzers, answers, noJumps } = input
  const sortedTeams = [...teams].sort((a, b) => a.seatOrder - b.seatOrder)

  return {
    version: FILE_VERSION,
    quiz: {
      division: quiz.division,
      quizNumber: quiz.quizNumber,
      overtime: quiz.overtime,
      placementFormula: quiz.placementFormula,
      questionTypes: [...quiz.questionTypes.entries()],
    },
    teams: sortedTeams.map((team) => ({
      id: team.id,
      name: team.name,
      onTime: team.onTime,
      seatOrder: team.seatOrder,
      quizzers: quizzers
        .filter((q) => q.teamId === team.id)
        .sort((a, b) => a.seatOrder - b.seatOrder)
        .map((q) => ({ id: q.id, name: q.name, seatOrder: q.seatOrder })),
    })),
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
}

export function deserialize(file: QuizFile): DeserializeResult {
  const allCols = buildColumns(20) // generous upper bound for OT
  const validKeys = buildKeyToIdx(allCols)

  const answers: Answer[] = file.answers.filter(
    (a) => validKeys.has(a.columnKey) && a.value !== CellValue.Empty,
  )

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

  for (const t of file.teams) {
    teams.push({ id: t.id, name: t.name, onTime: t.onTime, seatOrder: t.seatOrder })
    for (const q of t.quizzers) {
      quizzers.push({ id: q.id, teamId: t.id, name: q.name, seatOrder: q.seatOrder })
    }
  }

  return {
    quiz: {
      division: file.quiz.division,
      quizNumber: file.quiz.quizNumber,
      overtime: file.quiz.overtime,
      placementFormula: file.quiz.placementFormula ?? PlacementFormula.Rules,
      questionTypes,
    },
    teams,
    quizzers,
    answers,
    noJumps,
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
export function serializeStore(store: QuizStore, noJumps: Map<string, boolean>): string {
  return JSON.stringify(
    serialize({
      quiz: store.quiz,
      teams: store.teams,
      quizzers: store.quizzers,
      answers: store.answers,
      noJumps,
    }),
    null,
    2,
  )
}

/** The raw TypeBox schema — can be embedded in an OpenAPI spec later */
export { QuizFileSchema }
