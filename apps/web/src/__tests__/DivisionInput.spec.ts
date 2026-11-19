import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { DivisionInput } from '@qzr/ui'

function box(modelValue: string) {
  return mount(DivisionInput, { props: { modelValue } })
}

describe('DivisionInput', () => {
  it('shows a stored name as it is, so a prefix saved by mistake shows', () => {
    expect(box('Div 1').find('input').element.value).toBe('Div 1')
  })

  it('shows no prefix where its label already says "Division", and still drops a typed one', async () => {
    const wrapper = mount(DivisionInput, { props: { modelValue: '', bare: true } })
    expect(wrapper.find('.division-input-prefix').exists()).toBe(false)
    expect(wrapper.element.tagName).toBe('INPUT')
    await wrapper.find('input').setValue('D 2')
    expect(wrapper.find('input').element.value).toBe('2')
    expect(wrapper.emitted('update:modelValue')!.pop()).toEqual(['2'])
    expect(wrapper.emitted('change')).toEqual([['2']])
  })

  it('drops a typed prefix once the box is left', async () => {
    const wrapper = box('')
    const input = wrapper.find('input')
    // setValue fires both input and change, as typing and leaving the box do
    await input.setValue('Div 2')
    expect(input.element.value).toBe('2')
    expect(wrapper.emitted('update:modelValue')!.pop()).toEqual(['2'])
    expect(wrapper.emitted('change')).toEqual([['2']])
  })
})
