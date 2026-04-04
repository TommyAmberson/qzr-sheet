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
    consolation: false,
  },
  {
    id: 2,
    churchId: 20,
    churchName: 'Grace Church',
    churchShortName: 'GC',
    division: '1',
    number: 2,
    consolation: false,
  },
]

const mockQuizzers = [
  { quizzerId: 101, name: 'Alice' },
  { quizzerId: 102, name: 'Bob' },
]

/** Empty storeNames — simulates all-default (cleared) names */
const emptyNames = Array<string>(5).fill('')

beforeEach(() => {
  localStorage.clear()
  // Reset singleton session state between tests
  const { clearSession } = useMeetSession()
  clearSession()
  vi.clearAllMocks()
  vi.mocked(getMeetTeams).mockResolvedValue({ teams: mockTeams, meetDivisions: ['1', '2'] })
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
    await assignTeam(0, 1, emptyNames)
    const slot = getSlot(0)
    expect(slot).toBeDefined()
    expect(slot!.teamId).toBe(1)
    expect(slot!.dbLabel).toBe('FC 1')
    expect(slot!.quizzers).toHaveLength(5)
    expect(slot!.quizzers[0]!.dbName).toBe('Alice')
    expect(slot!.quizzers[2]!.dbName).toBe('') // seats beyond the DB roster are empty
  })

  it('calls getTeamQuizzers with the given teamId', async () => {
    const { loadMeet, assignTeam } = useMeetSession()
    await loadMeet(42, 'Finals')
    await assignTeam(1, 2, emptyNames)
    expect(getTeamQuizzers).toHaveBeenCalledWith(2)
  })

  it('does nothing when no session is active', async () => {
    const { assignTeam, getSlot } = useMeetSession()
    await assignTeam(0, 1, emptyNames)
    expect(getSlot(0)).toBeUndefined()
    expect(getTeamQuizzers).not.toHaveBeenCalled()
  })

  it('does nothing when teamId is not in teamList', async () => {
    const { loadMeet, assignTeam, getSlot } = useMeetSession()
    await loadMeet(42, 'Finals')
    await assignTeam(0, 999, emptyNames) // not in mockTeams
    expect(getSlot(0)).toBeUndefined()
    expect(getTeamQuizzers).not.toHaveBeenCalled()
  })

  it('places exact-matched quizzer at its store seat', async () => {
    const { loadMeet, assignTeam, getSlot } = useMeetSession()
    await loadMeet(42, 'Finals')
    // Store has Bob in seat 0, Alice in seat 1
    await assignTeam(0, 1, ['Bob', 'Alice', '', '', ''])
    const slot = getSlot(0)!
    expect(slot.quizzers[0]!.dbName).toBe('Bob')
    expect(slot.quizzers[1]!.dbName).toBe('Alice')
  })

  it('places first-name-matched quizzer at its store seat', async () => {
    vi.mocked(getTeamQuizzers).mockResolvedValueOnce({
      quizzers: [
        { quizzerId: 201, name: 'Alice Smith' },
        { quizzerId: 202, name: 'Bob Jones' },
      ],
    })
    const { loadMeet, assignTeam, getSlot } = useMeetSession()
    await loadMeet(42, 'Finals')
    // "Alice" matches "Alice Smith" by first-name token
    await assignTeam(0, 1, ['Alice', '', '', '', ''])
    const slot = getSlot(0)!
    expect(slot.quizzers[0]!.dbName).toBe('Alice Smith')
  })

  it('fills empty seats with remaining DB quizzers in order', async () => {
    const { loadMeet, assignTeam, getSlot } = useMeetSession()
    await loadMeet(42, 'Finals')
    // Seat 0 is named; seats 1-4 are empty → Bob fills seat 1
    await assignTeam(0, 1, ['Alice', '', '', '', ''])
    const slot = getSlot(0)!
    expect(slot.quizzers[0]!.dbName).toBe('Alice')
    expect(slot.quizzers[1]!.dbName).toBe('Bob')
    expect(slot.quizzers[2]!.dbName).toBe('')
  })

  it('matches edited names before filling empty seats with DB remainder', async () => {
    // Regression: fuzzy must run before empty-seat fill so edited quizzers are not
    // crowded out by blank seats consuming their best DB match.
    vi.mocked(getTeamQuizzers).mockResolvedValueOnce({
      quizzers: [
        { quizzerId: 301, name: 'Alice' },
        { quizzerId: 302, name: 'Bob' },
        { quizzerId: 303, name: 'Charlie' },
        { quizzerId: 304, name: 'Dave' },
      ],
    })
    const { loadMeet, assignTeam, getSlot } = useMeetSession()
    await loadMeet(42, 'Finals')
    // Two edited seats (typo "Aliss"), three blank
    await assignTeam(0, 1, ['Aliss', 'Bob', '', '', ''])
    const slot = getSlot(0)!
    // "Aliss" should fuzzy-match "Alice" before empty seats consume it
    expect(slot.quizzers[0]!.dbName).toBe('Alice')
    expect(slot.quizzers[1]!.dbName).toBe('Bob')
    // Remaining DB quizzers fill empty seats
    expect(slot.quizzers[2]!.dbName).toBe('Charlie')
    expect(slot.quizzers[3]!.dbName).toBe('Dave')
    expect(slot.quizzers[4]!.dbName).toBe('')
  })
})

