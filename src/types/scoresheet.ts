export enum AnswerValue {
  Correct = 'c',
  Error = 'e',
  Foul = 'f',
  Bonus = 'b',
  MissedBonus = 'mb',
  Empty = '',
}

export enum QuestionType {
    Normal = '',
    A = 'A',
    B = 'B',
}

export interface Question {
    number: number;
    type: QuestionType;
}

export interface Answer {
    quizzerId: number;
    questionId: string;
    value: AnswerValue;
}

export interface Quizzer {
  id: number;
  name: string;
  teamId: number;
}

export interface Team {
  id: number;
  name: string
  onTime: boolean
  timeouts: number[]
}

export interface QuizMeta {
  division: number
  quizNumber: number
  overtime: boolean
}
