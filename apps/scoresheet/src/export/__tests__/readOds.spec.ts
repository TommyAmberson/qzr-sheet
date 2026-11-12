import { describe, it, expect } from 'vitest'
import { deflateRawSync } from 'node:zlib'
import { readOds } from '../readOds'
import { CellValue, deserialize, quizOutcome, QuizFormat } from '@qzr/shared'

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
  return buildZip([
    {
      name: 'mimetype',
      data: Buffer.from('application/vnd.oasis.opendocument.spreadsheet'),
      compress: false,
    },
    { name: 'content.xml', data: Buffer.from(contentXml), compress: true },
  ])
}

/**
 * Build a minimal ZIP archive from an array of entries.
 * Uses Node's deflateRawSync for compressed entries (method 8) and stores
 * uncompressed entries as-is (method 0). No data-descriptor flags.
 */
function buildZip(entries: { name: string; data: Buffer; compress: boolean }[]): Uint8Array {
  const parts: Buffer[] = []
  const centralDir: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name)
    const payload = entry.compress ? deflateRawSync(entry.data) : entry.data
    const method = entry.compress ? 8 : 0
    const crc = crc32(entry.data)

    // Local file header
    const local = Buffer.alloc(30 + nameBytes.length)
    local.writeUInt32LE(0x04034b50, 0) // signature
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0, 6) // flags
    local.writeUInt16LE(method, 8) // compression method
    local.writeUInt16LE(0, 10) // mod time
    local.writeUInt16LE(0, 12) // mod date
    local.writeUInt32LE(crc, 14) // CRC-32
    local.writeUInt32LE(payload.length, 18) // compressed size
    local.writeUInt32LE(entry.data.length, 22) // uncompressed size
    local.writeUInt16LE(nameBytes.length, 26) // file name length
    local.writeUInt16LE(0, 28) // extra field length
    nameBytes.copy(local, 30)

    // Central directory entry
    const central = Buffer.alloc(46 + nameBytes.length)
    central.writeUInt32LE(0x02014b50, 0) // signature
    central.writeUInt16LE(20, 4) // version made by
    central.writeUInt16LE(20, 6) // version needed
    central.writeUInt16LE(0, 8) // flags
    central.writeUInt16LE(method, 10) // compression method
    central.writeUInt16LE(0, 12) // mod time
    central.writeUInt16LE(0, 14) // mod date
    central.writeUInt32LE(crc, 16) // CRC-32
    central.writeUInt32LE(payload.length, 20) // compressed size
    central.writeUInt32LE(entry.data.length, 24) // uncompressed size
    central.writeUInt16LE(nameBytes.length, 28) // file name length
    central.writeUInt16LE(0, 30) // extra field length
    central.writeUInt16LE(0, 32) // file comment length
    central.writeUInt16LE(0, 34) // disk number start
    central.writeUInt16LE(0, 36) // internal attributes
    central.writeUInt32LE(0, 38) // external attributes
    central.writeUInt32LE(offset, 42) // local header offset
    nameBytes.copy(central, 46)

    parts.push(local, payload)
    centralDir.push(central)
    offset += local.length + payload.length
  }

  const cdBuf = Buffer.concat(centralDir)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0) // end-of-central-directory signature
  eocd.writeUInt16LE(0, 4) // disk number
  eocd.writeUInt16LE(0, 6) // disk with CD start
  eocd.writeUInt16LE(entries.length, 8) // entries on disk
  eocd.writeUInt16LE(entries.length, 10) // total entries
  eocd.writeUInt32LE(cdBuf.length, 12) // CD size
  eocd.writeUInt32LE(offset, 16) // CD offset
  eocd.writeUInt16LE(0, 20) // comment length

  return new Uint8Array(Buffer.concat([...parts, cdBuf, eocd]))
}

