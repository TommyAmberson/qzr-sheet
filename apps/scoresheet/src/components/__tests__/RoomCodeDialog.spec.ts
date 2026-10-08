import { describe, it, expect, beforeAll, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { RoomCodeDialog, type RoomCodeRequest } from '@qzr/ui'

beforeAll(() => {
  // jsdom has no modal dialogs
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true
  }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false
  }
})

const rows = [
  { meetId: 1, label: 'Fall Meet, Room 1' },
  { meetId: 2, label: 'Spring Meet, Room 3' },
]

function open(
  onCode: RoomCodeRequest['onCode'],
  opts: { rows?: typeof rows; skip?: boolean } = {},
) {
  const wrapper = mount(RoomCodeDialog, { attachTo: document.body })
  const answer = wrapper.vm.ask({
    title: 'Room code needed',
    detail: 'Enter the room code again.',
    rows: opts.rows ?? rows.slice(0, 1),
    onCode,
    submitLabel: 'Join',
    closeLabel: opts.skip ? 'Done' : 'Cancel',
    skip: opts.skip ?? false,
  })
  return { wrapper, answer }
}

const button = (wrapper: ReturnType<typeof mount>, label: string, nth = 0) =>
  wrapper.findAll('button').filter((b) => b.text() === label)[nth]!

describe('RoomCodeDialog', () => {
  it('names each row and resolves true once every row is accepted', async () => {
    const onCode = vi.fn(async () => null)
    const { wrapper, answer } = open(onCode)
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('Room code needed')
    expect(wrapper.text()).toContain('Fall Meet, Room 1')
    await wrapper.find('input').setValue(' NEW-CODE ')
    await button(wrapper, 'Join').trigger('click')
    await flushPromises()
    expect(onCode).toHaveBeenCalledWith(rows[0], 'NEW-CODE')
    expect(await answer).toBe(true)
    wrapper.unmount()
  })

  it("shows a row's message and stays open when its code is refused", async () => {
    const { wrapper, answer } = open(async () => 'That code is for another meet.')
    await wrapper.vm.$nextTick()
    await wrapper.find('input').setValue('WRONG')
    await button(wrapper, 'Join').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('That code is for another meet.')
    expect(wrapper.find('dialog').element.open).toBe(true)
    await button(wrapper, 'Cancel').trigger('click')
    expect(await answer).toBe(false)
    wrapper.unmount()
  })

  it('resolves false when cancelled before any code is accepted', async () => {
    const onCode = vi.fn(async () => null)
    const { wrapper, answer } = open(onCode)
    await wrapper.vm.$nextTick()
    await button(wrapper, 'Cancel').trigger('click')
    expect(await answer).toBe(false)
    expect(onCode).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('lets each row be skipped, and closes once every row is handled', async () => {
    const onCode = vi.fn(async () => null)
    const { wrapper, answer } = open(onCode, { rows, skip: true })
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('Spring Meet, Room 3')
    await wrapper.findAll('input')[0]!.setValue('CODE-1')
    await button(wrapper, 'Join').trigger('click')
    await flushPromises()
    await button(wrapper, 'Skip').trigger('click')
    // Not every row was accepted
    expect(await answer).toBe(false)
    expect(onCode).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })
})
