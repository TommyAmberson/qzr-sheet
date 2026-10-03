import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ApiError, CellValue, PlacementFormula, type QuizFile } from '@qzr/shared'

vi.mock('../../api', async () => ({
  ...(await vi.importActual<typeof import('../../api')>('../../api')),
  getRevision: vi.fn(),
  getMeetName: vi.fn(async () => ({ meet: { name: 'Practice' } })),
  getMeetTeams: vi.fn(async () => ({ teams: [], meetDivisions: ['1'] })),
  getSender: vi.fn(async () => {
    throw new ApiError(401, 'Authentication required')
  }),
}))

import { getRevision } from '../../api'
import Scoresheet from '../Scoresheet.vue'
import { useMeetSession } from '../../composables/useMeetSession'

const storedQuiz: QuizFile = {
  version: 2,
  quiz: {
    division: '1',
    quizNumber: '17',
    overtime: false,
    placementFormula: PlacementFormula.Rules,
    questionTypes: [],
  },
  teams: [
    {
      id: 1,
      name: 'Calgary 1',
      onTime: true,
      seatOrder: 0,
      quizzers: [{ id: 11, name: 'Ann', seatOrder: 0 }],
    },
  ],
  answers: [{ quizzerId: 11, columnKey: '1', value: CellValue.Correct }],
  noJumps: [],
}

beforeEach(() => {
  localStorage.clear()
  useMeetSession().clearSession()
  vi.mocked(getRevision).mockResolvedValue({ quizFile: storedQuiz })
})

describe('opening a stored quiz from the portal', () => {
  it('loads the revision, links the meet, and clears the link from the address', async () => {
    window.history.replaceState(null, '', '/?meet=3&result=7&revision=2')
    const wrapper = mount(Scoresheet)
    await flushPromises()

    expect(getRevision).toHaveBeenCalledWith(3, 7, 2)
    expect(useMeetSession().snapshotSession()).toMatchObject({ meetId: 3, meetName: 'Practice' })
    const values = wrapper
      .findAll<HTMLInputElement>('input[type="text"]')
      .map((input) => input.element.value)
    expect(values).toContain('17')
    expect(window.location.search).toBe('')
    wrapper.unmount()
  })
})
