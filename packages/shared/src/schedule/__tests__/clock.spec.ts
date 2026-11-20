import { describe, expect, it } from 'vitest'
import { newScheduleDocument } from '../scheduleFile'
import { scheduleDayDates, slotTimes } from '../clock'

// The quiz under way on a phone's schedule (specs/010-meet-day FR-021)

function twoDays() {
  const doc = newScheduleDocument('Fall Meet')
  doc.frame = [
    { kind: 'day', id: 'd1', label: 'Friday' },
    { kind: 'slot', id: 's1', at: 19 * 60, minutes: 25 },
    { kind: 'slot', id: 's2', at: 19 * 60 + 30, minutes: 25 },
    { kind: 'day', id: 'd2', label: 'Saturday' },
    { kind: 'slot', id: 's3', at: 9 * 60, minutes: 25 },
  ] as typeof doc.frame
  return doc
}

describe('slot times', () => {
  // 2026-11-20 is a Friday
  const from = '2026-11-20'
  const iso = (ms: number | undefined) =>
    ms === undefined ? undefined : new Date(ms).toISOString()

  it("takes each day to a date on its weekday from the meet's start", () => {
    expect([...scheduleDayDates(twoDays(), from)]).toEqual([
      ['d1', '2026-11-20'],
      ['d2', '2026-11-21'],
    ])
  })

  it("times each slot on its day's date in the meet's time zone", () => {
    // Regina keeps UTC-6 all year, so the test doesn't hang on a zone's daylight-saving rules
    const times = slotTimes(twoDays(), from, 'America/Regina')
    // 19:00 Friday in Regina is 01:00 UTC on Saturday
    expect(iso(times.get('s1')?.start)).toBe('2026-11-21T01:00:00.000Z')
    expect(iso(times.get('s1')?.end)).toBe('2026-11-21T01:25:00.000Z')
    expect(iso(times.get('s3')?.start)).toBe('2026-11-21T15:00:00.000Z')
  })

  it('puts a slot before any day on the first day, and one past midnight on the next date', () => {
    const doc = twoDays()
    doc.frame = [
      { kind: 'slot', id: 's0', at: 8 * 60, minutes: 25 },
      ...doc.frame,
      { kind: 'slot', id: 'late', at: 24 * 60 + 30, minutes: 25 },
    ] as typeof doc.frame
    // A start entered a day late still dates the Friday before it, and the early slot with it
    const times = slotTimes(doc, '2026-11-21', 'UTC')
    expect(iso(times.get('s0')?.start)).toBe('2026-11-20T08:00:00.000Z')
    expect(iso(times.get('late')?.start)).toBe('2026-11-22T00:30:00.000Z')
  })
})
