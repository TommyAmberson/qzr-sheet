import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

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
