import { describe, it, expect } from 'vitest'
import {
  serialize,
  deserialize,
  parseQuizFile,
  parseQuizFileAttempt,
  NewerFileVersionError,
  fileVersionFor,
  FILE_VERSION,
  type QuizFile,
} from '@qzr/shared'
import { serializeStore } from '../quizFile'
import { createQuizStore } from '../../stores/quizStore'
import { CellValue, PlacementFormula, QuestionCategory, QuizFormat } from '@qzr/shared'

function makeFile(overrides: Partial<QuizFile> = {}): QuizFile {
  return {
    version: 2,
    quiz: {
      division: '1',
      quizNumber: '3',
      overtime: false,
      placementFormula: PlacementFormula.Rules,
      questionTypes: [],
    },
    teams: [
      {
        id: 10,
        name: 'Red',
        onTime: true,
        seatOrder: 0,
        quizzers: [{ id: 100, name: 'Alice', seatOrder: 0 }],
      },
    ],
    answers: [{ quizzerId: 100, columnKey: '1', value: CellValue.Correct }],
    noJumps: [],
    ...overrides,
  }
}

describe('serialize / deserialize round-trip', () => {
  it('preserves quiz metadata', () => {
    const store = createQuizStore()
    store.quiz.division = '2'
    store.quiz.quizNumber = '5'
    store.quiz.overtime = true
    store.quiz.placementFormula = PlacementFormula.Legacy

    const file = JSON.parse(serializeStore(store, new Map(), new Map())) as QuizFile

    const result = deserialize(file)
    expect(result.quiz.division).toBe('2')
    expect(result.quiz.quizNumber).toBe('5')
    expect(result.quiz.overtime).toBe(true)
    expect(result.quiz.placementFormula).toBe(PlacementFormula.Legacy)
  })

  it('preserves team names and onTime', () => {
    const store = createQuizStore()
    store.setTeamName(store.teams[0]!.id, 'Blazers')
    store.teams[0]!.onTime = false

    const file = JSON.parse(serializeStore(store, new Map(), new Map())) as QuizFile
    const result = deserialize(file)

    expect(result.teams[0]!.name).toBe('Blazers')
    expect(result.teams[0]!.onTime).toBe(false)
  })

  it('preserves quizzer names and seat order', () => {
    const store = createQuizStore()
    const team = store.teams[0]!
    const quizzers = store.quizzersByTeam(team.id)
    store.setQuizzerName(quizzers[0]!.id, 'Jordan')
    store.setQuizzerName(quizzers[1]!.id, 'Sam')

    const file = JSON.parse(serializeStore(store, new Map(), new Map())) as QuizFile
    const result = deserialize(file)

    const q = result.quizzers
      .filter((q) => q.teamId === team.id)
      .sort((a, b) => a.seatOrder - b.seatOrder)
    expect(q[0]!.name).toBe('Jordan')
    expect(q[1]!.name).toBe('Sam')
  })

  it('preserves non-empty answers only', () => {
    const store = createQuizStore()
    const team = store.teams[0]!
    const quizzer = store.quizzersByTeam(team.id)[0]!
    store.setAnswer(quizzer.id, '1', CellValue.Correct)
    store.setAnswer(quizzer.id, '2', CellValue.Empty) // should not appear

    const file = JSON.parse(serializeStore(store, new Map(), new Map())) as QuizFile
    expect(file.answers).toHaveLength(1)
    expect(file.answers[0]).toMatchObject({ columnKey: '1', value: CellValue.Correct })

    const result = deserialize(file)
    expect(result.answers).toHaveLength(1)
    expect(result.answers[0]!.columnKey).toBe('1')
  })

  it('preserves noJumps', () => {
    const noJumps = new Map([
      ['3', true],
      ['5', true],
      ['4', false],
    ])
    const store = createQuizStore()

    const file = JSON.parse(serializeStore(store, noJumps, new Map())) as QuizFile
    expect(file.noJumps).toEqual(expect.arrayContaining(['3', '5']))
    expect(file.noJumps).not.toContain('4')

    const result = deserialize(file)
    expect(result.noJumps.get('3')).toBe(true)
    expect(result.noJumps.get('5')).toBe(true)
    expect(result.noJumps.has('4')).toBe(false)
  })

  it('preserves questionTypes', () => {
    const store = createQuizStore()
    store.setQuestionType('1', QuestionCategory.INT)
    store.setQuestionType('16A', QuestionCategory.FTV)

    const file = JSON.parse(serializeStore(store, new Map(), new Map())) as QuizFile
    const result = deserialize(file)

    expect(result.quiz.questionTypes.get('1')).toBe(QuestionCategory.INT)
    expect(result.quiz.questionTypes.get('16A')).toBe(QuestionCategory.FTV)
  })
})

