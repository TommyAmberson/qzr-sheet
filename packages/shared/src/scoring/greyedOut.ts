import { BonusRule, CellValue, QuestionType, buildKeyToIdx, type Column } from '../types/scoresheet'
import {
  ColStatus,
  teamHasValue,
  teamHasAnswer,
  anyTeamHasAnswer,
  isResolved,
  findErrorSeat,
} from './helpers'
import { type TeamIdx, type TeamSeat, toTeamIdx, toSeatIdx, teamSeatKey } from '../types/indices'

/**
 * Compute which cells are greyed out (disabled).
 *
 * Three kinds of greying:
 * - "Question done": when a question has an answer (C/E/B/MB), all teams
 *   are greyed on that column (plus A/B cascade).
 * - "Toss-up": when a team errors, they can't jump on the next question.
 *   If the toss-up question also gets an error (not correct/bonus),
 *   the original team's grey carries forward too (bonus situation).
 * - "Seat bonus": in seat bonus mode, non-matching seats on the bonus team
 *   are greyed out (only the seat matching the last error can answer).
 *
 * Fouls don't end a question — it's re-asked.
 *
 * Output is per-column nested: `disabledTeams[col]`, `tossedUp[col]`, etc.
 * Lookups by colIdx are O(1) without scanning a flat composite-key set.
 */
export interface GreyedOutResult {
  /** Per column: teams disabled at the team level (question done, toss-up, OT-ineligible). */
  disabledTeams: Set<TeamIdx>[]
  /** Per column: (team, seat) pairs disabled at the seat level (seat-bonus mode). */
  disabledSeats: Set<TeamSeat>[]
  /** Per column: teams currently tossed up on this column (carry-forward chain). */
  tossedUp: Set<TeamIdx>[]
  /** Per column: (team, seat) pairs that fouled and can't answer this sub-part. */
  fouledQuizzers: Set<TeamSeat>[]
  /** Per-column game-logic status: Pending, Errored, Resolved, or Skipped */
  colStatuses: ColStatus[]
}

