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
export interface GreyedOutResult {
  disabled: Set<string>
  /** Teams that can't jump on a column due to toss-up/error chain: Set of "teamIdx:colIdx" */
  tossedUp: Set<string>
  /** Quizzers who fouled on a question and can't answer sub-parts: Set of "teamIdx:quizzerIdx:colIdx" */
  fouledQuizzers: Set<string>
}

export function computeGreyedOut(
  cellData: CellValue[][][],
  cols: Column[],
): GreyedOutResult {
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

    // 2. If a base question (Normal) was resolved (C/B/MB), grey out A and B.
    //    Errors don't resolve — they lead to toss-ups on A.
    if (col.type === QuestionType.Normal && col.isAB) {
      const resolved =
        anyTeamHasValue(colIdx, CellValue.Correct) ||
        anyTeamHasValue(colIdx, CellValue.Bonus) ||
        anyTeamHasValue(colIdx, CellValue.MissedBonus)
      if (resolved) {
        const aIdx = keyToIdx.get(`${col.number}A`)
        const bIdx = keyToIdx.get(`${col.number}B`)
        if (aIdx !== undefined) greyAllTeams(aIdx)
        if (bIdx !== undefined) greyAllTeams(bIdx)
      }
    }

    // 3. If an A question was resolved (C/B/MB), grey out B.
    //    Errors don't resolve — they lead to toss-ups on B.
    if (col.type === QuestionType.A) {
      const resolved =
        anyTeamHasValue(colIdx, CellValue.Correct) ||
        anyTeamHasValue(colIdx, CellValue.Bonus) ||
        anyTeamHasValue(colIdx, CellValue.MissedBonus)
      if (resolved) {
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

    // Only errors cause toss-ups and carry-forward — not B/MB
    const hasError = anyTeamHasValue(colIdx, CellValue.Error)
    const resolved =
      anyTeamHasValue(colIdx, CellValue.Correct) ||
      anyTeamHasValue(colIdx, CellValue.Bonus) ||
      anyTeamHasValue(colIdx, CellValue.MissedBonus)

    for (let ti = 0; ti < teamCount; ti++) {
      // If this team errored, they can't jump on the next question
      if (teamHasValue(ti, colIdx, CellValue.Error)) {
        tossedUp[nq]!.add(`${ti}`)
      }

      // If this team was tossed up (couldn't jump) and someone else errored
      // (not resolved by correct/bonus), carry forward
      if (
        tossedUp[colIdx]!.has(`${ti}`) &&
        !teamHasAnswer(ti, colIdx) &&
        hasError &&
        !resolved
      ) {
        tossedUp[nq]!.add(`${ti}`)
      }
    }
  }

  // Flatten tossedUp array into a single Set of "ti:colIdx" for easy lookup
  const tossedUpSet = new Set<string>()
  for (let colIdx = 0; colIdx < cols.length; colIdx++) {
    for (const tiStr of tossedUp[colIdx]!) {
      tossedUpSet.add(`${tiStr}:${colIdx}`)
    }
  }

  // Build fouledQuizzers: quizzers who fouled on a numbered question
  // can't answer subsequent sub-parts (A/B) of the same question
  const fouledQuizzers = new Set<string>()
  for (let colIdx = 0; colIdx < cols.length; colIdx++) {
    const col = cols[colIdx]!
    if (!col.isAB) continue

    for (let ti = 0; ti < teamCount; ti++) {
      const team = cellData[ti]!
      for (let qi = 0; qi < team.length; qi++) {
        if (team[qi]![colIdx] !== CellValue.Foul) continue

        // Foul on Normal → grey this quizzer on A and B
        if (col.type === QuestionType.Normal) {
          const aIdx = keyToIdx.get(`${col.number}A`)
          const bIdx = keyToIdx.get(`${col.number}B`)
          if (aIdx !== undefined) fouledQuizzers.add(`${ti}:${qi}:${aIdx}`)
          if (bIdx !== undefined) fouledQuizzers.add(`${ti}:${qi}:${bIdx}`)
        }
        // Foul on A → grey this quizzer on B
        if (col.type === QuestionType.A) {
          const bIdx = keyToIdx.get(`${col.number}B`)
          if (bIdx !== undefined) fouledQuizzers.add(`${ti}:${qi}:${bIdx}`)
        }
        // Foul on B → nothing further
      }
    }
  }

  return { disabled, tossedUp: tossedUpSet, fouledQuizzers }
}
