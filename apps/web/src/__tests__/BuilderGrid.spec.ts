import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defaultElims, generateSchedule, newScheduleDocument } from '@qzr/shared'

import { keepSchedule, loadSchedule } from '../builder/persistence'
import BuilderView from '../views/BuilderView.vue'

let wrapper: VueWrapper | null = null
afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

/** The builder with one 6-team division generated */
async function sixTeams() {
  wrapper = mount(BuilderView, { attachTo: document.body })
  const count = wrapper.find('[aria-label="Number of divisions"]')
  await count.setValue('1')
  await count.trigger('change')
  const teams = wrapper.find('[aria-label$="team count"]')
  await teams.setValue('6')
  await teams.trigger('change')
  return wrapper
}

const quizEl = (w: VueWrapper, label: string) =>
  w.findAll('.quiz').find((q) => q.find('.quiz-title').text() === label)!
const cellOf = (w: VueWrapper, label: string) =>
  quizEl(w, label).element.closest('td')!.dataset.cell
const seatsOf = (w: VueWrapper, label: string) =>
  quizEl(w, label)
    .findAll('.seat')
    .map((s) => s.text())
const lastRoom = (w: VueWrapper) => {
  const rooms = w.findAll('.room-name')
  return rooms[rooms.length - 1]!
}
/** A button in the open popup, by its text or, for a short one, its accessible name */
const popupButton = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('.popover button')].find(
    (b) => b.textContent?.trim() === text || b.getAttribute('aria-label') === text,
  )!

describe('the quiz menu (FR-005c)', () => {
  it('renames a quiz, and seats that refer to it follow (FR-035c)', async () => {
    const w = await sixTeams()
    // Div 1 Quiz C takes 2 of A and 2 of B in the 6-team bracket
    expect(seatsOf(w, 'Div 1 Quiz C')).toContain('2 of A')
    await quizEl(w, 'Div 1 Quiz A').find('.quiz-title').trigger('click')
    // Named as the scoresheet names it: the division stays, the quiz's own name changes
    const name = document.querySelector<HTMLInputElement>('[aria-label="Quiz name"]')!
    expect(name.value).toBe('A')
    name.value = 'A2'
    name.dispatchEvent(new Event('change'))
    await w.vm.$nextTick()
    expect(seatsOf(w, 'Div 1 Quiz C')).toContain('2 of A2')
    expect(quizEl(w, 'Div 1 Quiz A2').classes()).toContain('pinned')
  })

  it('sets a seat to any kind of source, and a seat editor leads back to its menu', async () => {
    const w = await sixTeams()
    await quizEl(w, 'Div 1 Quiz 1').findAll('.seat')[2]!.trigger('click')
    expect(document.querySelector('.seat-editor')).not.toBeNull()
    popupButton('Rank').click()
    await w.vm.$nextTick()
    const typed = document.querySelector<HTMLInputElement>('[aria-label="Other rank"]')!
    typed.value = 'New 10'
    typed.dispatchEvent(new Event('change'))
    await w.vm.$nextTick()
    expect(seatsOf(w, 'Div 1 Quiz 1')).toEqual(['A', 'C', 'New 10'])
    // Back on the quiz's menu; nothing is refused: a letter beyond the division is typed, kept and
    // marked (H-10)
    document.querySelector<HTMLButtonElement>('[aria-label="Seat 3"]')!.click()
    await w.vm.$nextTick()
    popupButton('Letter').click()
    await w.vm.$nextTick()
    const other = document.querySelector<HTMLInputElement>('[aria-label="Other letter"]')!
    other.value = 'Z'
    other.dispatchEvent(new Event('change'))
    await w.vm.$nextTick()
    expect(quizEl(w, 'Div 1 Quiz 1').classes()).toContain('conflict')
  })

  it('sets a seat from a place in an earlier quiz', async () => {
    const w = await sixTeams()
    await quizEl(w, 'Div 1 Quiz C').findAll('.seat')[0]!.trigger('click')
    expect(document.querySelector('[role="tab"][aria-selected="true"]')!.textContent!.trim()).toBe(
      'From quiz',
    )
    document.querySelector<HTMLButtonElement>('[aria-label="3rd of A"]')!.click()
    await w.vm.$nextTick()
    expect(seatsOf(w, 'Div 1 Quiz C')[0]).toBe('3 of A')
  })

  it('closes with its × or a click outside', async () => {
    const w = await sixTeams()
    await quizEl(w, 'Div 1 Quiz 1').find('.quiz-title').trigger('click')
    popupButton('×').click()
    await w.vm.$nextTick()
    expect(document.querySelector('.popover')).toBeNull()
    await quizEl(w, 'Div 1 Quiz 1').find('.quiz-title').trigger('click')
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await w.vm.$nextTick()
    expect(document.querySelector('.popover')).toBeNull()
  })

  it('moves to the tray, pins and unpins, and deletes', async () => {
    const w = await sixTeams()
    await quizEl(w, 'Div 1 Quiz 2').find('.quiz-title').trigger('click')
    popupButton('Move to Unplaced').click()
    await w.vm.$nextTick()
    expect(w.find('.tray').text()).toContain('Div 1 Quiz 2')
    await w.find('.tray-quiz').trigger('click')
    popupButton('Delete').click()
    await w.vm.$nextTick()
    expect(w.find('.tray').exists()).toBe(false)
  })
})

