import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import DisplayClock from '../components/DisplayClock.vue'

afterEach(() => vi.useRealTimers())

describe('the display clock', () => {
  it("shows the time on the meet's clock, moving on with each minute", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-13T15:09:30Z'))
    const w = mount(DisplayClock, { props: { timeZone: 'America/Regina' } })
    expect(w.text()).toBe('9:09 AM')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(w.text()).toBe('9:10 AM')
    w.unmount()
  })
})
