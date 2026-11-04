import { describe, expect, it } from 'vitest'
import { checkSchedule, resultName, type Conflict } from '../conflicts'
import { defaultElims } from '../elims'
import { generateSchedule } from '../reflow'
import { newScheduleDocument } from '../scheduleFile'
import type { ScheduleDocument, ScheduleQuiz } from '../scheduleFile'
import { at, doc, quiz, seats } from './fixtures'

/** The rule book's 6-team table, one quiz per slot in Room 1: a schedule with nothing wrong */
function sixTeams(): ScheduleQuiz[] {
  return ['ACF', 'BDA', 'CEB', 'DFC', 'EAD', 'FBE'].map((letters, i) =>
    quiz(`p${i + 1}`, { cell: at(`s${i + 1}`), seats: seats(...letters) }),
  )
}

function rule(conflicts: Conflict[], id: string): Conflict[] {
  return conflicts.filter((c) => c.rule === id)
}

function flagged(conflicts: Conflict[], id: string): string[] {
  return [...new Set(rule(conflicts, id).flatMap((c) => c.quizzes))].sort()
}

describe('checkSchedule', () => {
  it('finds nothing wrong with a sound prelim schedule', () => {
    expect(checkSchedule(doc({ quizzes: sixTeams() }))).toEqual([])
  })

  it('H-1: a team in two quizzes in one slot', () => {
    const quizzes = sixTeams()
    quizzes[1]!.cell = at('s1', 'r2')
    expect(flagged(checkSchedule(doc({ quizzes })), 'H-1')).toEqual(['p1', 'p2'])
  })

  it('H-2: two quizzes in one room in one slot', () => {
    const quizzes = sixTeams()
    quizzes[3]!.cell = at('s1')
    expect(flagged(checkSchedule(doc({ quizzes })), 'H-2')).toEqual(['p1', 'p4'])
  })

  it('H-3: a quiz in a room an event takes at that time', () => {
    const d = doc({ quizzes: sixTeams() })
    // A coaches' meeting in Room 1 during the second slot, and a quiz in its cell
    d.events.push({
      id: 'meeting',
      label: 'Coaches meeting',
      slot: 's2',
      rooms: ['r1'],
      pinned: true,
    })
    d.quizzes[0]!.cell = { slot: 's2', room: 'r1' }
    expect(flagged(checkSchedule(d), 'H-3')).toContain('p1')
    // In another room it's clear
    d.quizzes[0]!.cell = { slot: 's2', room: 'r2' }
    expect(flagged(checkSchedule(d), 'H-3')).not.toContain('p1')
  })

  it('H-4: a team twice in one quiz', () => {
    const quizzes = sixTeams()
    quizzes[0]!.seats = seats('A', 'A', 'F')
    expect(flagged(checkSchedule(doc({ quizzes })), 'H-4')).toEqual(['p1'])
  })

  it("H-5: a seat not filled, but not an absent team's seat", () => {
    const quizzes = sixTeams()
    quizzes[0]!.seats = seats('A', 'C', '_')
    const d = doc({ quizzes })
    d.draw.d1 = {
      stale: false,
      teams: [{ name: 'Lakeview 1', late: false, absent: true, letter: 'B' }],
    }
    expect(flagged(checkSchedule(d), 'H-5')).toEqual(['p1'])
  })

  it('H-6: a quiz in a division the schedule has no settings for', () => {
    const quizzes = sixTeams()
    quizzes[0]!.division = 'd9'
    expect(flagged(checkSchedule(doc({ quizzes })), 'H-6')).toEqual(['p1'])
  })

  it('H-7: two quizzes with the same label', () => {
    const quizzes = sixTeams()
    quizzes[1]!.label = quizzes[0]!.label
    expect(flagged(checkSchedule(doc({ quizzes })), 'H-7')).toEqual(['p1', 'p2'])
  })

  it('H-9: a team with too few prelims', () => {
    const quizzes = sixTeams().slice(1)
    // Dropping ACF leaves A, C and F with two quizzes each
    expect(flagged(checkSchedule(doc({ quizzes })), 'H-9')).toEqual(['p2', 'p3', 'p4', 'p5', 'p6'])
  })

  it('H-10: a letter beyond the division', () => {
    const quizzes = sixTeams()
    quizzes[0]!.seats = seats('A', 'C', 'G')
    expect(flagged(checkSchedule(doc({ quizzes })), 'H-10')).toEqual(['p1'])
  })

  it("H-11: an elim at or before one of its division's prelims", () => {
    const quizzes = [
      ...sixTeams().slice(0, 5),
      quiz('e1', { phase: 'elim', lane: 0, cell: at('s5', 'r2'), seats: seats('1', '2', '3') }),
    ]
    expect(flagged(checkSchedule(doc({ quizzes })), 'H-11')).toEqual(['e1', 'p5'])
  })

  it("H-12: a quiz taking a team from a quiz that isn't earlier", () => {
    const d = doc({}, 6)
    d.quizzes = [
      quiz('A', { phase: 'elim', lane: 0, cell: at('s2'), seats: seats('1', '4', '5') }),
      quiz('B', { phase: 'elim', lane: 0, cell: at('s2', 'r2'), seats: seats('2', '3', '6') }),
      quiz('C', {
        phase: 'elim',
        lane: 0,
        cell: at('s2', 'r3'),
        seats: seats('2ofA', '2ofB', '3ofA'),
      }),
    ]
    d.rooms.push({ id: 'r3', name: 'Room 3' })
    expect(flagged(checkSchedule(d), 'H-12')).toEqual(['C'])
  })

  it("H-12: a New seat before all of its intermediate's quizzes", () => {
    const d = doc({}, 6)
    d.settings.divisions[0]!.elims = {
      lanes: [
        {
          size: 3,
          format: 'bracket',
          finals: true,
          label: { kind: 'suffix' },
          lettering: 'continue',
        },
        {
          size: 3,
          format: 'bracket',
          finals: true,
          label: { kind: 'suffix' },
          lettering: 'continue',
        },
      ],
      lines: [{ intermediate: { quizzes: 1, kind: 'rerank', above: 1 } }],
    }
    d.quizzes = [
      quiz('X', { phase: 'elim', line: 0, cell: at('s2'), seats: seats('3', '4', '5') }),
      quiz('A', { phase: 'elim', lane: 0, cell: at('s2', 'r2'), seats: seats('1', '2', 'N3') }),
      quiz('I', { phase: 'elim', lane: 1, cell: at('s4'), seats: seats('N4', 'N5', '6') }),
    ]
    expect(flagged(checkSchedule(d), 'H-12')).toEqual(['A'])
  })

  it("H-13: a lane's deciding quiz before another of its quizzes", () => {
    const d = doc({}, 3)
    d.quizzes = [
      quiz('A', { phase: 'elim', lane: 0, cell: at('s3'), seats: seats('1', '2', '3') }),
      quiz('F', {
        phase: 'elim',
        lane: 0,
        deciding: true,
        cell: at('s2'),
        seats: seats('1ofA', '_', '_'),
      }),
    ]
    expect(flagged(checkSchedule(d), 'H-13')).toEqual(['A', 'F'])
  })

  it('H-14: a rank that never enters the elims, or enters a bracket twice', () => {
    const d = doc({}, 6)
    d.quizzes = [
      quiz('A', { phase: 'elim', lane: 0, cell: at('s2'), seats: seats('1', '4', '5') }),
      quiz('B', { phase: 'elim', lane: 0, cell: at('s2', 'r2'), seats: seats('2', '3', '5') }),
    ]
    const h14 = rule(checkSchedule(d), 'H-14')
    expect(h14.map((c) => c.reason).join(' ')).toMatch(/6/)
    expect(flagged(checkSchedule(d), 'H-14')).toEqual(['A', 'B'])
  })

  it('H-14: a round robin may seat a rank more than once', () => {
    const d = doc({}, 4)
    d.settings.divisions[0]!.elims.lanes = [
      {
        size: 4,
        format: 'roundRobin',
        perTeam: 2,
        finals: false,
        label: { kind: 'suffix' },
        lettering: 'continue',
      },
    ]
    d.quizzes = [
      quiz('A', { phase: 'elim', lane: 0, cell: at('s2'), seats: seats('1', '2', '3') }),
      quiz('B', { phase: 'elim', lane: 0, cell: at('s3'), seats: seats('4', '1', '2') }),
      quiz('C', { phase: 'elim', lane: 0, cell: at('s4'), seats: seats('3', '4', '1') }),
    ]
    expect(rule(checkSchedule(d), 'H-14')).toEqual([])
  })

  it('H-15: a result sent to two seats', () => {
    const d = doc({}, 3)
    d.quizzes = [
      quiz('A', { phase: 'elim', lane: 0, cell: at('s1'), seats: seats('1', '2', '3') }),
      quiz('B', { phase: 'elim', lane: 0, cell: at('s2'), seats: seats('1ofA', '2ofA', '_') }),
      quiz('C', { phase: 'elim', lane: 0, cell: at('s3'), seats: seats('1ofA', '3ofA', '_') }),
    ]
    expect(flagged(checkSchedule(d), 'H-15')).toEqual(['B', 'C'])
  })

  it('H-16: a New result used twice, unused, or outside its range', () => {
    const d = doc({}, 6)
    d.settings.divisions[0]!.elims = {
      lanes: [
        {
          size: 3,
          format: 'bracket',
          finals: true,
          label: { kind: 'suffix' },
          lettering: 'continue',
        },
        {
          size: 3,
          format: 'bracket',
          finals: true,
          label: { kind: 'suffix' },
          lettering: 'continue',
        },
      ],
      lines: [{ intermediate: { quizzes: 1, kind: 'rerank', above: 1 } }],
    }
    d.quizzes = [
      quiz('X', { phase: 'elim', line: 0, cell: at('s1'), seats: seats('3', '4', '5') }),
      quiz('A', { phase: 'elim', lane: 0, cell: at('s3'), seats: seats('1', '2', 'N3') }),
      quiz('I', { phase: 'elim', lane: 1, cell: at('s3', 'r2'), seats: seats('N3', 'N6', '6') }),
    ]
    const reasons = rule(checkSchedule(d), 'H-16')
      .map((c) => c.reason)
      .join(' | ')
    expect(reasons).toMatch(/New 3/)
    expect(reasons).toMatch(/New 4/)
    expect(reasons).toMatch(/New 5/)
    expect(reasons).toMatch(/New 6/)
  })

  it('H-17: a place in a quiz of another division, or of no quiz', () => {
    const d = doc({}, 3)
    d.settings.divisions.push({
      id: 'd2',
      name: 'Div 2',
      teams: 3,
      elims: { lanes: [], lines: [] },
    })
    d.quizzes = [
      quiz('A', { phase: 'elim', lane: 0, cell: at('s1'), seats: seats('1', '2', '3') }),
      quiz('B', {
        division: 'd2',
        label: 'Div 2 Quiz B',
        phase: 'elim',
        lane: 0,
        cell: at('s2'),
        seats: seats('1ofA', '1ofZZ', '_'),
      }),
    ]
    expect(rule(checkSchedule(d), 'H-17')).toHaveLength(2)
    expect(flagged(checkSchedule(d), 'H-17')).toEqual(['B'])
  })

  it('H-18: two teams holding one letter', () => {
    const d = doc({ quizzes: sixTeams() })
    d.draw.d1 = {
      stale: false,
      teams: [
        { name: 'Northside 1', late: false, absent: false, letter: 'A' },
        { name: 'Lakeview 1', late: false, absent: false, letter: 'A' },
      ],
    }
    expect(rule(checkSchedule(d), 'H-18')).toHaveLength(1)
  })

  it('W-1: two teams meeting twice in the prelims, from 7 teams', () => {
    const quizzes = ['ABC', 'ABG', 'EFG', 'CDE', 'ADF', 'BCF', 'DEG'].map((l, i) =>
      quiz(`p${i + 1}`, { cell: at(`s${(i % 6) + 1}`, i < 6 ? 'r1' : 'r2'), seats: seats(...l) }),
    )
    const w1 = rule(checkSchedule(doc({ quizzes }, 7)), 'W-1')
    expect(w1.length).toBeGreaterThan(0)
    expect(w1.every((c) => c.warning)).toBe(true)
  })

  it("W-2: a late team playing its division's first slot", () => {
    const d = doc({ quizzes: sixTeams() })
    d.settings.lateTeams = true
    d.draw.d1 = {
      stale: false,
      teams: [
        { name: 'Northside 1', late: true, absent: false, letter: 'C' },
        { name: 'Lakeview 1', late: true, absent: false, letter: 'B' },
      ],
    }
    expect(flagged(checkSchedule(d), 'W-2')).toEqual(['p1'])
  })

  it('a New seat may run in the slot right after its intermediate (FR-028a)', () => {
    const d = doc({}, 6)
    d.settings.divisions[0]!.elims = {
      lanes: [
        {
          size: 3,
          format: 'bracket',
          finals: true,
          label: { kind: 'suffix' },
          lettering: 'continue',
        },
        {
          size: 3,
          format: 'bracket',
          finals: true,
          label: { kind: 'suffix' },
          lettering: 'continue',
        },
      ],
      lines: [{ intermediate: { quizzes: 1, kind: 'rerank', above: 1 } }],
    }
    d.quizzes = [
      quiz('X', { phase: 'elim', line: 0, cell: at('s1'), seats: seats('3', '4', '5') }),
      quiz('A', { phase: 'elim', lane: 0, cell: at('s2'), seats: seats('1', '2', 'N3') }),
      quiz('I', { phase: 'elim', lane: 1, cell: at('s3'), seats: seats('N4', 'N5', '6') }),
    ]
    // The intermediate's row is long enough to total it, so the next slot is soon enough
    const conflicts = checkSchedule(d)
    expect(flagged(conflicts, 'H-12')).toEqual([])
    expect(conflicts.some((c) => c.rule === 'W-3')).toBe(false)
  })

  it('W-4: a quiz waiting in the tray, so the check never reports nothing to fix', () => {
    const quizzes = sixTeams()
    quizzes[5]!.cell = null
    const conflicts = checkSchedule(doc({ quizzes }))
    expect(flagged(conflicts, 'W-4')).toEqual(['p6'])
    expect(conflicts.length).toBeGreaterThan(0)
  })

  it('no clash for quizzes whose room is gone, which wait in the tray (H-2, W-4)', () => {
    const quizzes = sixTeams()
    quizzes[4]!.cell = { slot: quizzes[0]!.cell!.slot, room: 'gone' }
    quizzes[5]!.cell = { slot: quizzes[0]!.cell!.slot, room: 'gone' }
    const conflicts = checkSchedule(doc({ quizzes }))
    expect(flagged(conflicts, 'H-2')).toEqual([])
    expect(flagged(conflicts, 'W-4').sort()).toEqual(['p5', 'p6'])
  })

  it('an elim whose room is gone has no time, so prelims after it break nothing (H-11)', () => {
    const quizzes = sixTeams()
    const first = quizzes[0]!.cell!
    quizzes.push({
      id: 'e1',
      label: 'Div 1 Quiz A',
      division: 'd1',
      phase: 'elim',
      cell: { slot: first.slot, room: 'gone' },
      seats: [
        { kind: 'rank', rank: 1 },
        { kind: 'rank', rank: 2 },
        { kind: 'rank', rank: 3 },
      ],
      pinned: true,
    })
    expect(flagged(checkSchedule(doc({ quizzes })), 'H-11')).toEqual([])
  })

  it("W-4: a quiz whose row is gone, which the grid can't draw", () => {
    const quizzes = sixTeams()
    quizzes[5]!.cell = { slot: 'gone', room: quizzes[5]!.cell!.room }
    expect(flagged(checkSchedule(doc({ quizzes })), 'W-4')).toEqual(['p6'])
  })

  it('W-5: two quizzes whose results would share a name', () => {
    const d: ScheduleDocument = doc({}, 9)
    const lane = {
      format: 'bracket' as const,
      finals: true,
      label: { kind: 'suffix' as const },
      lettering: 'restart' as const,
    }
    d.settings.divisions[0]!.elims.lanes = [
      { ...lane, size: 3 },
      { ...lane, size: 3 },
      { ...lane, size: 3 },
    ]
    d.quizzes = [
      quiz('a', {
        label: 'Div 1C Quiz A',
        phase: 'elim',
        lane: 1,
        cell: at('s1'),
        seats: seats('4', '5', '6'),
      }),
      quiz('b', {
        label: 'Div 1CC Quiz A',
        phase: 'elim',
        lane: 2,
        cell: at('s1', 'r2'),
        seats: seats('7', '8', '9'),
      }),
    ]
    expect(flagged(checkSchedule(d), 'W-5')).toEqual(['a', 'b'])
  })
})

