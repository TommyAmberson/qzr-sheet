import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate'
import { buildColumns } from '../types/scoresheet'
import { scoreTeam } from '../scoring/scoreTeam'
import { computeOvertimeRounds } from '../scoring/overtime'
import { patchCell } from './odsXml'
import type { QuizFile } from '../persistence/quizFile'
import { deserialize } from '../persistence/quizFile'
import type { CellValue } from '../types/scoresheet'

/**
 * Fill an OTS template with quiz data and return an ODS file as bytes.
 *
 * The OTS is a ZIP archive. We unzip it, patch the Quiz sheet cells in
 * content.xml with real values, change the MIME type to ODS, and rezip.
 * All other sheets (Calculations, Summaries, Basic, Lists) pass through
 * unchanged — the template's own formulas recalculate from the filled
 * Quiz sheet when opened in LibreOffice.
 *
 * @param otsBytes - raw bytes of the .ots template file
 * @param quizFile - parsed quiz file data
 * @returns Uint8Array of the filled .ods file
 */
export function fillOts(otsBytes: Uint8Array, quizFile: QuizFile): Uint8Array {
  // --- 1. Unzip ---
  const files = unzipSync(otsBytes)

  // --- 2. Decode content.xml ---
  const contentBytes = files['content.xml']
  if (!contentBytes) throw new Error('content.xml not found in template')
  let xml = strFromU8(contentBytes)

  // --- 3. Derive data ---
  const { quiz, teams, quizzers, answers, noJumps } = deserialize(quizFile)

  const overtimeRounds = quiz.overtime ? 6 : 0 // max 6 OT rounds = 18 OT questions
  const cols = buildColumns(overtimeRounds)

  const sortedTeams = [...teams].sort((a, b) => a.seatOrder - b.seatOrder)

  // Build answer lookup: quizzerId:colKey → CellValue
  const answerMap = new Map<string, CellValue>()
  for (const a of answers) {
    answerMap.set(`${a.quizzerId}:${a.columnKey}`, a.value)
  }

  // Build quizzers per team, sorted by seatOrder
  const quizzersByTeam = new Map<number, typeof quizzers>()
  for (const team of sortedTeams) {
    quizzersByTeam.set(
      team.id,
      quizzers.filter((q) => q.teamId === team.id).sort((a, b) => a.seatOrder - b.seatOrder),
    )
  }

  // Build cell grid for scoring: cells[teamIdx][quizzerIdx][colIdx]
  const cellGrid: CellValue[][][] = sortedTeams.map((team) => {
    const tQuizzers = quizzersByTeam.get(team.id) ?? []
    return tQuizzers.map((qzr) =>
      cols.map((col) => answerMap.get(`${qzr.id}:${col.key}`) ?? ('' as CellValue)),
    )
  })

  // --- 4. Extract the Quiz sheet XML ---
  // The Quiz sheet is delimited by table:name="Quiz"
  const quizSheetStart = xml.indexOf('table:name="Quiz"')
  if (quizSheetStart === -1) throw new Error('Quiz sheet not found in content.xml')

  // Find the opening <table:table tag that contains this attribute
  const tableTagStart = xml.lastIndexOf('<table:table', quizSheetStart)

  // Find the closing tag of the Quiz sheet
  const quizSheetEnd = xml.indexOf('</table:table>', tableTagStart) + '</table:table>'.length

  let sheetXml = xml.slice(tableTagStart, quizSheetEnd)

  // --- 5. Fill metadata (row 2, 0-based) ---
  // Row 3 in 1-based = 0-based row 2: Div input at col C (idx 2), Quiz# input at col E (idx 4)
  sheetXml = patchCell(sheetXml, 2, 2, quiz.division)
  sheetXml = patchCell(sheetXml, 2, 4, quiz.quizNumber)

  // --- 6. Fill each team block ---
  // Team layout (0-based rows):
  //   Team 1: name=row4 col1, quizzers=rows5-9, score=row10
  //   Team 2: name=row12 col1, quizzers=rows13-17, score=row18
  //   Team 3: name=row20 col1, quizzers=rows21-25, score=row26
  const teamRows = [
    { nameRow: 4, quizzerStartRow: 5, scoreRow: 10, onTimeRow: 3 },
    { nameRow: 12, quizzerStartRow: 13, scoreRow: 18, onTimeRow: 11 },
    { nameRow: 20, quizzerStartRow: 21, scoreRow: 26, onTimeRow: 19 },
  ] as const

  // ODS column mapping for quizzer rows:
  //   Q1  → col 3 (D)  … Q15 → col 17 (R)
  //   Q16 → col 18 (S), Q17 → col 19 (T), …, Q20 → col 22 (W)
  //   OT Q21 → col 23 (X) … OT Q26 → col 28 (AC)
  //
  // Each question number maps to ONE column regardless of A/B sub-type.
  // App keys like "16A" and "16B" write to rows 30/31, not separate columns.
  // We build two maps:
  //   colKeyToOdsCol  — quizzer-row column index (undefined for A/B sub-keys)
  //   abKeyToRowAndCol — { row, col } for "16A"/"16B" etc. (rows 30/31)
  const colKeyToOdsCol = new Map<string, number>()
  const abKeyToRowAndCol = new Map<string, { row: number; col: number }>()

  // Q1–Q15: sequential, no A/B
  for (let q = 1; q <= 15; q++) {
    colKeyToOdsCol.set(`${q}`, 3 + (q - 1))
  }
  // Q16–Q20: one ODS col per question; A/B sub-keys → rows 30/31
  for (let q = 16; q <= 20; q++) {
    const odsColIdx = 3 + (q - 1) // col 18–22
    colKeyToOdsCol.set(`${q}`, odsColIdx)
    abKeyToRowAndCol.set(`${q}A`, { row: 29, col: odsColIdx }) // row 30 (0-based 29)
    abKeyToRowAndCol.set(`${q}B`, { row: 30, col: odsColIdx }) // row 31 (0-based 30)
  }
  // OT questions: one ODS col per question number; A/B sub-keys → rows 30/31
  let otCol = 23
  const seenOtNumbers = new Set<number>()
  for (const col of cols) {
    if (!col.isOvertime) continue
    if (!seenOtNumbers.has(col.number)) {
      seenOtNumbers.add(col.number)
      colKeyToOdsCol.set(`${col.number}`, otCol)
      abKeyToRowAndCol.set(`${col.number}A`, { row: 29, col: otCol })
      abKeyToRowAndCol.set(`${col.number}B`, { row: 30, col: otCol })
      otCol++
    }
  }

  // No-jump row (row 27, 0-based) and question type row (row 28, 0-based)
  const noJumpRow = 27
  const qtRow = 28
  const overtimeCell = 29 // row 29 col 2

  for (let ti = 0; ti < sortedTeams.length; ti++) {
    const team = sortedTeams[ti]!
    const { nameRow, quizzerStartRow, scoreRow, onTimeRow } = teamRows[ti]!
    const tQuizzers = quizzersByTeam.get(team.id) ?? []
    const teamCells = cellGrid[ti]!

    // Team name
    sheetXml = patchCell(sheetXml, nameRow, 1, team.name)

    // On-time (col 6 in separator/header row)
    sheetXml = patchCell(sheetXml, onTimeRow, 6, team.onTime ? 'y' : 'n')

    // Score row: per-question running totals
    const scoring = scoreTeam(teamCells, cols, team.onTime)
    for (let ci = 0; ci < cols.length; ci++) {
      const col = cols[ci]!
      const odsColIdx = colKeyToOdsCol.get(col.key)
      if (odsColIdx === undefined) continue
      const runningTotal = scoring.runningTotals[ci]
      if (runningTotal !== null && runningTotal !== undefined) {
        sheetXml = patchCell(sheetXml, scoreRow, odsColIdx, runningTotal)
      }
    }

    // Quizzer rows
    for (let qi = 0; qi < 5; qi++) {
      const qzr = tQuizzers[qi]
      const qRow = quizzerStartRow + qi

      // Quizzer name
      sheetXml = patchCell(sheetXml, qRow, 1, qzr?.name ?? '')

      // Answer cells — all keys write to the quizzer row at the parent
      // question's column. A/B answers go in the same ODS column as the
      // parent question number (the ODS has one column per question).
      if (qzr) {
        for (let ci = 0; ci < cols.length; ci++) {
          const col = cols[ci]!
          const cell = teamCells[qi]?.[ci] ?? ''
          if (cell === '') continue

          // Normal keys map directly; A/B keys use the parent question number
          const odsColIdx = colKeyToOdsCol.get(col.key) ?? colKeyToOdsCol.get(`${col.number}`)
          if (odsColIdx !== undefined) {
            sheetXml = patchCell(sheetXml, qRow, odsColIdx, cell)
          }
        }
      }
    }
  }

  // --- 7. No-jump row ---
  for (const col of cols) {
    const odsColIdx = colKeyToOdsCol.get(col.key)
    if (odsColIdx === undefined) continue
    if (noJumps.get(col.key)) {
      sheetXml = patchCell(sheetXml, noJumpRow, odsColIdx, 'x')
    }
  }

  // --- 8. Question types rows ---
  // Row 29 (0-based 28): toss-up / normal question types
  // Row 30 (0-based 29): A sub-question types
  // Row 31 (0-based 30): B sub-question types
  for (const col of cols) {
    const qt = quiz.questionTypes.get(col.key)
    if (!qt) continue

    const odsColIdx = colKeyToOdsCol.get(col.key)
    if (odsColIdx !== undefined) {
      // Normal key → question types row 29
      sheetXml = patchCell(sheetXml, qtRow, odsColIdx, qt)
    } else {
      // A/B key → rows 30/31
      const ab = abKeyToRowAndCol.get(col.key)
      if (ab) {
        sheetXml = patchCell(sheetXml, ab.row, ab.col, qt)
      }
    }
  }

  // --- 9. Overtime flag ---
  // Only 'y' if OT rounds are actually shown (regulation complete + tie exists).
  // The app hides OT columns when there's no tie, even if OT is enabled.
  const noJumpFlags = cols.map((c) => !!noJumps.get(c.key))
  const onTimes = sortedTeams.map((t) => t.onTime)
  const visibleOtRounds = quiz.overtime
    ? computeOvertimeRounds(cellGrid, cols, onTimes, noJumpFlags)
    : 0
  sheetXml = patchCell(sheetXml, overtimeCell, 2, visibleOtRounds > 0 ? 'y' : 'n')

  // --- 10. Splice patched sheet back into content.xml ---
  xml = xml.slice(0, tableTagStart) + sheetXml + xml.slice(quizSheetEnd)

  // --- 11. Update mimetype to ODS (not OTS) ---
  const odsMime = 'application/vnd.oasis.opendocument.spreadsheet'
  xml = xml.replace(/application\/vnd\.oasis\.opendocument\.spreadsheet-template/g, odsMime)

  // Also update manifest.xml
  let manifestXml: string | undefined
  const manifestBytes = files['META-INF/manifest.xml']
  if (manifestBytes) {
    manifestXml = strFromU8(manifestBytes).replace(
      /application\/vnd\.oasis\.opendocument\.spreadsheet-template/g,
      odsMime,
    )
  }

  // --- 12. Repack as ODS ---
  // mimetype must be first and uncompressed (level 0)
  const output: Zippable = {
    mimetype: [strToU8(odsMime), { level: 0 }],
    'content.xml': strToU8(xml),
  }

  for (const [name, data] of Object.entries(files)) {
    if (name === 'mimetype' || name === 'content.xml') continue
    if (name === 'META-INF/manifest.xml' && manifestXml) {
      output['META-INF/manifest.xml'] = strToU8(manifestXml)
    } else {
      output[name] = data
    }
  }

  return zipSync(output, { level: 6 })
}