describe('moving and swapping (FR-005a)', () => {
  it('moves a quiz by choosing Move, then a cell, and swaps two quizzes the same way', async () => {
    const w = await sixTeams()
    const empty = w.find('.empty-cell')
    const target = empty.element.closest('td')!.dataset.cell
    await quizEl(w, 'Div 1 Quiz 1').find('.quiz-title').trigger('click')
    popupButton('Move').click()
    await w.vm.$nextTick()
    await empty.trigger('click')
    expect(cellOf(w, 'Div 1 Quiz 1')).toBe(target)

    const [one, two] = [cellOf(w, 'Div 1 Quiz 1'), cellOf(w, 'Div 1 Quiz 2')]
    await quizEl(w, 'Div 1 Quiz 1').find('.quiz-title').trigger('click')
    popupButton('Move').click()
    await w.vm.$nextTick()
    await quizEl(w, 'Div 1 Quiz 2').find('.quiz-title').trigger('click')
    expect([cellOf(w, 'Div 1 Quiz 1'), cellOf(w, 'Div 1 Quiz 2')]).toEqual([two, one])
  })

  it('adds a quiz by clicking an empty cell, and opens its menu (FR-035a)', async () => {
    const w = await sixTeams()
    const empty = w.find('.empty-cell')
    expect(empty.attributes('aria-label')).toBe('Add a quiz or event here')
    const target = empty.element.closest('td')!.dataset.cell
    const before = w.findAll('.quiz').length
    await empty.trigger('click')
    popupButton('Quiz').click()
    await flushPromises()
    expect(w.findAll('.quiz')).toHaveLength(before + 1)
    const added = w.find(`td[data-cell="${target}"] .quiz`)
    expect(added.findAll('.seat')).toHaveLength(3)
    expect(document.querySelector('.popover')?.textContent).toContain(
      added.find('.quiz-title').text(),
    )
  })

  it('adds an event in a cell, moves it to Unplaced, and turns it into a quiz and back (FR-017)', async () => {
    const w = await sixTeams()
    await w.find('.empty-cell').trigger('click')
    popupButton('Event').click()
    await flushPromises()
    expect(w.findAll('.room-event').map((e) => e.text())).toContain('Event')
    popupButton('Move to Unplaced').click()
    await w.vm.$nextTick()
    expect(w.find('.tray-event').text()).toContain('Event')

    await w.find('.tray-event button').trigger('click')
    popupButton('Turn into quiz').click()
    await flushPromises()
    expect(w.find('.tray-event').exists()).toBe(false)
    expect(w.findAll('.tray-card')).toHaveLength(1)
    popupButton('Turn into event').click()
    await flushPromises()
    expect(w.find('.tray-event').exists()).toBe(true)
  })

  it('swaps two seats by choosing one, then the other', async () => {
    const w = await sixTeams()
    await quizEl(w, 'Div 1 Quiz 1').findAll('.seat')[0]!.trigger('click')
    popupButton('Swap with another seat').click()
    await w.vm.$nextTick()
    await quizEl(w, 'Div 1 Quiz 2').findAll('.seat')[0]!.trigger('click')
    expect(seatsOf(w, 'Div 1 Quiz 1')[0]).toBe('B')
    expect(seatsOf(w, 'Div 1 Quiz 2')[0]).toBe('A')
  })

  it('drags a quiz to a cell and a seat onto another seat, with pointer events', async () => {
    const w = await sixTeams()
    const empty = w.find('.empty-cell')
    const target = empty.element.closest('td')!.dataset.cell
    const drag = async (from: Element, to: Element) => {
      document.elementFromPoint = () => to
      const at = (type: string, x: number) =>
        new PointerEvent(type, { bubbles: true, button: 0, clientX: x, clientY: x })
      from.dispatchEvent(at('pointerdown', 0))
      from.dispatchEvent(at('pointermove', 20))
      from.dispatchEvent(at('pointerup', 20))
      await w.vm.$nextTick()
    }
    await drag(quizEl(w, 'Div 1 Quiz 1').find('.quiz-title').element, empty.element)
    expect(cellOf(w, 'Div 1 Quiz 1')).toBe(target)

    await drag(
      quizEl(w, 'Div 1 Quiz 1').findAll('.seat')[0]!.element,
      quizEl(w, 'Div 1 Quiz 2').findAll('.seat')[0]!.element,
    )
    expect(seatsOf(w, 'Div 1 Quiz 1')[0]).toBe('B')

    // Unplaced quizzes show their seats, and drag back onto the grid
    await new Promise((r) => setTimeout(r))
    await quizEl(w, 'Div 1 Quiz 2').find('.quiz-title').trigger('click')
    popupButton('Move to Unplaced').click()
    await w.vm.$nextTick()
    const card = w.find('.tray-card')
    expect(card.findAll('.tray-seat')).toHaveLength(3)
    await drag(card.find('.tray-quiz').element, w.find('.empty-cell').element)
    expect(w.find('.tray').exists()).toBe(false)
  })

  it("doesn't drag when a finger scrolls, or when the browser takes the pointer over", async () => {
    const w = await sixTeams()
    const from = quizEl(w, 'Div 1 Quiz 1').find('.quiz-title').element
    const before = cellOf(w, 'Div 1 Quiz 1')
    document.elementFromPoint = () => w.find('.empty-cell').element
    const at = (type: string, x: number, pointerType: string) =>
      new PointerEvent(type, { bubbles: true, button: 0, clientX: x, clientY: x, pointerType })

    from.dispatchEvent(at('pointerdown', 0, 'touch'))
    from.dispatchEvent(at('pointermove', 40, 'touch'))
    from.dispatchEvent(at('pointerup', 40, 'touch'))
    await w.vm.$nextTick()
    expect(cellOf(w, 'Div 1 Quiz 1')).toBe(before)

    // A pen's drag the browser cancels leaves nothing armed for the next tap
    from.dispatchEvent(at('pointerdown', 0, 'pen'))
    from.dispatchEvent(at('pointermove', 40, 'pen'))
    from.dispatchEvent(at('pointercancel', 40, 'pen'))
    from.dispatchEvent(at('pointerup', 40, 'pen'))
    await w.vm.$nextTick()
    expect(cellOf(w, 'Div 1 Quiz 1')).toBe(before)
    expect(w.find('.drag-ghost').exists()).toBe(false)
  })
})