describe('deserialize — unknown/invalid data is silently dropped', () => {
  it('drops answers with unknown column keys', () => {
    const file = makeFile({
      answers: [
        { quizzerId: 100, columnKey: '99', value: CellValue.Correct },
        { quizzerId: 100, columnKey: '1', value: CellValue.Correct },
      ],
    })
    const result = deserialize(file)
    expect(result.answers).toHaveLength(1)
    expect(result.answers[0]!.columnKey).toBe('1')
  })

  it('drops noJump entries with unknown column keys', () => {
    const file = makeFile({ noJumps: ['99', '1'] })
    const result = deserialize(file)
    expect(result.noJumps.has('99')).toBe(false)
    expect(result.noJumps.get('1')).toBe(true)
  })

  it('drops questionType entries with unknown column keys', () => {
    const file = makeFile({
      quiz: { ...makeFile().quiz, questionTypes: [['99', QuestionCategory.INT]] },
    })
    const result = deserialize(file)
    expect(result.quiz.questionTypes.size).toBe(0)
  })
})

describe('file version (version needed to read)', () => {
  it('stamps 20-question quizzes as version 2 and 15-question ones as version 3', () => {
    expect(fileVersionFor(QuizFormat.TwentyQuestion)).toBe(2)
    expect(fileVersionFor(QuizFormat.FifteenQuestion)).toBe(3)
  })

  it('serializes a default quiz as version 2 with no format, readable by older installs', () => {
    const file = JSON.parse(serializeStore(createQuizStore(), new Map(), new Map())) as QuizFile
    expect(file.version).toBe(2)
    expect(file.quiz).not.toHaveProperty('format')
  })
})

describe('parseQuizFile — validation', () => {
  it('parses a valid JSON string', () => {
    const store = createQuizStore()
    const json = serializeStore(store, new Map(), new Map())
    const result = parseQuizFile(json)
    expect(result.teams).toHaveLength(3)
  })

  it('throws on invalid JSON', () => {
    expect(() => parseQuizFile('not json')).toThrow()
  })

  it('throws when version field is missing', () => {
    expect(() =>
      parseQuizFile(JSON.stringify({ quiz: {}, teams: [], answers: [], noJumps: [] })),
    ).toThrow()
  })

  it('throws when version is wrong', () => {
    const store = createQuizStore()
    const file = JSON.parse(serializeStore(store, new Map(), new Map())) as QuizFile
    expect(() => parseQuizFile(JSON.stringify({ ...file, version: 99 }))).toThrow()
  })

  it('throws on missing teams array', () => {
    const store = createQuizStore()
    const { teams: _, ...rest } = JSON.parse(
      serializeStore(store, new Map(), new Map()),
    ) as QuizFile
    expect(() => parseQuizFile(JSON.stringify(rest))).toThrow()
  })

  it('throws on invalid CellValue in answers', () => {
    const store = createQuizStore()
    const file = JSON.parse(serializeStore(store, new Map(), new Map())) as QuizFile
    const bad = { ...file, answers: [{ quizzerId: 1, columnKey: '1', value: 'x' }] }
    expect(() => parseQuizFile(JSON.stringify(bad))).toThrow()
  })
})

