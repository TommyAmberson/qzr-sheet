export enum Answer {
  Correct = 'c',
  Error = 'e',
  Foul = 'f',
  Bonus = 'b',
  MissedBonus = 'mb',
  Empty = '',
}

export enum QuestionType = {
    Normal = '',
    A = 'A',
    B = 'B',
}

export interface Question {
    number: number;
    type: QuestionType;
}

export interface QuizzerRow {
  seat: number;
  name: string;
  results: Map<Question, Answer>;
}

export interface TeamBlock {
  teamName: string
  onTime: boolean
  timeouts: number[]
  quizzers: QuizzerRow[]
}

export interface QuizMeta {
  division: number
  quizNumber: number
  overtime: boolean
}
