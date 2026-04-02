import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MeetTeam } from '../../api'

// Mock the API module before importing useMeetSession
vi.mock('../../api', () => ({
  getMeetTeams: vi.fn(),
  getTeamQuizzers: vi.fn(),
}))

import { getMeetTeams, getTeamQuizzers } from '../../api'
import { useMeetSession } from '../useMeetSession'

const mockTeams: MeetTeam[] = [
  {
    id: 1,
    churchId: 10,
    churchName: 'First Church',
    churchShortName: 'FC',
    division: '1',
    number: 1,
  },
  {
    id: 2,
    churchId: 20,
    churchName: 'Grace Church',
    churchShortName: 'GC',
    division: '1',
    number: 2,
  },
]

const mockQuizzers = [
  { quizzerId: 101, name: 'Alice' },
  { quizzerId: 102, name: 'Bob' },
]

beforeEach(() => {
  localStorage.clear()
  // Reset singleton session state between tests
  const { clearSession } = useMeetSession()
  clearSession()
  vi.clearAllMocks()
  vi.mocked(getMeetTeams).mockResolvedValue({ teams: mockTeams })
  vi.mocked(getTeamQuizzers).mockResolvedValue({ quizzers: mockQuizzers })
})

describe('useMeetSession — initial state', () => {
  it('isActive is false when no session is loaded', () => {
    const { isActive } = useMeetSession()
    expect(isActive.value).toBe(false)
  })

  it('meetName is null when no session is loaded', () => {
    const { meetName } = useMeetSession()
    expect(meetName.value).toBeNull()
  })

  it('teamList is empty when no session is loaded', () => {
    const { teamList } = useMeetSession()
    expect(teamList.value).toHaveLength(0)
  })
})

describe('useMeetSession — loadMeet', () => {
  it('sets isActive to true after loading a meet', async () => {
    const { isActive, loadMeet } = useMeetSession()
    await loadMeet(42, 'District Finals')
    expect(isActive.value).toBe(true)
  })

  it('sets meetName', async () => {
    const { meetName, loadMeet } = useMeetSession()
    await loadMeet(42, 'District Finals')
    expect(meetName.value).toBe('District Finals')
  })

  it('populates teamList from API response', async () => {
    const { teamList, loadMeet } = useMeetSession()
    await loadMeet(42, 'District Finals')
    expect(teamList.value).toHaveLength(2)
    expect(teamList.value[0]!.id).toBe(1)
  })

  it('initialises three empty slots', async () => {
    const { getSlot, loadMeet } = useMeetSession()
    await loadMeet(42, 'District Finals')
    expect(getSlot(0)).toBeUndefined()
    expect(getSlot(1)).toBeUndefined()
    expect(getSlot(2)).toBeUndefined()
  })

  it('persists session to localStorage', async () => {
    const { loadMeet } = useMeetSession()
    await loadMeet(42, 'District Finals')
    const stored = JSON.parse(localStorage.getItem('qzr-meet-session')!)
    expect(stored.meetId).toBe(42)
    expect(stored.meetName).toBe('District Finals')
  })

  it('calls getMeetTeams with the given meetId', async () => {
    const { loadMeet } = useMeetSession()
    await loadMeet(7, 'Regionals')
    expect(getMeetTeams).toHaveBeenCalledWith(7)
  })
})

describe('useMeetSession — assignTeam', () => {
  it('populates a slot with team label and quizzers', async () => {
    const { loadMeet, assignTeam, getSlot } = useMeetSession()
    await loadMeet(42, 'Finals')
    await assignTeam(0, 1)
    const slot = getSlot(0)
    expect(slot).toBeDefined()
    expect(slot!.teamId).toBe(1)
    expect(slot!.dbLabel).toBe('FC 1')
    expect(slot!.quizzers).toHaveLength(2)
    expect(slot!.quizzers[0]!.dbName).toBe('Alice')
  })

  it('calls getTeamQuizzers with the given teamId', async () => {
    const { loadMeet, assignTeam } = useMeetSession()
    await loadMeet(42, 'Finals')
    await assignTeam(1, 2)
    expect(getTeamQuizzers).toHaveBeenCalledWith(2)
  })

  it('does nothing when no session is active', async () => {
    const { assignTeam, getSlot } = useMeetSession()
    await assignTeam(0, 1)
    expect(getSlot(0)).toBeUndefined()
    expect(getTeamQuizzers).not.toHaveBeenCalled()
  })

  it('does nothing when teamId is not in teamList', async () => {
    const { loadMeet, assignTeam, getSlot } = useMeetSession()
    await loadMeet(42, 'Finals')
    await assignTeam(0, 999) // not in mockTeams
    expect(getSlot(0)).toBeUndefined()
    expect(getTeamQuizzers).not.toHaveBeenCalled()
  })
})

