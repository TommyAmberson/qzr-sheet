import { describe, it, expect } from 'vitest'

import { allocateCells } from '../scheduleAlloc'
import { buildElimPlan, buildPrelimPlan, type QuizDef } from '../scheduleBuild'
import { PRELIM_DRAW_PATTERNS } from '../prelimDraw'
import type { Row } from '../scheduleSort'
import type { MeetRoom, MeetSlot } from '../api'

function room(id: number, sortOrder: number): MeetRoom {
  return { id, name: `R${id}`, sortOrder, hasCode: false }
}

function slot(id: number, sortOrder: number): MeetSlot {
  return {
    id,
    meetId: 1,
    startAt: '2026-05-08T13:00:00.000Z',
    durationMinutes: 25,
    kind: 'quiz',
    eventLabel: null,
    sortOrder,
  }
}

function makeGrid(slotCount: number, roomCount: number) {
  const slots = Array.from({ length: slotCount }, (_, i) => slot(100 + i, i))
  const rooms = Array.from({ length: roomCount }, (_, i) => room(10 + i, i))
  return { slots, rooms }
}

function rowsFor(teamCount: number): Row[] {
  return PRELIM_DRAW_PATTERNS[teamCount]!.map((r) => [r[0], r[1], r[2]] as Row)
}

/** Walk a quiz plan and check the "no team in two rooms at once"
 *  invariant per division: within any single slot, no letter appears
 *  in more than one quiz of the same division. Returns null on
 *  success, or a description of the first conflict found. */
function findPlanConflict(plan: QuizDef[]): string | null {
  const bySlotDiv = new Map<string, Map<string, string>>() // "slot|div" → letter → label
  for (const def of plan) {
    const key = `${def.slotId}|${def.division}`
    let placed = bySlotDiv.get(key)
    if (!placed) {
      placed = new Map()
      bySlotDiv.set(key, placed)
    }
    for (const seat of def.seats) {
      if (!seat.letter) continue
      const existing = placed.get(seat.letter)
      if (existing) {
        return `Division ${def.division} slot ${def.slotId}: letter ${seat.letter} appears in ${existing} and ${def.label}`
      }
      placed.set(seat.letter, def.label)
    }
  }
  return null
}

/** Quiz numbers per division should be sequential starting from 1. */
function findNumberingGap(plan: QuizDef[]): string | null {
  const byDiv = new Map<string, QuizDef[]>()
  for (const def of plan) {
    if (def.phase !== 'prelim') continue
    let arr = byDiv.get(def.division)
    if (!arr) {
      arr = []
      byDiv.set(def.division, arr)
    }
    arr.push(def)
  }
  for (const [division, defs] of byDiv) {
    const nums = defs
      .map((d) => Number(d.label.replace(`D${division}-Q`, '')))
      .sort((a, b) => a - b)
    for (let i = 0; i < nums.length; i++) {
      if (nums[i] !== i + 1) {
        return `Division ${division}: quiz numbers are ${nums.join(',')} — expected sequential 1..${nums.length}`
      }
    }
  }
  return null
}

