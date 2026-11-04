import { describe, expect, it } from 'vitest'
import { checkSchedule } from '../conflicts'
import { clearDraw, drawDivision } from '../draw'
import { defaultElims } from '../elims'
import { sortPrelims } from '../placement'
import { generateSchedule, reflowSchedule } from '../reflow'
import { newScheduleDocument, type ScheduleDocument } from '../scheduleFile'

function meet(counts: number[], rooms: number | 'auto' = 'auto'): ScheduleDocument {
  const doc = newScheduleDocument('Test')
  doc.settings.rooms = rooms
  // These schedules mark late teams, so lateness counts
  doc.settings.lateTeams = true
  doc.settings.divisions = counts.map((teams, i) => ({
    id: `d${i + 1}`,
    name: `Div ${i + 1}`,
    teams,
    elims: defaultElims(teams),
  }))
  const generated = generateSchedule(doc)
  for (const d of generated.settings.divisions) {
    generated.draw[d.id] = {
      stale: false,
      teams: Array.from({ length: d.teams }, (_, i) => ({
        name: `${d.name} team ${i + 1}`,
        late: false,
        absent: false,
      })),
    }
  }
  return generated
}

/** A seeded random, so each run draws the same */
function seeded(seed: number) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647
}

const slotOrder = (doc: ScheduleDocument) =>
  new Map(doc.frame.flatMap((r) => (r.kind === 'slot' ? [r.id] : [])).map((id, i) => [id, i]))

describe('drawDivision', () => {
  it('gives every team exactly one letter, and every letter one team (H-18)', () => {
    const doc = meet([9])
    const draw = drawDivision(doc, 'd1', seeded(1))
    const letters = draw.teams.map((t) => t.letter)
    expect(new Set(letters).size).toBe(9)
    expect(letters.sort()).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'])
  })

  it('gives late teams letters that share quizzes, as late as can be (FR-041)', () => {
    // One room, so the division's quizzes run one at a time and a late start is possible
    const doc = meet([9], 1)
    doc.draw.d1!.teams[2]!.late = true
    doc.draw.d1!.teams[5]!.late = true
    doc.draw.d1 = drawDivision(doc, 'd1', seeded(2))
    const late = doc.draw.d1.teams.filter((t) => t.late).map((t) => t.letter!)
    const prelims = doc.quizzes.filter((q) => q.phase === 'prelim')
    const theirs = prelims.filter((q) =>
      q.seats.some((s) => s.kind === 'letter' && late.includes(s.letter)),
    )
    // Two teams with 3 quizzes each share one when they can: 5, not 6
    expect(theirs).toHaveLength(5)
    expect(checkSchedule(doc).filter((c) => c.rule === 'W-2')).toEqual([])
  })

  it('changes no quiz (FR-039)', () => {
    const doc = meet([9])
    const before = structuredClone(doc.quizzes)
    drawDivision(doc, 'd1', seeded(3))
    expect(doc.quizzes).toEqual(before)
  })

  it("clears to letters, and an absent team's seats still count as filled (FR-040, FR-042b, H-5)", () => {
    const doc = meet([6])
    doc.draw.d1 = drawDivision(doc, 'd1', seeded(4))
    doc.draw.d1.teams[0]!.absent = true
    expect(checkSchedule(doc).filter((c) => c.rule === 'H-5')).toEqual([])
    expect(clearDraw(doc.draw.d1).teams.every((t) => t.letter === undefined)).toBe(true)
  })
})