describe('useMeetSession — clearSlot', () => {
  it('clears a previously assigned slot', async () => {
    const { loadMeet, assignTeam, clearSlot, getSlot } = useMeetSession()
    await loadMeet(42, 'Finals')
    await assignTeam(0, 1, emptyNames)
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
    await assignTeam(0, 1, emptyNames)
    await assignTeam(1, 2, emptyNames)
    clearSlot(0)
    expect(getSlot(0)).toBeUndefined()
    expect(getSlot(1)).toBeDefined()
  })
})

describe('useMeetSession — reorderSlotQuizzers', () => {
  it('updates quizzer order in the slot', async () => {
    const { loadMeet, assignTeam, getSlot, reorderSlotQuizzers } = useMeetSession()
    await loadMeet(42, 'Finals')
    await assignTeam(0, 1, emptyNames) // Alice at 0, Bob at 1
    reorderSlotQuizzers(0, 0, 1) // move Alice to seat 1
    const slot = getSlot(0)
    expect(slot!.quizzers[0]!.dbName).toBe('Bob')
    expect(slot!.quizzers[1]!.dbName).toBe('Alice')
  })

  it('isQuizzerDiverged returns false after reorder with unchanged names', async () => {
    const { loadMeet, assignTeam, reorderSlotQuizzers, isQuizzerDiverged } = useMeetSession()
    await loadMeet(42, 'Finals')
    await assignTeam(0, 1, emptyNames)
    reorderSlotQuizzers(0, 0, 1) // Bob is now at seat 0, Alice at seat 1
    expect(isQuizzerDiverged(0, 0, 'Bob')).toBe(false)
    expect(isQuizzerDiverged(0, 1, 'Alice')).toBe(false)
  })

  it('isQuizzerDiverged still returns true when name was edited after reorder', async () => {
    const { loadMeet, assignTeam, reorderSlotQuizzers, isQuizzerDiverged } = useMeetSession()
    await loadMeet(42, 'Finals')
    await assignTeam(0, 1, emptyNames)
    reorderSlotQuizzers(0, 0, 1) // Bob → seat 0, Alice → seat 1
    expect(isQuizzerDiverged(0, 0, 'Robert')).toBe(true) // Bob renamed to Robert
  })

  it('does nothing when no session is active', () => {
    const { reorderSlotQuizzers } = useMeetSession()
    expect(() => reorderSlotQuizzers(0, 0, 1)).not.toThrow()
  })

  it('isQuizzerDiverged returns false for empty seat left between quizzers after reorder', async () => {
    // Alice(0), Bob(1) from DB; seats 2-4 are empty. Drag Alice to seat 3.
    // After: seat 0 = Bob, seat 1 = '' (empty), seat 2 = '' (empty), seat 3 = Alice, seat 4 = ''
    const { loadMeet, assignTeam, reorderSlotQuizzers, isQuizzerDiverged } = useMeetSession()
    await loadMeet(42, 'Finals')
    await assignTeam(0, 1, emptyNames) // Alice at 0, Bob at 1, nulls at 2-4
    reorderSlotQuizzers(0, 0, 3) // move Alice to seat 3
    expect(isQuizzerDiverged(0, 0, 'Bob')).toBe(false)
    expect(isQuizzerDiverged(0, 1, '')).toBe(false) // empty seat — no DB record here now
    expect(isQuizzerDiverged(0, 2, '')).toBe(false) // empty seat
    expect(isQuizzerDiverged(0, 3, 'Alice')).toBe(false)
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
    await assignTeam(0, 1, emptyNames)
    expect(isQuizzerDiverged(0, 0, 'Alice')).toBe(false)
  })

  it('returns true when name differs from DB name', async () => {
    const { loadMeet, assignTeam, isQuizzerDiverged } = useMeetSession()
    await loadMeet(42, 'Finals')
    await assignTeam(0, 1, emptyNames)
    expect(isQuizzerDiverged(0, 0, 'Alicia')).toBe(true)
  })

  it('trims whitespace before comparing', async () => {
    const { loadMeet, assignTeam, isQuizzerDiverged } = useMeetSession()
    await loadMeet(42, 'Finals')
    await assignTeam(0, 1, emptyNames)
    expect(isQuizzerDiverged(0, 0, '  Alice  ')).toBe(false)
  })

  it('returns false when quizzer index is out of range', async () => {
    const { loadMeet, assignTeam, isQuizzerDiverged } = useMeetSession()
    await loadMeet(42, 'Finals')
    await assignTeam(0, 1, emptyNames)
    expect(isQuizzerDiverged(0, 99, 'Anyone')).toBe(false)
  })

  it('returns false for a null-entry seat when name is empty', async () => {
    const { loadMeet, assignTeam, isQuizzerDiverged } = useMeetSession()
    await loadMeet(42, 'Finals')
    await assignTeam(0, 1, emptyNames) // only 2 DB quizzers; seats 2-4 are null
    expect(isQuizzerDiverged(0, 2, '')).toBe(false)
  })

  it('returns true for a null-entry seat when name is non-empty', async () => {
    const { loadMeet, assignTeam, isQuizzerDiverged } = useMeetSession()
    await loadMeet(42, 'Finals')
    await assignTeam(0, 1, emptyNames)
    expect(isQuizzerDiverged(0, 2, 'Jordan')).toBe(true)
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
          consolation: false,
        },
      ],
      meetDivisions: ['1'],
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

describe('useMeetSession — divisionOptions', () => {
  it('returns empty array when no session is active', () => {
    const { divisionOptions } = useMeetSession()
    expect(divisionOptions.value).toEqual([])
  })

  it('returns the meet canonical divisions', async () => {
    const { loadMeet, divisionOptions } = useMeetSession()
    vi.mocked(getMeetTeams).mockResolvedValueOnce({
      teams: mockTeams,
      meetDivisions: ['1', '2', '3'],
    })
    await loadMeet(42, 'Finals')
    expect(divisionOptions.value).toEqual(['1', '2', '3'])
  })
})

describe('useMeetSession — teamsForDivision', () => {
  const div2Teams: MeetTeam[] = [
    { ...mockTeams[0]!, id: 10, division: '2', consolation: false },
    { ...mockTeams[1]!, id: 11, division: '2', consolation: true },
  ]

  beforeEach(async () => {
    vi.mocked(getMeetTeams).mockResolvedValueOnce({
      teams: div2Teams,
      meetDivisions: ['2'],
    })
    const { loadMeet } = useMeetSession()
    await loadMeet(42, 'Finals')
  })

  it('returns all teams when division is empty string', () => {
    const { teamsForDivision } = useMeetSession()
    expect(teamsForDivision('', false)).toHaveLength(2)
  })

  it('returns only non-consolation teams for a base division', () => {
    const { teamsForDivision } = useMeetSession()
    const result = teamsForDivision('2', false)
    expect(result).toHaveLength(1)
    expect(result[0]!.consolation).toBe(false)
  })

  it('returns only consolation teams when consolation is true', () => {
    const { teamsForDivision } = useMeetSession()
    const result = teamsForDivision('2', true)
    expect(result).toHaveLength(1)
    expect(result[0]!.consolation).toBe(true)
  })

  it('returns empty list when no teams match', () => {
    const { teamsForDivision } = useMeetSession()
    expect(teamsForDivision('1', true)).toHaveLength(0)
  })
})
