import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ApiError, CellValue, PlacementFormula, type QuizFile } from '@qzr/shared'
import type { MeetTeam } from '../../api'

const team = (id: number, churchName: string, division: string): MeetTeam => ({
  id,
  churchId: id,
  churchName,
  churchShortName: churchName.slice(0, 3),
  division,
  number: 1,
  consolation: false,
})
// Division 2's Calgary is listed first, so only the quiz's division can prefer division 1's
const roster = [team(9, 'Calgary', '2'), team(1, 'Calgary', '1'), team(2, 'Regina', '1')]

vi.mock('../../api', async () => ({
  ...(await vi.importActual<typeof import('../../api')>('../../api')),
  getMeetTeams: vi.fn(async () => ({ teams: roster, meetDivisions: ['1', '2'] })),
  getTeamQuizzers: vi.fn(async () => ({ quizzers: [{ quizzerId: 11, name: 'Ann' }] })),
  getSender: vi.fn(),
  getMyMeets: vi.fn(),
}))
vi.mock('../../persistence/fileIO', async () => ({
  ...(await vi.importActual<typeof import('../../persistence/fileIO')>('../../persistence/fileIO')),
  openAnyQuizFile: vi.fn(),
  confirmAction: vi.fn(async () => false),
}))

import { getMyMeets, getSender } from '../../api'
import { confirmAction, openAnyQuizFile } from '../../persistence/fileIO'
import Scoresheet from '../Scoresheet.vue'
import { useMeetSession, type MeetSessionData } from '../../composables/useMeetSession'
import { useSubmitToMeet } from '../../composables/useSubmitToMeet'

const fileTeam = (id: number, name: string, quizzer: string) => ({
  id,
  name,
  onTime: true,
  seatOrder: id - 1,
  quizzers: [{ id: id * 10, name: quizzer, seatOrder: 0 }],
})
const savedQuiz: QuizFile = {
  version: 2,
  quiz: {
    division: '1',
    quizNumber: '4',
    overtime: false,
    placementFormula: PlacementFormula.Rules,
    questionTypes: [],
  },
  teams: [fileTeam(1, 'Calgary 1', 'Ann'), fileTeam(2, 'Saskatoon 1', 'Bo'), fileTeam(3, '', '')],
  answers: [],
  noJumps: [],
}

// Two teams marked correct on the one question
const quizWithScoringError: QuizFile = {
  ...savedQuiz,
  answers: [10, 20].map((quizzerId) => ({ quizzerId, columnKey: '1', value: CellValue.Correct })),
}

// The last quiz had Regina in the first slot
const linked: MeetSessionData = {
  meetId: 3,
  meetName: 'Practice',
  slots: [
    { teamId: 2, dbLabel: 'Reg 1', dbLabelFull: 'Regina 1', quizzers: [] },
    undefined,
    undefined,
  ],
  teamList: roster,
  meetDivisions: ['1', '2'],
  quizId: '5',
  sender: { admin: true, rooms: [] },
}

beforeEach(() => {
  localStorage.clear()
  useMeetSession().restoreSession(structuredClone(linked))
  vi.mocked(confirmAction).mockClear()
  vi.mocked(getSender).mockResolvedValue({ admin: true, rooms: [] })
  vi.mocked(getMyMeets).mockRejectedValue(new ApiError(401, 'Authentication required'))
  vi.mocked(openAnyQuizFile).mockResolvedValue({
    type: 'json',
    content: JSON.stringify(savedQuiz),
  })
})

describe('opening a file in a linked meet', () => {
  it("drops the last quiz's picks and picks none for the file's teams", async () => {
    const wrapper = mount(Scoresheet)
    await flushPromises()
    await wrapper.vm.openFile()
    await flushPromises()

    const { getSlot, quizId } = useMeetSession()
    // Calgary 1 is on the roster, and still isn't picked: the file stays as it was saved
    expect(getSlot(0)).toBeUndefined()
    expect(getSlot(1)).toBeUndefined()
    expect(quizId.value).toBeNull()
    wrapper.unmount()
  })

  it('lists the names that disagree with the roster, and asks before sending them', async () => {
    const wrapper = mount(Scoresheet)
    await flushPromises()
    await wrapper.vm.openFile()
    await flushPromises()

    // No team of an opened file is picked, on the roster or off it, and the third has no name
    const warnings = [
      "Calgary 1: not picked from the meet's teams",
      "Saskatoon 1: not picked from the meet's teams",
      'Team 3: no team picked',
    ]
    expect(wrapper.get('.meta-name-warnings').attributes('title')).toBe(warnings.join('\n'))

    const button = (label: string) =>
      wrapper.findAll('button').find((candidate) => candidate.text().includes(label))!
    await button('Save').trigger('click')
    await button('Submit to meet').trigger('click')
    await flushPromises()
    expect(confirmAction).toHaveBeenLastCalledWith(
      `Check these names:\n${warnings.join('\n')}\n\nSubmit anyway?`,
    )
    wrapper.unmount()
  })

  it('asks before sending a quiz with scoring errors, rather than refusing it', async () => {
    vi.mocked(openAnyQuizFile).mockResolvedValue({
      type: 'json',
      content: JSON.stringify(quizWithScoringError),
    })
    const wrapper = mount(Scoresheet)
    await flushPromises()
    await wrapper.vm.openFile()
    await flushPromises()

    const button = (label: string) =>
      wrapper.findAll('button').find((candidate) => candidate.text().includes(label))!
    await button('Save').trigger('click')
    await button('Submit to meet').trigger('click')
    await flushPromises()
    const question = vi.mocked(confirmAction).mock.lastCall?.[0]
    expect(question).toMatch(/^Scoring errors .*\n.+\n\nCheck these names:/)
    expect(question).toMatch(/Submit anyway\?$/)
    wrapper.unmount()
  })

  it("leaves the linked meet's roster out of it when the quiz goes to another meet", async () => {
    // Linked to a meet the user may not send to, with one other meet they may
    useMeetSession().restoreSession({ ...structuredClone(linked), sender: null })
    vi.mocked(getSender).mockImplementation(async (meetId) => {
      if (meetId === linked.meetId) throw new ApiError(403, 'Forbidden')
      return { admin: true, rooms: [] }
    })
    vi.mocked(getMyMeets).mockResolvedValue({
      memberships: [{ meetId: 7, meetName: 'Regionals', role: 'admin' }],
    } as Awaited<ReturnType<typeof getMyMeets>>)
    vi.mocked(openAnyQuizFile).mockResolvedValue({
      type: 'json',
      content: JSON.stringify(quizWithScoringError),
    })
    const wrapper = mount(Scoresheet)
    await flushPromises()
    await useSubmitToMeet().refreshTargets()
    await wrapper.vm.openFile()
    await flushPromises()

    const button = (label: string) =>
      wrapper.findAll('button').find((candidate) => candidate.text().includes(label))!
    await button('Save').trigger('click')
    await button('Submit to meet').trigger('click')
    await flushPromises()
    const question = vi.mocked(confirmAction).mock.lastCall?.[0]
    expect(question).toMatch(/^Scoring errors /)
    expect(question).not.toContain('Check these names')
    wrapper.unmount()
  })
})