describe('buildPrelimPlan + allocateCells — integration', () => {
  it('user worked example (3×3, D1=4 + D2=5): numbering is gap-free', () => {
    // NB: the 4-team and 5-team rule books only support K=1 disjoint
    // tuples, so the 3×3 layout (which forces K=2 at slot 2 for D1
    // and slot 1/3 for D2) WILL have within-slot letter conflicts —
    // unavoidable rule-book limitation. The test just checks that
    // numbering remains clean and that every quiz gets placed.
    const { slots, rooms } = makeGrid(3, 3)
    const alloc = allocateCells(['D1', 'D2'], { D1: 4, D2: 5 }, slots, rooms)
    const plan: QuizDef[] = [
      ...buildPrelimPlan('1', alloc.perDivision.get('D1')!, rowsFor(4), new Set()),
      ...buildPrelimPlan('2', alloc.perDivision.get('D2')!, rowsFor(5), new Set()),
    ]
    expect(findNumberingGap(plan)).toBeNull()
    expect(plan.filter((d) => d.division === '1')).toHaveLength(4)
    expect(plan.filter((d) => d.division === '2')).toHaveLength(5)
  })

  it('large meet (9×5, D1=9 + D2=15 + D3=20): no slot conflicts under Populate', () => {
    const { slots, rooms } = makeGrid(9, 5)
    const alloc = allocateCells(['D1', 'D2', 'D3'], { D1: 9, D2: 15, D3: 20 }, slots, rooms)
    const plan: QuizDef[] = [
      ...buildPrelimPlan('1', alloc.perDivision.get('D1')!, rowsFor(9), new Set()),
      ...buildPrelimPlan('2', alloc.perDivision.get('D2')!, rowsFor(15), new Set()),
      ...buildPrelimPlan('3', alloc.perDivision.get('D3')!, rowsFor(20), new Set()),
    ]
    expect(findPlanConflict(plan)).toBeNull()
    expect(findNumberingGap(plan)).toBeNull()
  })

  it('large meet with D2 lateness: slot 1 of D2 contains no late letters', () => {
    const { slots, rooms } = makeGrid(9, 5)
    const alloc = allocateCells(['D1', 'D2', 'D3'], { D1: 9, D2: 15, D3: 20 }, slots, rooms)
    const d2LateLetters = new Set(['J', 'K', 'L', 'M', 'N', 'O'])
    const plan: QuizDef[] = [
      ...buildPrelimPlan('1', alloc.perDivision.get('D1')!, rowsFor(9), new Set()),
      ...buildPrelimPlan('2', alloc.perDivision.get('D2')!, rowsFor(15), d2LateLetters),
      ...buildPrelimPlan('3', alloc.perDivision.get('D3')!, rowsFor(20), new Set()),
    ]
    // No D2 quiz in slot 1 (the earliest slot) should contain a late letter.
    const d2Slot1 = plan.filter((d) => d.division === '2' && d.slotId === 100)
    expect(d2Slot1.length).toBeGreaterThan(0)
    for (const quiz of d2Slot1) {
      for (const seat of quiz.seats) {
        expect(d2LateLetters.has(seat.letter ?? '')).toBe(false)
      }
    }
    // And slot 1 of D2 must still be conflict-free.
    expect(findPlanConflict(plan.filter((d) => d.division === '2' && d.slotId === 100))).toBeNull()
  })

  it('large meet with D3 lateness (S, T): slot 1 of D3 contains no late letters', () => {
    const { slots, rooms } = makeGrid(9, 5)
    const alloc = allocateCells(['D1', 'D2', 'D3'], { D1: 9, D2: 15, D3: 20 }, slots, rooms)
    const d3LateLetters = new Set(['S', 'T'])
    const plan: QuizDef[] = [
      ...buildPrelimPlan('1', alloc.perDivision.get('D1')!, rowsFor(9), new Set()),
      ...buildPrelimPlan('2', alloc.perDivision.get('D2')!, rowsFor(15), new Set()),
      ...buildPrelimPlan('3', alloc.perDivision.get('D3')!, rowsFor(20), d3LateLetters),
    ]
    const d3Slot1 = plan.filter((d) => d.division === '3' && d.slotId === 100)
    expect(d3Slot1.length).toBeGreaterThan(0)
    for (const quiz of d3Slot1) {
      for (const seat of quiz.seats) {
        expect(seat.letter).not.toBe('S')
        expect(seat.letter).not.toBe('T')
      }
    }
  })

  it('exhaustive sweep: every team count 4-21 in K=1 produces no slot conflicts', () => {
    for (const teamCount of Object.keys(PRELIM_DRAW_PATTERNS).map(Number)) {
      const { slots, rooms } = makeGrid(teamCount, 1)
      const alloc = allocateCells(['D1'], { D1: teamCount }, slots, rooms)
      const plan = buildPrelimPlan('1', alloc.perDivision.get('D1')!, rowsFor(teamCount), new Set())
      expect(findPlanConflict(plan), `team count ${teamCount}`).toBeNull()
      expect(plan).toHaveLength(teamCount)
      expect(findNumberingGap(plan), `team count ${teamCount}`).toBeNull()
    }
  })

  it('exhaustive sweep with lateness: every team count 4-21 in K=1 still conflict-free', () => {
    for (const teamCount of Object.keys(PRELIM_DRAW_PATTERNS).map(Number)) {
      const { slots, rooms } = makeGrid(teamCount, 1)
      const alloc = allocateCells(['D1'], { D1: teamCount }, slots, rooms)
      // Mark the highest letter (most-late team per Winkler) as late.
      const lateLetter = String.fromCharCode(65 + teamCount - 1)
      const plan = buildPrelimPlan(
        '1',
        alloc.perDivision.get('D1')!,
        rowsFor(teamCount),
        new Set([lateLetter]),
      )
      expect(findPlanConflict(plan), `team count ${teamCount}, late ${lateLetter}`).toBeNull()
    }
  })

  it('20-team in 3 rooms × 7 slots: no slot conflicts under Populate or Lateness', () => {
    const { slots, rooms } = makeGrid(7, 3)
    const alloc = allocateCells(['D1'], { D1: 20 }, slots, rooms)
    const cells = alloc.perDivision.get('D1')!
    expect(cells).toHaveLength(20)

    // Populate (no lateness).
    const planPop = buildPrelimPlan('1', cells, rowsFor(20), new Set())
    expect(findPlanConflict(planPop)).toBeNull()
    expect(findNumberingGap(planPop)).toBeNull()

    // Sort by lateness (S, T late).
    const planLate = buildPrelimPlan('1', cells, rowsFor(20), new Set(['S', 'T']))
    expect(findNumberingGap(planLate)).toBeNull()
    // Slot 1 (first 3 cells) must contain no late letters AND be
    // conflict-free.
    const slot1 = planLate.filter((d) => d.slotId === 100)
    for (const quiz of slot1) {
      for (const seat of quiz.seats) {
        expect(seat.letter).not.toBe('S')
        expect(seat.letter).not.toBe('T')
      }
    }
    expect(findPlanConflict(slot1)).toBeNull()
  })

  it('21-team in 3 rooms × 7 slots: no slot conflicts', () => {
    const { slots, rooms } = makeGrid(7, 3)
    const alloc = allocateCells(['D1'], { D1: 21 }, slots, rooms)
    const plan = buildPrelimPlan('1', alloc.perDivision.get('D1')!, rowsFor(21), new Set())
    expect(findPlanConflict(plan)).toBeNull()
    expect(plan).toHaveLength(21)
  })

  it('all divisions late together (extreme stress): no slot conflicts in early slots', () => {
    const { slots, rooms } = makeGrid(9, 5)
    const alloc = allocateCells(['D1', 'D2', 'D3'], { D1: 9, D2: 15, D3: 20 }, slots, rooms)
    const plan: QuizDef[] = [
      ...buildPrelimPlan('1', alloc.perDivision.get('D1')!, rowsFor(9), new Set(['I'])),
      ...buildPrelimPlan('2', alloc.perDivision.get('D2')!, rowsFor(15), new Set(['M', 'N', 'O'])),
      ...buildPrelimPlan('3', alloc.perDivision.get('D3')!, rowsFor(20), new Set(['S', 'T'])),
    ]
    // The earliest slot of each division should have no late letters
    // in any of its quizzes.
    const earliestSlot = 100
    for (const div of ['1', '2', '3']) {
      const lateLetters: Record<string, string[]> = {
        '1': ['I'],
        '2': ['M', 'N', 'O'],
        '3': ['S', 'T'],
      }
      const lateSet = new Set(lateLetters[div])
      const earliestQuizzes = plan.filter((d) => d.division === div && d.slotId === earliestSlot)
      for (const quiz of earliestQuizzes) {
        for (const seat of quiz.seats) {
          expect(lateSet.has(seat.letter ?? '')).toBe(false)
        }
      }
    }
    // D1 (9 teams, K=1) must be fully conflict-free. D2 (15-team
    // K=2) and D3 (20-team K=3 with S/T late forcing 3 late rows to
    // share a slot) can have unavoidable conflicts at the very last
    // slots, but the early slots must stay clean.
    expect(findPlanConflict(plan.filter((d) => d.division === '1'))).toBeNull()
    // Earliest 4 slots across the whole plan must be conflict-free
    // per division (covers slot 100..103 of 100..108 in the test
    // grid).
    const earlySlots = new Set([100, 101, 102, 103])
    expect(findPlanConflict(plan.filter((d) => earlySlots.has(d.slotId)))).toBeNull()
  })
})

