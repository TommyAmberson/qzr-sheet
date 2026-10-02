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

/** Quiz format: how many regulation questions, and the rules that follow from that */
export enum QuizFormat {
  TwentyQuestion = '20-question',
  /** Three-team practice-meet quiz; see docs/scoring-rules-explained.md */
  FifteenQuestion = '15-question',
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

/**
 * Newest file version this build reads and writes. A file is stamped with the version needed to
 * read it, not this one: 20-question quizzes stay version 2 so older installs can open them, and
 * 15-question quizzes are version 3 so older installs refuse them instead of misscoring them.
 */
export const FILE_VERSION = 3

// ---- Schema ----

export const QuizFileSchema = Type.Object({
  version: Type.Union([Type.Literal(1), Type.Literal(2), Type.Literal(3)]),
  quiz: Type.Object({
    division: Type.String(),
    quizNumber: Type.String(),
    overtime: Type.Boolean(),
    consolation: Type.Optional(Type.Boolean()),
    placementFormula: Type.Enum(PlacementFormula),
    bonusRule: Type.Optional(Type.Enum(BonusRule)),
    /** Absent means 20-question; required from version 3 */
    format: Type.Optional(Type.Enum(QuizFormat)),
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
