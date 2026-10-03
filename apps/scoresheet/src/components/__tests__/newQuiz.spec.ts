import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import Scoresheet from '../Scoresheet.vue'
import { useMeetSession, type MeetSessionData } from '../../composables/useMeetSession'

const linked: MeetSessionData = {
  meetId: 3,
  meetName: 'Practice',
  slots: [undefined, undefined, undefined],
  teamList: [],
  meetDivisions: ['1'],
  quizId: 5,
  official: { rooms: [] },
}

beforeEach(() => {
  localStorage.clear()
  useMeetSession().restoreSession(structuredClone(linked))
})

describe('starting a new quiz in a linked meet', () => {
  it('forgets the last quiz but keeps the meet link, however it is started', async () => {
    const wrapper = mount(Scoresheet)
    // Ctrl+N reaches newQuiz directly, not through the New menu
    await wrapper.vm.newQuiz()
    const session = useMeetSession().snapshotSession()
    expect(session).toMatchObject({ meetId: 3, official: { rooms: [] }, quizId: null })
  })
})