describe('useMeetSession — clearSlot', () => {
  it('clears a previously assigned slot', async () => {
    const { loadMeet, assignTeam, clearSlot, getSlot } = useMeetSession()
    await loadMeet(42, 'Finals')
    await assignTeam(0, 1)
    clearSlot(0)
    expect(getSlot(0)).toBeUndefined()
  })

  it('does nothing when no session is active', () => {
    const { clearSlot } = useMeetSession()
    expect(() => clearSlot(0)).not.toThrow()
  })

  it('does not affect other slots', async () => {
    const { loadMeet, assignTeam, clearSlot, getSlot } = useMeetSession()
    await loadMeet(42, 'Finals')
    await assignTeam(0, 1)
    await assignTeam(1, 2)
    clearSlot(0)
    expect(getSlot(0)).toBeUndefined()
    expect(getSlot(1)).toBeDefined()
  })
})

describe('useMeetSession — isQuizzerDiverged', () => {
  it('returns false when no session is active', () => {
    const { isQuizzerDiverged } = useMeetSession()
    expect(isQuizzerDiverged(0, 0, 'Alice')).toBe(false)
  })

  it('returns false when slot is not assigned', async () => {
    const { loadMeet, isQuizzerDiverged } = useMeetSession()
    await loadMeet(42, 'Finals')
    expect(isQuizzerDiverged(0, 0, 'Alice')).toBe(false)
  })

  it('returns false when name matches the DB name', async () => {
    const { loadMeet, assignTeam, isQuizzerDiverged } = useMeetSession()
    await loadMeet(42, 'Finals')
    await assignTeam(0, 1)
    expect(isQuizzerDiverged(0, 0, 'Alice')).toBe(false)
  })

  it('returns true when name differs from DB name', async () => {
    const { loadMeet, assignTeam, isQuizzerDiverged } = useMeetSession()
    await loadMeet(42, 'Finals')
    await assignTeam(0, 1)
    expect(isQuizzerDiverged(0, 0, 'Alicia')).toBe(true)
  })

  it('trims whitespace before comparing', async () => {
    const { loadMeet, assignTeam, isQuizzerDiverged } = useMeetSession()
    await loadMeet(42, 'Finals')
    await assignTeam(0, 1)
    expect(isQuizzerDiverged(0, 0, '  Alice  ')).toBe(false)
  })

  it('returns false when quizzer index has no DB record', async () => {
    const { loadMeet, assignTeam, isQuizzerDiverged } = useMeetSession()
    await loadMeet(42, 'Finals')
    await assignTeam(0, 1)
    expect(isQuizzerDiverged(0, 99, 'Anyone')).toBe(false)
  })
})

describe('useMeetSession — clearSession', () => {
  it('sets isActive to false', async () => {
    const { loadMeet, clearSession, isActive } = useMeetSession()
    await loadMeet(42, 'Finals')
    clearSession()
    expect(isActive.value).toBe(false)
  })

  it('removes session from localStorage', async () => {
    const { loadMeet, clearSession } = useMeetSession()
    await loadMeet(42, 'Finals')
    clearSession()
    expect(localStorage.getItem('qzr-meet-session')).toBeNull()
  })
})

describe('useMeetSession — teamLabel', () => {
  it('formats the label as "{shortName} {number}"', () => {
    const { teamLabel } = useMeetSession()
    expect(teamLabel(mockTeams[0]!)).toBe('FC 1')
    expect(teamLabel(mockTeams[1]!)).toBe('GC 2')
  })
})

describe('useMeetSession — refresh', () => {
  it('re-fetches the team list', async () => {
    const { loadMeet, refresh } = useMeetSession()
    await loadMeet(42, 'Finals')
    vi.mocked(getMeetTeams).mockResolvedValue({
      teams: [
        {
          id: 3,
          churchId: 30,
          churchName: 'Hope',
          churchShortName: 'HC',
          division: '1',
          number: 3,
        },
      ],
    })
    await refresh()
    const { teamList } = useMeetSession()
    expect(teamList.value).toHaveLength(1)
    expect(teamList.value[0]!.id).toBe(3)
  })

  it('does nothing when no session is active', async () => {
    const { refresh } = useMeetSession()
    await refresh()
    expect(getMeetTeams).not.toHaveBeenCalled()
  })

  it('silently ignores API errors and keeps existing data', async () => {
    const { loadMeet, refresh, teamList } = useMeetSession()
    await loadMeet(42, 'Finals')
    vi.mocked(getMeetTeams).mockRejectedValue(new Error('network error'))
    await expect(refresh()).resolves.not.toThrow()
    expect(teamList.value).toHaveLength(2) // original data preserved
  })
})
