import { strFromU8, unzipSync } from 'fflate'
import { readCell } from './odsXml'
import {
  answerLookup,
  BonusRule,
  buildCellGrid,
  buildColumns,
  CellValue,
  ColStatus,
  computeGreyedOut,
  computeOtIneligibility,
  countTowardsOut,
  deserialize,
  fileVersionFor,
  hasLeftBench,
  inSeatOrder,
  isQuizzedOut,
  newOutTally,
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
  teamIdx: number
  /** The quizzer's seat on their team, which a seat bonus follows */
  seatIdx: number
  q: number
  value: CellValue
}

/** Where one question's marks go among its normal, A and B columns */
interface Placement {
  answers: QuizFile['answers']
  noJumps: string[]
}

/** The ODS template only holds 20-question quizzes */
const RULES = quizRules(QuizFormat.TwentyQuestion)

/**
 * Whether an error on a question leaves one team to answer, so that its A question is skipped and
 * the rest is on B: the case when the question was already a toss-up. Asked of the shared scoring
 * rules, given the quiz so far with that error placed.
 */
function errorSkipsA(fileWithError: QuizFile, q: number): boolean {
  const { quiz, teams, quizzers, answers, noJumps } = deserialize(fileWithError)
  const columns = buildColumns(RULES, OT_ROUNDS_IN_SHEET)
  const cells = buildCellGrid(teams, quizzers, columns, answerLookup(answers))
  // In overtime, teams that aren't tied are locked out of every question
  const notInOvertime = computeOtIneligibility(
    cells,
    columns,
    inSeatOrder(teams, quizzers).map(({ team }) => team.onTime),
    columns.map((c) => noJumps.get(c.key) ?? false),
    RULES,
  )
  const { colStatuses } = computeGreyedOut(cells, columns, notInOvertime, quiz.bonusRule)
  return colStatuses[columns.findIndex((c) => c.key === `${q}A`)] === ColStatus.Skipped
}

/** Seats on a team's bench; a fifth quizzer listed is a substitute */
const SEATS = 4

/** The seat a mark was most likely made from, when the sheet gives a reason to pick one */
type SeatOf = (mark: Pick<RawAnswer, 'teamIdx' | 'seatIdx'>) => number | undefined

/**
 * The two errors of a question that went to B, in the order they were made. The spreadsheet doesn't
 * record the order, but a seat bonus goes to the seat of the last error, so the error more likely
 * to have come from that seat is taken as the last:
 * - a bonus answer is in that seat
 * - a no-jump means the third team had nobody in that seat
 *
 * The seats are themselves a guess (see `seatOf`), so this is the likelier order, not a known one.
 * When the seat favours neither error, the order they are listed in stands.
 *
 * @param isSeatEmpty - whether a team has nobody sitting in a seat
 */
