import { describe, it, expect } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { fillOts } from '../fillOts'
import { readOds } from '../readOds'
import { deserialize } from '../../quizFileCodec'
import { quizOutcome } from '../../scoring/quizOutcome'
import { fifteenQuestionQuizFile } from '../../scoring/__tests__/fixtures/fifteenQuestionQuiz'
import { referenceMeet } from '../../scoring/__tests__/fixtures/referenceMeet'

/** A template whose Quiz sheet has every cell the scoresheet fills, all empty */
function blankTemplate(): Uint8Array {
  const row = `<table:table-row>${'<table:table-cell/>'.repeat(32)}</table:table-row>`
  const content =
    '<?xml version="1.0"?><office:document-content><office:body><office:spreadsheet>' +
    `<table:table table:name="Quiz">${row.repeat(34)}</table:table>` +
    '<table:table table:name="Calculations"></table:table>' +
    '</office:spreadsheet></office:body></office:document-content>'
  return zipSync({
    mimetype: [strToU8('application/vnd.oasis.opendocument.spreadsheet-template'), { level: 0 }],
    'content.xml': strToU8(content),
  })
}

describe('fillOts', () => {
  it('refuses a 15-question quiz, which the template cannot score', () => {
    expect(() => fillOts(new Uint8Array(), fifteenQuestionQuizFile())).toThrow(
      /20-question quizzes only/,
    )
  })

  describe('a round trip through a sheet', () => {
    const template = blankTemplate()

    // D2cQE's sheet marks a bonus to an empty chair "mb", which the reader now reads as a no-jump;
    // its fixture was read before that, so it has the mark
    const EMPTY_CHAIR_BONUS = 'D2cQE'
    const quizzes = referenceMeet.quizzes.filter((q) => q.sheet !== EMPTY_CHAIR_BONUS)

    it.each(quizzes.map((q) => [q.sheet, q.file] as const))(
      'gives %s back with the same marks, scores and places',
      (_sheet, file) => {
        const back = readOds(fillOts(template, file))
        expect(back.answers).toEqual(file.answers)
        expect(back.noJumps.toSorted()).toEqual(file.noJumps.toSorted())
        expect(quizOutcome(deserialize(back))).toEqual(quizOutcome(deserialize(file)))
      },
    )

    it('gives a bonus to an empty chair back as a no-jump', () => {
      const file = referenceMeet.quizzes.find((q) => q.sheet === EMPTY_CHAIR_BONUS)!.file
      const back = readOds(fillOts(template, file))
      expect(back.answers.some((a) => a.columnKey === '19B')).toBe(false)
      expect(back.noJumps).toContain('19B')
    })

    it('reads a filled sheet the same way twice, so sending it again changes nothing', () => {
      for (const { file } of referenceMeet.quizzes) {
        const sheet = fillOts(template, file)
        expect(JSON.stringify(readOds(sheet))).toBe(JSON.stringify(readOds(sheet)))
      }
    })
  })
})
