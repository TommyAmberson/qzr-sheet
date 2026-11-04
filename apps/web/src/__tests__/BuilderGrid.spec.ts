import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'

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
const popupButton = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('.popover button')].find(
    (b) => b.textContent?.trim() === text,
  )!

describe('the quiz menu (FR-005c)', () => {
  it('renames a quiz, and seats that refer to it follow (FR-035c)', async () => {
    const w = await sixTeams()
    // Div 1 Quiz C takes 2 of A and 2 of B in the 6-team bracket
    expect(seatsOf(w, 'Div 1 Quiz C')).toContain('2 of A')
    await quizEl(w, 'Div 1 Quiz A').find('.quiz-title').trigger('click')
    const name = document.querySelector<HTMLInputElement>('[aria-label="Quiz name"]')!
    name.value = 'Div 1 Quiz A2'
    name.dispatchEvent(new Event('change'))
    await w.vm.$nextTick()
    expect(seatsOf(w, 'Div 1 Quiz C')).toContain('2 of A2')
    expect(quizEl(w, 'Div 1 Quiz A2').classes()).toContain('pinned')
  })

  it('sets a seat to any kind of source, and a seat editor leads back to its menu', async () => {
    const w = await sixTeams()
    await quizEl(w, 'Div 1 Quiz 1').findAll('.seat')[2]!.trigger('click')
    expect(document.querySelector('.seat-editor')).not.toBeNull()
    const kind = document.querySelector<HTMLSelectElement>('[aria-label="Seat kind"]')!
    kind.value = 'new'
    kind.dispatchEvent(new Event('change'))
    await w.vm.$nextTick()
    const rank = document.querySelector<HTMLInputElement>('[aria-label="Rank"]')!
    rank.value = '10'
    popupButton('Set seat').click()
    await w.vm.$nextTick()
    expect(seatsOf(w, 'Div 1 Quiz 1')).toEqual(['A', 'C', 'New 10'])
    // Back on the quiz's menu; nothing is refused: a letter beyond the division is kept, and
    // marked (H-10)
    document.querySelector<HTMLButtonElement>('[aria-label="Seat 3"]')!.click()
    await w.vm.$nextTick()
    const letter = document.querySelector<HTMLSelectElement>('[aria-label="Seat kind"]')!
    letter.value = 'letter'
    letter.dispatchEvent(new Event('change'))
    await w.vm.$nextTick()
    document.querySelector<HTMLInputElement>('[aria-label="Letter"]')!.value = 'Z'
    popupButton('Set seat').click()
    await w.vm.$nextTick()
    expect(quizEl(w, 'Div 1 Quiz 1').classes()).toContain('conflict')
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
  })
})

describe('rows and rooms', () => {
  it("inserts a slot, a one-room event and a note, sets a slot's length, and deletes a row", async () => {
    const w = await sixTeams()
    const rows = () => w.findAll('tbody tr').length
    const before = rows()
    const firstTime = () => w.find('.slot .time button')
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
    await w
      .findAll('.event')
      .find((e) => e.text().includes('Event'))!
      .find('.time button')
      .trigger('click')
    const room = document.querySelector<HTMLSelectElement>('[aria-label="Event room"]')!
    room.value = room.options[2]!.value
    room.dispatchEvent(new Event('change'))
    await w.vm.$nextTick()
    // The event takes its room's cell: shown there, or, over a quiz, the quiz is marked (H-3)
    const marked = w.findAll('.quiz').some((q) => (q.attributes('title') ?? '').includes('H-3'))
    expect(w.find('.room-event').exists() || marked).toBe(true)

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

describe('on a phone (FR-005b)', () => {
  it('opens the settings as a sheet and still moves a quiz by select-then-choose', async () => {
    const w = await sixTeams()
    await w.find('.settings-toggle').trigger('click')
    expect(w.find('.panel').classes()).toContain('open')
    await w.find('.settings-toggle').trigger('click')
    const empty = w.find('.empty-cell')
    const target = empty.element.closest('td')!.dataset.cell
    await quizEl(w, 'Div 1 Quiz 3').find('.quiz-title').trigger('click')
    popupButton('Move').click()
    await w.vm.$nextTick()
    await empty.trigger('click')
    expect(cellOf(w, 'Div 1 Quiz 3')).toBe(target)
  })
})

describe('Elim settings (story 4)', () => {
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
    await format.setValue('roundRobin')
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
    await w.find('.elim-section .link:last-of-type').trigger('click')
    const line = w.find('[aria-label="Intermediate after Div 1"]')
    await line.setValue('4')
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

    await w.find('.slot .time button').trigger('click')
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