describe('rows and rooms', () => {
  it("inserts a slot, a one-room event and a note, sets a slot's length, and deletes a row", async () => {
    const w = await sixTeams()
    const rows = () => w.findAll('tbody tr').length
    const before = rows()
    // The first quiz slot's time; the rows before it hold events
    const firstTime = () => w.find('.slot:not(.event) .time button')
    await firstTime().trigger('click')
    popupButton('Insert slot after').click()
    await w.vm.$nextTick()
    await firstTime().trigger('click')
    popupButton('Insert note after').click()
    await w.vm.$nextTick()
    expect(rows()).toBe(before + 2)
    expect(w.find('.note').exists()).toBe(true)

    await firstTime().trigger('click')
    popupButton('Insert event after').click()
    await w.vm.$nextTick()
    // A new event takes every room of a row of its own, drawn short; taking one room fewer
    // leaves an empty room in that row, which stays short
    const added = w.findAll('.event-name').find((e) => e.text() === 'Event')!
    await added.trigger('click')
    popupButton('In Room 1').click()
    await w.vm.$nextTick()
    const row = w
      .findAll('.event-name')
      .find((e) => e.text() === 'Event')!
      .element.closest('tr')!
    expect(row.classList.contains('event')).toBe(true)
    expect(row.querySelector('.empty-cell')).not.toBeNull()
    popupButton('×').click()
    await w.vm.$nextTick()

    await firstTime().trigger('click')
    const length = document.querySelector<HTMLInputElement>('[aria-label="Length"]')!
    length.value = '20'
    length.dispatchEvent(new Event('change'))
    await w.vm.$nextTick()
    popupButton('×').click()
    await w.vm.$nextTick()
    await firstTime().trigger('click')
    popupButton('Delete').click()
    await w.vm.$nextTick()
    expect(w.find('.tray').text()).toContain('Div 1 Quiz 1')
  })

  it('adds, renames and removes rooms from the grid', async () => {
    const w = await sixTeams()
    const n = w.findAll('th.room').length
    await w.find('.add-room').trigger('click')
    expect(w.findAll('th.room')).toHaveLength(n + 1)
    await lastRoom(w).trigger('click')
    const name = document.querySelector<HTMLInputElement>('[aria-label="Room name"]')!
    name.value = 'Chapel'
    name.dispatchEvent(new Event('change'))
    await w.vm.$nextTick()
    expect(lastRoom(w).text()).toBe('Chapel')
    popupButton('Remove room').click()
    await w.vm.$nextTick()
    expect(w.findAll('th.room')).toHaveLength(n)
  })
})

