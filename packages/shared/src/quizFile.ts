import { Type, type Static } from '@sinclair/typebox'

// ---- Enums ----

export enum PlacementFormula {
  Rules = 'rules',
  Legacy = 'legacy',
}

export enum BonusRule {
  /** Any quizzer on the bonus team can answer */
  Team = 'team',
  /** Only the quizzer in the seat matching the last error can answer */
  Seat = 'seat',
}

export enum CellValue {
  Correct = 'c',
  Error = 'e',
  Foul = 'f',
  Bonus = 'b',
  MissedBonus = 'mb',
  Empty = '',
}

export enum QuestionCategory {
  INT = 'INT',
  FTV = 'FTV',
  REF = 'REF',
  MA = 'MA',
  Q = 'Q',
  SIT = 'SIT',
}

export const FILE_VERSION = 2

// ---- Schema ----

export const QuizFileSchema = Type.Object({
  version: Type.Union([Type.Literal(1), Type.Literal(2)]),
  quiz: Type.Object({
    division: Type.String(),
    quizNumber: Type.String(),
    overtime: Type.Boolean(),
    consolation: Type.Optional(Type.Boolean()),
    placementFormula: Type.Enum(PlacementFormula),
    bonusRule: Type.Optional(Type.Enum(BonusRule)),
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
      timeouts: Type.Optional(
        Type.Array(
          Type.Object({
            afterColumnKey: Type.Union([Type.String(), Type.Null()]),
          }),
        ),
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

export type QuizFile = Static<typeof QuizFileSchema>
