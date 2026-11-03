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