/** CRC-32 using the standard polynomial. */
function crc32(buf: Buffer): number {
  let crc = 0xffffffff
  for (const byte of buf) {
    crc ^= byte
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
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
// teamIdx=0: teamId=1, quizzerIds 2-6
// teamIdx=1: teamId=7, quizzerIds 8-12
// teamIdx=2: teamId=13, quizzerIds 14-18
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

describe('readOds — Q16+ A/B distribution with footer types', () => {
  it('no errors: all answers go to base key', () => {
    const cells = minimalCells()
    // No entries in rows 29/30 for Q16 col
    setCell(cells, T1_QUIZZER_ROW, Q_COL(16), 'c')
    const { answers } = readOds(makeOds(makeSheetXml(cells)))
    expect(answers).toContainEqual({ quizzerId: T1_Q1, columnKey: '16', value: CellValue.Correct })
  })

  it('one error (A type in row 29): error → base key, correct → A key', () => {
    const cells = minimalCells()
    setCell(cells, 29, Q_COL(16), 'INT') // marks depth=1
    setCell(cells, T1_QUIZZER_ROW, Q_COL(16), 'e') // quizzer 1 errors
    setCell(cells, T1_QUIZZER_ROW2, Q_COL(16), 'c') // quizzer 2 answers A
    const { answers } = readOds(makeOds(makeSheetXml(cells)))
    expect(answers).toContainEqual({ quizzerId: T1_Q1, columnKey: '16', value: CellValue.Error })
    expect(answers).toContainEqual({ quizzerId: T1_Q2, columnKey: '16A', value: CellValue.Correct })
  })

  it('two errors (B type in row 30): errors on base and A, correct → B key', () => {
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

  it('one error: multiple non-errors all go to A key', () => {
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
// Q16+ answers — footer rows absent
// ---------------------------------------------------------------------------

describe('readOds — Q16+ A/B distribution when footer is empty', () => {
  it('0 errors: correct answer stays on base key', () => {
    const cells = minimalCells()
    setCell(cells, T1_QUIZZER_ROW, Q_COL(18), 'c')
    const { answers } = readOds(makeOds(makeSheetXml(cells)))
    expect(answers).toContainEqual({ quizzerId: T1_Q1, columnKey: '18', value: CellValue.Correct })
  })

  it('1 error: error on base key, correct on A key', () => {
    const cells = minimalCells()
    setCell(cells, T1_QUIZZER_ROW, Q_COL(18), 'e')
    setCell(cells, T1_QUIZZER_ROW2, Q_COL(18), 'c')
    const { answers } = readOds(makeOds(makeSheetXml(cells)))
    expect(answers).toContainEqual({ quizzerId: T1_Q1, columnKey: '18', value: CellValue.Error })
    expect(answers).toContainEqual({ quizzerId: T1_Q2, columnKey: '18A', value: CellValue.Correct })
  })

  it('2 errors: errors on base/A, correct on B key', () => {
    const cells = minimalCells()
    setCell(cells, T1_QUIZZER_ROW, Q_COL(19), 'e')
    setCell(cells, T1_QUIZZER_ROW2, Q_COL(19), 'e')
    setCell(cells, T1_QUIZZER_ROW3, Q_COL(19), 'c')
    const { answers } = readOds(makeOds(makeSheetXml(cells)))
    expect(answers).toContainEqual({ quizzerId: T1_Q1, columnKey: '19', value: CellValue.Error })
    expect(answers).toContainEqual({ quizzerId: T1_Q2, columnKey: '19A', value: CellValue.Error })
    expect(answers).toContainEqual({ quizzerId: T1_Q3, columnKey: '19B', value: CellValue.Correct })
  })

  it('a third error is an answer to B, the last question asked', () => {
    const cells = minimalCells()
    setCell(cells, T1_QUIZZER_ROW, Q_COL(20), 'e') // → base
    setCell(cells, T1_QUIZZER_ROW2, Q_COL(20), 'e') // → A
    setCell(cells, T1_QUIZZER_ROW3, Q_COL(20), 'e') // → B
    const { answers } = readOds(makeOds(makeSheetXml(cells)))
    expect(answers).toContainEqual({ quizzerId: T1_Q1, columnKey: '20', value: CellValue.Error })
    expect(answers).toContainEqual({ quizzerId: T1_Q2, columnKey: '20A', value: CellValue.Error })
    expect(answers).toContainEqual({ quizzerId: T1_Q3, columnKey: '20B', value: CellValue.Error })
  })
})

// ---------------------------------------------------------------------------
// Q16+ placement by the state of the quiz
// ---------------------------------------------------------------------------

// TEAM_BLOCKS[1]: quizzerStart=13, quizzerIds 8-12; TEAM_BLOCKS[2]: quizzerStart=21, quizzerIds 14-18
const T2_Q1 = 8
const T3_Q1 = 14
const T2_QUIZZER_ROW = 13
const T3_QUIZZER_ROW = 21

describe('readOds — Q16+ placement by the state of the quiz', () => {
  /** Cells with a named first quizzer on each team, so their answers are valid */
  function namedCells(): Map<number, Map<number, string>> {
    const cells = minimalCells()
    for (const row of [T1_QUIZZER_ROW, T2_QUIZZER_ROW, T3_QUIZZER_ROW]) {
      setCell(cells, row, 1, `Quizzer ${row}`)
    }
    return cells
  }

  it('puts a no-jump under an errored question on its A question', () => {
    const cells = namedCells()
    setCell(cells, T1_QUIZZER_ROW, Q_COL(16), 'e')
    setCell(cells, 27, Q_COL(16), 'x')
    const { answers, noJumps } = readOds(makeOds(makeSheetXml(cells)))
    expect(answers).toContainEqual({ quizzerId: T1_Q1, columnKey: '16', value: CellValue.Error })
    expect(noJumps).toEqual(['16A'])
  })

  it('puts a no-jump under a twice-errored question on its B question', () => {
    const cells = namedCells()
    setCell(cells, T1_QUIZZER_ROW, Q_COL(18), 'e')
    setCell(cells, T2_QUIZZER_ROW, Q_COL(18), 'e')
    setCell(cells, 27, Q_COL(18), 'x')
    const { answers, noJumps } = readOds(makeOds(makeSheetXml(cells)))
    expect(answers).toContainEqual({ quizzerId: T1_Q1, columnKey: '18', value: CellValue.Error })
    expect(answers).toContainEqual({ quizzerId: T2_Q1, columnKey: '18A', value: CellValue.Error })
    expect(noJumps).toEqual(['18B'])
  })

  it('keeps a no-jump after one error on A even when the footer types B', () => {
    const cells = namedCells()
    setCell(cells, 30, Q_COL(17), 'INT')
    setCell(cells, T1_QUIZZER_ROW, Q_COL(17), 'e')
    setCell(cells, 27, Q_COL(17), 'x')
    const { noJumps } = readOds(makeOds(makeSheetXml(cells)))
    expect(noJumps).toEqual(['17A'])
  })

  it('orders two errors by the bonus seat: the error from that seat was the last', () => {
    const cells = namedCells()
    for (const row of [T2_QUIZZER_ROW + 2, T3_QUIZZER_ROW + 2]) setCell(cells, row, 1, 'Third seat')
    // Team 1 is listed first, but the bonus went to team 3's first seat, so team 1's first-seat
    // error was the second one, and team 2's third-seat error the first
    setCell(cells, T1_QUIZZER_ROW, Q_COL(16), 'e')
    setCell(cells, T2_QUIZZER_ROW + 2, Q_COL(16), 'e')
    setCell(cells, T3_QUIZZER_ROW, Q_COL(16), 'b')
    const { answers } = readOds(makeOds(makeSheetXml(cells)))
    expect(answers).toContainEqual({
      quizzerId: T2_Q1 + 2,
      columnKey: '16',
      value: CellValue.Error,
    })
    expect(answers).toContainEqual({ quizzerId: T1_Q1, columnKey: '16A', value: CellValue.Error })
    expect(answers).toContainEqual({ quizzerId: T3_Q1, columnKey: '16B', value: CellValue.Bonus })
  })

  it('still orders two errors by the bonus seat on a team of five, for its first four rows', () => {
    const cells = namedCells()
    for (const row of [T2_QUIZZER_ROW + 2, T3_QUIZZER_ROW + 2]) setCell(cells, row, 1, 'Third seat')
    for (let seat = 1; seat < 5; seat++) setCell(cells, T3_QUIZZER_ROW + seat, 1, `Quizzer ${seat}`)
    setCell(cells, T1_QUIZZER_ROW, Q_COL(16), 'e')
    setCell(cells, T2_QUIZZER_ROW + 2, Q_COL(16), 'e')
    setCell(cells, T3_QUIZZER_ROW, Q_COL(16), 'b')
    const { answers } = readOds(makeOds(makeSheetXml(cells)))
    expect(answers).toContainEqual({
      quizzerId: T2_Q1 + 2,
      columnKey: '16',
      value: CellValue.Error,
    })
    expect(answers).toContainEqual({ quizzerId: T1_Q1, columnKey: '16A', value: CellValue.Error })
  })

  it('takes a fifth-row error as the last when the other error was not from the bonus seat', () => {
    const cells = namedCells()
    for (let seat = 1; seat < 5; seat++) setCell(cells, T1_QUIZZER_ROW + seat, 1, `Quizzer ${seat}`)
    setCell(cells, T3_QUIZZER_ROW + 1, 1, 'Second seat')
    // The substitute on team 1's fifth row could be in any seat; team 2's first-seat error can't
    // be the one the second-seat bonus followed, so the substitute's was
    setCell(cells, T1_QUIZZER_ROW + 4, Q_COL(16), 'e')
    setCell(cells, T2_QUIZZER_ROW, Q_COL(16), 'e')
    setCell(cells, T3_QUIZZER_ROW + 1, Q_COL(16), 'b')
    const { answers } = readOds(makeOds(makeSheetXml(cells)))
    expect(answers).toContainEqual({ quizzerId: T2_Q1, columnKey: '16', value: CellValue.Error })
    expect(answers).toContainEqual({
      quizzerId: T1_Q1 + 4,
      columnKey: '16A',
      value: CellValue.Error,
    })
  })

  it('seats a fifth-row quizzer where the one teammate who is out sat', () => {
    const cells = namedCells()
    for (let seat = 1; seat < 5; seat++) setCell(cells, T1_QUIZZER_ROW + seat, 1, `Quizzer ${seat}`)
    setCell(cells, T2_QUIZZER_ROW + 1, 1, 'Second seat')
    setCell(cells, T3_QUIZZER_ROW + 2, 1, 'Third seat')
    // Team 1's third seat quizzes out, so its substitute sits there
    for (const q of [1, 2, 3, 4]) setCell(cells, T1_QUIZZER_ROW3, Q_COL(q), 'c')
    // The substitute's error is listed first, but the third-seat bonus shows it was the last
    setCell(cells, T1_QUIZZER_ROW + 4, Q_COL(16), 'e')
    setCell(cells, T2_QUIZZER_ROW + 1, Q_COL(16), 'e')
    setCell(cells, T3_QUIZZER_ROW + 2, Q_COL(16), 'b')
    const { answers } = readOds(makeOds(makeSheetXml(cells)))
    expect(answers).toContainEqual({ quizzerId: T2_Q1 + 1, columnKey: '16', value: 'e' })
    expect(answers).toContainEqual({ quizzerId: T1_Q1 + 4, columnKey: '16A', value: 'e' })
  })

  it('seats a fifth-row quizzer where a teammate who fouled out sat', () => {
    const cells = namedCells()
    for (let seat = 1; seat < 5; seat++) setCell(cells, T1_QUIZZER_ROW + seat, 1, `Quizzer ${seat}`)
    setCell(cells, T2_QUIZZER_ROW + 1, 1, 'Second seat')
    setCell(cells, T3_QUIZZER_ROW + 2, 1, 'Third seat')
    for (const q of [1, 2, 3]) setCell(cells, T1_QUIZZER_ROW3, Q_COL(q), 'f')
    setCell(cells, T1_QUIZZER_ROW + 4, Q_COL(16), 'e')
    setCell(cells, T2_QUIZZER_ROW + 1, Q_COL(16), 'e')
    setCell(cells, T3_QUIZZER_ROW + 2, Q_COL(16), 'b')
    const { answers } = readOds(makeOds(makeSheetXml(cells)))
    expect(answers).toContainEqual({ quizzerId: T2_Q1 + 1, columnKey: '16', value: 'e' })
    expect(answers).toContainEqual({ quizzerId: T1_Q1 + 4, columnKey: '16A', value: 'e' })
  })

  it('takes a fifth-row error as the first when its seat is known not to be the bonus seat', () => {
    const cells = namedCells()
    for (let seat = 1; seat < 5; seat++) setCell(cells, T2_QUIZZER_ROW + seat, 1, `Quizzer ${seat}`)
    setCell(cells, T3_QUIZZER_ROW + 1, 1, 'Second seat')
    // Team 2's fourth seat errors out, so its substitute sits there, not in the bonus seat; with
    // that seat unknown, team 1's first-seat error would have stayed first as listed
    for (const q of [1, 2, 3]) setCell(cells, T2_QUIZZER_ROW + 3, Q_COL(q), 'e')
    setCell(cells, T1_QUIZZER_ROW, Q_COL(16), 'e')
    setCell(cells, T2_QUIZZER_ROW + 4, Q_COL(16), 'e')
    setCell(cells, T3_QUIZZER_ROW, Q_COL(16), 'b')
    const { answers } = readOds(makeOds(makeSheetXml(cells)))
    expect(answers).toContainEqual({ quizzerId: T2_Q1 + 4, columnKey: '16', value: 'e' })
    expect(answers).toContainEqual({ quizzerId: T1_Q1, columnKey: '16A', value: 'e' })
  })

  it('leaves two errors as listed when the bonus answer is on a fifth row', () => {
    const cells = namedCells()
    for (let seat = 1; seat < 5; seat++) setCell(cells, T3_QUIZZER_ROW + seat, 1, `Quizzer ${seat}`)
    setCell(cells, T2_QUIZZER_ROW + 2, 1, 'Third seat')
    setCell(cells, T1_QUIZZER_ROW, Q_COL(16), 'e')
    setCell(cells, T2_QUIZZER_ROW + 2, Q_COL(16), 'e')
    setCell(cells, T3_QUIZZER_ROW + 4, Q_COL(16), 'b')
    const { answers } = readOds(makeOds(makeSheetXml(cells)))
    expect(answers).toContainEqual({ quizzerId: T1_Q1, columnKey: '16', value: CellValue.Error })
    expect(answers).toContainEqual({
      quizzerId: T2_Q1 + 2,
      columnKey: '16A',
      value: CellValue.Error,
    })
  })

  it('orders two errors before a no-jump by the empty bonus seat', () => {
    const cells = namedCells()
    setCell(cells, T1_QUIZZER_ROW3, 1, 'Third seat')
    // Team 3 has nobody in its third seat, so a no-jump on its bonus means the third-seat error
    // was the last one, though team 1 is listed first
    setCell(cells, T1_QUIZZER_ROW3, Q_COL(19), 'e')
    setCell(cells, T2_QUIZZER_ROW, Q_COL(19), 'e')
    setCell(cells, 27, Q_COL(19), 'x')
    const { answers, noJumps } = readOds(makeOds(makeSheetXml(cells)))
    expect(answers).toContainEqual({ quizzerId: T2_Q1, columnKey: '19', value: CellValue.Error })
    expect(answers).toContainEqual({ quizzerId: T1_Q3, columnKey: '19A', value: CellValue.Error })
    expect(noJumps).toEqual(['19B'])
  })

  it('reads a second error on an errored toss-up as an answer to B', () => {
    const cells = namedCells()
    setCell(cells, T1_QUIZZER_ROW, Q_COL(15), 'e')
    setCell(cells, T2_QUIZZER_ROW, Q_COL(16), 'e')
    setCell(cells, T3_QUIZZER_ROW, Q_COL(16), 'e')
    const { answers } = readOds(makeOds(makeSheetXml(cells)))
    expect(answers).toContainEqual({ quizzerId: T2_Q1, columnKey: '16', value: CellValue.Error })
    expect(answers).toContainEqual({ quizzerId: T3_Q1, columnKey: '16B', value: CellValue.Error })
  })

  it('takes two errors as reaching B even when the footer only types A', () => {
    const cells = namedCells()
    setCell(cells, 29, Q_COL(18), 'INT')
    setCell(cells, T1_QUIZZER_ROW, Q_COL(18), 'e')
    setCell(cells, T2_QUIZZER_ROW, Q_COL(18), 'e')
    setCell(cells, 27, Q_COL(18), 'x')
    const { answers, noJumps } = readOds(makeOds(makeSheetXml(cells)))
    expect(answers).toContainEqual({ quizzerId: T1_Q1, columnKey: '18', value: CellValue.Error })
    expect(answers).toContainEqual({ quizzerId: T2_Q1, columnKey: '18A', value: CellValue.Error })
    expect(noJumps).toEqual(['18B'])
  })

  it('puts the bonus after an errored toss-up on the B question', () => {
    const cells = namedCells()
    // Team 1's error on 15 makes 16 a toss-up, so team 2's error on it sends a bonus to team 3
    setCell(cells, T1_QUIZZER_ROW, Q_COL(15), 'e')
    setCell(cells, T2_QUIZZER_ROW, Q_COL(16), 'e')
    setCell(cells, T3_QUIZZER_ROW, Q_COL(16), 'b')
    const { answers } = readOds(makeOds(makeSheetXml(cells)))
    expect(answers).toContainEqual({ quizzerId: T2_Q1, columnKey: '16', value: CellValue.Error })
    expect(answers).toContainEqual({ quizzerId: T3_Q1, columnKey: '16B', value: CellValue.Bonus })
  })

  it('puts the bonus after an error between two teams tied in overtime on the B question', () => {
    const cells = namedCells()
    setCell(cells, 29, 2, 'y')
    // Teams 1 and 2 tie on a correct answer each; every other regulation question is a no-jump
    setCell(cells, T1_QUIZZER_ROW, Q_COL(1), 'c')
    setCell(cells, T2_QUIZZER_ROW, Q_COL(2), 'c')
    for (let q = 3; q <= 20; q++) setCell(cells, 27, Q_COL(q), 'x')
    setCell(cells, T1_QUIZZER_ROW, OT_COL(21), 'e')
    setCell(cells, T2_QUIZZER_ROW, OT_COL(21), 'b')
    const { answers } = readOds(makeOds(makeSheetXml(cells)))
    expect(answers).toContainEqual({ quizzerId: T1_Q1, columnKey: '21', value: CellValue.Error })
    expect(answers).toContainEqual({ quizzerId: T2_Q1, columnKey: '21B', value: CellValue.Bonus })
  })

  it('reads a file with these marks as a quiz with no validation errors', () => {
    const cells = namedCells()
    setCell(cells, T1_QUIZZER_ROW, Q_COL(15), 'e')
    setCell(cells, T2_QUIZZER_ROW, Q_COL(16), 'e')
    setCell(cells, T3_QUIZZER_ROW, Q_COL(16), 'b')
    setCell(cells, T1_QUIZZER_ROW, Q_COL(17), 'e')
    setCell(cells, 27, Q_COL(17), 'x')
    for (const q of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 18, 19, 20]) {
      setCell(cells, 27, Q_COL(q), 'x')
    }
    expect(quizOutcome(deserialize(readOds(makeOds(makeSheetXml(cells))))).placed).toBe(true)
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

describe('readOds — quiz format', () => {
  it('imports a spreadsheet as a 20-question quiz, at the version older installs read', () => {
    const file = readOds(makeOds(makeSheetXml(minimalCells())))
    expect(file.version).toBe(2)
    expect(file.quiz).not.toHaveProperty('format')
    expect(deserialize(file).quiz.format).toBe(QuizFormat.TwentyQuestion)
  })
})
