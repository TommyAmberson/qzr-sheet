import { describe, expect, it } from 'vitest'
import { checkSchedule } from '../conflicts'
import { defaultElims } from '../elims'
import { generateSchedule } from '../reflow'
import { newScheduleDocument, type ScheduleDocument } from '../scheduleFile'

function meet(counts: number[], rooms: number | 'auto' = 'auto'): ScheduleDocument {
  const doc = newScheduleDocument('Test')
  doc.settings.rooms = rooms
  doc.settings.divisions = counts.map((teams, i) => ({
    id: `d${i + 1}`,
    name: `Div ${i + 1}`,
    teams,
    elims: defaultElims(teams),
  }))
  return generateSchedule(doc)
}

const hard = (doc: ScheduleDocument) => checkSchedule(doc).filter((c) => !c.warning)
const clock = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`

describe('generateSchedule', () => {
  it('FBC 2025 (6, 17, 16): a full weekend in 5 rooms with no hard conflicts (SC-001)', () => {
    const doc = meet([6, 17, 16])
    expect(doc.rooms).toHaveLength(5)
    expect(hard(doc)).toEqual([])
    const rules = new Set(checkSchedule(doc).map((c) => c.rule))
    expect(rules.has('W-3')).toBe(false)
    expect(rules.has('W-4')).toBe(false)
    expect(doc.quizzes.filter((q) => q.phase === 'prelim')).toHaveLength(39)
  })

  it('Heritage 2024 (6, 32) and Heritage 2025 (10, 14, 21) have no hard conflicts', () => {
    expect(hard(meet([6, 32]))).toEqual([])
    expect(hard(meet([10, 14, 21]))).toEqual([])
  })

  it('labels prelims in draw order (FR-026)', () => {
    const doc = meet([6])
    expect(doc.quizzes.filter((q) => q.phase === 'prelim').map((q) => q.label)).toEqual(
      [1, 2, 3, 4, 5, 6].map((n) => `Div 1 Quiz ${n}`),
    )
  })

  function finalsInOrder(doc: ScheduleDocument) {
    const slots = new Map(doc.frame.flatMap((r) => (r.kind === 'slot' ? [[r.id, r] as const] : [])))
    const finals = doc.quizzes
      .filter((q) => q.label.endsWith('Finals') && q.cell)
      .sort((a, b) => slots.get(a.cell!.slot)!.at - slots.get(b.cell!.slot)!.at)
    return { finals, slotOf: (q: ScheduleDocument['quizzes'][number]) => slots.get(q.cell!.slot)! }
  }

  it("with two divisions, runs every Finals one at a time in Room 1, each consolation's just before its division's (FR-019a)", () => {
    const doc = meet([6, 26], 5)
    const { finals, slotOf } = finalsInOrder(doc)
    expect(finals.map((q) => q.label)).toEqual(['Div 2C Finals', 'Div 2 Finals', 'Div 1 Finals'])
    expect(new Set(finals.map((q) => q.cell!.room))).toEqual(new Set([doc.rooms[0]!.id]))
    expect(finals.every((q) => slotOf(q).use === 'finals')).toBe(true)
    expect(clock(slotOf(finals[0]!).at) >= '15:00').toBe(true)
  })

  it("with three divisions, runs consolation Finals in their lane's rooms and the rest in Room 1, highest division first (FR-019a)", () => {
    const doc = meet([6, 17, 16])
    const { finals, slotOf } = finalsInOrder(doc)
    const main = finals.filter((q) => slotOf(q).use === 'finals')
    expect(main.map((q) => q.label)).toEqual(['Div 3 Finals', 'Div 2 Finals', 'Div 1 Finals'])
    expect(new Set(main.map((q) => q.cell!.room))).toEqual(new Set([doc.rooms[0]!.id]))
    for (const label of ['Div 2C Finals', 'Div 3C Finals']) {
      const q = finals.find((x) => x.label === label)!
      expect(slotOf(q).use).toBe('elim')
      const lane = doc.quizzes.filter((x) => x.lane === q.lane && x.division === q.division)
      expect(lane.filter((x) => x !== q).some((x) => x.cell?.room === q.cell!.room)).toBe(true)
    }
    expect(hard(doc)).toEqual([])
  })

  it("keeps each division's elims after its prelims, the stats break between (H-11, FR-020)", () => {
    const doc = meet([6, 17, 16])
    expect(checkSchedule(doc).filter((c) => c.rule === 'H-11')).toEqual([])
  })

  it('leaves no empty prelim row before the stats break (P-7)', () => {
    // May 2023: 32 prelims fit 7 rounds of 5 rooms, as they did at the meet
    const doc = meet([6, 26], 5)
    const prelimSlots = doc.frame.filter((r) => r.kind === 'slot' && r.use === 'prelim')
    expect(prelimSlots).toHaveLength(7)
    for (const s of prelimSlots) expect(doc.quizzes.some((q) => q.cell?.slot === s.id)).toBe(true)
  })

  it('never puts two divisions in one room at once when they share rooms (H-2)', () => {
    // Three divisions in two rooms: their room blocks overlap
    const doc = meet([10, 10, 10], 2)
    expect(hard(doc).filter((c) => c.rule === 'H-2')).toEqual([])
  })

  it('runs no more Finals side by side than there are rooms (H-2)', () => {
    const doc = newScheduleDocument('Test')
    doc.settings.framePreset = 'oneRoom'
    doc.settings.finals.sideBySide = 2
    doc.settings.divisions = [6, 6].map((teams, i) => ({
      id: `d${i + 1}`,
      name: `Div ${i + 1}`,
      teams,
      elims: defaultElims(teams),
    }))
    expect(hard(generateSchedule(doc)).filter((c) => c.rule === 'H-2')).toEqual([])
  })

  it('with no team counts, a minimal frame of 3 rooms (FR-010)', () => {
    const doc = meet([])
    expect(doc.rooms).toHaveLength(3)
    expect(doc.frame.some((r) => r.kind === 'slot')).toBe(true)
  })

  it('generates a 60-team, three-division weekend in under 2 seconds (FR-014, SC-007)', () => {
    const start = performance.now()
    meet([12, 20, 28])
    expect(performance.now() - start).toBeLessThan(2000)
  })
})

describe('elim rooms (P-2, P-3)', () => {
  it('keeps each lane to as few rooms as it runs quizzes at once', () => {
    for (const counts of [
      [6, 17, 16],
      [10, 14, 21],
      [6, 32],
    ]) {
      const doc = meet(counts)
      const lanes = new Map<string, { rooms: Set<string>; atOnce: Map<string, number> }>()
      for (const q of doc.quizzes) {
        if (q.phase !== 'elim' || !q.cell || q.line !== undefined || q.deciding) continue
        const key = `${q.division}:${q.lane ?? 0}`
        const lane = lanes.get(key) ?? { rooms: new Set(), atOnce: new Map() }
        lane.rooms.add(q.cell.room)
        lane.atOnce.set(q.cell.slot, (lane.atOnce.get(q.cell.slot) ?? 0) + 1)
        lanes.set(key, lane)
      }
      for (const [key, lane] of lanes) {
        expect(lane.rooms.size, `${counts.join('/')} ${key}`).toBe(
          Math.max(...lane.atOnce.values()),
        )
      }
    }
  })
})
