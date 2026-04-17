import {
  BonusRule,
  CellValue,
  PlacementFormula,
  QuestionCategory,
  QUIZZERS_PER_TEAM,
  type Column,
  type Quiz,
  type Team,
  type Quizzer,
  type Answer,
} from '../types/scoresheet'
import { type QuizzerId, type SeatIdx, toQuizzerId } from '../types/indices'

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
    consolation: false,
    placementFormula: PlacementFormula.Rules,
    bonusRule: BonusRule.Seat,
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

    for (let q = 0; q < QUIZZERS_PER_TEAM; q++) {
      quizzers.push({
        id: toQuizzerId(genId()),
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
  teamForQuizzer(quizzerId: QuizzerId): number | undefined

  /** Get a single answer value (Empty if not set) */
  getAnswer(quizzerId: QuizzerId, columnKey: string): CellValue

  /** Set an answer value (Empty removes the answer) */
  setAnswer(quizzerId: QuizzerId, columnKey: string, value: CellValue): void

  /** Update a team's name */
  setTeamName(teamId: number, name: string): void

  /** Update a quizzer's name */
  setQuizzerName(quizzerId: QuizzerId, name: string): void

  /** Swap two seats within a team. Answers follow the quizzer (keyed by QuizzerId), not the seat. */
  moveQuizzer(teamId: number, fromSeat: SeatIdx, toSeat: SeatIdx): void

  /**
   * Return true if the quizzer has a blank name. A seat with a blank-named
   * quizzer is displayed as an "empty seat" in the scoresheet, but the
   * quizzer record still exists in storage (with answers, etc.).
   */
  isQuizzerUnnamed(quizzerId: QuizzerId): boolean

  /** Set the question category for a column (null clears it) */
  setQuestionType(columnKey: string, category: QuestionCategory | null): void

  /**
   * Derive the positional cell grid for scoring functions.
   * Returns cells[teamIdx][seatIdx][colIdx] — the second index is SEAT ORDER,
   * so after a substitution the answers follow the quizzer to their new seat.
   */
  cellGrid(columns: Column[]): CellValue[][][]

  /** Replace all store state from a deserialized file */
  loadState(state: {
    quiz: Omit<Quiz, 'id'>
    teams: Omit<Team, 'quizId'>[]
    quizzers: Quizzer[]
    answers: Answer[]
  }): void
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

  function teamForQuizzer(quizzerId: QuizzerId): number | undefined {
    return quizzers.find((q) => q.id === quizzerId)?.teamId
  }

  function answerKey(quizzerId: QuizzerId, columnKey: string): string {
    return `${quizzerId}:${columnKey}`
  }

  function getAnswer(quizzerId: QuizzerId, columnKey: string): CellValue {
    return answerMap.get(answerKey(quizzerId, columnKey))?.value ?? CellValue.Empty
  }

  function setAnswer(quizzerId: QuizzerId, columnKey: string, value: CellValue): void {
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

  function setQuizzerName(quizzerId: QuizzerId, name: string): void {
    const qzr = quizzers.find((q) => q.id === quizzerId)
    if (qzr) qzr.name = name
  }

  function isQuizzerUnnamed(quizzerId: QuizzerId): boolean {
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

  function moveQuizzer(teamId: number, fromSeat: SeatIdx, toSeat: SeatIdx): void {
    if (fromSeat === toSeat) return
    const sorted = quizzersByTeam(teamId)
    if (fromSeat < 0 || fromSeat >= sorted.length) return
    if (toSeat < 0 || toSeat >= sorted.length) return // Swap the two quizzers
    ;[sorted[fromSeat]!, sorted[toSeat]!] = [sorted[toSeat]!, sorted[fromSeat]!]

    // Reassign seatOrder to match new array order
    for (let seatIdx = 0; seatIdx < sorted.length; seatIdx++) {
      sorted[seatIdx]!.seatOrder = seatIdx
    }
  }

  function cellGrid(columns: Column[]): CellValue[][][] {
    const sortedTeams = [...teams].sort((a, b) => a.seatOrder - b.seatOrder)

    return sortedTeams.map((team) => {
      const teamQuizzers = quizzersByTeam(team.id)
      return teamQuizzers.map((qzr) => columns.map((col) => getAnswer(qzr.id, col.key)))
    })
  }

  function loadState(state: {
    quiz: Omit<Quiz, 'id'>
    teams: Omit<Team, 'quizId'>[]
    quizzers: Quizzer[]
    answers: Answer[]
  }): void {
    quiz.division = state.quiz.division
    quiz.quizNumber = state.quiz.quizNumber
    quiz.overtime = state.quiz.overtime
    quiz.consolation = state.quiz.consolation
    quiz.placementFormula = state.quiz.placementFormula
    quiz.questionTypes.clear()
    for (const [k, v] of state.quiz.questionTypes) quiz.questionTypes.set(k, v)

    teams.length = 0
    for (const t of state.teams) teams.push({ ...t, quizId: quiz.id })

    quizzers.length = 0
    for (const q of state.quizzers) quizzers.push(q)

    answerMap.clear()
    for (const a of state.answers) {
      if (a.value !== CellValue.Empty) {
        answerMap.set(answerKey(a.quizzerId, a.columnKey), a)
      }
    }
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
    isQuizzerUnnamed,
    setQuestionType,
    loadState,
    cellGrid,
    get answers() {
      return [...answerMap.values()]
    },
  }

  return store
}
