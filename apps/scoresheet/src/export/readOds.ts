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
const VALID_QUESTION_CATEGORIES = new Set<string>(Object.values(QuestionCategory))

/** Extract the Quiz sheet XML from the full content.xml string. */
function extractQuizSheet(xml: string): string {
  const quizSheetStart = xml.indexOf('table:name="Quiz"')
  if (quizSheetStart === -1) throw new Error('Quiz sheet not found in content.xml')
  const tableTagStart = xml.lastIndexOf('<table:table', quizSheetStart)
  const quizSheetEnd = xml.indexOf('</table:table>', tableTagStart) + '</table:table>'.length
  return xml.slice(tableTagStart, quizSheetEnd)
}

/**
 * Determine how deep the A/B chain went for a question column.
 * 0 = toss-up only, 1 = through A, 2 = through B.
 */
function getABDepth(sheet: string, odsCol: number): number {
  if (readCell(sheet, 30, odsCol)) return 2
  if (readCell(sheet, 29, odsCol)) return 1
  return 0
}

/**
 * Infer A/B depth from the answer values when footer rows are empty.
 * Each error triggers the next sub-question, so error count = depth.
 */
function inferABDepth(rawAnswers: { quizzerId: number; q: number; value: CellValue }[]): number {
  const errorCount = rawAnswers.filter((a) => a.value === CellValue.Error).length
  return Math.min(errorCount, 2)
}

/**
 * Distribute answers for a Q16+ question across normal/A/B column keys.
 *
 * Uses the A/B depth from the footer rows and the error-first chain rule:
 * - depth 0: all answers → normal key
 * - depth 1: first error → normal, rest → A
 * - depth 2: first error → normal, second error → A, rest → B
 *
 * Errors are assigned to earlier sub-questions since they trigger the
 * next sub-question in the chain.
 */
function distributeABAnswers(
  out: QuizFile['answers'],
  rawAnswers: { quizzerId: number; q: number; value: CellValue }[],
  q: number,
  depth: number,
): void {
  if (depth === 0) {
    for (const a of rawAnswers) {
      out.push({ quizzerId: a.quizzerId, columnKey: `${q}`, value: a.value })
    }
    return
  }

  // Separate errors from non-errors to assign them in chain order
  const errors = rawAnswers.filter((a) => a.value === CellValue.Error)
  const nonErrors = rawAnswers.filter((a) => a.value !== CellValue.Error)

  const keys = [`${q}`, `${q}A`, `${q}B`]
  let errorIdx = 0

  // Assign errors to progressively deeper keys (normal first, then A, then B)
  for (const a of errors) {
    const key = keys[Math.min(errorIdx, depth - 1)]!
    out.push({ quizzerId: a.quizzerId, columnKey: key, value: a.value })
    errorIdx++
  }

  // Non-errors go to the deepest reached key
  const resolvedKey = keys[depth]!
  for (const a of nonErrors) {
    out.push({ quizzerId: a.quizzerId, columnKey: resolvedKey, value: a.value })
  }
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

  // First pass: build teams/quizzers and collect raw answer values
  interface RawAnswer {
    quizzerId: number
    q: number
    value: CellValue
  }
  const rawAnswersByQ = new Map<number, RawAnswer[]>()

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

      for (let q = 1; q <= 20; q++) {
        const val = readCell(sheet, qRow, 3 + (q - 1)).toLowerCase()
        if (val && VALID_CELL_VALUES.has(val)) {
          if (!rawAnswersByQ.has(q)) rawAnswersByQ.set(q, [])
          rawAnswersByQ.get(q)!.push({ quizzerId, q, value: val as CellValue })
        }
      }

      for (let q = 21; q <= 26; q++) {
        const val = readCell(sheet, qRow, 23 + (q - 21)).toLowerCase()
        if (val && VALID_CELL_VALUES.has(val)) {
          if (!rawAnswersByQ.has(q)) rawAnswersByQ.set(q, [])
          rawAnswersByQ.get(q)!.push({ quizzerId, q, value: val as CellValue })
        }
      }
    }

    teams.push({ id: teamId, name: teamName, onTime, seatOrder: ti, quizzers })
  }

  // Second pass: assign column keys using footer rows to guess A/B depth
  for (const [q, rawAnswers] of rawAnswersByQ) {
    if (q < 16) {
      for (const a of rawAnswers) {
        answers.push({ quizzerId: a.quizzerId, columnKey: `${q}`, value: a.value })
      }
    } else {
      const odsCol = q <= 20 ? 3 + (q - 1) : 23 + (q - 21)
      let depth = getABDepth(sheet, odsCol)
      // If footer rows are empty, infer depth from the answers themselves:
      // an error + any other answer means the question went to at least A.
      if (depth === 0) depth = inferABDepth(rawAnswers)
      distributeABAnswers(answers, rawAnswers, q, depth)
    }
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
