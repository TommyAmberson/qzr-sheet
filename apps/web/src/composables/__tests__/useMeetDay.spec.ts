import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import type { MeetDay } from '@qzr/shared'

vi.mock('../../api', () => ({ getMeetDay: vi.fn() }))

import { MEET_DAY_SECONDS, useMeetDay } from '../useMeetDay'

const day = (scheduleVersion: number): MeetDay => ({
  phase: 'live',
  scheduleVersion,
  quizzes: [],
  benches: {},
  notOnSchedule: [],
})

let visibility: DocumentVisibilityState = 'visible'

function setVisibility(state: DocumentVisibilityState) {
  visibility = state
  document.dispatchEvent(new Event('visibilitychange'))
}

/** Mount the composable for meet 7, reading through `read` */
function open(read: (meetId: number) => Promise<MeetDay>) {
  let state!: ReturnType<typeof useMeetDay>
  const wrapper = mount(
    defineComponent({
      setup() {
        state = useMeetDay(ref(7), read)
        return () => h('div')
      },
    }),
  )
  return { wrapper, state: () => state }
}

const flush = async () => {
  await Promise.resolve()
  await nextTick()
}

beforeEach(() => {
  vi.useFakeTimers()
  visibility = 'visible'
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useMeetDay (FR-022)', () => {
  it('reads on opening and every 30 seconds while the browser tab is visible', async () => {
    let version = 1
    const read = vi.fn(async () => day(version))
    const { state } = open(read)
    await flush()
    expect(read).toHaveBeenCalledTimes(1)
    expect(state().day.value?.scheduleVersion).toBe(1)
    // A read that finds nothing changed leaves the tabs be
    await vi.advanceTimersByTimeAsync(MEET_DAY_SECONDS * 1000)
    expect(read).toHaveBeenCalledTimes(2)
    expect(state().beat.value).toBe(1)
    version = 2
    await vi.advanceTimersByTimeAsync(MEET_DAY_SECONDS * 1000)
    expect(state().beat.value).toBe(2)
  })

  it('never reads while hidden, and reads at once on coming back into view', async () => {
    const read = vi.fn(async () => day(1))
    open(read)
    await flush()
    setVisibility('hidden')
    await vi.advanceTimersByTimeAsync(MEET_DAY_SECONDS * 3000)
    expect(read).toHaveBeenCalledTimes(1)
    setVisibility('visible')
    await flush()
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('reads on refresh, keeping the newest answer when an older one comes back later', async () => {
    let answer!: (d: MeetDay) => void
    const read = vi
      .fn<(meetId: number) => Promise<MeetDay>>()
      .mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)))
      .mockImplementationOnce(async () => day(2))
    const { state } = open(read)
    await state().refresh()
    answer(day(1))
    await flush()
    expect(state().day.value?.scheduleVersion).toBe(2)
  })

  it('moves the beat for an asked-for read that a background read overtook', async () => {
    let answer!: (d: MeetDay) => void
    const read = vi
      .fn<(meetId: number) => Promise<MeetDay>>()
      .mockImplementation(async () => day(1))
    const { state } = open(read)
    await flush()
    const before = state().beat.value
    read.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)))
    const asked = state().refresh()
    // The 30 seconds come round while it waits, and find the meet unchanged
    await vi.advanceTimersByTimeAsync(MEET_DAY_SECONDS * 1000)
    answer(day(1))
    await asked
    await flush()
    expect(state().beat.value).toBe(before + 1)
  })

  it('stops reading once the page is closed', async () => {
    const read = vi.fn(async () => day(1))
    const { wrapper } = open(read)
    await flush()
    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(MEET_DAY_SECONDS * 3000)
    expect(read).toHaveBeenCalledTimes(1)
  })
})