export function computeGreyedOut(
  cellData: CellValue[][][],
  cols: Column[],
  otIneligibility?: Map<number, Set<number>>,
  bonusRule: BonusRule = BonusRule.Seat,
): GreyedOutResult {
  const disabledTeams: Set<TeamIdx>[] = cols.map(() => new Set<TeamIdx>())
  const disabledSeats: Set<TeamSeat>[] = cols.map(() => new Set<TeamSeat>())
  const colStatuses: ColStatus[] = cols.map(() => ColStatus.Pending)
  const teamCount = cellData.length
  const keyToIdx = buildKeyToIdx(cols)

  // Partially apply cellData so call sites read cleanly
  const hasAnswer = (teamIdx: number, colIdx: number) => teamHasAnswer(cellData, teamIdx, colIdx)
  const hasValue = (teamIdx: number, colIdx: number, v: CellValue) =>
    teamHasValue(cellData, teamIdx, colIdx, v)
  const anyHasAnswer = (colIdx: number) => anyTeamHasAnswer(cellData, colIdx)
  const colResolved = (colIdx: number) => isResolved(cellData, colIdx)

  function greyAllTeams(colIdx: number) {
    for (let teamIdx = 0; teamIdx < teamCount; teamIdx++) {
      disabledTeams[colIdx]!.add(toTeamIdx(teamIdx))
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
  const tossedUp: Set<TeamIdx>[] = cols.map(() => new Set<TeamIdx>())
  // For seat bonus: the seat of the most recent error feeding into each column
  const lastErrorSeat: (number | undefined)[] = cols.map(() => undefined)

  // In OT, non-eligible teams can't jump at all. Seeding them into tossedUp
  // (rather than only greying them) means the toss-up/bonus carry-forward
  // sees them as locked out — so a 2-way OT tie correctly treats every
  // numbered question as a toss-up and routes errors straight to B.
  // Ineligibility is scoped per-round so teams resolved out in round N are
  // not retroactively tossed-up on round N columns.
  if (otIneligibility) {
    for (const [colIdx, ineligible] of otIneligibility) {
      for (const teamIdx of ineligible) {
        tossedUp[colIdx]!.add(toTeamIdx(teamIdx))
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
      const aColIdx = keyToIdx.get(`${col.number}A`)
      const bColIdx = keyToIdx.get(`${col.number}B`)
      if (aColIdx !== undefined) {
        greyAllTeams(aColIdx)
        colStatuses[aColIdx] = ColStatus.Skipped
      }
      if (bColIdx !== undefined) {
        greyAllTeams(bColIdx)
        colStatuses[bColIdx] = ColStatus.Skipped
      }
    }

    // 3. If an A question was resolved (C/B/MB), grey out B.
    //    Errors don't resolve — they lead to toss-ups on B.
    if (col.type === QuestionType.A && colStatuses[colIdx] === ColStatus.Resolved) {
      const bColIdx = keyToIdx.get(`${col.number}B`)
      if (bColIdx !== undefined) {
        greyAllTeams(bColIdx)
        colStatuses[bColIdx] = ColStatus.Skipped
      }
    }

    // 4. Toss-up greying: teams in tossedUp set are greyed on this column
    for (const teamIdx of tossedUp[colIdx]!) {
      disabledTeams[colIdx]!.add(teamIdx)
    }

    // 4b. Seat bonus greying: on bonus columns, grey non-matching seats on the bonus team
    if (bonusRule === BonusRule.Seat && lastErrorSeat[colIdx] !== undefined) {
      const tossedHere = tossedUp[colIdx]!
      for (let teamIdx = 0; teamIdx < teamCount; teamIdx++) {
        const branded = toTeamIdx(teamIdx)
        if (tossedHere.has(branded)) continue
        // Check if every OTHER team is tossed (= bonus for this team)
        if (tossedHere.size === teamCount - 1) {
          const seatCount = cellData[teamIdx]!.length
          for (let seatIdx = 0; seatIdx < seatCount; seatIdx++) {
            if (seatIdx !== lastErrorSeat[colIdx]) {
              disabledSeats[colIdx]!.add(teamSeatKey(branded, toSeatIdx(seatIdx)))
            }
          }
        }
      }
    }

    // 5. Toss-up / bonus carry-forward
    // Only errors cause toss-ups — not B/MB
    if (colStatuses[colIdx] === ColStatus.Errored) {
      // Determine which teams would be tossed on the next column
      const wouldBeTossed: TeamIdx[] = []
      let newErrorSeat: number | undefined
      for (let teamIdx = 0; teamIdx < teamCount; teamIdx++) {
        const branded = toTeamIdx(teamIdx)
        if (hasValue(teamIdx, colIdx, CellValue.Error)) {
          wouldBeTossed.push(branded)
          // Track the seat that caused this error (for seat bonus)
          const seat = findErrorSeat(cellData, teamIdx, colIdx)
          if (seat !== undefined) newErrorSeat = seat
        } else if (tossedUp[colIdx]!.has(branded) && !hasAnswer(teamIdx, colIdx)) {
          wouldBeTossed.push(branded)
        }
      }

      // A is always a toss-up (2 teams eligible), B is always a bonus (1 team eligible).
      // When a Normal isAB column's error would leave only one team eligible, skip A and
      // route directly to B.
      let nq: number | undefined
      if (col.type === QuestionType.Normal && col.isAB && wouldBeTossed.length === teamCount - 1) {
        nq = keyToIdx.get(`${col.number}B`)
        const aColIdx = keyToIdx.get(`${col.number}A`)
        if (aColIdx !== undefined) {
          colStatuses[aColIdx] = ColStatus.Skipped
          greyAllTeams(aColIdx)
        }
      } else {
        nq = nextQuestion(col)
      }

      if (nq !== undefined) {
        for (const teamIdx of wouldBeTossed) {
          tossedUp[nq]!.add(teamIdx)
        }
        // Propagate error seat: new error replaces, otherwise carry existing
        lastErrorSeat[nq] = newErrorSeat ?? lastErrorSeat[colIdx]
      }
    }
  }

  // Build fouledQuizzers: quizzers who fouled on a numbered question
  // can't answer subsequent sub-parts (A/B) of the same question
  const fouledQuizzers: Set<TeamSeat>[] = cols.map(() => new Set<TeamSeat>())
  for (let colIdx = 0; colIdx < cols.length; colIdx++) {
    const col = cols[colIdx]!
    if (!col.isAB) continue

    for (let teamIdx = 0; teamIdx < teamCount; teamIdx++) {
      const team = cellData[teamIdx]!
      for (let seatIdx = 0; seatIdx < team.length; seatIdx++) {
        if (team[seatIdx]![colIdx] !== CellValue.Foul) continue

        const key = teamSeatKey(toTeamIdx(teamIdx), toSeatIdx(seatIdx))
        // Foul on Normal → grey this quizzer on A and B
        if (col.type === QuestionType.Normal) {
          const aColIdx = keyToIdx.get(`${col.number}A`)
          const bColIdx = keyToIdx.get(`${col.number}B`)
          if (aColIdx !== undefined) fouledQuizzers[aColIdx]!.add(key)
          if (bColIdx !== undefined) fouledQuizzers[bColIdx]!.add(key)
        }
        // Foul on A → grey this quizzer on B
        if (col.type === QuestionType.A) {
          const bColIdx = keyToIdx.get(`${col.number}B`)
          if (bColIdx !== undefined) fouledQuizzers[bColIdx]!.add(key)
        }
        // Foul on B → nothing further
      }
    }
  }

  // Grey out non-eligible teams on overtime columns
  if (otIneligibility) {
    for (const [colIdx, ineligible] of otIneligibility) {
      for (const teamIdx of ineligible) {
        disabledTeams[colIdx]!.add(toTeamIdx(teamIdx))
      }
    }
  }

  return { disabledTeams, disabledSeats, tossedUp, fouledQuizzers, colStatuses }
}
