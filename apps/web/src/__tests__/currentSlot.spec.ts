import { describe, expect, it } from 'vitest'
import { newScheduleDocument, type ScheduleDocument, type ScheduleQuiz } from '@qzr/shared'
import { currentSlot } from '../views/meet/currentSlot'

const minute = 60_000
/** Noon on the meet's day, in milliseconds */
const noon = Date.UTC(2026, 5, 13, 18)

function quizAt(slot: string, id = slot): ScheduleQuiz {
  return {
    id,
    label: id,
    division: '1',
    phase: 'prelim',
    cell: { slot, room: 'r1' },
    seats: [],
    pinned: false,
  }
}

/** Quizzes at 12:00 and 12:30, a slot with none at 12:15, and a quiz not placed */
function schedule(): { doc: ScheduleDocument; times: Map<string, { start: number; end: number }> } {
  const doc = newScheduleDocument('Meet')
  doc.quizzes = [quizAt('s1200'), quizAt('s1230'), { ...quizAt('s1300', 'unplaced'), cell: null }]
  const times = new Map([
    ['s1200', { start: noon, end: noon + 25 * minute }],
    ['s1215', { start: noon + 15 * minute, end: noon + 20 * minute }],
    ['s1230', { start: noon + 30 * minute, end: noon + 55 * minute }],
    ['s1300', { start: noon + 60 * minute, end: noon + 85 * minute }],
  ])
  return { doc, times }
}

describe('currentSlot', () => {
  it('stays on the quiz that last started until the next one starts', () => {
    const { doc, times } = schedule()
    expect(currentSlot(doc, times, noon + 9 * minute)).toBe('s1200')
    // Past its end, with the next not started, still the one before
    expect(currentSlot(doc, times, noon + 27 * minute)).toBe('s1200')
    expect(currentSlot(doc, times, noon + 30 * minute)).toBe('s1230')
  })

  it('passes over slots holding no quiz shown', () => {
    const { doc, times } = schedule()
    expect(currentSlot(doc, times, noon + 16 * minute)).toBe('s1200')
    // A quiz not placed on the sheet holds no slot
    expect(currentSlot(doc, times, noon + 70 * minute)).toBe('s1230')
  })

  it('is none before the first quiz starts', () => {
    const { doc, times } = schedule()
    expect(currentSlot(doc, times, noon - minute)).toBeNull()
  })
})
