import { strFromU8, unzipSync } from 'fflate'
import { readCell } from './odsXml'
import {
  answerLookup,
  BonusRule,
  buildCellGrid,
  buildColumns,
  CellValue,
  computeGreyedOut,
  computeOtIneligibility,
  deserialize,
  fileVersionFor,
  inSeatOrder,
  PlacementFormula,
  QuestionCategory,
  type QuizFile,
  QuizFormat,
  quizRules,
} from '@qzr/shared'

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

/** Overtime rounds the spreadsheet has columns for (questions 21 to 26) */
const OT_ROUNDS_IN_SHEET = 2

/** One mark in a question's column of the spreadsheet */
interface RawAnswer {
  quizzerId: number
  q: number
  value: CellValue
}

/** Where one question's marks go among its normal, A and B columns */
interface Placement {
  answers: QuizFile['answers']
  noJumps: string[]
}

/**
 * How many teams can't jump on a question's numbered column, going by the questions before it: none
 * on an open question, one on a toss-up.
 */
function teamsLockedOut(fileSoFar: QuizFile, q: number): number {
  const { quiz, teams, quizzers, answers, noJumps } = deserialize(fileSoFar)
  const rules = quizRules(quiz.format)
  const columns = buildColumns(rules, OT_ROUNDS_IN_SHEET)
  const cells = buildCellGrid(teams, quizzers, columns, answerLookup(answers))
  // In overtime, teams that aren't tied are locked out of every question
  const notInOvertime = computeOtIneligibility(
    cells,
    columns,
    inSeatOrder(teams, quizzers).map(({ team }) => team.onTime),
    columns.map((c) => noJumps.get(c.key) ?? false),
    rules,
  )
  const { tossedUp } = computeGreyedOut(cells, columns, notInOvertime, quiz.bonusRule)
  return tossedUp[columns.findIndex((c) => c.key === `${q}`)]?.size ?? 0
}

/**
 * A question's marks spread over its columns. The spreadsheet has one column for a Q16+ question's
 * three, so which of them a mark is on follows from how the question must have gone:
 * - no errors: everything is on the numbered question
 * - an open question: the first error is on it, a second on A, and anything after on B
 * - a toss-up, where an error leaves one team to answer: the error is on it, the rest on B
 *
 * A no-jump is on the last of them asked.
 */
function placeQuestion(
  rawAnswers: RawAnswer[],
  q: number,
  noJump: boolean,
  tossUp: boolean,
): Placement {
  const errors = rawAnswers.filter((a) => a.value === CellValue.Error)
  const rest = rawAnswers.filter((a) => a.value !== CellValue.Error)
  const on = (key: string) => (a: RawAnswer) => ({
    quizzerId: a.quizzerId,
    columnKey: key,
    value: a.value,
  })
  if (q < 16 || errors.length === 0) {
    return { answers: rawAnswers.map(on(`${q}`)), noJumps: noJump ? [`${q}`] : [] }
  }

  // Errors beyond the ones that fit are answers to the last question asked
  const onA = tossUp ? [] : errors.slice(1, 2)
  const extra = errors.slice(tossUp ? 1 : 2)
  const last = tossUp || onA.length > 0 ? `${q}B` : `${q}A`
  return {
    answers: [
      on(`${q}`)(errors[0]!),
      ...onA.map(on(`${q}A`)),
      ...[...extra, ...rest].map(on(last)),
    ],
    noJumps: noJump ? [last] : [],
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
  const noJumpQuestions = new Set<number>()
  // Q1–Q20: cols 3–22
  for (let q = 1; q <= 20; q++) {
    if (readCell(sheet, 27, 3 + (q - 1)).toLowerCase() === 'x') noJumpQuestions.add(q)
  }
  // OT Q21–Q26: cols 23–28
  for (let q = 21; q <= 26; q++) {
    if (readCell(sheet, 27, 23 + (q - 21)).toLowerCase() === 'x') noJumpQuestions.add(q)
  }

  // --- Teams and quizzers ---
  let nextId = 1
  const teams: QuizFile['teams'] = []

  // First pass: build teams/quizzers and collect raw answer values
  const rawAnswersByQ = new Map<number, RawAnswer[]>()

  for (let teamIdx = 0; teamIdx < TEAM_BLOCKS.length; teamIdx++) {
    const block = TEAM_BLOCKS[teamIdx]!
    const teamId = nextId++
    const teamName = readCell(sheet, block.nameRow, 1)
    const onTime = readCell(sheet, block.onTimeRow, 6).toLowerCase() !== 'n'

    const quizzers: QuizFile['teams'][0]['quizzers'] = []

    for (let seatIdx = 0; seatIdx < 5; seatIdx++) {
      const qRow = block.quizzerStart + seatIdx
      const quizzerId = nextId++
      const quizzerName = readCell(sheet, qRow, 1)

      quizzers.push({ id: quizzerId, name: quizzerName, seatOrder: seatIdx })

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

    teams.push({ id: teamId, name: teamName, onTime, seatOrder: teamIdx, quizzers })
  }

  const toFile = (answers: QuizFile['answers'], noJumps: string[]): QuizFile => ({
    // The ODS template only holds 20-question quizzes
    version: fileVersionFor(QuizFormat.TwentyQuestion),
    quiz: {
      division,
      quizNumber,
      overtime: overtimeFlag,
      placementFormula: PlacementFormula.Rules,
      bonusRule: BonusRule.Seat,
      questionTypes,
    },
    teams,
    answers,
    noJumps,
  })

  // Second pass: assign column keys, question by question, since where a question's marks belong
  // depends on the questions before it
  const answers: QuizFile['answers'] = []
  const noJumps: string[] = []
  const questions = [...new Set([...rawAnswersByQ.keys(), ...noJumpQuestions])].sort(
    (a, b) => a - b,
  )
  for (const q of questions) {
    const rawAnswers = rawAnswersByQ.get(q) ?? []
    const noJump = noJumpQuestions.has(q)
    // Whether an error on a Q16+ question leaves only one team to answer
    const tossUp =
      q >= 16 &&
      rawAnswers.some((a) => a.value === CellValue.Error) &&
      teamsLockedOut(toFile(answers, noJumps), q) >= TEAM_BLOCKS.length - 2
    const placed = placeQuestion(rawAnswers, q, noJump, tossUp)
    answers.push(...placed.answers)
    noJumps.push(...placed.noJumps)
  }

  return toFile(answers, noJumps)
}
