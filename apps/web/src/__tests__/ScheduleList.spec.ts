import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import {
  generateSchedule,
  newScheduleDocument,
  slotTimes,
  type ScheduleDocument,
} from '@qzr/shared'
import { ScheduleList } from '@qzr/ui'

// The schedule on a phone (specs/010-meet-day FR-021)

function published() {
  const base = newScheduleDocument('Fall Meet')
  base.settings.divisions = [{ id: '1', name: 'Div 1', teams: 6, elims: { lanes: [], lines: [] } }]
  return generateSchedule(base)
}

/** The list for `shown`, with the clock a minute into `slot` of the whole schedule `doc` */
function listAt(doc: ScheduleDocument, slot: string | null, shown = doc, withDivision = false) {
  const times = slotTimes(doc, '2026-11-20', 'UTC')
  const at = slot === null ? 0 : times.get(slot)!.start + 60_000
  return mount(ScheduleList, {
    props: {
      doc: shown,
      view: 'letters',
      marks: null,
      withDivision,
      times,
      now: at,
      timeZone: 'UTC',
    },
  })
}

describe('ScheduleList', () => {
  it('lists the quizzes by time, marking the slot under way and naming divisions when asked', () => {
    const doc = published()
    const first = doc.quizzes.find((q) => q.cell)!
    const w = listAt(doc, first.cell!.slot, doc, true)
    expect(w.findAll('.list-slot').length).toBeGreaterThan(0)
    const marked = w.findAll('.under-way')
    expect(marked).toHaveLength(1)
    expect(marked[0]!.text()).toContain('Under way')
    expect(marked[0]!.text()).toContain(first.label)
    expect(w.find('.where').text()).toContain('Div 1')
  })

  it('marks nothing before the meet runs, and leaves divisions out for one division', () => {
    const w = listAt(published(), null)
    expect(w.find('.under-way').exists()).toBe(false)
    expect(w.find('.now-line').exists()).toBe(false)
    expect(w.find('.where').text()).not.toContain('Div 1')
  })

  it('shows a slot that holds only an event, so the time under way has a place', () => {
    const doc = published()
    const lunch = doc.frame.find((r) => r.kind === 'slot')!
    doc.quizzes = doc.quizzes.filter((q) => q.cell?.slot !== lunch.id)
    doc.events = [{ id: 'e1', label: 'Lunch', slot: lunch.id, rooms: 'all', pinned: false }]
    expect(listAt(doc, lunch.id).find('.under-way').text()).toContain('Lunch')
  })

  it('draws a now line before the next slot listed when none listed is under way', () => {
    const doc = published()
    const withQuizzes = [...new Set(doc.quizzes.flatMap((q) => (q.cell ? [q.cell.slot] : [])))]
    const [, gone, next] = doc.frame.filter((r) => r.kind === 'slot' && withQuizzes.includes(r.id))
    // As when the division picked has no quiz in the slot under way
    const shown = structuredClone(doc)
    shown.quizzes = shown.quizzes.filter((q) => q.cell?.slot !== gone!.id)
    const w = listAt(doc, gone!.id, shown)
    expect(w.find('.under-way').exists()).toBe(false)
    const line = w.find('.now-line')
    expect(line.text()).toMatch(/^Now · /)
    const after = line.element.nextElementSibling!
    const nextSlot = after.classList.contains('list-slot') ? after : after.nextElementSibling!
    expect(nextSlot.textContent).toContain(
      doc.quizzes.find((q) => q.cell?.slot === next!.id)!.label,
    )
  })

  it('draws no now line between schedule days, when the meet is not running', () => {
    const doc = published()
    const firstDay = doc.frame.findIndex((r) => r.kind === 'day')
    // A second day, a week on, holding the last slot
    const last = doc.frame.map((r) => r.kind).lastIndexOf('slot')
    doc.frame.splice(last, 0, {
      kind: 'day',
      id: 'later',
      label: 'Saturday',
    } as (typeof doc.frame)[number])
    expect(firstDay).toBeGreaterThanOrEqual(0)
    const times = slotTimes(doc, '2026-11-20', 'UTC')
    const lastSlot = doc.frame[last + 1]!
    const before = doc.frame
      .slice(0, last)
      .filter((r) => r.kind === 'slot')
      .pop()!
    const night = times.get(before.id)!.end + 60 * 60_000
    expect(night).toBeLessThan(times.get(lastSlot.id)!.start)
    const w = mount(ScheduleList, {
      props: {
        doc,
        view: 'letters',
        marks: null,
        withDivision: false,
        times,
        now: night,
        timeZone: 'UTC',
      },
    })
    expect(w.find('.now-line').exists()).toBe(false)
  })

  it("draws the line under today's name before its first slot listed, once the day has begun", () => {
    const doc = published()
    const day = doc.frame.findIndex((r) => r.kind === 'day')
    const [first, second] = doc.frame.slice(day).filter((r) => r.kind === 'slot')
    // As when the division picked has no quiz in the day's first slot
    const shown = structuredClone(doc)
    shown.quizzes = shown.quizzes.filter((q) => q.cell?.slot !== first!.id)
    shown.events = shown.events.filter((e) => e.slot !== first!.id)
    const w = listAt(doc, first!.id, shown)
    const line = w.find('.now-line')
    expect(line.element.previousElementSibling?.classList.contains('day-label')).toBe(true)
    expect(line.element.nextElementSibling?.textContent).toContain(
      doc.quizzes.find((q) => q.cell?.slot === second!.id)?.label ?? '',
    )
  })
})