function inOrderMade(
  errors: RawAnswer[],
  rest: RawAnswer[],
  noJump: boolean,
  seatOf: SeatOf,
  isSeatEmpty: (teamIdx: number, seat: number) => boolean,
): RawAnswer[] {
  const [first, second] = errors
  if (!first || !second) return errors
  const bonus = rest.find((a) => a.value === CellValue.Bonus || a.value === CellValue.MissedBonus)
  const bonusSeat = bonus && seatOf(bonus)
  const thirdTeam = TEAM_BLOCKS.findIndex((_, teamIdx) =>
    errors.every((e) => e.teamIdx !== teamIdx),
  )
  if (bonus ? bonusSeat === undefined : !noJump || thirdTeam < 0) return errors

  /** How likely an error came from the bonus seat: 1 if it seems so, 0 if not, between if unknown */
  const fromBonusSeat = (error: RawAnswer) => {
    const seat = seatOf(error)
    if (seat === undefined) return 0.5
    return (bonus ? seat === bonusSeat : isSeatEmpty(thirdTeam, seat)) ? 1 : 0
  }
  return fromBonusSeat(first) > fromBonusSeat(second) ? [second, first, ...errors.slice(2)] : errors
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
  seatOf: SeatOf,
  isSeatEmpty: (teamIdx: number, seat: number) => boolean,
): Placement {
  const errors = rawAnswers.filter((a) => a.value === CellValue.Error)
  const rest = rawAnswers.filter((a) => a.value !== CellValue.Error)
  const on = (key: string) => (a: RawAnswer) => ({
    quizzerId: a.quizzerId,
    columnKey: key,
    value: a.value,
  })
  if (q < RULES.firstAbQuestion || errors.length === 0) {
    return { answers: rawAnswers.map(on(`${q}`)), noJumps: noJump ? [`${q}`] : [] }
  }

  const ordered = tossUp ? errors : inOrderMade(errors, rest, noJump, seatOf, isSeatEmpty)
  // Errors beyond the ones that fit are answers to the last question asked
  const onA = tossUp ? [] : ordered.slice(1, 2)
  const extra = ordered.slice(tossUp ? 1 : 2)
  const last = tossUp || onA.length > 0 ? `${q}B` : `${q}A`
  return {
    answers: [
      on(`${q}`)(ordered[0]!),
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
          rawAnswersByQ.get(q)!.push({ quizzerId, teamIdx, seatIdx, q, value: val as CellValue })
        }
      }

      for (let q = 21; q <= 26; q++) {
        const val = readCell(sheet, qRow, 23 + (q - 21)).toLowerCase()
        if (val && VALID_CELL_VALUES.has(val)) {
          if (!rawAnswersByQ.has(q)) rawAnswersByQ.set(q, [])
          rawAnswersByQ.get(q)!.push({ quizzerId, teamIdx, seatIdx, q, value: val as CellValue })
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

  const named = teams.map((team) => team.quizzers.map((quizzer) => quizzer.name.trim() !== ''))

  // Each quizzer's correct answers, errors and fouls on the questions placed so far
  const tallies = teams.map((team) => team.quizzers.map(newOutTally))
  // A best guess, since the sheet lists quizzers, not seats, and a substitution never changes the
  // rows. The first four listed are taken to sit in order. A fifth is a substitute: usually in the
  // seat of the one teammate who has quizzed, errored or fouled out, and otherwise unknown. A team
  // that swaps quizzers mid-quiz and back again breaks both, which only costs the order of two
  // errors, never a score.
  const seatOf: SeatOf = ({ teamIdx, seatIdx }) => {
    if (seatIdx < SEATS) return seatIdx
    const out = tallies[teamIdx]!.slice(0, SEATS).flatMap((tally, seat) =>
      isQuizzedOut(tally, RULES) || hasLeftBench(tally) ? [seat] : [],
    )
    return out.length === 1 ? out[0] : undefined
  }

  // A seat is empty when its quizzer isn't listed or had to leave (a quiz-out may stay on for
  // bonuses), unless the substitute is guessed to have taken it
  const isSeatEmpty = (teamIdx: number, seat: number) => {
    const vacated = !named[teamIdx]![seat] || hasLeftBench(tallies[teamIdx]![seat]!)
    const filled = named[teamIdx]![SEATS] && seatOf({ teamIdx, seatIdx: SEATS }) === seat
    return vacated && !filled
  }

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
    const firstError = rawAnswers.find((a) => a.value === CellValue.Error)
    const tossUp =
      q >= RULES.firstAbQuestion &&
      firstError !== undefined &&
      errorSkipsA(
        toFile(
          [
            ...answers,
            { quizzerId: firstError.quizzerId, columnKey: `${q}`, value: firstError.value },
          ],
          noJumps,
        ),
        q,
      )
    const placed = placeQuestion(rawAnswers, q, noJump, tossUp, seatOf, isSeatEmpty)
    for (const { teamIdx, seatIdx, value } of rawAnswers) {
      countTowardsOut(tallies[teamIdx]![seatIdx]!, value)
    }
    answers.push(...placed.answers)
    noJumps.push(...placed.noJumps)
  }

  return toFile(answers, noJumps)
}
