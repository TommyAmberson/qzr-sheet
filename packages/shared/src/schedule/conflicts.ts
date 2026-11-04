import { foldName, resultKey } from '../results'
import { eventCells } from './frame'
import { indexOfLetter, letterOf } from './letters'
import { quizNumber } from './names'
import { lateLetters, type ScheduleDocument, type ScheduleQuiz, type Seat } from './scheduleFile'

/**
 * A broken rule from docs/schedule-invariants.md: its ID, the quizzes involved (none when the
 * problem is something missing), and a short reason. Warnings make a schedule worse, not wrong.
 */
export interface Conflict {
  rule: string
  warning: boolean
  quizzes: string[]
  reason: string
}

interface SlotTime {
  order: number
  day: number
  start: number
  end: number
}

/** Where each slot sits: its order down the grid, its day, and its start and end in minutes */
function slotTimes(doc: ScheduleDocument): Map<string, SlotTime> {
  const times = new Map<string, SlotTime>()
  let day = 0
  let order = 0
  for (const row of doc.frame) {
    if (row.kind === 'day') day++
    if (row.kind === 'slot') {
      times.set(row.id, { order: order++, day, start: row.at, end: row.at + row.minutes })
    }
  }
  return times
}

/** A seat's team, as a key two seats share when they name the same team; null for an empty seat */
function teamKey(q: ScheduleQuiz, seat: Seat): string | null {
  switch (seat.kind) {
    case 'letter':
      return `letter:${seat.letter}`
    case 'rank':
      return `rank:${seat.rank}`
    case 'new':
      return `new:${seat.rank}`
    case 'place':
      return `place:${seat.quiz}:${seat.place}`
    case 'points':
      return `points:${q.lane ?? ''}:${seat.place}`
    case 'empty':
      return null
  }
}

/**
 * The scoresheet's division, consolation flag and quiz number for a schedule quiz, which name its
 * results (research R10)
 */
export function scheduleQuizMeta(q: ScheduleQuiz): {
  division: string
  consolation: boolean
  quizNumber: string
} {
  return { division: q.division, consolation: (q.lane ?? 0) > 0, quizNumber: quizNumber(q) }
}

/** The key the meet stores this quiz's results under, as the scoresheet names them (research R10) */
export function resultName(q: ScheduleQuiz): string {
  return resultKey(scheduleQuizMeta(q))
}

function groupBy<T>(items: T[], key: (item: T) => string | null): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const k = key(item)
    if (k === null) continue
    const group = groups.get(k)
    if (group) group.push(item)
    else groups.set(k, [item])
  }
  return groups
}

