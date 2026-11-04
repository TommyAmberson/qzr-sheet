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

  it("runs Finals one at a time in Room 1, highest division first, each consolation's just before its division's (FR-019a)", () => {
    const doc = meet([6, 17, 16])
    const slots = new Map(
      doc.frame.flatMap((r) => (r.kind === 'slot' ? [[r.id, r.at] as const] : [])),
    )
    const finals = doc.quizzes
      .filter((q) => q.label.endsWith('Finals') && q.cell)
      .sort((a, b) => slots.get(a.cell!.slot)! - slots.get(b.cell!.slot)!)
    expect(finals.map((q) => q.label)).toEqual([
      'Div 3C Finals',
      'Div 3 Finals',
      'Div 2C Finals',
      'Div 2 Finals',
      'Div 1 Finals',
    ])
    expect(new Set(finals.map((q) => q.cell!.room))).toEqual(new Set([doc.rooms[0]!.id]))
    expect(clock(slots.get(finals[0]!.cell!.slot)!) >= '15:00').toBe(true)
  })

  it("keeps each division's elims after its prelims, the stats break between (H-11, FR-020)", () => {
    const doc = meet([6, 17, 16])
    expect(checkSchedule(doc).filter((c) => c.rule === 'H-11')).toEqual([])
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