describe('quiz format in quiz files', () => {
  function fifteenStore() {
    const store = createQuizStore()
    store.quiz.format = QuizFormat.FifteenQuestion
    return store
  }

  it('saves a 15-question quiz as version 3 with its format', () => {
    const file = JSON.parse(serializeStore(fifteenStore(), new Map(), new Map())) as QuizFile
    expect(file.version).toBe(3)
    expect(file.quiz.format).toBe(QuizFormat.FifteenQuestion)
  })

  it('round-trips every quiz field, format included', () => {
    const store = fifteenStore()
    store.quiz.division = '4'
    store.quiz.overtime = true
    store.quiz.consolation = true
    store.quiz.placementFormula = PlacementFormula.Legacy
    const { id: _, ...expected } = store.quiz
    const result = parseQuizFile(serializeStore(store, new Map(), new Map()))
    expect(result.quiz).toEqual(expected)
  })

  it('loads version 1 and 2 files as 20-question quizzes', () => {
    for (const version of [1, 2] as const) {
      expect(deserialize(makeFile({ version })).quiz.format).toBe(QuizFormat.TwentyQuestion)
    }
  })

  it('rejects a version 1 or 2 file that names a format, rather than guess its rules', () => {
    for (const version of [1, 2] as const) {
      const file = makeFile({ version })
      file.quiz.format = QuizFormat.FifteenQuestion
      expect(() => deserialize(file)).toThrow(/format/)
    }
  })

  it('rejects a version 3 file without a format', () => {
    expect(() => parseQuizFile(JSON.stringify(makeFile({ version: 3 })))).toThrow(/format/)
  })

  it('rejects an unknown format, naming it', () => {
    const file = makeFile({ version: 3 })
    const json = JSON.stringify({ ...file, quiz: { ...file.quiz, format: 'nonsense' } })
    expect(() => parseQuizFile(json)).toThrow(/nonsense/)
  })

  it('reads column keys under the format the file records', () => {
    // 13A exists only in a 15-question quiz, and 16A is its first overtime round
    const answers = ['13A', '16A'].map((columnKey) => ({
      quizzerId: 100,
      columnKey,
      value: CellValue.Correct,
    }))
    const fifteen = makeFile({ version: 3, answers })
    fifteen.quiz.format = QuizFormat.FifteenQuestion
    expect(deserialize(fifteen).answers.map((a) => a.columnKey)).toEqual(['13A', '16A'])
    expect(deserialize(makeFile({ answers })).answers.map((a) => a.columnKey)).toEqual(['16A'])
  })
})

describe('files from a newer scoresheet', () => {
  const newer = () => ({
    ...makeFile(),
    version: FILE_VERSION + 1,
    futureField: 'from a later release',
  })

  it('parseQuizFile refuses them with a NewerFileVersionError', () => {
    expect(() => parseQuizFile(JSON.stringify(newer()))).toThrow(NewerFileVersionError)
  })

  it('parseQuizFileAttempt opens them, dropping what it does not know', () => {
    const result = parseQuizFileAttempt(JSON.stringify(newer()))
    expect(result.quiz.division).toBe('1')
    expect(result.answers).toHaveLength(1)
    expect(result).not.toHaveProperty('futureField')
  })

  it('parseQuizFileAttempt opens one that records the 20-question format explicitly', () => {
    const file = newer()
    const json = JSON.stringify({
      ...file,
      quiz: { ...file.quiz, format: QuizFormat.TwentyQuestion },
    })
    expect(parseQuizFileAttempt(json).quiz.format).toBe(QuizFormat.TwentyQuestion)
  })

  it('parseQuizFileAttempt still rejects an unknown format, naming it', () => {
    const file = newer()
    const json = JSON.stringify({ ...file, quiz: { ...file.quiz, format: 'two-team' } })
    expect(() => parseQuizFileAttempt(json)).toThrow(/two-team/)
  })
})
