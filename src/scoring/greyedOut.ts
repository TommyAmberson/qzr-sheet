import { CellValue, QuestionType, type Column } from '../types/scoresheet'

/**
 * Compute which cells are greyed out (disabled).
 * Returns a Set of "teamIdx:colIdx" keys.
 *
 * Two kinds of greying:
 * - "Question done": when a question has an answer (C/E/B/MB), all teams
 *   are greyed on that column (plus A/B cascade).
 * - "Toss-up": when a team errors, they can't jump on the next question.
 *   If the toss-up question also gets an error (not correct/bonus),
 *   the original team's grey carries forward too (bonus situation).
 *
 * Fouls don't end a question — it's re-asked.
 */
export function computeGreyedOut(
  cellData: CellValue[][][],
  cols: Column[],
): Set<string> {
  const disabled = new Set<string>()
  const teamCount = cellData.length

  function teamHasValue(teamIdx: number, colIdx: number, value: CellValue): boolean {
    for (const row of cellData[teamIdx]!) {
      if (row[colIdx] === value) return true
    }
    return false
  }

  function teamHasAnswer(teamIdx: number, colIdx: number): boolean {
    for (const row of cellData[teamIdx]!) {
      const v = row[colIdx]
      if (v !== CellValue.Empty && v !== CellValue.Foul) return true
    }
    return false
  }

  function anyTeamHasAnswer(colIdx: number): boolean {
    for (let ti = 0; ti < teamCount; ti++) {
      if (teamHasAnswer(ti, colIdx)) return true
    }
    return false
  }

  function anyTeamHasValue(colIdx: number, value: CellValue): boolean {
    for (let ti = 0; ti < teamCount; ti++) {
      for (const row of cellData[ti]!) {
        if (row[colIdx] === value) return true
      }
    }
    return false
  }

  function greyAllTeams(colIdx: number) {
    for (let ti = 0; ti < teamCount; ti++) {
      disabled.add(`${ti}:${colIdx}`)
    }
  }

  const keyToIdx = new Map<string, number>()
  cols.forEach((col, i) => keyToIdx.set(col.key, i))

  /** Find the next question column index */
  function nextQuestion(col: Column): number | undefined {
    if (col.isAB) {
      if (col.type === QuestionType.Normal) return keyToIdx.get(`${col.number}A`)
      if (col.type === QuestionType.A) return keyToIdx.get(`${col.number}B`)
      return keyToIdx.get(`${col.number + 1}`)
    }
    return keyToIdx.get(`${col.number + 1}`)
  }

  // Track which teams are tossed-up (can't jump) per column due to error chain.
  // This is separate from "question is done" greying — only toss-up greying
  // carries forward.
  const tossedUp: Set<string>[] = cols.map(() => new Set<string>())

  for (let colIdx = 0; colIdx < cols.length; colIdx++) {
    const col = cols[colIdx]!

    // 1. If a question has an answer (C/E/B/MB), it's done — grey out all teams
    //    on that column. Fouls don't count (question is re-asked).
    if (anyTeamHasAnswer(colIdx)) {
      greyAllTeams(colIdx)
    }

    // 2. If a base question (Normal) was answered, grey out A and B
    if (col.type === QuestionType.Normal && col.isAB) {
      if (anyTeamHasAnswer(colIdx)) {
        const aIdx = keyToIdx.get(`${col.number}A`)
        const bIdx = keyToIdx.get(`${col.number}B`)
        if (aIdx !== undefined) greyAllTeams(aIdx)
        if (bIdx !== undefined) greyAllTeams(bIdx)
      }
    }

    // 3. If an A question was answered, grey out B
    if (col.type === QuestionType.A) {
      if (anyTeamHasAnswer(colIdx)) {
        const bIdx = keyToIdx.get(`${col.number}B`)
        if (bIdx !== undefined) greyAllTeams(bIdx)
      }
    }

    // 4. Toss-up greying: teams in tossedUp set are greyed on this column
    for (const tiStr of tossedUp[colIdx]!) {
      disabled.add(`${tiStr}:${colIdx}`)
    }

    // 5. Toss-up / bonus carry-forward
    const nq = nextQuestion(col)
    if (nq === undefined) continue

    const questionAnswered = anyTeamHasAnswer(colIdx)
    const resolvedByCorrect =
      anyTeamHasValue(colIdx, CellValue.Correct) ||
      anyTeamHasValue(colIdx, CellValue.Bonus)

    for (let ti = 0; ti < teamCount; ti++) {
      // If this team errored, they can't jump on the next question
      if (teamHasValue(ti, colIdx, CellValue.Error)) {
        tossedUp[nq]!.add(`${ti}`)
      }

      // If this team was tossed up (couldn't jump) and the question was
      // answered by someone else with an error (not resolved by correct/bonus),
      // carry forward
      if (
        tossedUp[colIdx]!.has(`${ti}`) &&
        !teamHasAnswer(ti, colIdx) &&
        questionAnswered &&
        !resolvedByCorrect
      ) {
        tossedUp[nq]!.add(`${ti}`)
      }
    }
  }

  return disabled
}
