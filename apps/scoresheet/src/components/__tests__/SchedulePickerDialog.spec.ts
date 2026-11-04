import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ApiError, MeetRole, generateSchedule, newScheduleDocument } from '@qzr/shared'

vi.mock('../../api', () => ({
  getMyMeets: vi.fn(),
  joinMeet: vi.fn(),
  joinMeetGuest: vi.fn(),
  getMeetTeams: vi.fn(),
  getPublishedSchedule: vi.fn(),
}))

import { getMyMeets, getPublishedSchedule } from '../../api'
import { useMeetSession } from '../../composables/useMeetSession'
import SchedulePickerDialog from '../SchedulePickerDialog.vue'

beforeAll(() => {
  // jsdom has no modal dialogs
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true
  }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false
    this.dispatchEvent(new Event('close'))
  }
})

function published() {
  const base = newScheduleDocument('Fall Meet')
  base.settings.divisions = [{ id: '1', name: 'Div 1', teams: 6, elims: { lanes: [], lines: [] } }]
  return generateSchedule(base)
}

beforeEach(() => {
  useMeetSession().clearSession()
  vi.mocked(getPublishedSchedule).mockReset()
  vi.mocked(getMyMeets)
    .mockReset()
    .mockResolvedValue({
      memberships: [{ meetId: 4, meetName: 'Fall Meet', role: MeetRole.Official }],
    })
})

async function openOnMeet(onPick = vi.fn().mockResolvedValue(true)) {
  const wrapper = mount(SchedulePickerDialog, { props: { onPick }, attachTo: document.body })
  await wrapper.vm.open()
  await flushPromises()
  await wrapper.find('.meet-row').trigger('click')
  await flushPromises()
  return { wrapper, onPick }
}

describe('loading a quiz from the published schedule (FR-050)', () => {
  it("shows the meet's published schedule and loads the quiz picked, by its id", async () => {
    const doc = published()
    vi.mocked(getPublishedSchedule).mockResolvedValue({
      document: doc,
      publishedAt: '2026-11-02',
      view: 'letters',
      meetName: 'Fall Meet',
    })
    const { wrapper, onPick } = await openOnMeet()
    const quiz = doc.quizzes.find((q) => q.cell)!
    await wrapper.find(`[data-quiz="${quiz.id}"] .picker-quiz-btn`).trigger('click')
    await flushPromises()
    expect(onPick).toHaveBeenCalledWith(4, quiz.id)
    wrapper.unmount()
  })

  it('says so when nothing is published yet', async () => {
    vi.mocked(getPublishedSchedule).mockRejectedValue(new ApiError(404, 'Nothing is published yet'))
    const { wrapper } = await openOnMeet()
    expect(wrapper.text()).toContain("This meet's schedule hasn't been published yet.")
    wrapper.unmount()
  })

  it('says why when the API is down, and the scoresheet stays usable (Principle I)', async () => {
    vi.mocked(getPublishedSchedule).mockRejectedValue(new TypeError('Failed to fetch'))
    const { wrapper } = await openOnMeet()
    expect(wrapper.find('.schedule-picker-state--error').text()).toBe('Failed to fetch')
    wrapper.unmount()
  })
})
