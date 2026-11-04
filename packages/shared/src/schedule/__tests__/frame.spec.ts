import { describe, expect, it } from 'vitest'
import { buildFrame, defaultRoomCount, DEFAULT_SHAPE } from '../frame'
import type { FrameRow, ScheduleEvent } from '../scheduleFile'

const clock = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`

/** The frame as readable lines: days, events with their slot's time, quiz slots as their start */
function lines({ rows, events }: { rows: FrameRow[]; events: ScheduleEvent[] }): string[] {
  return rows.map((r) => {
    if (r.kind === 'day') return `# ${r.label}`
    if (r.kind === 'note') return `note ${r.text}`
    const event = events.find((e) => e.slot === r.id)
    return `${clock(r.at)} ${event ? event.label : 'slot'}`
  })
}

describe('buildFrame', () => {
  it('lays out the Weekend preset (FR-015)', () => {
    const frame = lines(buildFrame('weekend', 25, { prelimSlots: 8, elimSlots: 9, finalsSlots: 3 }))
    expect(frame.slice(0, 8)).toEqual([
      '# Friday',
      '19:00 Registration',
      '19:30 Assembly',
      '20:00 slot',
      '20:25 slot',
      '20:50 slot',
      '21:15 slot',
      '21:40 slot',
    ])
    expect(frame).toContain('# Saturday')
    expect(frame).toContain('8:00 Breakfast')
    expect(frame).toContain('9:00 slot')
    expect(frame).toContain('12:00 Lunch')
    expect(frame).toContain('17:00 Supper')
    expect(frame).toContain('# Sunday')
    expect(frame.filter((l) => l.endsWith('slot'))).toHaveLength(8 + 9 + 3)
  })

  it('puts five prelim rounds on Friday and the rest on Saturday', () => {
    const frame = lines(buildFrame('weekend', 25, { prelimSlots: 8, elimSlots: 0, finalsSlots: 0 }))
    const saturday = frame.slice(frame.indexOf('# Saturday'))
    expect(saturday.slice(0, 5)).toEqual([
      '# Saturday',
      '8:00 Breakfast',
      '9:00 slot',
      '9:25 slot',
      '9:50 slot',
    ])
  })

  it('leaves no slot during Lunch, and Finals from mid-afternoon', () => {
    const { rows, events } = buildFrame('weekend', 25, {
      prelimSlots: 8,
      elimSlots: 9,
      finalsSlots: 3,
    })
    // Every event sits across all rooms of a slot made for it
    expect(events.every((e) => e.rooms === 'all')).toBe(true)
    const lunchSlot = events.find((e) => e.label === 'Lunch')!.slot
    const lunch = rows.find((r) => r.id === lunchSlot)!
    const slots = rows.filter((r) => r.kind === 'slot' && r.use !== 'event')
    if (lunch.kind !== 'slot' || lunch.use !== 'event') throw new Error('Lunch has its own slot')
    expect(
      slots.some(
        (s) => s.kind === 'slot' && s.at < lunch.at + lunch.minutes && lunch.at < s.at + s.minutes,
      ),
    ).toBe(false)
    const finals = slots.slice(-3).map((s) => (s.kind === 'slot' ? s.at : 0))
    expect(finals[0]).toBeGreaterThanOrEqual(15 * 60)
  })

  it('uses the slot length it is given (FR-016)', () => {
    const { rows } = buildFrame('weekend', 20, DEFAULT_SHAPE)
    const quizSlots = rows.filter((r) => r.kind === 'slot' && r.use !== 'event')
    expect(quizSlots.every((r) => r.kind === 'slot' && r.minutes === 20)).toBe(true)
  })

  it('lays out a one-day meet', () => {
    const frame = lines(buildFrame('oneDay', 20, { prelimSlots: 6, elimSlots: 6, finalsSlots: 2 }))
    expect(frame.slice(0, 3)).toEqual(['# Saturday', '9:30 Assembly', '10:00 slot'])
    expect(frame).toContain('12:00 Lunch')
    expect(frame.filter((l) => l.endsWith('slot'))).toHaveLength(14)
  })
})

describe('defaultRoomCount', () => {
  it('is the fewest rooms, at least 3, that fit the prelims (FR-018)', () => {
    expect(defaultRoomCount(39, 8)).toBe(5) // FBC 2025: 6, 17 and 16 teams
    expect(defaultRoomCount(45, 8)).toBe(6) // Heritage 2025: 10, 14 and 21
    expect(defaultRoomCount(38, 8)).toBe(5) // Heritage 2024: 6 and 32
    expect(defaultRoomCount(0, 8)).toBe(3) // No teams yet (FR-010)
  })
})
