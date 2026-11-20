import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { defineComponent, h, nextTick, ref, type Ref } from 'vue'
import { mount } from '@vue/test-utils'
import type { MeetDay } from '@qzr/shared'

vi.mock('../../api', () => ({ getMeetDay: vi.fn() }))

import { MEET_DAY_SECONDS, useMeetDay } from '../useMeetDay'

// Keeping the meet page current (FR-022), by the rules of specs/010-meet-day/research.md R7

const day = (scheduleVersion: number): MeetDay => ({
  phase: 'live',
  scheduleVersion,
  quizzes: [],
  benches: {},
  notOnSchedule: [],
})

type Read = (meetId: number, signal: AbortSignal) => Promise<MeetDay>

/** A read that waits to be answered, and remembers the signal it was given */
function held() {
  let answer!: (d: MeetDay) => void
  let signal!: AbortSignal
  const read: Read = (_id, s) => {
    signal = s
    return new Promise((resolve) => (answer = resolve))
  }
  return { read, answer: (d: MeetDay) => answer(d), signal: () => signal }
}

let visibility: DocumentVisibilityState = 'visible'

function setVisibility(state: DocumentVisibilityState) {
  visibility = state
  document.dispatchEvent(new Event('visibilitychange'))
}

/** Mount the composable for a meet, reading through `read` */
function open(read: Read, meetId: Ref<number | null> = ref(7)) {
  let state!: ReturnType<typeof useMeetDay>
  const wrapper = mount(
    defineComponent({
      setup() {
        state = useMeetDay(meetId, read)
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

describe('when the meet day is read', () => {
  it('reads on opening and every 30 seconds while the browser tab is visible', async () => {
    const read = vi.fn<Read>(async () => day(1))
    const { state } = open(read)
    await flush()
    expect(state().day.value?.scheduleVersion).toBe(1)
    await vi.advanceTimersByTimeAsync(MEET_DAY_SECONDS * 1000)
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('never reads while hidden, and reads at once on coming back into view', async () => {
    const read = vi.fn<Read>(async () => day(1))
    open(read)
    await flush()
    setVisibility('hidden')
    await vi.advanceTimersByTimeAsync(MEET_DAY_SECONDS * 3000)
    expect(read).toHaveBeenCalledTimes(1)
    setVisibility('visible')
    await flush()
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('stops reading, and cancels the read on its way, once the page is closed', async () => {
    const slow = held()
    const read = vi.fn<Read>(slow.read)
    const { wrapper } = open(read)
    wrapper.unmount()
    expect(slow.signal().aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(MEET_DAY_SECONDS * 3000)
    expect(read).toHaveBeenCalledTimes(1)
  })
})

describe('one read at a time (rule 1)', () => {
  it('lets the 30 seconds wait for a read already on its way', async () => {
    const slow = held()
    const read = vi.fn<Read>(slow.read)
    open(read)
    await vi.advanceTimersByTimeAsync(MEET_DAY_SECONDS * 1000)
    expect(read).toHaveBeenCalledTimes(1)
    expect(slow.signal().aborted).toBe(false)
  })

  it('cancels the read on its way for a Refresh, and drops its answer', async () => {
    const slow = held()
    const read = vi.fn<Read>().mockImplementationOnce(slow.read).mockResolvedValue(day(2))
    const { state } = open(read)
    await state().refresh()
    expect(slow.signal().aborted).toBe(true)
    slow.answer(day(1))
    await flush()
    expect(state().day.value?.scheduleVersion).toBe(2)
  })

  it('cancels a read of the last meet on opening another, and drops its answer', async () => {
    const slow = held()
    const read = vi.fn<Read>().mockImplementationOnce(slow.read).mockResolvedValue(day(2))
    const meetId = ref<number | null>(7)
    const { state } = open(read, meetId)
    meetId.value = 8
    await flush()
    expect(slow.signal().aborted).toBe(true)
    slow.answer(day(1))
    await flush()
    expect(read).toHaveBeenLastCalledWith(8, expect.anything())
    expect(state().day.value?.scheduleVersion).toBe(2)
  })
})

describe('what an answer asks of the tabs (rule 2)', () => {
  it('leaves the beat on opening, and moves it when the 30 seconds find the meet changed', async () => {
    let version = 1
    const { state } = open(vi.fn<Read>(async () => day(version)))
    await flush()
    await vi.advanceTimersByTimeAsync(MEET_DAY_SECONDS * 1000)
    expect(state().beat.value).toBe(0)
    version = 2
    await vi.advanceTimersByTimeAsync(MEET_DAY_SECONDS * 1000)
    expect(state().beat.value).toBe(1)
  })

  it('always moves the beat for a Refresh, changed or not', async () => {
    const { state } = open(vi.fn<Read>(async () => day(1)))
    await flush()
    await state().refresh()
    expect(state().beat.value).toBe(1)
  })

  it('never moves it to catch up, as after a tab switch, though the meet changed', async () => {
    let version = 1
    const { state } = open(vi.fn<Read>(async () => day(version)))
    await flush()
    version = 2
    await state().refresh('catchUp')
    expect(state().day.value?.scheduleVersion).toBe(2)
    expect(state().beat.value).toBe(0)
  })

  it('moves the beat for a Refresh that a read to catch up replaced', async () => {
    const slow = held()
    const read = vi.fn<Read>(async () => day(1))
    const { state } = open(read)
    await flush()
    read.mockImplementationOnce(slow.read)
    void state().refresh()
    await state().refresh('catchUp')
    expect(state().beat.value).toBe(1)
  })

  it('moves the beat for a Refresh after the opening read failed', async () => {
    const read = vi.fn<Read>().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(day(1))
    const { state } = open(read)
    await flush()
    expect(state().error.value).toBe('offline')
    await state().refresh()
    expect(state().error.value).toBe('')
    expect(state().beat.value).toBe(1)
  })
})
