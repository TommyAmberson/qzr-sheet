import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate'
import { buildColumns } from '../types/scoresheet'
import { scoreTeam } from '../scoring/scoreTeam'
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

  // --- 5. Fill metadata (row 3, 0-based) ---
  // Row 3 = Row 4 in 1-based: Div at col 2, Quiz# at col 3
  sheetXml = patchCell(sheetXml, 3, 2, quiz.division)
  sheetXml = patchCell(sheetXml, 3, 3, quiz.quizNumber)

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

  // Column index for Q1..Q20 answers: col 3 = Q1, col 4 = Q2, ..., col 22 = Q20
  // OT Q21..Q26: cols 23..28
  // The column keys map to ODS col indices:
  //   key "1"=col3, "2"=col4 ... "15"=col17
  //   key "16"=col18, "16A"=col19, "16B"=col20
  //   key "17"=col21... etc.
  // We build a map from column key → ODS column index (0-based)
  const colKeyToOdsCol = new Map<string, number>()
  let odsCol = 3 // cols 0=quizzer#, 1-2=name, 3=Q1
  for (const col of cols) {
    colKeyToOdsCol.set(col.key, odsCol++)
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

      // Answer cells
      if (qzr) {
        for (let ci = 0; ci < cols.length; ci++) {
          const col = cols[ci]!
          const odsColIdx = colKeyToOdsCol.get(col.key)
          if (odsColIdx === undefined) continue
          const cell = teamCells[qi]?.[ci] ?? ''
          if (cell !== '') {
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

  // --- 8. Question types row ---
  for (const col of cols) {
    const odsColIdx = colKeyToOdsCol.get(col.key)
    if (odsColIdx === undefined) continue
    const qt = quiz.questionTypes.get(col.key)
    if (qt) {
      sheetXml = patchCell(sheetXml, qtRow, odsColIdx, qt)
    }
  }

  // --- 9. Overtime flag ---
  sheetXml = patchCell(sheetXml, overtimeCell, 2, quiz.overtime ? 'y' : 'n')

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
