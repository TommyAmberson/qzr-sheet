import { describe, it, expect } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { readOds } from '../readOds'
import { CellValue } from '../../types/scoresheet'

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Build a sparse Quiz sheet XML from a map of { row: { col: value } }. */
function makeSheetXml(cells: Map<number, Map<number, string>>): string {
  const maxRow = Math.max(...cells.keys(), 30)
  const rows: string[] = []

  for (let r = 0; r <= maxRow; r++) {
    const rowCells = cells.get(r)
    if (!rowCells) {
      rows.push(
        '<table:table-row><table:table-cell table:number-columns-repeated="30"/></table:table-row>',
      )
      continue
    }

    const maxCol = Math.max(...rowCells.keys(), 0)
    let rowXml = '<table:table-row>'
    let col = 0
    while (col <= maxCol) {
      const val = rowCells.get(col)
      if (val !== undefined) {
        rowXml += `<table:table-cell office:value-type="string"><text:p>${val}</text:p></table:table-cell>`
        col++
      } else {
        let empty = 0
        while (col + empty <= maxCol && !rowCells.has(col + empty)) empty++
        rowXml += `<table:table-cell table:number-columns-repeated="${empty}"/>`
        col += empty
      }
    }
    rowXml += '</table:table-row>'
    rows.push(rowXml)
  }

  return `<table:table table:name="Quiz">${rows.join('')}</table:table>`
}

/** Wrap a sheet XML in a minimal content.xml and zip it into ODS bytes. */
function makeOds(sheetXml: string): Uint8Array {
  const contentXml =
    `<?xml version="1.0"?><office:document-content><office:body><office:spreadsheet>` +
    sheetXml +
    `</office:spreadsheet></office:body></office:document-content>`
  return zipSync({
    mimetype: strToU8('application/vnd.oasis.opendocument.spreadsheet'),
    'content.xml': strToU8(contentXml),
  })
}

/** Convenience: set a single cell in a sparse cells map. */
function setCell(
  cells: Map<number, Map<number, string>>,
  row: number,
  col: number,
  value: string,
): void {
  if (!cells.has(row)) cells.set(row, new Map())
  cells.get(row)!.set(col, value)
}

/**
 * Build a minimal cells map with the three teams populated so readOds can
 * complete without throwing. Team/quizzer names default to empty strings
 * (readCell returns '' for missing cells, which is fine).
 */
function minimalCells(): Map<number, Map<number, string>> {
  return new Map()
}

// ---------------------------------------------------------------------------
// ID assignment constants (derived from readOds nextId sequence)
// ---------------------------------------------------------------------------
// ti=0: teamId=1, quizzerIds 2-6
// ti=1: teamId=7, quizzerIds 8-12
// ti=2: teamId=13, quizzerIds 14-18
const T1_Q1 = 2 // team 1, quizzer slot 0 (row 5)
const T1_Q2 = 3 // team 1, quizzer slot 1 (row 6)
const T1_Q3 = 4 // team 1, quizzer slot 2 (row 7)

// TEAM_BLOCKS[0]: nameRow=4, onTimeRow=3, quizzerStart=5
const T1_QUIZZER_ROW = 5 // row 5 = first quizzer of team 1
const T1_QUIZZER_ROW2 = 6
const T1_QUIZZER_ROW3 = 7

// Column helpers
const Q_COL = (q: number) => 3 + (q - 1) // Q1=3, Q15=17, Q16=18 … Q20=22
const OT_COL = (q: number) => 23 + (q - 21) // Q21=23 … Q26=28

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

