import { beforeAll, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

import router from '../router'
import BuilderView from '../views/BuilderView.vue'

describe('the schedule builder page', () => {
  it('opens signed out, with no account', async () => {
    await router.push('/builder')
    expect(router.currentRoute.value.name).toBe('builder')
  })

  it('keeps one section of the left panel open at a time', async () => {
    const wrapper = mount(BuilderView)
    const heads = () => wrapper.findAll('.section-head')
    const expanded = () => heads().filter((h) => h.attributes('aria-expanded') === 'true')

    expect(expanded().map((h) => h.text())).toEqual(['Teams'])
    await heads()[2]!.trigger('click')
    expect(expanded().map((h) => h.text())).toEqual(['Prelim settings'])
    await heads()[2]!.trigger('click')
    expect(expanded()).toHaveLength(0)
  })

  it('undoes and redoes a change', async () => {
    const wrapper = mount(BuilderView)
    const name = wrapper.find('.schedule-name')
    await name.setValue('FBC 2025')
    await name.trigger('change')
    expect((name.element as HTMLInputElement).value).toBe('FBC 2025')

    await wrapper.find('[aria-label="Undo"]').trigger('click')
    expect((name.element as HTMLInputElement).value).toBe('New schedule')

    await wrapper.find('[aria-label="Redo"]').trigger('click')
    expect((name.element as HTMLInputElement).value).toBe('FBC 2025')
  })
})

describe('building from team counts', () => {
  it('generates the FBC 2025 counts with no problems, prelims in letters (story 1)', async () => {
    const wrapper = mount(BuilderView)
    const count = wrapper.find('[aria-label="Number of divisions"]')
    await count.setValue('3')
    await count.trigger('change')
    const teams = wrapper.findAll('[aria-label$="team count"]')
    for (const [i, n] of [6, 17, 16].entries()) {
      await teams[i]!.setValue(String(n))
      await teams[i]!.trigger('change')
    }
    expect(wrapper.find('.issue-count').text()).toMatch(/^0 problems/)
    expect(wrapper.findAll('[data-quiz]').length).toBeGreaterThan(39)
    const firstPrelim = wrapper.findAll('.quiz').find((q) => q.text().startsWith('Div 1 Quiz 1'))
    expect(firstPrelim?.findAll('.seat').map((s) => s.text())).toEqual(['A', 'C', 'F'])
    expect(wrapper.find('.room-divisions').text()).toContain('Div 1')
  })

  it('starts a new schedule as a minimal frame of 3 rooms (FR-010)', () => {
    const wrapper = mount(BuilderView)
    expect(wrapper.findAll('th.room')).toHaveLength(3)
  })
})

describe('settings sections', () => {
  beforeAll(() => {
    // jsdom has no modal dialogs
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.open = true
    }
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
      this.open = false
    }
  })

  async function fbc() {
    const wrapper = mount(BuilderView, { attachTo: document.body })
    const count = wrapper.find('[aria-label="Number of divisions"]')
    await count.setValue('3')
    await count.trigger('change')
    const teams = wrapper.findAll('[aria-label$="team count"]')
    for (const [i, n] of [6, 17, 16].entries()) {
      await teams[i]!.setValue(String(n))
      await teams[i]!.trigger('change')
    }
    return wrapper
  }

  async function openSection(wrapper: Awaited<ReturnType<typeof fbc>>, title: string) {
    await wrapper
      .findAll('.section-head')
      .find((h) => h.text().startsWith(title))!
      .trigger('click')
  }

  it('raising the room count adds a room and re-flows the grid (story 2 scenario 1)', async () => {
    const wrapper = await fbc()
    await openSection(wrapper, 'Time slots and rooms')
    await wrapper.find('[aria-label="As many rooms as needed"]').setValue(false)
    const rooms = wrapper.find('[aria-label="Room count"]')
    await rooms.setValue('6')
    await rooms.trigger('change')
    expect(wrapper.findAll('th.room')).toHaveLength(6)
    expect(wrapper.find('.issue-count').text()).toMatch(/^0 problems/)
    wrapper.unmount()
  })

  it('adds and deletes days from Time slots and under the grid', async () => {
    const wrapper = await fbc()
    await openSection(wrapper, 'Time slots and rooms')
    const days = () =>
      wrapper.findAll('[aria-label="Day name"]').map((d) => (d.element as HTMLInputElement).value)
    expect(days()).toEqual(['Friday', 'Saturday', 'Sunday'])
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '+ Add a day')!
      .trigger('click')
    await wrapper.find('.add-day').trigger('click')
    expect(days()).toEqual(['Friday', 'Saturday', 'Sunday', 'Monday', 'Tuesday'])
    await wrapper.find('[aria-label="Delete Friday"]').trigger('click')
    expect(days()[0]).toBe('Saturday')
    expect(wrapper.findAll('tr.day')).toHaveLength(4)
    wrapper.unmount()
  })

  it("picks a division's colour, which its quizzes take", async () => {
    const wrapper = await fbc()
    await wrapper.find('[aria-label="Div 2 colour"]').trigger('click')
    await wrapper.find('[aria-label="Div 2 colours"] [aria-label="teal"]').trigger('click')
    const quiz = wrapper.findAll('.quiz').find((q) => q.text().includes('Div 2 Quiz 1'))!
    expect(quiz.attributes('style')).toContain('--dc-teal')
    wrapper.unmount()
  })

  it('steps a number field with its + and − buttons', async () => {
    const wrapper = await fbc()
    const field = wrapper
      .find('[aria-label="Number of divisions"]')
      .element.closest('.number-input')!
    const [fewer, more] = field.querySelectorAll('button')
    more!.click()
    await flushPromises()
    expect(wrapper.findAll('[aria-label$="team count"]')).toHaveLength(4)
    fewer!.click()
    await flushPromises()
    expect(wrapper.findAll('[aria-label$="team count"]')).toHaveLength(3)
    wrapper.unmount()
  })

  it('with Auto-apply off, marks a changed setting until Apply (FR-012a, story 2 scenario 6)', async () => {
    const wrapper = await fbc()
    await wrapper.find('[aria-label="Auto-apply"]').setValue(false)
    await openSection(wrapper, 'Time slots and rooms')
    const length = wrapper.find('[aria-label="Slot length"]')
    await length.setValue('20')
    await length.trigger('change')

    expect(wrapper.find('.unapplied').text()).toBe('Unapplied · grid uses 25')
    expect(wrapper.find('[data-section="frame"] .count').text()).toBe('1 unapplied')
    await wrapper.find('.apply').trigger('click')
    await wrapper.vm.$nextTick()
    const dialog = document.querySelector('.choice-dialog')!
    expect(dialog.textContent).toMatch(/\d+ quizz?(es)? will move/)
    ;(
      [...dialog.querySelectorAll('button')].find(
        (b) => b.textContent?.trim() === 'Apply',
      ) as HTMLButtonElement
    ).click()
    await new Promise((r) => setTimeout(r))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.unapplied').exists()).toBe(false)
    wrapper.unmount()
  })

  it('explains the prelim draw with an (i) (FR-008)', async () => {
    const wrapper = await fbc()
    await openSection(wrapper, 'Prelim settings')
    await wrapper.find('[aria-label="About the prelim draw"]').trigger('click')
    expect(wrapper.find('.info-box').text()).toMatch(/no tables over 21 teams/)
    wrapper.unmount()
  })
})
