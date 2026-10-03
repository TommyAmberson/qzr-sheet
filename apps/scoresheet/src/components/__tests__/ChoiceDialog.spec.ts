import { describe, it, expect, beforeAll } from 'vitest'
import { mount } from '@vue/test-utils'
import ChoiceDialog from '../ChoiceDialog.vue'

beforeAll(() => {
  // jsdom has no modal dialogs
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true
  }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false
  }
})

const choices = [
  { label: "Don't submit", value: null },
  { label: 'Room 1', value: 1 },
  { label: 'Room 2', value: 2, primary: true },
]

async function ask() {
  const wrapper = mount(ChoiceDialog, { attachTo: document.body })
  const answer = wrapper.vm.ask('Submit for which room?', 'You officiate two rooms.', choices)
  await wrapper.vm.$nextTick()
  return { wrapper, answer }
}

describe('ChoiceDialog', () => {
  it('shows the question and resolves to the chosen value', async () => {
    for (const choice of choices) {
      const { wrapper, answer } = await ask()
      expect(wrapper.text()).toContain('Submit for which room?')
      expect(wrapper.text()).toContain('You officiate two rooms.')
      await wrapper
        .findAll('button')
        .find((b) => b.text() === choice.label)!
        .trigger('click')
      expect(await answer).toBe(choice.value)
      wrapper.unmount()
    }
  })

  it('dismisses an unanswered question when asked another', async () => {
    const { wrapper, answer } = await ask()
    const next = wrapper.vm.ask('Another?', 'Second question.', choices)
    expect(await answer).toBeNull()
    await wrapper.vm.$nextTick()
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Room 1')!
      .trigger('click')
    expect(await next).toBe(1)
    wrapper.unmount()
  })

  it('resolves to null when dismissed', async () => {
    const { wrapper, answer } = await ask()
    await wrapper.find('dialog').trigger('cancel')
    expect(await answer).toBeNull()
    wrapper.unmount()
  })
})