/** Every hard rule and warning the schedule breaks, after any change (FR-037) */
export function checkSchedule(doc: ScheduleDocument): Conflict[] {
  const conflicts: Conflict[] = []
  const add = (rule: string, quizzes: ScheduleQuiz[], reason: string) =>
    conflicts.push({
      rule,
      warning: rule.startsWith('W'),
      quizzes: quizzes.map((q) => q.id),
      reason,
    })

  const times = slotTimes(doc)
  const divisions = new Map(doc.settings.divisions.map((d) => [d.id, d]))
  const byId = new Map(doc.quizzes.map((q) => [q.id, q]))
  const placed = doc.quizzes.filter((q) => q.cell && times.has(q.cell.slot))
  const timeOf = (q: ScheduleQuiz) => (q.cell ? times.get(q.cell.slot) : undefined)

  // H-1: a team in two quizzes in one slot
  for (const inSlot of groupBy(placed, (q) => q.cell!.slot).values()) {
    const seen = new Map<string, ScheduleQuiz>()
    for (const q of inSlot) {
      for (const seat of q.seats) {
        const key = teamKey(q, seat)
        if (key === null) continue
        const k = `${q.division}|${key}`
        const other = seen.get(k)
        if (other && other !== q)
          add('H-1', [other, q], `${describe(seat)} is in two quizzes at once`)
        else seen.set(k, q)
      }
    }
  }

  // H-2: two quizzes in one cell
  for (const inCell of groupBy(placed, (q) => `${q.cell!.slot}|${q.cell!.room}`).values()) {
    if (inCell.length > 1) add('H-2', inCell, 'Two quizzes in one room at once')
  }

  // H-3: a quiz in a room an event takes at that time
  const takenByEvents = eventCells(
    doc.frame,
    doc.events,
    doc.rooms.map((r) => r.id),
  )
  for (const q of doc.quizzes) {
    if (!q.cell) continue
    const t = times.get(q.cell.slot)
    // A cell whose slot is gone isn't over an event; it just has no time to check
    if (!t) continue
    if (takenByEvents.has(`${q.cell.slot}|${q.cell.room}`)) {
      add('H-3', [q], 'Its room has an event at this time')
    }
  }

  for (const q of doc.quizzes) {
    // H-4: a team twice in one quiz
    const keys = q.seats.map((s) => teamKey(q, s)).filter((k): k is string => k !== null)
    if (new Set(keys).size < keys.length) add('H-4', [q], 'The same team fills two seats')
    // H-5: three seats, or two for a deciding quiz; an empty seat isn't filled
    const filled = keys.length
    if (q.seats.some((s) => s.kind === 'empty')) add('H-5', [q], 'A seat is empty')
    else if (filled !== 3 && !(q.deciding && filled === 2))
      add('H-5', [q], 'A quiz has three seats')
    // H-6: a division the schedule knows
    if (!divisions.has(q.division)) add('H-6', [q], 'Its division is not in the schedule')
  }

  // H-7: unique labels
  for (const same of groupBy(doc.quizzes, (q) => foldName(q.label)).values()) {
    if (same.length > 1) add('H-7', same, `Another quiz is also called ${same[0]!.label}`)
  }

  for (const division of doc.settings.divisions) {
    const mine = doc.quizzes.filter((q) => q.division === division.id)
    const prelims = mine.filter((q) => q.phase === 'prelim')
    const elims = mine.filter((q) => q.phase === 'elim')

    // H-9: every team plays the set number of prelims
    if (prelims.length > 0) {
      // Every team counts, so one left out of every prelim is caught too
      const counts = new Map(
        Array.from({ length: division.teams }, (_, i) => [letterOf(i), 0] as [string, number]),
      )
      for (const q of prelims) {
        for (const s of q.seats)
          if (s.kind === 'letter') counts.set(s.letter, (counts.get(s.letter) ?? 0) + 1)
      }
      const off = [...counts].filter(([, n]) => n !== doc.settings.quizzesPerTeam).map(([l]) => l)
      if (off.length > 0) {
        const quizzes = prelims.filter((q) =>
          q.seats.some((s) => s.kind === 'letter' && off.includes(s.letter)),
        )
        add(
          'H-9',
          quizzes,
          `${off.sort().join(', ')} don't play ${doc.settings.quizzesPerTeam} prelims`,
        )
      }
    }

    // H-10: letters within the division
    for (const q of prelims) {
      for (const s of q.seats) {
        if (s.kind === 'letter' && indexOfLetter(s.letter) >= division.teams) {
          add('H-10', [q], `Letter ${s.letter} is outside the division's ${division.teams} teams`)
        }
      }
    }

    // H-11: prelims before elims
    const placedPrelims = prelims.filter(timeOf)
    const placedElims = elims.filter(timeOf)
    if (placedPrelims.length > 0 && placedElims.length > 0) {
      const lastPrelim = Math.max(...placedPrelims.map((q) => timeOf(q)!.order))
      const firstElim = Math.min(...placedElims.map((q) => timeOf(q)!.order))
      if (firstElim <= lastPrelim) {
        const late = placedPrelims.filter((q) => timeOf(q)!.order >= firstElim)
        const early = placedElims.filter((q) => timeOf(q)!.order <= lastPrelim)
        add('H-11', [...late, ...early], 'Prelims must all come before the elims')
      }
    }

    // The intermediate on each line, and the ranks it holds
    const lineQuizzes = groupBy(
      elims.filter((q) => q.line !== undefined),
      (q) => String(q.line),
    )
    const rerankRange = new Map<number, number>()
    for (const [line, quizzes] of lineQuizzes) {
      if (division.elims.lines[Number(line)]?.intermediate?.kind !== 'rerank') continue
      for (const q of quizzes)
        for (const s of q.seats) if (s.kind === 'rank') rerankRange.set(s.rank, Number(line))
    }
    // The quizzes a New n waits for: its line's whole intermediate, or, for an intermediate inside a
    // bracket (the 10-team bracket's X), the quiz that seats rank n
    const feedersOf = (rank: number, users: ScheduleQuiz[]): ScheduleQuiz[] => {
      const line = rerankRange.get(rank)
      if (line !== undefined) return lineQuizzes.get(String(line)) ?? []
      return elims.filter(
        (x) => !users.includes(x) && x.seats.some((s) => s.kind === 'rank' && s.rank === rank),
      )
    }

    for (const q of elims) {
      const t = timeOf(q)
      for (const s of q.seats) {
        // H-12 and H-17: a place in an earlier quiz of the same division
        if (s.kind === 'place') {
          const source = byId.get(s.quiz)
          if (!source || source.division !== q.division) {
            add(
              'H-17',
              [q],
              `Takes a team from ${source ? source.label : "a quiz that doesn't exist"}`,
            )
            continue
          }
          const st = timeOf(source)
          if (t && st && st.order >= t.order)
            add('H-12', [q], `Takes a team from ${source.label}, which isn't earlier`)
        }
        // H-12 and W-3: a New seat after every quiz of its intermediate, with time to total
        if (s.kind === 'new' && t) {
          const inter = feedersOf(s.rank, [q])
            .map(timeOf)
            .filter((x): x is SlotTime => !!x)
          if (inter.length === 0) continue
          const last = inter.reduce((a, b) => (b.order > a.order ? b : a))
          if (last.order >= t.order)
            add('H-12', [q], `Uses New ${s.rank} before the intermediate ends`)
          else if (last.day === t.day && t.start - last.end < doc.settings.totallingMinutes) {
            add(
              'W-3',
              [q],
              `Starts ${t.start - last.end} min after the intermediate; totalling needs ${doc.settings.totallingMinutes}`,
            )
          }
        }
      }
    }

    // H-13: a lane's deciding quiz after its other quizzes
    for (const decider of placedElims.filter((q) => q.deciding)) {
      const after = placedElims.filter(
        (q) =>
          q !== decider &&
          q.lane === decider.lane &&
          q.line === undefined &&
          timeOf(q)!.order >= timeOf(decider)!.order,
      )
      if (after.length > 0)
        add('H-13', [decider, ...after], 'The deciding quiz must come last in its lane')
    }

    if (elims.length > 0) {
      // H-14: every rank enters once; a round robin may seat a rank more than once
      const roundRobin = (q: ScheduleQuiz) =>
        q.lane !== undefined && division.elims.lanes[q.lane]?.format === 'roundRobin'
      const entries = new Map<number, ScheduleQuiz[]>()
      for (const q of elims) {
        for (const s of q.seats)
          if (s.kind === 'rank') entries.set(s.rank, [...(entries.get(s.rank) ?? []), q])
      }
      for (let rank = 1; rank <= division.teams; rank++) {
        const at = entries.get(rank) ?? []
        if (at.length === 0) add('H-14', [], `Rank ${rank} never enters the elims`)
        else if (at.filter((q) => !roundRobin(q)).length > 1) {
          add('H-14', [...new Set(at)], `Rank ${rank} enters the elims more than once`)
        }
      }

      // H-16: each New result of a reranking intermediate used once, and only within its range;
      // a round robin seats each of its teams more than once, which counts as one use (as H-14)
      const uses = new Map<number, ScheduleQuiz[]>()
      for (const q of elims)
        for (const s of q.seats)
          if (s.kind === 'new') uses.set(s.rank, [...(uses.get(s.rank) ?? []), q])
      for (const [rank, quizzes] of uses) {
        const times =
          quizzes.filter((q) => !roundRobin(q)).length + (quizzes.some(roundRobin) ? 1 : 0)
        if (feedersOf(rank, quizzes).length === 0)
          add('H-16', quizzes, `New ${rank} isn't in any intermediate's range`)
        else if (times > 1) add('H-16', quizzes, `New ${rank} is used more than once`)
      }
      for (const rank of rerankRange.keys()) {
        if (!uses.has(rank)) add('H-16', [], `New ${rank} is never used`)
      }
    }

    // H-15: each result sent at most once
    for (const [key, quizzes] of groupBy(
      elims.flatMap((q) => q.seats.filter((s) => s.kind === 'place').map((s) => ({ q, s }))),
      ({ s }) => (s.kind === 'place' ? `${s.quiz}:${s.place}` : null),
    )) {
      if (quizzes.length > 1) {
        const [quiz, place] = key.split(':')
        add(
          'H-15',
          quizzes.map((x) => x.q),
          `${place} of ${byId.get(quiz!)?.label ?? quiz} is sent twice`,
        )
      }
    }

    // H-18: letters and teams one to one
    const draw = doc.draw[division.id]
    if (draw) {
      for (const same of groupBy(draw.teams, (t) => t.letter ?? null).values()) {
        if (same.length > 1) add('H-18', [], `Two teams hold letter ${same[0]!.letter}`)
      }
    }

    // W-1: no two teams meet twice in the prelims, from 7 teams
    if (division.teams >= 7) {
      const met = new Set<string>()
      for (const q of prelims) {
        const letters = q.seats.flatMap((s) => (s.kind === 'letter' ? [s.letter] : [])).sort()
        for (let i = 0; i < letters.length; i++) {
          for (let j = i + 1; j < letters.length; j++) {
            const pair = `${letters[i]}-${letters[j]}`
            if (met.has(pair)) add('W-1', [q], `${letters[i]} and ${letters[j]} meet again`)
            met.add(pair)
          }
        }
      }
    }

    // W-2: a late team in the division's first prelim slot
    const late = lateLetters(doc, division.id)
    if (late.size > 0 && placedPrelims.length > 0) {
      const first = Math.min(...placedPrelims.map((q) => timeOf(q)!.order))
      for (const q of placedPrelims.filter((q) => timeOf(q)!.order === first)) {
        if (q.seats.some((s) => s.kind === 'letter' && late.has(s.letter)))
          add('W-2', [q], 'A late team plays in the first slot')
      }
    }
  }

  // W-4: every quiz on the schedule
  for (const q of doc.quizzes) if (!q.cell) add('W-4', [q], 'Not on the schedule yet')

  // W-5: each quiz's results have a name of their own
  for (const same of groupBy(doc.quizzes, resultName).values()) {
    if (same.length > 1) add('W-5', same, 'Their results would be saved under the same name')
  }

  return conflicts
}

function describe(seat: Seat): string {
  switch (seat.kind) {
    case 'letter':
      return seat.letter
    case 'rank':
      return `Rank ${seat.rank}`
    case 'new':
      return `New ${seat.rank}`
    case 'place':
      return `${seat.place} of a quiz`
    case 'points':
      return `${seat.place} in points`
    case 'empty':
      return 'An empty seat'
  }
}
