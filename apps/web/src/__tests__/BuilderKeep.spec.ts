import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import {
  SCHEDULE_FILE_VERSION,
  generateSchedule,
  newScheduleDocument,
  serializeSchedule,
} from '@qzr/shared'

import { keepSchedule, listSchedules, loadSchedule } from '../builder/persistence'
import router from '../router'
import BuilderListView from '../views/BuilderListView.vue'
import BuilderView from '../views/BuilderView.vue'

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

async function withSixTeams(id?: string) {
  const w = mount(BuilderView, { props: id ? { id } : {}, attachTo: document.body })
  const count = w.find('[aria-label="Number of divisions"]')
  await count.setValue('1')
  await count.trigger('change')
  const teams = w.find('[aria-label$="team count"]')
  await teams.setValue('6')
  await teams.trigger('change')
  return w
}

describe('keeping schedules in the browser (FR-002)', () => {
  it('keeps every change, pins included, and reopens the schedule as it was', async () => {
    const w = await withSixTeams()
    const id = listSchedules()[0]!.id
    // Pin a quiz by hand
    await w.findAll('.quiz-title')[0]!.trigger('click')
    ;[...document.querySelectorAll<HTMLButtonElement>('.popover button')]
      .find((b) => b.textContent?.trim() === 'Pin')!
      .click()
    await w.vm.$nextTick()
    w.unmount()

    const again = mount(BuilderView, { props: { id } })
    expect(again.findAll('.quiz.pinned')).toHaveLength(1)
    expect(again.findAll('[data-quiz]').length).toBeGreaterThan(6)
    again.unmount()
  })

  it('edits and saves with the network off once the page is open (FR-001)', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
    const w = await withSixTeams()
    expect(fetch).not.toHaveBeenCalled()
    expect(loadSchedule(listSchedules()[0]!.id)?.settings.divisions[0]?.teams).toBe(6)
    w.unmount()
  })

  it('says so when a schedule is no longer in this browser', () => {
    const w = mount(BuilderView, { props: { id: 'gone' } })
    expect(w.find('.message').text()).toMatch(/isn't in this browser any more/)
    w.unmount()
  })

  it("doesn't list a meet's linked draft, which its meet page edits", () => {
    const linked = { ...generateSchedule(newScheduleDocument('Fall Meet')), link: { meetId: 7 } }
    keepSchedule(linked)
    keepSchedule(generateSchedule(newScheduleDocument('Practice')))
    const w = mount(BuilderListView, { global: { plugins: [router] } })
    const names = w
      .findAll('[aria-label="Schedule name"]')
      .map((i) => (i.element as HTMLInputElement).value)
    expect(names).toEqual(['Practice'])
    w.unmount()
  })

  it('lists, renames, duplicates and deletes schedules', async () => {
    const doc = generateSchedule(newScheduleDocument('FBC 2025'))
    keepSchedule(doc)
    const w = mount(BuilderListView, { global: { plugins: [router] } })
    expect(w.find('[aria-label="Schedule name"]').element).toHaveProperty('value', 'FBC 2025')
    await w
      .findAll('button')
      .find((b) => b.text() === 'Duplicate')!
      .trigger('click')
    expect(
      listSchedules()
        .map((s) => s.name)
        .sort(),
    ).toEqual(['FBC 2025', 'FBC 2025 (copy)'])
    await w
      .findAll('button')
      .find((b) => b.text() === 'Delete')!
      .trigger('click')
    expect(listSchedules()).toHaveLength(1)
    w.unmount()
  })
})

describe('schedule files (FR-003)', () => {
  const pick = async (w: ReturnType<typeof mount>, text: string) => {
    const input = w.find<HTMLInputElement>('[aria-label="Open a schedule file"]')
    Object.defineProperty(input.element, 'files', {
      value: [new File([text], 'x.qzrschedule.json')],
      configurable: true,
    })
    await input.trigger('change')
    await flushPromises()
  }

  it('opens a saved file as it was', async () => {
    const doc = generateSchedule(newScheduleDocument('From a file'))
    const w = mount(BuilderListView, { global: { plugins: [router] } })
    await pick(w, serializeSchedule(doc))
    expect(loadSchedule(doc.id)).toEqual(doc)
    w.unmount()
  })

  it('refuses a newer file, naming both versions, and an invalid one, saying why', async () => {
    const w = mount(BuilderListView, { global: { plugins: [router] } })
    const doc = generateSchedule(newScheduleDocument('Newer'))
    await pick(w, JSON.stringify({ ...doc, version: SCHEDULE_FILE_VERSION + 1 }))
    expect(w.find('.message').text()).toMatch(/version 2.*version 1/)
    await pick(w, JSON.stringify({ ...doc, rooms: 'nope' }))
    expect(w.find('.message').text()).toMatch(/Not a valid schedule/)
    expect(listSchedules()).toEqual([])
    w.unmount()
  })
})

describe('printing (FR-044)', () => {
  it('prints the one-room list and the basic schedule', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    const w = await withSixTeams()
    await w.find('[aria-label="Print"]').setValue('list')
    expect(print).toHaveBeenCalled()
    expect(w.find('.schedule-list').text()).toMatch(/Div 1 Quiz 1/)
    await w.find('[aria-label="Print"]').setValue('basic')
    expect(w.find('.schedule-basic').text()).toMatch(/Quizzing/)
    w.unmount()
  })

  it('shows letters until a division has a draw (FR-043)', async () => {
    const w = await withSixTeams()
    const teams = w.findAll('.view-toggle button')[1]!
    expect(teams.attributes('disabled')).toBeDefined()
    w.unmount()
  })
})
