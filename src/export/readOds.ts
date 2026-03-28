import { strFromU8, unzipSync } from 'fflate'
import { readCell } from './odsXml'
import { CellValue, PlacementFormula, QuestionCategory } from '../types/scoresheet'
import type { QuizFile } from '../persistence/quizFile'
import { FILE_VERSION } from '../persistence/quizFile'

/**
 * Team block addresses in the Quiz sheet (0-based row/col).
 */
const TEAM_BLOCKS = [
  { nameRow: 4, onTimeRow: 3, quizzerStart: 5 },
  { nameRow: 12, onTimeRow: 11, quizzerStart: 13 },
  { nameRow: 20, onTimeRow: 19, quizzerStart: 21 },
] as const

const VALID_CELL_VALUES = new Set<string>(['c', 'e', 'f', 'b', 'mb'])
const VALID_QUESTION_CATEGORIES = new Set<string>(
  Object.values(QuestionCategory).filter((v) => v !== ''),
)

/** Extract the Quiz sheet XML from the full content.xml string. */
function extractQuizSheet(xml: string): string {
  const quizSheetStart = xml.indexOf('table:name="Quiz"')
  if (quizSheetStart === -1) throw new Error('Quiz sheet not found in content.xml')
  const tableTagStart = xml.lastIndexOf('<table:table', quizSheetStart)
  const quizSheetEnd = xml.indexOf('</table:table>', tableTagStart) + '</table:table>'.length
  return xml.slice(tableTagStart, quizSheetEnd)
}

/**
 * Read an ODS/OTS file and return a QuizFile.
 *
 * Reads cell values from the known Quiz sheet layout and maps them
 * back to the app's data model. Team and quizzer IDs are generated
 * sequentially since the ODS has no concept of IDs.
 */
export function readOds(odsBytes: Uint8Array): QuizFile {
  const files = unzipSync(odsBytes)
  const contentBytes = files['content.xml']
  if (!contentBytes) throw new Error('content.xml not found in ODS file')
  const xml = strFromU8(contentBytes)
  const sheet = extractQuizSheet(xml)

  // --- Metadata ---
  const division = readCell(sheet, 2, 2)
  const quizNumber = readCell(sheet, 2, 4)
  const overtimeFlag = readCell(sheet, 29, 2).toLowerCase() === 'y'

  // --- Question types ---
  // Row 28 (0-based): normal question types for Q1–Q20
  // Row 29 (0-based): A sub-question types for Q16–Q20
  // Row 30 (0-based): B sub-question types for Q16–Q20
  const questionTypes: [string, QuestionCategory][] = []

  // Q1–Q15: col 3–17
  for (let q = 1; q <= 15; q++) {
    const val = readCell(sheet, 28, 3 + (q - 1))
    if (val && VALID_QUESTION_CATEGORIES.has(val)) {
      questionTypes.push([`${q}`, val as QuestionCategory])
    }
  }
  // Q16–Q20: normal at row 28, A at row 29, B at row 30
  for (let q = 16; q <= 20; q++) {
    const col = 3 + (q - 1)
    const normal = readCell(sheet, 28, col)
    if (normal && VALID_QUESTION_CATEGORIES.has(normal)) {
      questionTypes.push([`${q}`, normal as QuestionCategory])
    }
    const a = readCell(sheet, 29, col)
    if (a && VALID_QUESTION_CATEGORIES.has(a)) {
      questionTypes.push([`${q}A`, a as QuestionCategory])
    }
    const b = readCell(sheet, 30, col)
    if (b && VALID_QUESTION_CATEGORIES.has(b)) {
      questionTypes.push([`${q}B`, b as QuestionCategory])
    }
  }
  // OT Q21–Q26: col 23–28
  for (let q = 21; q <= 26; q++) {
    const col = 23 + (q - 21)
    const normal = readCell(sheet, 28, col)
    if (normal && VALID_QUESTION_CATEGORIES.has(normal)) {
      questionTypes.push([`${q}`, normal as QuestionCategory])
    }
    const a = readCell(sheet, 29, col)
    if (a && VALID_QUESTION_CATEGORIES.has(a)) {
      questionTypes.push([`${q}A`, a as QuestionCategory])
    }
    const b = readCell(sheet, 30, col)
    if (b && VALID_QUESTION_CATEGORIES.has(b)) {
      questionTypes.push([`${q}B`, b as QuestionCategory])
    }
  }

  // --- No-jumps (row 27) ---
  const noJumps: string[] = []
  // Q1–Q20: cols 3–22
  for (let q = 1; q <= 20; q++) {
    if (readCell(sheet, 27, 3 + (q - 1)).toLowerCase() === 'x') {
      noJumps.push(`${q}`)
    }
  }
  // OT Q21–Q26: cols 23–28
  for (let q = 21; q <= 26; q++) {
    if (readCell(sheet, 27, 23 + (q - 21)).toLowerCase() === 'x') {
      noJumps.push(`${q}`)
    }
  }

  // --- Teams and quizzers ---
  let nextId = 1
  const teams: QuizFile['teams'] = []
  const answers: QuizFile['answers'] = []

  for (let ti = 0; ti < TEAM_BLOCKS.length; ti++) {
    const block = TEAM_BLOCKS[ti]!
    const teamId = nextId++
    const teamName = readCell(sheet, block.nameRow, 1)
    const onTime = readCell(sheet, block.onTimeRow, 6).toLowerCase() !== 'n'

    const quizzers: QuizFile['teams'][0]['quizzers'] = []

    for (let qi = 0; qi < 5; qi++) {
      const qRow = block.quizzerStart + qi
      const quizzerId = nextId++
      const quizzerName = readCell(sheet, qRow, 1)

      quizzers.push({ id: quizzerId, name: quizzerName, seatOrder: qi })

      // Q1–Q20 answers: cols 3–22
      // The ODS stores all sub-question answers (normal/A/B) in the same
      // column. On import we map them to the normal key; the app's scoring
      // will use question type metadata to handle A/B logic.
      for (let q = 1; q <= 20; q++) {
        const val = readCell(sheet, qRow, 3 + (q - 1)).toLowerCase()
        if (val && VALID_CELL_VALUES.has(val)) {
          answers.push({ quizzerId, columnKey: `${q}`, value: val as CellValue })
        }
      }

      // OT Q21–Q26 answers: cols 23–28
      for (let q = 21; q <= 26; q++) {
        const val = readCell(sheet, qRow, 23 + (q - 21)).toLowerCase()
        if (val && VALID_CELL_VALUES.has(val)) {
          answers.push({ quizzerId, columnKey: `${q}`, value: val as CellValue })
        }
      }
    }

    teams.push({ id: teamId, name: teamName, onTime, seatOrder: ti, quizzers })
  }

  return {
    version: FILE_VERSION,
    quiz: {
      division,
      quizNumber,
      overtime: overtimeFlag,
      placementFormula: PlacementFormula.Rules,
      questionTypes,
    },
    teams,
    answers,
    noJumps,
  }
}