describe('readOds — metadata', () => {
  it('reads division and quizNumber from row 2', () => {
    const cells = minimalCells()
    setCell(cells, 2, 2, 'EAST')
    setCell(cells, 2, 4, '7')
    const { quiz } = readOds(makeOds(makeSheetXml(cells)))
    expect(quiz.division).toBe('EAST')
    expect(quiz.quizNumber).toBe('7')
  })

  it('defaults overtime to false when flag is absent', () => {
    const { quiz } = readOds(makeOds(makeSheetXml(minimalCells())))
    expect(quiz.overtime).toBe(false)
  })

  it('sets overtime true when row 29 col 2 is "y"', () => {
    const cells = minimalCells()
    setCell(cells, 29, 2, 'y')
    const { quiz } = readOds(makeOds(makeSheetXml(cells)))
    expect(quiz.overtime).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// noJumps
// ---------------------------------------------------------------------------

describe('readOds — noJumps', () => {
  it('records column keys where row 27 is "x"', () => {
    const cells = minimalCells()
    setCell(cells, 27, Q_COL(1), 'x') // Q1
    setCell(cells, 27, Q_COL(5), 'X') // Q5 — case-insensitive
    const { noJumps } = readOds(makeOds(makeSheetXml(cells)))
    expect(noJumps).toContain('1')
    expect(noJumps).toContain('5')
  })

  it('includes OT questions in noJumps', () => {
    const cells = minimalCells()
    setCell(cells, 27, OT_COL(21), 'x')
    const { noJumps } = readOds(makeOds(makeSheetXml(cells)))
    expect(noJumps).toContain('21')
  })

  it('returns empty array when no no-jump cells are set', () => {
    const { noJumps } = readOds(makeOds(makeSheetXml(minimalCells())))
    expect(noJumps).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Question types
// ---------------------------------------------------------------------------

describe('readOds — questionTypes', () => {
  it('reads normal Q1–Q15 categories from row 28', () => {
    const cells = minimalCells()
    setCell(cells, 28, Q_COL(1), 'INT')
    setCell(cells, 28, Q_COL(10), 'FTV')
    const { quiz } = readOds(makeOds(makeSheetXml(cells)))
    expect(quiz.questionTypes).toContainEqual(['1', 'INT'])
    expect(quiz.questionTypes).toContainEqual(['10', 'FTV'])
  })

  it('reads Q16–Q20 normal/A/B types from rows 28/29/30', () => {
    const cells = minimalCells()
    setCell(cells, 28, Q_COL(16), 'FTV') // Q16 normal
    setCell(cells, 29, Q_COL(16), 'INT') // Q16A
    setCell(cells, 30, Q_COL(16), 'REF') // Q16B
    const { quiz } = readOds(makeOds(makeSheetXml(cells)))
    expect(quiz.questionTypes).toContainEqual(['16', 'FTV'])
    expect(quiz.questionTypes).toContainEqual(['16A', 'INT'])
    expect(quiz.questionTypes).toContainEqual(['16B', 'REF'])
  })

  it('ignores invalid category values', () => {
    const cells = minimalCells()
    setCell(cells, 28, Q_COL(3), 'INVALID')
    const { quiz } = readOds(makeOds(makeSheetXml(cells)))
    const keys = quiz.questionTypes.map(([k]) => k)
    expect(keys).not.toContain('3')
  })

  it('reads OT question types from row 28', () => {
    const cells = minimalCells()
    setCell(cells, 28, OT_COL(21), 'MA')
    const { quiz } = readOds(makeOds(makeSheetXml(cells)))
    expect(quiz.questionTypes).toContainEqual(['21', 'MA'])
  })
})

// ---------------------------------------------------------------------------
// Q1–Q15 answers — always map to base key
// ---------------------------------------------------------------------------

describe('readOds — Q1–Q15 answers', () => {
  it('maps a correct answer to the base column key', () => {
    const cells = minimalCells()
    setCell(cells, T1_QUIZZER_ROW, Q_COL(1), 'c')
    const { answers } = readOds(makeOds(makeSheetXml(cells)))
    expect(answers).toContainEqual({ quizzerId: T1_Q1, columnKey: '1', value: CellValue.Correct })
  })

  it('maps an error to the base column key (no A/B for Q1–Q15)', () => {
    const cells = minimalCells()
    setCell(cells, T1_QUIZZER_ROW, Q_COL(3), 'e')
    setCell(cells, T1_QUIZZER_ROW2, Q_COL(3), 'c')
    const { answers } = readOds(makeOds(makeSheetXml(cells)))
    expect(answers).toContainEqual({ quizzerId: T1_Q1, columnKey: '3', value: CellValue.Error })
    expect(answers).toContainEqual({ quizzerId: T1_Q2, columnKey: '3', value: CellValue.Correct })
  })

  it('ignores unrecognised cell values', () => {
    const cells = minimalCells()
    setCell(cells, T1_QUIZZER_ROW, Q_COL(2), 'x')
    const { answers } = readOds(makeOds(makeSheetXml(cells)))
    expect(answers.filter((a) => a.columnKey === '2')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Q16+ answers — distributeABAnswers with footer-row depth
// ---------------------------------------------------------------------------

describe('readOds — Q16+ A/B distribution via footer rows', () => {
  it('depth 0 (no footer types): all answers go to base key', () => {
    const cells = minimalCells()
    // No entries in rows 29/30 for Q16 col
    setCell(cells, T1_QUIZZER_ROW, Q_COL(16), 'c')
    const { answers } = readOds(makeOds(makeSheetXml(cells)))
    expect(answers).toContainEqual({ quizzerId: T1_Q1, columnKey: '16', value: CellValue.Correct })
  })

  it('depth 1 (A type in row 29): error → base key, correct → A key', () => {
    const cells = minimalCells()
    setCell(cells, 29, Q_COL(16), 'INT') // marks depth=1
    setCell(cells, T1_QUIZZER_ROW, Q_COL(16), 'e') // quizzer 1 errors
    setCell(cells, T1_QUIZZER_ROW2, Q_COL(16), 'c') // quizzer 2 answers A
    const { answers } = readOds(makeOds(makeSheetXml(cells)))
    expect(answers).toContainEqual({ quizzerId: T1_Q1, columnKey: '16', value: CellValue.Error })
    expect(answers).toContainEqual({ quizzerId: T1_Q2, columnKey: '16A', value: CellValue.Correct })
  })

  it('depth 2 (B type in row 30): two errors distributed, correct → B key', () => {
    const cells = minimalCells()
    setCell(cells, 30, Q_COL(16), 'INT') // marks depth=2
    setCell(cells, T1_QUIZZER_ROW, Q_COL(16), 'e') // first error → base
    setCell(cells, T1_QUIZZER_ROW2, Q_COL(16), 'e') // second error → A
    setCell(cells, T1_QUIZZER_ROW3, Q_COL(16), 'c') // correct → B
    const { answers } = readOds(makeOds(makeSheetXml(cells)))
    expect(answers).toContainEqual({ quizzerId: T1_Q1, columnKey: '16', value: CellValue.Error })
    expect(answers).toContainEqual({ quizzerId: T1_Q2, columnKey: '16A', value: CellValue.Error })
    expect(answers).toContainEqual({ quizzerId: T1_Q3, columnKey: '16B', value: CellValue.Correct })
  })

  it('depth 1: multiple non-errors all go to A key', () => {
    const cells = minimalCells()
    setCell(cells, 29, Q_COL(17), 'FTV') // Q17, depth=1
    setCell(cells, T1_QUIZZER_ROW, Q_COL(17), 'e')
    setCell(cells, T1_QUIZZER_ROW2, Q_COL(17), 'c')
    setCell(cells, T1_QUIZZER_ROW3, Q_COL(17), 'b')
    const { answers } = readOds(makeOds(makeSheetXml(cells)))
    expect(answers).toContainEqual({ quizzerId: T1_Q1, columnKey: '17', value: CellValue.Error })
    expect(answers).toContainEqual({ quizzerId: T1_Q2, columnKey: '17A', value: CellValue.Correct })
    expect(answers).toContainEqual({ quizzerId: T1_Q3, columnKey: '17A', value: CellValue.Bonus })
  })
})

// ---------------------------------------------------------------------------
// Q16+ answers — inferABDepth (footer rows absent)
// ---------------------------------------------------------------------------

describe('readOds — Q16+ A/B depth inference when footer is empty', () => {
  it('0 errors → depth 0: correct answer stays on base key', () => {
    const cells = minimalCells()
    setCell(cells, T1_QUIZZER_ROW, Q_COL(18), 'c')
    const { answers } = readOds(makeOds(makeSheetXml(cells)))
    expect(answers).toContainEqual({ quizzerId: T1_Q1, columnKey: '18', value: CellValue.Correct })
  })

  it('1 error → depth 1: error on base key, correct on A key', () => {
    const cells = minimalCells()
    setCell(cells, T1_QUIZZER_ROW, Q_COL(18), 'e')
    setCell(cells, T1_QUIZZER_ROW2, Q_COL(18), 'c')
    const { answers } = readOds(makeOds(makeSheetXml(cells)))
    expect(answers).toContainEqual({ quizzerId: T1_Q1, columnKey: '18', value: CellValue.Error })
    expect(answers).toContainEqual({ quizzerId: T1_Q2, columnKey: '18A', value: CellValue.Correct })
  })

  it('2 errors → depth 2: errors on base/A, correct on B key', () => {
    const cells = minimalCells()
    setCell(cells, T1_QUIZZER_ROW, Q_COL(19), 'e')
    setCell(cells, T1_QUIZZER_ROW2, Q_COL(19), 'e')
    setCell(cells, T1_QUIZZER_ROW3, Q_COL(19), 'c')
    const { answers } = readOds(makeOds(makeSheetXml(cells)))
    expect(answers).toContainEqual({ quizzerId: T1_Q1, columnKey: '19', value: CellValue.Error })
    expect(answers).toContainEqual({ quizzerId: T1_Q2, columnKey: '19A', value: CellValue.Error })
    expect(answers).toContainEqual({ quizzerId: T1_Q3, columnKey: '19B', value: CellValue.Correct })
  })

  it('3+ errors → depth capped at 2: third error goes to A key', () => {
    // inferABDepth caps at 2 even with 3 errors
    const cells = minimalCells()
    setCell(cells, T1_QUIZZER_ROW, Q_COL(20), 'e') // → base
    setCell(cells, T1_QUIZZER_ROW2, Q_COL(20), 'e') // → A (depth-1 cap)
    setCell(cells, T1_QUIZZER_ROW3, Q_COL(20), 'e') // → A (depth-1 cap, 3rd error)
    const { answers } = readOds(makeOds(makeSheetXml(cells)))
    expect(answers).toContainEqual({ quizzerId: T1_Q1, columnKey: '20', value: CellValue.Error })
    expect(answers).toContainEqual({ quizzerId: T1_Q2, columnKey: '20A', value: CellValue.Error })
    expect(answers).toContainEqual({ quizzerId: T1_Q3, columnKey: '20A', value: CellValue.Error })
  })
})

// ---------------------------------------------------------------------------
// OT answers
// ---------------------------------------------------------------------------

describe('readOds — OT answers', () => {
  it('maps OT correct answers to numeric column keys', () => {
    const cells = minimalCells()
    setCell(cells, T1_QUIZZER_ROW, OT_COL(21), 'c')
    const { answers } = readOds(makeOds(makeSheetXml(cells)))
    expect(answers).toContainEqual({ quizzerId: T1_Q1, columnKey: '21', value: CellValue.Correct })
  })
})
