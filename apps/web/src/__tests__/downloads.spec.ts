// The archives are zipped by fflate, whose checks for its own byte arrays fail across jsdom's realm
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { CellValue, PlacementFormula, QuizFormat, type QuizFile } from '@qzr/shared'
import { quizArchive } from '../downloads'

function quiz(division: string, quizNumber: string, extra: Partial<QuizFile> = {}): QuizFile {
  return {
    version: 3,
    quiz: {
      division,
      quizNumber,
      overtime: false,
      placementFormula: PlacementFormula.Rules,
      format: QuizFormat.TwentyQuestion,
      questionTypes: [],
    },
    teams: [
      {
        id: 1,
        name: 'Calgary 1',
        onTime: true,
        seatOrder: 0,
        quizzers: [{ id: 11, name: 'Ann', seatOrder: 0 }],
      },
    ],
    answers: [{ quizzerId: 11, columnKey: '1', value: CellValue.Correct }],
    noJumps: [],
    ...extra,
  }
}

/** A template whose Quiz sheet has every cell the scoresheet fills */
function template(): Uint8Array {
  const row = `<table:table-row>${'<table:table-cell/>'.repeat(32)}</table:table-row>`
  const content = `<office:document-content><office:body><office:spreadsheet><table:table table:name="Quiz">${row.repeat(34)}</table:table></office:spreadsheet></office:body></office:document-content>`
  return zipSync({ 'content.xml': strToU8(content) })
}

const names = (zip: Uint8Array) => Object.keys(unzipSync(zip)).sort()

describe('quizArchive', () => {
  const stored = [
    quiz('1', '3'),
    quiz('1', '4'),
    quiz('2', '3'),
    quiz('2', 'A', { quiz: { ...quiz('2', 'A').quiz, consolation: true } }),
  ]

  it('holds one .json file per quiz, named as the scoresheet names its saves', () => {
    const { zip, notes } = quizArchive(stored, 'json')
    expect(names(zip!)).toEqual(['D1Q3.json', 'D1Q4.json', 'D2Q3.json', 'D2cQA.json'])
    expect(JSON.parse(strFromU8(unzipSync(zip!)['D1Q3.json']!))).toEqual(stored[0])
    expect(notes).toEqual([])
  })

  it('fills the template for each quiz as .ods', () => {
    const { zip } = quizArchive(stored, 'ods', template())
    expect(names(zip!)).toEqual(['D1Q3.ods', 'D1Q4.ods', 'D2Q3.ods', 'D2cQA.ods'])
  })

  it('keeps names unique when two quizzes would share one', () => {
    const { zip } = quizArchive([quiz('1', '3'), quiz('1 ', '3')], 'json')
    expect(names(zip!)).toEqual(['D1Q3 (2).json', 'D1Q3.json'])
  })

  it('leaves a 15-question quiz out of an .ods archive, and says so', () => {
    const fifteen = quiz('1', '5', {
      quiz: { ...quiz('1', '5').quiz, format: QuizFormat.FifteenQuestion },
    })
    const { zip, notes } = quizArchive([quiz('1', '3'), fifteen], 'ods', template())
    expect(names(zip!)).toEqual(['D1Q3.ods'])
    expect(notes).toEqual(['D1 Q5 left out: spreadsheets hold 20-question quizzes only'])
  })

  it('fills a quiz past Q26 as far as the sheet goes, and names what was left out', () => {
    const long = quiz('1', '6', {
      answers: [
        { quizzerId: 11, columnKey: '27', value: CellValue.Correct },
        { quizzerId: 11, columnKey: '28', value: CellValue.Error },
      ],
    })
    const { zip, notes } = quizArchive([long], 'ods', template())
    expect(names(zip!)).toEqual(['D1Q6.ods'])
    expect(notes).toEqual(['D1 Q6: questions 27, 28 are past the sheet and left out'])
  })

  it('builds nothing from no quizzes', () => {
    expect(quizArchive([], 'json').zip).toBeNull()
  })
})