describe('screen sizes (FR-005b)', () => {
  const screen = (narrow: boolean) =>
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: narrow,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
  afterEach(() => vi.unstubAllGlobals())

  it('opens the settings as a sheet and still moves a quiz by select-then-choose', async () => {
    screen(true)
    const w = await sixTeams()
    await w.find('.settings-toggle').trigger('click')
    expect(w.find('.panel').classes()).toContain('open')
    expect(w.find('.settings-toggle').attributes('aria-expanded')).toBe('true')
    await w.find('.panel-close').trigger('click')
    expect(w.find('.panel').classes()).not.toContain('open')
    expect(w.find('.settings-toggle').attributes('aria-expanded')).toBe('false')
    const empty = w.find('.empty-cell')
    const target = empty.element.closest('td')!.dataset.cell
    await quizEl(w, 'Div 1 Quiz 3').find('.quiz-title').trigger('click')
    popupButton('Move').click()
    await w.vm.$nextTick()
    await empty.trigger('click')
    expect(cellOf(w, 'Div 1 Quiz 3')).toBe(target)
  })

  it('hides the settings beside the grid on a wide screen, to give the grid the room', async () => {
    screen(false)
    const w = await sixTeams()
    await w.find('.settings-toggle').trigger('click')
    expect(w.find('.builder-main').classes()).toContain('rail-hidden')
    expect(w.find('.settings-toggle').attributes('aria-expanded')).toBe('false')
  })
})

describe('Elim settings (story 4)', () => {
  it("names a 9-team lane's brackets by their opening quizzes, a saved 9b as rule book B", async () => {
    const doc = newScheduleDocument('Nine')
    const elims = defaultElims(9)
    elims.lanes[0]!.bracket = '9b'
    doc.settings.divisions = [{ id: 'd1', name: 'Div 1', teams: 9, elims }]
    const saved = generateSchedule(doc)
    keepSchedule(saved)
    wrapper = mount(BuilderView, { props: { id: saved.id }, attachTo: document.body })
    const w = wrapper
    await w
      .findAll('.section-head')
      .find((h) => h.text().startsWith('Elim settings'))!
      .trigger('click')
    const select = w.find<HTMLSelectElement>('[aria-label="Div 1 bracket"]')
    expect(select.findAll('option').map((o) => o.text())).toEqual([
      'Snake: 1-6-7, 2-5-8, 3-4-9',
      'Rule book A: 1-2-3, 4-5-6, 7-8-9',
      'Rule book B: 1-4-9, 2-5-7, 3-6-8',
      'Rule book C: 1-4-9, winners next',
    ])
    expect(select.element.value).toBe('ruleB')
    expect(w.find('.lrow .hint').text()).toBe('9 teams · bracket, every team loses twice')
  })

  it('moves consolation Finals into the Finals slots when chosen (FR-019a)', async () => {
    const doc = newScheduleDocument('Three divisions')
    doc.settings.divisions = [6, 17, 16].map((teams, i) => ({
      id: `d${i + 1}`,
      name: `Div ${i + 1}`,
      teams,
      elims: defaultElims(teams),
    }))
    const saved = generateSchedule(doc)
    keepSchedule(saved)
    wrapper = mount(BuilderView, { props: { id: saved.id }, attachTo: document.body })
    const w = wrapper
    await w
      .findAll('.section-head')
      .find((h) => h.text().startsWith('Elim settings'))!
      .trigger('click')
    const choice = (name: string) =>
      w
        .find('[aria-label="Consolation Finals"]')
        .findAll('button')
        .find((b) => b.text() === name)!
    expect(choice("In the lane's rooms").attributes('aria-pressed')).toBe('true')
    await choice('With the other Finals').trigger('click')
    expect(choice('With the other Finals').attributes('aria-pressed')).toBe('true')
    const kept = loadSchedule(saved.id)!
    const slot = (label: string) => {
      const q = kept.quizzes.find((x) => x.label === label)!
      return kept.frame.find((r) => r.kind === 'slot' && r.id === q.cell!.slot)
    }
    expect(slot('Div 3C Finals')).toMatchObject({ use: 'finals' })
  })

  it('turning a consolation lane into a round robin rebuilds its quizzes', async () => {
    wrapper = mount(BuilderView, { attachTo: document.body })
    const w = wrapper
    const count = w.find('[aria-label="Number of divisions"]')
    await count.setValue('1')
    await count.trigger('change')
    const teams = w.find('[aria-label$="team count"]')
    await teams.setValue('17')
    await teams.trigger('change')
    expect(w.findAll('.quiz-title').some((t) => t.text() === 'Div 1C Finals')).toBe(true)

    await w
      .findAll('.section-head')
      .find((h) => h.text().startsWith('Elim settings'))!
      .trigger('click')
    const format = w.find('[aria-label="Div 1C format"]')
    await format
      .findAll('button')
      .find((b) => b.text() === 'Round robin')!
      .trigger('click')
    const consolation = w
      .findAll('.quiz')
      .filter((q) => q.find('.quiz-title').text().startsWith('Div 1C'))
    // 8 teams, 2 each: 6 quizzes seated by rank, and no Finals until one is asked for
    expect(consolation).toHaveLength(6)
    expect(
      consolation
        .flatMap((q) => q.findAll('.seat').map((s) => s.text()))
        .every((t) => /^(New )?\d+$/.test(t)),
    ).toBe(true)
  })

  it("refuses an intermediate that doesn't fit, saying why in the page", async () => {
    wrapper = mount(BuilderView, { attachTo: document.body })
    const w = wrapper
    const count = w.find('[aria-label="Number of divisions"]')
    await count.setValue('1')
    await count.trigger('change')
    const teams = w.find('[aria-label$="team count"]')
    await teams.setValue('12')
    await teams.trigger('change')
    await w
      .findAll('.section-head')
      .find((h) => h.text().startsWith('Elim settings'))!
      .trigger('click')
    await w.find('.elim-section .split').trigger('click')
    await w.find('.elim-section .step.gap .link').trigger('click')
    const line = w.find('[aria-label="Intermediate after Div 1"]')
    await line
      .findAll('button')
      .find((b) => b.text() === 'WXYZ')!
      .trigger('click')
    expect(w.find('.message').text()).toMatch(/Make those lanes bigger/)
  })
})

