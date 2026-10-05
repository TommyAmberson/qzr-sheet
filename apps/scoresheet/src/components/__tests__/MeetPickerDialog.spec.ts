import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ApiError, MeetRole } from '@qzr/shared'

vi.mock('../../api', () => ({
  getMyMeets: vi.fn(),
  joinMeet: vi.fn(),
  joinMeetGuest: vi.fn(),
  getMeetTeams: vi.fn(),
  getSender: vi.fn(),
}))

import { getMeetTeams, getMyMeets } from '../../api'
import { useMeetSession } from '../../composables/useMeetSession'
import MeetPickerDialog from '../MeetPickerDialog.vue'

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

const membership = (meetId: number, role: MeetRole) => ({
  meetId,
  meetName: `Meet ${meetId}`,
  role,
})

beforeEach(() => {
  useMeetSession().clearSession()
  vi.mocked(getMeetTeams).mockReset()
  vi.mocked(getMyMeets)
    .mockReset()
    .mockResolvedValue({
      memberships: [
        membership(1, MeetRole.Official),
        membership(2, MeetRole.Viewer),
        membership(3, MeetRole.Admin),
      ],
    })
})

async function choosing(last: number | null = null) {
  const wrapper = mount(MeetPickerDialog, { attachTo: document.body })
  const chosen = wrapper.vm.chooseForSubmit(last)
  await flushPromises()
  return { wrapper, chosen }
}

describe('choosing a meet to submit to', () => {
  it('lists only the meets the user may send to, marking the last one used', async () => {
    const { wrapper } = await choosing(3)
    expect(wrapper.text()).toContain('Submit to which meet?')
    const rows = wrapper.findAll('.meet-row')
    expect(rows.map((row) => row.find('.meet-row-name').text())).toEqual(['Meet 1', 'Meet 3'])
    expect(rows[1]!.classes()).toContain('meet-row--last')
    wrapper.unmount()
  })

  it("lists a meet where any of the user's memberships may send, whichever came first", async () => {
    vi.mocked(getMyMeets).mockResolvedValue({
      memberships: [
        membership(4, MeetRole.HeadCoach),
        { ...membership(4, MeetRole.Official), roomId: 9 },
      ],
    })
    const { wrapper } = await choosing()
    expect(wrapper.findAll('.meet-row').map((row) => row.text())).toEqual(['Meet 4official'])
    wrapper.unmount()
  })

  it('gives back the meet picked, without linking the sheet or loading its teams', async () => {
    const { wrapper, chosen } = await choosing()
    await wrapper.findAll('.meet-row')[1]!.trigger('click')
    expect(await chosen).toMatchObject({ meetId: 3, meetName: 'Meet 3' })
    expect(getMeetTeams).not.toHaveBeenCalled()
    expect(useMeetSession().isActive.value).toBe(false)
    wrapper.unmount()
  })

  it('gives back nothing when closed', async () => {
    const { wrapper, chosen } = await choosing()
    await wrapper.find('.meet-picker-close').trigger('click')
    expect(await chosen).toBeNull()
    wrapper.unmount()
  })

  it("shows why the meets couldn't be listed", async () => {
    vi.mocked(getMyMeets).mockRejectedValue(new Error('Failed to fetch'))
    const { wrapper } = await choosing()
    expect(wrapper.text()).toContain('Failed to fetch')
    expect(wrapper.text()).not.toContain('room code.')
    wrapper.unmount()
  })

  it('offers a code join to someone with no meet to send to', async () => {
    vi.mocked(getMyMeets).mockRejectedValue(new ApiError(401, 'Not signed in'))
    const { wrapper } = await choosing()
    expect(wrapper.findAll('.meet-row')).toHaveLength(0)
    expect(wrapper.text()).toContain('Sign in, or join a meet with your room code.')
    expect(wrapper.find('.join-input').exists()).toBe(true)
    wrapper.unmount()
  })
})