describe('buildPrelimPlan — quiz numbering and labels', () => {
  it('numbers quizzes sequentially per non-empty cell', () => {
    const cells = [
      { slotId: 100, roomId: 10 },
      { slotId: 101, roomId: 10 },
      { slotId: 102, roomId: 10 },
      { slotId: 103, roomId: 10 },
    ]
    const rows: Row[] = [
      ['A', 'B', 'C'],
      ['D', 'E', 'F'],
      ['G', 'H', 'I'],
    ]
    // 4 cells, 3 rows → 1 trailing empty cell; labels still Q1-Q3.
    const plan = buildPrelimPlan('1', cells, rows, new Set())
    expect(plan.map((d) => d.label)).toEqual(['D1-Q1', 'D1-Q2', 'D1-Q3'])
  })

  it('skips empty cells when numbering — never produces a "D1-Q4" with no row', () => {
    // Force an empty cell in the middle by giving fewer rows than cells.
    const cells = [
      { slotId: 100, roomId: 10 },
      { slotId: 101, roomId: 10 },
      { slotId: 102, roomId: 10 },
    ]
    const rows: Row[] = [
      ['A', 'B', 'C'],
      ['D', 'E', 'F'],
    ]
    const plan = buildPrelimPlan('1', cells, rows, new Set())
    expect(plan).toHaveLength(2)
    expect(plan.map((d) => d.label)).toEqual(['D1-Q1', 'D1-Q2'])
  })

  it('seats come from the placed row letters', () => {
    const cells = [{ slotId: 100, roomId: 10 }]
    const rows: Row[] = [['X', 'Y', 'Z']]
    const plan = buildPrelimPlan('1', cells, rows, new Set())
    expect(plan[0]!.seats).toEqual([
      { seatNumber: 1, letter: 'X' },
      { seatNumber: 2, letter: 'Y' },
      { seatNumber: 3, letter: 'Z' },
    ])
  })

  it('preserves cell slotId and roomId', () => {
    const cells = [{ slotId: 42, roomId: 99 }]
    const rows: Row[] = [['A', 'B', 'C']]
    const plan = buildPrelimPlan('Div', cells, rows, new Set())
    expect(plan[0]!.slotId).toBe(42)
    expect(plan[0]!.roomId).toBe(99)
    expect(plan[0]!.division).toBe('Div')
    expect(plan[0]!.phase).toBe('prelim')
    expect(plan[0]!.label).toBe('DDiv-Q1')
  })
})

describe('buildElimPlan — letter labels and placeholder seats', () => {
  it('labels elim quizzes with letters (QA, QB, QC, ...)', () => {
    const cells = [
      { slotId: 100, roomId: 10 },
      { slotId: 100, roomId: 11 },
      { slotId: 101, roomId: 10 },
    ]
    const plan = buildElimPlan('1', cells)
    expect(plan.map((d) => d.label)).toEqual(['D1-QA', 'D1-QB', 'D1-QC'])
  })

  it('uses placeholder A/B/C seats (resolved later by seed refs)', () => {
    const plan = buildElimPlan('1', [{ slotId: 100, roomId: 10 }])
    expect(plan[0]!.seats).toEqual([
      { seatNumber: 1, letter: 'A' },
      { seatNumber: 2, letter: 'B' },
      { seatNumber: 3, letter: 'C' },
    ])
  })

  it('returns empty plan for empty cells list', () => {
    expect(buildElimPlan('1', [])).toEqual([])
  })

  it('phase is "elim"', () => {
    const plan = buildElimPlan('1', [{ slotId: 100, roomId: 10 }])
    expect(plan[0]!.phase).toBe('elim')
  })
})
