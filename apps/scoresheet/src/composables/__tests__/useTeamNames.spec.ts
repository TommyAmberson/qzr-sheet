import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ApiError } from '@qzr/shared'

vi.mock('../../api', () => ({ getTeamNames: vi.fn() }))

import { getTeamNames } from '../../api'
import { useTeamNames } from '../useTeamNames'

const lists = [
  { division: '1', names: ['Calgary 1', 'Regina 1'] },
  { division: 'Senior B', names: ['Edmonton 2'] },
]

beforeEach(async () => {
  vi.mocked(getTeamNames).mockReset().mockResolvedValue(lists)
  await useTeamNames().refreshTeamNames(null)
})

describe('the team names offered', () => {
  it("are the meet's, for the quiz's division, matched ignoring case and spaces", async () => {
    const { refreshTeamNames, teamNamesFor } = useTeamNames()
    await refreshTeamNames(3)
    expect(getTeamNames).toHaveBeenCalledWith(3)
    expect(teamNamesFor('1')).toEqual(['Calgary 1', 'Regina 1'])
    expect(teamNamesFor(' senior  b')).toEqual(['Edmonton 2'])
    expect(teamNamesFor('2')).toEqual([])
  })

  it('are none with no meet', async () => {
    const { refreshTeamNames, teamNamesFor } = useTeamNames()
    await refreshTeamNames(3)
    await refreshTeamNames(null)
    expect(teamNamesFor('1')).toEqual([])
  })

  it("stay the meet's last known names when they can't be fetched, and stay on the device", async () => {
    const { refreshTeamNames, teamNamesFor } = useTeamNames()
    await refreshTeamNames(3)
    vi.mocked(getTeamNames).mockRejectedValue(new Error('offline'))
    await refreshTeamNames(3)
    expect(teamNamesFor('1')).toEqual(['Calgary 1', 'Regina 1'])
    expect(JSON.parse(localStorage.getItem('qzr-team-names')!)).toEqual({ meetId: 3, lists })
  })

  it("aren't another meet's when the new meet's can't be fetched", async () => {
    const { refreshTeamNames, teamNamesFor } = useTeamNames()
    await refreshTeamNames(3)
    vi.mocked(getTeamNames).mockRejectedValue(new ApiError(403, 'Forbidden'))
    await refreshTeamNames(4)
    expect(teamNamesFor('1')).toEqual([])
  })

  it("aren't overwritten by an older, slower fetch", async () => {
    let answerOld!: (value: typeof lists) => void
    vi.mocked(getTeamNames)
      .mockReturnValueOnce(new Promise((resolve) => (answerOld = resolve)))
      .mockResolvedValueOnce([{ division: '1', names: ['Newer'] }])
    const { refreshTeamNames, teamNamesFor } = useTeamNames()
    const old = refreshTeamNames(3)
    await refreshTeamNames(4)
    answerOld(lists)
    await old
    expect(teamNamesFor('1')).toEqual(['Newer'])
  })
})
