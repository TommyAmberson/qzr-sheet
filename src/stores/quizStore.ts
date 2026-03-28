import {
  CellValue,
  PlacementFormula,
  QuestionCategory,
  type Column,
  type Quiz,
  type Team,
  type Quizzer,
  type Answer,
} from '../types/scoresheet'

let nextId = 1
function genId(): number {
  return nextId++
}

function createDefaultQuiz(): Quiz {
  return {
    id: genId(),
    division: '1',
    quizNumber: '1',
    overtime: false,
    placementFormula: PlacementFormula.Rules,
    questionTypes: new Map(),
  }
}

function createDefaultTeams(quizId: number): { teams: Team[]; quizzers: Quizzer[] } {
  const teams: Team[] = []
  const quizzers: Quizzer[] = []

  for (let t = 0; t < 3; t++) {
    const teamId = genId()
    teams.push({
      id: teamId,
      quizId,
      name: `Team ${t + 1}`,
      onTime: true,
      seatOrder: t,
    })

    for (let q = 0; q < 5; q++) {
      quizzers.push({
        id: genId(),
        teamId,
        name: q < 4 ? `Quizzer ${q + 1}` : '',
        seatOrder: q,
      })
    }
  }

  return { teams, quizzers }
}

export interface QuizStore {
  quiz: Quiz
  teams: Team[]
  quizzers: Quizzer[]
  answers: Answer[]

  /** Get quizzers for a team, sorted by seatOrder */
  quizzersByTeam(teamId: number): Quizzer[]

  /** Get the teamId for a quizzer */
  teamForQuizzer(quizzerId: number): number | undefined

  /** Get a single answer value (Empty if not set) */
  getAnswer(quizzerId: number, columnKey: string): CellValue

  /** Set an answer value (Empty removes the answer) */
  setAnswer(quizzerId: number, columnKey: string, value: CellValue): void

  /** Update a team's name */
  setTeamName(teamId: number, name: string): void

  /** Update a quizzer's name */
  setQuizzerName(quizzerId: number, name: string): void

  /** Move a quizzer from one seat to another within a team (insert, not swap) */
  moveQuizzer(teamId: number, fromSeat: number, toSeat: number): void

  /** Check if a quizzer is an empty seat (blank/whitespace name) */
  isEmptySeat(quizzerId: number): boolean

  /** Set the question category for a column (null clears it) */
  setQuestionType(columnKey: string, category: QuestionCategory | null): void

  /**
   * Derive the positional cell grid for scoring functions.
   * Returns cells[teamIdx][quizzerIdx][colIdx] ordered by seatOrder.
   */
  cellGrid(columns: Column[]): CellValue[][][]
}

export function createQuizStore(): QuizStore {
  const quiz = createDefaultQuiz()
  const { teams, quizzers } = createDefaultTeams(quiz.id)

  // Answers stored in a Map keyed by "quizzerId:columnKey" for O(1) lookup
  const answerMap = new Map<string, Answer>()

  // Pre-build quizzer lookup by team
  function quizzersByTeam(teamId: number): Quizzer[] {
    return quizzers.filter((q) => q.teamId === teamId).sort((a, b) => a.seatOrder - b.seatOrder)
  }

  function teamForQuizzer(quizzerId: number): number | undefined {
    return quizzers.find((q) => q.id === quizzerId)?.teamId
  }

  function answerKey(quizzerId: number, columnKey: string): string {
    return `${quizzerId}:${columnKey}`
  }

  function getAnswer(quizzerId: number, columnKey: string): CellValue {
    return answerMap.get(answerKey(quizzerId, columnKey))?.value ?? CellValue.Empty
  }

  function setAnswer(quizzerId: number, columnKey: string, value: CellValue): void {
    const key = answerKey(quizzerId, columnKey)
    if (value === CellValue.Empty) {
      answerMap.delete(key)
    } else {
      answerMap.set(key, { quizzerId, columnKey, value })
    }
  }

  function setTeamName(teamId: number, name: string): void {
    const team = teams.find((t) => t.id === teamId)
    if (team) team.name = name
  }

  function setQuizzerName(quizzerId: number, name: string): void {
    const qzr = quizzers.find((q) => q.id === quizzerId)
    if (qzr) qzr.name = name
  }

  function isEmptySeat(quizzerId: number): boolean {
    const qzr = quizzers.find((q) => q.id === quizzerId)
    return qzr ? !qzr.name.trim() : false
  }

  function setQuestionType(columnKey: string, category: QuestionCategory | null): void {
    if (category === null) {
      quiz.questionTypes.delete(columnKey)
    } else {
      quiz.questionTypes.set(columnKey, category)
    }
  }

  function moveQuizzer(teamId: number, fromSeat: number, toSeat: number): void {
    if (fromSeat === toSeat) return
    const sorted = quizzersByTeam(teamId)
    if (fromSeat < 0 || fromSeat >= sorted.length) return
    if (toSeat < 0 || toSeat >= sorted.length) return

    // Remove from old position and insert at new position
    const [moved] = sorted.splice(fromSeat, 1)
    sorted.splice(toSeat, 0, moved!)

    // Reassign seatOrder to match new array order
    for (let i = 0; i < sorted.length; i++) {
      sorted[i]!.seatOrder = i
    }
  }

  function cellGrid(columns: Column[]): CellValue[][][] {
    const sortedTeams = [...teams].sort((a, b) => a.seatOrder - b.seatOrder)

    return sortedTeams.map((team) => {
      const teamQuizzers = quizzersByTeam(team.id)
      return teamQuizzers.map((qzr) => columns.map((col) => getAnswer(qzr.id, col.key)))
    })
  }

  const store: QuizStore = {
    quiz,
    teams,
    quizzers,
    quizzersByTeam,
    teamForQuizzer,
    getAnswer,
    setAnswer,
    setTeamName,
    setQuizzerName,
    moveQuizzer,
    isEmptySeat,
    setQuestionType,
    cellGrid,
    get answers() {
      return [...answerMap.values()]
    },
  }

  return store
}
