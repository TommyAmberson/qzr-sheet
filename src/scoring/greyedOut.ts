import { CellValue, QuestionType, buildKeyToIdx, type Column } from '../types/scoresheet'
import { ColStatus, teamHasValue, teamHasAnswer, anyTeamHasAnswer, isResolved } from './helpers'

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
  /** Per-column game-logic status: Pending, Errored, Resolved, or Skipped */
  colStatuses: ColStatus[]
}

export function computeGreyedOut(
  cellData: CellValue[][][],
  cols: Column[],
  otIneligibility?: Map<number, Set<number>>,
): GreyedOutResult {
  const disabled = new Set<string>()
  const colStatuses: ColStatus[] = cols.map(() => ColStatus.Pending)
  const teamCount = cellData.length
  const keyToIdx = buildKeyToIdx(cols)

  // Partially apply cellData so call sites read cleanly
  const hasAnswer = (ti: number, ci: number) => teamHasAnswer(cellData, ti, ci)
  const hasValue = (ti: number, ci: number, v: CellValue) => teamHasValue(cellData, ti, ci, v)
  const anyHasAnswer = (ci: number) => anyTeamHasAnswer(cellData, ci)
  const colResolved = (ci: number) => isResolved(cellData, ci)

  function greyAllTeams(colIdx: number) {
    for (let ti = 0; ti < teamCount; ti++) {
      disabled.add(`${ti}:${colIdx}`)
    }
  }

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

  // In OT, non-eligible teams can't jump at all. Seeding them into tossedUp
  // (rather than only greying them) means the toss-up/bonus carry-forward
  // sees them as locked out — so a 2-way OT tie correctly treats every
  // numbered question as a toss-up and routes errors straight to B.
  // Ineligibility is scoped per-round so teams resolved out in round N are
  // not retroactively tossed-up on round N columns.
  if (otIneligibility) {
    for (const [colIdx, ineligible] of otIneligibility) {
      for (const ti of ineligible) {
        tossedUp[colIdx]!.add(`${ti}`)
      }
    }
  }

  for (let colIdx = 0; colIdx < cols.length; colIdx++) {
    const col = cols[colIdx]!

    // 1. If a question has an answer (C/E/B/MB), it's done — grey out all teams
    //    on that column. Fouls don't count (question is re-asked).
    if (anyHasAnswer(colIdx)) {
      greyAllTeams(colIdx)
      if (colStatuses[colIdx] === ColStatus.Pending) {
        colStatuses[colIdx] = colResolved(colIdx) ? ColStatus.Resolved : ColStatus.Errored
      }
    }

    // 2. If a base question (Normal) was resolved (C/B/MB), grey out A and B.
    //    Errors don't resolve — they lead to toss-ups on A.
    if (
      col.type === QuestionType.Normal &&
      col.isAB &&
      colStatuses[colIdx] === ColStatus.Resolved
    ) {
      const aIdx = keyToIdx.get(`${col.number}A`)
      const bIdx = keyToIdx.get(`${col.number}B`)
      if (aIdx !== undefined) {
        greyAllTeams(aIdx)
        colStatuses[aIdx] = ColStatus.Skipped
      }
      if (bIdx !== undefined) {
        greyAllTeams(bIdx)
        colStatuses[bIdx] = ColStatus.Skipped
      }
    }

    // 3. If an A question was resolved (C/B/MB), grey out B.
    //    Errors don't resolve — they lead to toss-ups on B.
    if (col.type === QuestionType.A && colStatuses[colIdx] === ColStatus.Resolved) {
      const bIdx = keyToIdx.get(`${col.number}B`)
      if (bIdx !== undefined) {
        greyAllTeams(bIdx)
        colStatuses[bIdx] = ColStatus.Skipped
      }
    }

    // 4. Toss-up greying: teams in tossedUp set are greyed on this column
    for (const tiStr of tossedUp[colIdx]!) {
      disabled.add(`${tiStr}:${colIdx}`)
    }

    // 5. Toss-up / bonus carry-forward
    // Only errors cause toss-ups — not B/MB
    if (colStatuses[colIdx] === ColStatus.Errored) {
      // Determine which teams would be tossed on the next column
      const wouldBeTossed: number[] = []
      for (let ti = 0; ti < teamCount; ti++) {
        if (hasValue(ti, colIdx, CellValue.Error)) {
          wouldBeTossed.push(ti)
        } else if (tossedUp[colIdx]!.has(`${ti}`) && !hasAnswer(ti, colIdx)) {
          wouldBeTossed.push(ti)
        }
      }

      // A is always a toss-up (2 teams eligible), B is always a bonus (1 team eligible).
      // When a Normal isAB column's error would leave only one team eligible, skip A and
      // route directly to B.
      let nq: number | undefined
      if (col.type === QuestionType.Normal && col.isAB && wouldBeTossed.length === teamCount - 1) {
        nq = keyToIdx.get(`${col.number}B`)
        const aIdx = keyToIdx.get(`${col.number}A`)
        if (aIdx !== undefined) {
          colStatuses[aIdx] = ColStatus.Skipped
          greyAllTeams(aIdx)
        }
      } else {
        nq = nextQuestion(col)
      }

      if (nq !== undefined) {
        for (const ti of wouldBeTossed) {
          tossedUp[nq]!.add(`${ti}`)
        }
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

  // Grey out non-eligible teams on overtime columns
  if (otIneligibility) {
    for (const [colIdx, ineligible] of otIneligibility) {
      for (const ti of ineligible) {
        disabled.add(`${ti}:${colIdx}`)
      }
    }
  }

  return { disabled, tossedUp: tossedUpSet, fouledQuizzers, colStatuses }
}