describe('sortPrelims', () => {
  /** FBC 2025 counts with two Div 2 teams and one Div 3 team late, drawn */
  function lateFbc(): ScheduleDocument {
    const doc = meet([6, 17, 16])
    doc.draw.d2!.teams[7]!.late = true
    doc.draw.d2!.teams[8]!.late = true
    doc.draw.d3!.teams[5]!.late = true
    for (const d of ['d1', 'd2', 'd3']) doc.draw[d] = drawDivision(doc, d, seeded(7))
    return doc
  }

  const saturday = (doc: ScheduleDocument) => {
    const ids = new Set<string>()
    let on = false
    for (const r of doc.frame) {
      if (r.kind === 'day') on = r.label === 'Saturday'
      if (on && r.kind === 'slot') ids.add(r.id)
    }
    return ids
  }

  function lateOnSaturday(doc: ScheduleDocument): boolean {
    const sat = saturday(doc)
    return ['d2', 'd3'].every((d) => {
      const late = doc.draw[d]!.teams.filter((t) => t.late).map((t) => t.letter!)
      return doc.quizzes
        .filter((q) => q.division === d && q.phase === 'prelim')
        .filter((q) => q.seats.some((s) => s.kind === 'letter' && late.includes(s.letter)))
        .every((q) => q.cell && sat.has(q.cell.slot))
    })
  }

  /** No room goes from one division to another and back across the prelims (P-3) */
  function noFlipBack(doc: ScheduleDocument): boolean {
    const order = slotOrder(doc)
    return doc.rooms.every((room) => {
      const seq = doc.quizzes
        .filter((q) => q.phase === 'prelim' && q.cell?.room === room.id)
        .sort((a, b) => order.get(a.cell!.slot)! - order.get(b.cell!.slot)!)
        .map((q) => q.division)
        .filter((d, i, all) => i === 0 || all[i - 1] !== d)
      return new Set(seq).size === seq.length
    })
  }

  it('is how re-flow places prelims, so a settings change keeps it (P-1)', () => {
    const doc = lateFbc()
    doc.settings.slotMinutes = 20
    const after = reflowSchedule(doc)
    expect(lateOnSaturday(after)).toBe(true)
    expect(checkSchedule(after).filter((c) => !c.warning)).toEqual([])
  })

  it('counts for nothing with lateness switched off', () => {
    const doc = lateFbc()
    doc.settings.lateTeams = false
    const unmarked = structuredClone(doc)
    for (const d of Object.values(unmarked.draw)) for (const t of d.teams) t.late = false
    const cells = (d: ScheduleDocument) => new Map(d.quizzes.map((q) => [q.id, q.cell]))
    expect(cells(reflowSchedule(doc))).toEqual(cells(reflowSchedule(unmarked)))
    const letters = (d: ScheduleDocument) =>
      drawDivision(d, 'd2', seeded(7)).teams.map((t) => t.letter)
    expect(letters(doc)).toEqual(letters(unmarked))
  })

  it('puts every quiz of the late teams on Saturday, breaking no hard rule (P-1)', () => {
    const doc = sortPrelims(lateFbc(), { includePinned: false, acrossRooms: false })
    expect(lateOnSaturday(doc)).toBe(true)
    expect(checkSchedule(doc).filter((c) => !c.warning)).toEqual([])
  })

  it('across rooms does the same, and no room switches division and back (P-2, P-3)', () => {
    const doc = sortPrelims(lateFbc(), { includePinned: false, acrossRooms: true })
    expect(lateOnSaturday(doc)).toBe(true)
    expect(noFlipBack(doc)).toBe(true)
    expect(checkSchedule(doc).filter((c) => !c.warning)).toEqual([])
  })

  it('leaves pinned quizzes alone unless they are included', () => {
    const doc = lateFbc()
    const q = doc.quizzes.find((x) => x.division === 'd2' && x.phase === 'prelim')!
    q.pinned = true
    const kept = sortPrelims(doc, { includePinned: false, acrossRooms: false })
    expect(kept.quizzes.find((x) => x.id === q.id)).toEqual(q)
    const moved = sortPrelims(doc, { includePinned: true, acrossRooms: false })
    expect(moved.quizzes.find((x) => x.id === q.id)!.pinned).toBe(false)
  })
})

/** Cases carried over from the old editor's scenarios (research R3) */
describe("the old editor's scenarios", () => {
  it.each([
    [[4, 5], 3],
    [[9, 15, 20], 5],
  ])('%j teams in %i rooms: every quiz placed, no hard conflicts', (counts, rooms) => {
    const doc = meet(counts, rooms)
    expect(doc.quizzes.filter((q) => q.phase === 'prelim' && !q.cell)).toEqual([])
    expect(checkSchedule(doc).filter((c) => !c.warning)).toEqual([])
  })

  it("late teams in every division sit out their division's first prelim slot after Sort", () => {
    const doc = meet([9, 15, 20], 5)
    const late: Record<string, number[]> = { d1: [8], d2: [9, 10, 11, 12, 13, 14], d3: [18, 19] }
    for (const [d, teams] of Object.entries(late)) {
      for (const t of teams) doc.draw[d]!.teams[t]!.late = true
      doc.draw[d] = drawDivision(doc, d, seeded(11))
    }
    const sorted = sortPrelims(doc, { includePinned: false, acrossRooms: false })
    const order = slotOrder(sorted)
    for (const d of Object.keys(late)) {
      const letters = new Set(sorted.draw[d]!.teams.filter((t) => t.late).map((t) => t.letter!))
      const prelims = sorted.quizzes.filter((q) => q.division === d && q.phase === 'prelim')
      const first = Math.min(...prelims.map((q) => order.get(q.cell!.slot)!))
      const opening = prelims.filter((q) => order.get(q.cell!.slot) === first)
      for (const q of opening) {
        for (const s of q.seats) {
          if (s.kind === 'letter')
            expect(letters.has(s.letter), `${q.label} ${s.letter}`).toBe(false)
        }
      }
    }
    expect(checkSchedule(sorted).filter((c) => !c.warning)).toEqual([])
  })
})