describe('pinning many at once (FR-011)', () => {
  const pinned = (w: VueWrapper) => w.findAll('.quiz.pinned').length

  it("pins and unpins a room's column and a slot's row", async () => {
    const w = await sixTeams()
    await w.findAll('.room-name')[0]!.trigger('click')
    popupButton('Pin room').click()
    await w.vm.$nextTick()
    const inRoom = pinned(w)
    expect(inRoom).toBeGreaterThan(0)

    await w.findAll('.room-name')[0]!.trigger('click')
    popupButton(`Unpin room (${inRoom})`).click()
    await w.vm.$nextTick()
    expect(pinned(w)).toBe(0)

    await w.find('.slot:not(.event) .time button').trigger('click')
    popupButton('Pin row').click()
    await w.vm.$nextTick()
    expect(pinned(w)).toBeGreaterThan(0)
  })

  it('unpins everything, and a division, from the panel', async () => {
    const w = await sixTeams()
    await w.findAll('.room-name')[0]!.trigger('click')
    popupButton('Pin room').click()
    await w.vm.$nextTick()
    const unpinDivision = w.findAll('button').find((b) => b.text().startsWith('Unpin Div 1'))!
    await unpinDivision.trigger('click')
    expect(pinned(w)).toBe(0)

    await w.findAll('.room-name')[0]!.trigger('click')
    popupButton('Pin room').click()
    await w.vm.$nextTick()
    await w
      .findAll('button')
      .find((b) => b.text() === 'Unpin all')!
      .trigger('click')
    expect(pinned(w)).toBe(0)
  })
})

describe("a day's menu", () => {
  const days = (w: VueWrapper) => w.findAll('.day .row-button').map((b) => b.text())

  it('deletes a day with its rows, and adds one after another', async () => {
    const w = await sixTeams()
    expect(days(w)).toContain('Sunday')
    await w
      .findAll('.day .row-button')
      .find((b) => b.text() === 'Sunday')!
      .trigger('click')
    popupButton('Delete day').click()
    await w.vm.$nextTick()
    expect(days(w)).not.toContain('Sunday')

    await w
      .findAll('.day .row-button')
      .find((b) => b.text() === 'Saturday')!
      .trigger('click')
    popupButton('Insert day after').click()
    await w.vm.$nextTick()
    expect(days(w)).toEqual(['Friday', 'Saturday', 'Sunday'])
  })
})