describe('H-9 and result names', () => {
  it('flags a team that plays no prelims at all', () => {
    const doc = generateSchedule(
      Object.assign(newScheduleDocument('x'), {
        settings: {
          ...newScheduleDocument('x').settings,
          divisions: [{ id: '1', name: 'Div 1', teams: 6, elims: { lanes: [], lines: [] } }],
        },
      }),
    )
    for (const q of doc.quizzes)
      q.seats = q.seats.map((s) =>
        s.kind === 'letter' && s.letter === 'F' ? { kind: 'empty' } : s,
      )
    expect(checkSchedule(doc).find((c) => c.rule === 'H-9')?.reason).toMatch(/\bF\b/)
  })

  it('names results as the meet stores them', () => {
    const doc = generateSchedule(newScheduleDocument('x'))
    const q = {
      ...doc.quizzes[0]!,
      division: '2',
      lane: 1,
      label: 'Div 2 Quiz A',
      phase: 'elim' as const,
    }
    expect(resultName(q)).toBe('2|c|a')
  })
})

describe('H-3 with an event across every room', () => {
  it('flags the quizzes in a slot the event overlaps', () => {
    const d = generateSchedule(newScheduleDocument('x'))
    d.settings.divisions = [{ id: '1', name: 'Div 1', teams: 6, elims: { lanes: [], lines: [] } }]
    const doc = generateSchedule(d)
    const slot = doc.frame.find(
      (r) => r.kind === 'slot' && doc.quizzes.some((q) => q.cell?.slot === r.id),
    )!
    if (slot.kind !== 'slot') throw new Error('no slot')
    // An all-rooms event in a slot of its own whose time overlaps the quizzes' slot
    doc.frame.splice(doc.frame.indexOf(slot), 0, {
      kind: 'slot',
      id: 'assembly',
      at: slot.at,
      minutes: 10,
      use: 'event',
    })
    doc.events.push({ id: 'ev', label: 'Assembly', slot: 'assembly', rooms: 'all', pinned: true })
    expect(checkSchedule(doc).some((c) => c.rule === 'H-3')).toBe(true)
  })
})

describe('H-16 with a round robin', () => {
  it("counts a New rank seated across a round robin's quizzes as one use", () => {
    const d = newScheduleDocument('x')
    d.settings.divisions = [{ id: '2', name: 'Div 2', teams: 17, elims: defaultElims(17) }]
    // The consolation lane, fed by the XY's New ranks, as a round robin of 2 each
    d.settings.divisions[0]!.elims.lanes[1] = {
      ...d.settings.divisions[0]!.elims.lanes[1]!,
      format: 'roundRobin',
      perTeam: 2,
      finals: false,
    }
    const doc = generateSchedule(d)
    expect(checkSchedule(doc).filter((c) => c.rule === 'H-16')).toEqual([])
  })
})
