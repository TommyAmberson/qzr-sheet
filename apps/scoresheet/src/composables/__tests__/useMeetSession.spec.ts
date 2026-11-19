import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ApiError, DEFAULT_STATS_SETTINGS, PlacementFormula } from '@qzr/shared'
import type { MeetTeam, ScheduledQuizDetails } from '../../api'

// Mock the API module before importing useMeetSession
vi.mock('../../api', () => ({
  getMeetTeams: vi.fn(),
  getTeamQuizzers: vi.fn(),
  getScheduledQuiz: vi.fn(),
  getSender: vi.fn(),
  getStatsSettings: vi.fn(),
}))

import {
  getMeetTeams,
  getScheduledQuiz,
  getSender,
  getStatsSettings,
  getTeamQuizzers,
} from '../../api'
import { quizzersConfirmTeam, teamNamed, teamsNearName, useMeetSession } from '../useMeetSession'
import {
  currentTab,
  onTabLinkChange,
  startTab,
  writeMeta,
  writeRecord,
} from '../../persistence/autoSave'
import { aRecord } from '../../persistence/__tests__/records'

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

let linkWrites = 0

beforeEach(async () => {
  localStorage.clear()
  await startTab()
  linkWrites = 0
  onTabLinkChange(() => linkWrites++)
  // Reset singleton session state between tests
  const { clearSession } = useMeetSession()
  clearSession()
  vi.clearAllMocks()
  vi.mocked(getMeetTeams).mockResolvedValue({ teams: mockTeams, meetDivisions: ['1', '2'] })
  vi.mocked(getTeamQuizzers).mockResolvedValue({ quizzers: mockQuizzers })
  vi.mocked(getStatsSettings).mockResolvedValue({ settings: DEFAULT_STATS_SETTINGS })
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

  it("keeps the link with the tab's quiz, and nowhere shared", async () => {
    const { loadMeet } = useMeetSession()
    await loadMeet(42, 'District Finals')
    expect(currentTab()!.link).toMatchObject({ meetId: 42, meetName: 'District Finals' })
    expect(localStorage.getItem('qzr-meet-session')).toBeNull()
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

  it("calls getTeamQuizzers with the session's meet and the given teamId", async () => {
    const { loadMeet, assignTeam } = useMeetSession()
    await loadMeet(42, 'Finals')
    await assignTeam(1, 2, emptyNames)
    expect(getTeamQuizzers).toHaveBeenCalledWith(42, 2)
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

  it('drops the pick when the meet is unlinked while the roster loads', async () => {
    let arrive!: (roster: { quizzers: typeof mockQuizzers }) => void
    vi.mocked(getTeamQuizzers).mockReturnValueOnce(new Promise((resolve) => (arrive = resolve)))
    const { loadMeet, assignTeam, clearSession, isActive } = useMeetSession()
    await loadMeet(42, 'Finals')
    const picking = assignTeam(0, 1, emptyNames)
    clearSession()
    arrive({ quizzers: mockQuizzers })
    await expect(picking).resolves.toBe(false)
    expect(isActive.value).toBe(false)
  })

  it('drops the pick when a new quiz is begun while the roster loads', async () => {
    let arrive!: (roster: { quizzers: typeof mockQuizzers }) => void
    vi.mocked(getTeamQuizzers).mockReturnValueOnce(new Promise((resolve) => (arrive = resolve)))
    const { loadMeet, assignTeam, startNewQuiz, getSlot } = useMeetSession()
    await loadMeet(42, 'Finals')
    const picking = assignTeam(0, 1, emptyNames)
    startNewQuiz()
    arrive({ quizzers: mockQuizzers })
    await expect(picking).resolves.toBe(false)
    expect(getSlot(0)).toBeUndefined()
  })

  it('drops the pick when another meet is linked while the roster loads', async () => {
    let arrive!: (roster: { quizzers: typeof mockQuizzers }) => void
    vi.mocked(getTeamQuizzers).mockReturnValueOnce(new Promise((resolve) => (arrive = resolve)))
    const { loadMeet, assignTeam, getSlot } = useMeetSession()
    await loadMeet(42, 'Finals')
    const picking = assignTeam(0, 1, emptyNames)
    await loadMeet(43, 'Regionals')
    arrive({ quizzers: mockQuizzers })
    await picking
    expect(getSlot(0)).toBeUndefined()
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

describe('useMeetSession — slotFor + commitLink', () => {
  it('builds a pick without touching the session', async () => {
    const teamA = mockTeams[0]!
    const { loadMeet, slotFor, getSlot } = useMeetSession()
    await loadMeet(42, 'Finals')

    const slot = slotFor(teamA, mockQuizzers, emptyNames)

    expect(slot.teamId).toBe(teamA.id)
    expect(slot.dbLabelFull).toBe('First Church 1')
    expect(slot.quizzers[0]!.dbName).toBe('Alice')
    expect(getSlot(0)).toBeUndefined()
  })

  it('ties seats around the names already there', () => {
    const { slotFor } = useMeetSession()
    // Bob sits first and Alice second, the reverse of the roster's order
    const slot = slotFor(mockTeams[0]!, mockQuizzers, ['Bob', 'Alice', '', '', ''])
    expect(slot.quizzers.slice(0, 2).map((quizzer) => quizzer.dbName)).toEqual(['Bob', 'Alice'])
  })

  it('commits meet, picks and scheduled quiz in one write', async () => {
    const { fetchMeet, slotFor, commitLink, getSlot, quizId, meetName, teamList } = useMeetSession()
    const meet = await fetchMeet(42)
    const slot = slotFor(mockTeams[0]!, mockQuizzers, emptyNames)
    const writesBefore = linkWrites
    commitLink({
      meetId: 42,
      meetName: 'Finals',
      ...meet,
      slots: [slot, undefined, undefined],
      quizId: '555',
      scheduledQuiz: null,
    })

    expect(linkWrites - writesBefore).toBe(1)
    expect(meetName.value).toBe('Finals')
    expect(teamList.value).toHaveLength(2)
    expect(getSlot(0)?.teamId).toBe(1)
    expect(getSlot(1)).toBeUndefined()
    expect(quizId.value).toBe('555')
  })

  it("keeps the meet's way of scoring level teams (FR-023b)", async () => {
    vi.mocked(getStatsSettings).mockResolvedValue({
      settings: { ...DEFAULT_STATS_SETTINGS, levelTeams: PlacementFormula.Legacy },
    })
    const { loadMeet, levelTeams } = useMeetSession()
    await loadMeet(42, 'Finals')
    expect(levelTeams.value).toBe(PlacementFormula.Legacy)
  })

  it("links a meet whose settings can't be read, keeping what was known of them", async () => {
    vi.mocked(getStatsSettings).mockResolvedValue({
      settings: { ...DEFAULT_STATS_SETTINGS, levelTeams: PlacementFormula.Legacy },
    })
    const { loadMeet, fetchMeet, commitLink, levelTeams } = useMeetSession()
    await loadMeet(42, 'Finals')
    vi.mocked(getStatsSettings).mockRejectedValue(new Error('offline'))
    const meet = await fetchMeet(42)
    expect(meet.levelTeams).toBeUndefined()
    commitLink({
      meetId: 42,
      meetName: 'Finals',
      ...meet,
      slots: [],
      quizId: null,
      scheduledQuiz: null,
    })
    expect(levelTeams.value).toBe(PlacementFormula.Legacy)
  })

  it("renews the meet's way of scoring level teams with the rest of the meet", async () => {
    const { loadMeet, refresh, levelTeams } = useMeetSession()
    await loadMeet(42, 'Finals')
    expect(levelTeams.value).toBe(PlacementFormula.Rules)
    vi.mocked(getStatsSettings).mockResolvedValue({
      settings: { ...DEFAULT_STATS_SETTINGS, levelTeams: PlacementFormula.Legacy },
    })
    expect(await refresh()).toBe(true)
    expect(levelTeams.value).toBe(PlacementFormula.Legacy)
  })

  it('fetching a meet keeps nothing until it is committed', async () => {
    const { fetchMeet, isActive } = useMeetSession()
    await fetchMeet(42)
    expect(isActive.value).toBe(false)
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

describe('useMeetSession — relinkSeatByName', () => {
  // Alice is tied to seat 0 and Bob to seat 1, as the roster lists them
  async function seated() {
    const meet = useMeetSession()
    await meet.loadMeet(42, 'Finals')
    await meet.assignTeam(0, 1, emptyNames)
    return meet
  }
  const linked = (meet: ReturnType<typeof useMeetSession>) =>
    meet.getSlot(0)!.quizzers.map((quizzer) => quizzer.dbName)

  it("swaps two seats' quizzers when one is typed into the other's seat", async () => {
    const meet = await seated()
    meet.relinkSeatByName(0, 0, ['Bob', 'Bob', '', '', ''])
    // Bob sat in seat 1 under his own name, so he stays, and seat 0 still disagrees
    expect(linked(meet).slice(0, 2)).toEqual(['Alice', 'Bob'])

    meet.relinkSeatByName(0, 0, ['Bob', 'Alice', '', '', ''])
    expect(linked(meet).slice(0, 2)).toEqual(['Bob', 'Alice'])
    expect(meet.isQuizzerDiverged(0, 0, 'Bob')).toBe(false)
    expect(meet.isQuizzerDiverged(0, 1, 'Alice')).toBe(false)
  })

  it('takes a quizzer from a seat that is blank or bears another name', async () => {
    const meet = await seated()
    meet.relinkSeatByName(0, 0, ['Bob', '', '', '', ''])
    expect(linked(meet).slice(0, 2)).toEqual(['Bob', 'Alice'])

    meet.relinkSeatByName(0, 0, ['Alice', 'Zed', '', '', ''])
    expect(linked(meet).slice(0, 2)).toEqual(['Alice', 'Bob'])
  })

  it('leaves the seats alone for a name not exactly a roster quizzer of the team', async () => {
    const meet = await seated()
    meet.relinkSeatByName(0, 0, ['bob', 'Alice', '', '', ''])
    meet.relinkSeatByName(0, 0, ['Zed', 'Bob', '', '', ''])
    meet.relinkSeatByName(0, 0, ['', 'Bob', '', '', ''])
    expect(linked(meet).slice(0, 2)).toEqual(['Alice', 'Bob'])
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

  it('isQuizzerDiverged returns false for empty seat swapped with quizzer after reorder', async () => {
    // Alice(0), Bob(1) from DB; seats 2-4 are empty. Swap Alice with empty seat 3.
    // After: seat 0 = '' (empty from seat 3), seat 1 = Bob, seat 2 = '', seat 3 = Alice, seat 4 = ''
    const { loadMeet, assignTeam, reorderSlotQuizzers, isQuizzerDiverged } = useMeetSession()
    await loadMeet(42, 'Finals')
    await assignTeam(0, 1, emptyNames) // Alice at 0, Bob at 1, nulls at 2-4
    reorderSlotQuizzers(0, 0, 3) // swap Alice with empty seat 3
    expect(isQuizzerDiverged(0, 0, '')).toBe(false) // empty seat swapped in
    expect(isQuizzerDiverged(0, 1, 'Bob')).toBe(false) // unchanged
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

describe('useMeetSession — isTeamNameDiverged', () => {
  it('returns false when no team is picked for the slot', async () => {
    const { loadMeet, isTeamNameDiverged } = useMeetSession()
    await loadMeet(42, 'Finals')
    expect(isTeamNameDiverged(0, 'Some Church 4')).toBe(false)
  })

  it("returns false for the picked team's full label, ignoring case and spaces", async () => {
    const { loadMeet, assignTeam, isTeamNameDiverged } = useMeetSession()
    await loadMeet(42, 'Finals')
    await assignTeam(0, 1, emptyNames)
    expect(isTeamNameDiverged(0, '  first  Church 1 ')).toBe(false)
  })

  it('returns true for the short label, which would be submitted as another team', async () => {
    const { loadMeet, assignTeam, isTeamNameDiverged } = useMeetSession()
    await loadMeet(42, 'Finals')
    await assignTeam(0, 1, emptyNames)
    expect(isTeamNameDiverged(0, 'FC 1')).toBe(true)
  })

  it('returns true when the name was edited away from the picked team', async () => {
    const { loadMeet, assignTeam, isTeamNameDiverged } = useMeetSession()
    await loadMeet(42, 'Finals')
    await assignTeam(0, 1, emptyNames)
    expect(isTeamNameDiverged(0, 'First Church 3')).toBe(true)
  })

  it("follows the roster's name when it is corrected after the pick", async () => {
    const { loadMeet, assignTeam, refresh, isTeamNameDiverged, pickedTeamName } = useMeetSession()
    await loadMeet(42, 'Finals')
    await assignTeam(0, 1, emptyNames)
    vi.mocked(getMeetTeams).mockResolvedValue({
      teams: mockTeams.map((team) =>
        team.id === 1 ? { ...team, churchName: 'First Chapel' } : team,
      ),
      meetDivisions: ['1', '2'],
    })
    await refresh()
    expect(pickedTeamName(0)).toBe('First Chapel 1')
    expect(isTeamNameDiverged(0, 'First Chapel 1')).toBe(false)
    expect(isTeamNameDiverged(0, 'First Church 1')).toBe(true)
  })

  it('follows a corrected name that a refresh brings', async () => {
    const { loadMeet, assignTeam, refresh, pickedTeamName } = useMeetSession()
    await loadMeet(42, 'Finals')
    await assignTeam(0, 1, emptyNames)
    const renamed = { ...mockTeams[0]!, churchName: 'First Chapel' }
    vi.mocked(getMeetTeams).mockResolvedValue({ teams: [renamed], meetDivisions: ['1'] })
    await refresh()
    expect(pickedTeamName(0)).toBe('First Chapel 1')
  })
})

describe('teamNamed', () => {
  const teams = [
    { id: 1, name: "St. John's 1", shortName: 'SJ 1' },
    { id: 2, name: 'SJ 1', shortName: 'Saint 1' },
    { id: 3, name: 'St Johns 1', shortName: 'STJ 1' },
  ]

  it('finds a team by its full name, ignoring case and spacing', () => {
    expect(teamNamed("  st. john's  1", teams)).toBe(1)
  })

  it("takes a full name before another team's short one", () => {
    expect(teamNamed('sj 1', teams)).toBe(2)
  })

  it('sets punctuation aside only when nothing matches as written', () => {
    expect(teamNamed('St Johns 1', teams)).toBe(3)
    expect(teamNamed('St. Johns 1', teams)).toBe(1)
  })

  it('finds nothing for a name no team has', () => {
    expect(teamNamed('St Jon 1', teams)).toBeUndefined()
  })
})

describe('teamsNearName', () => {
  const labelled = (id: number, name: string, shortName: string) => ({ id, name, shortName })
  const roster = [
    labelled(1, 'Alpha Church 2', 'AC 2'),
    labelled(2, 'Grace Chapel 1', 'GRC 1'),
    labelled(3, 'Alpha Church 3', 'AC 3'),
  ]

  it('finds the team a typo away', () => {
    expect(teamsNearName('alfa church 2', roster)).toEqual([1])
  })

  it('finds nothing for a name that is far from every team', () => {
    expect(teamsNearName('Bethel 1', roster)).toEqual([])
  })

  it("finds both of a church's teams for a number neither has", () => {
    expect(teamsNearName('Alpha Church 4', roster)).toEqual([1, 3])
  })

  it('finds the team whose short label is a typo away', () => {
    expect(teamsNearName('GRCC 1', roster)).toEqual([2])
  })

  it("allows a short label one edit only, since two reach other churches' teams", () => {
    expect(teamsNearName('AD 9', roster)).toEqual([])
  })
})

describe('quizzersConfirmTeam', () => {
  const roster = ['Alice Smith', 'Bob Jones', 'Carol White']

  it('confirms when every typed quizzer is on the roster, ignoring case and spaces', () => {
    expect(quizzersConfirmTeam(['alice  smith', '', 'Bob Jones', '', ''], roster)).toBe(true)
  })

  it('needs two typed quizzers', () => {
    expect(quizzersConfirmTeam(['Alice Smith', '', '', '', ''], roster)).toBe(false)
  })

  it('counts a quizzer typed into two seats once', () => {
    expect(quizzersConfirmTeam(['Alice Smith', 'alice smith', '', '', ''], roster)).toBe(false)
  })

  it('refuses when a typed quizzer is not on the roster, even by first name', () => {
    expect(quizzersConfirmTeam(['Alice Smith', 'Bob', '', '', ''], roster)).toBe(false)
  })
})

describe('useMeetSession — clearSession', () => {
  it('sets isActive to false', async () => {
    const { loadMeet, clearSession, isActive } = useMeetSession()
    await loadMeet(42, 'Finals')
    clearSession()
    expect(isActive.value).toBe(false)
  })

  it("removes the link from the tab's quiz", async () => {
    const { loadMeet, clearSession } = useMeetSession()
    await loadMeet(42, 'Finals')
    clearSession()
    expect(currentTab()!.link).toBeNull()
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

describe('useMeetSession — the linked scheduled quiz', () => {
  const seat = (seatNumber: number, team: MeetTeam | null) => ({
    seatNumber,
    letter: team ? 'A' : null,
    seedRef: team ? null : '1 of X',
    team,
    quizzers: team ? mockQuizzers : [],
  })
  const scheduled = (
    seats: ScheduledQuizDetails['seats'],
    quiz: Partial<ScheduledQuizDetails['quiz']> = {},
  ): ScheduledQuizDetails => ({
    quiz: {
      id: '777',
      meetName: 'District Finals',
      label: 'Div 1 Quiz 3',
      division: '1',
      consolation: false,
      quizNumber: '3',
      ...quiz,
    },
    seats,
  })

  /** Link a scheduled quiz as the scoresheet does: fetch, then commit, keeping same-meet picks */
  async function linkQuiz(meetId: number, quizId: string) {
    const session = useMeetSession()
    const [meet, details] = await Promise.all([
      session.fetchMeet(meetId),
      getScheduledQuiz(meetId, quizId),
    ])
    session.commitLink({
      meetId,
      meetName: details!.quiz.meetName,
      ...meet,
      slots: session.meetId.value === meetId ? [0, 1, 2].map(session.getSlot) : [],
      quizId,
      scheduledQuiz: session.scheduledQuizCopy(details!),
    })
  }

  it('keeps a copy of the quiz, with each seat as a team or undecided', async () => {
    vi.mocked(getScheduledQuiz).mockResolvedValue(
      scheduled([seat(1, mockTeams[0]!), seat(2, null), seat(3, mockTeams[1]!)]),
    )
    const { quizId, scheduledQuiz, meetName } = useMeetSession()
    await linkQuiz(42, '777')

    expect(meetName.value).toBe('District Finals')
    expect(quizId.value).toBe('777')
    expect(scheduledQuiz.value).toEqual({
      label: 'Div 1 Quiz 3',
      division: '1',
      consolation: false,
      quizNumber: '3',
      seats: [1, null, 2],
      inSchedule: true,
    })
  })

  it('leaves the picks alone when the quiz is of the meet already linked', async () => {
    vi.mocked(getScheduledQuiz).mockResolvedValue(scheduled([seat(1, mockTeams[1]!)]))
    const { loadMeet, assignTeam, getSlot } = useMeetSession()
    await loadMeet(42, 'Finals')
    await assignTeam(0, 1, emptyNames)
    await linkQuiz(42, '777')
    expect(getSlot(0)?.teamId).toBe(1)
  })

  it('unlinking the quiz keeps the meet and the picks', async () => {
    vi.mocked(getScheduledQuiz).mockResolvedValue(scheduled([seat(1, mockTeams[0]!)]))
    const { assignTeam, unlinkQuiz, quizId, scheduledQuiz, getSlot, isActive } = useMeetSession()
    await linkQuiz(42, '777')
    await assignTeam(0, 1, emptyNames)
    unlinkQuiz()

    expect(quizId.value).toBeNull()
    expect(scheduledQuiz.value).toBeNull()
    expect(getSlot(0)?.teamId).toBe(1)
    expect(isActive.value).toBe(true)
  })

  it('a new quiz in the meet, or unlinking the meet, forgets the scheduled quiz', async () => {
    vi.mocked(getScheduledQuiz).mockResolvedValue(scheduled([seat(1, mockTeams[0]!)]))
    const { startNewQuiz, clearSession, quizId, scheduledQuiz } = useMeetSession()
    await linkQuiz(42, '777')
    startNewQuiz()
    expect([quizId.value, scheduledQuiz.value]).toEqual([null, null])

    await linkQuiz(42, '777')
    clearSession()
    expect([quizId.value, scheduledQuiz.value]).toEqual([null, null])
  })

  it('reads a session saved before copies were kept as linked with nothing to compare', () => {
    const { restoreSession, quizId, scheduledQuiz } = useMeetSession()
    restoreSession({
      meetId: 42,
      meetName: 'Finals',
      slots: [undefined, undefined, undefined],
      teamList: mockTeams,
      meetDivisions: ['1'],
      quizId: '777',
      sender: null,
    })
    expect(quizId.value).toBe('777')
    expect(scheduledQuiz.value).toBeNull()
  })

  it('a refresh rewrites the copy from the schedule as it now stands', async () => {
    vi.mocked(getScheduledQuiz).mockResolvedValue(scheduled([seat(1, null)]))
    const { refresh, scheduledQuiz } = useMeetSession()
    await linkQuiz(42, '777')

    vi.mocked(getScheduledQuiz).mockResolvedValue(
      scheduled([seat(1, mockTeams[1]!)], { quizNumber: '4' }),
    )
    expect(await refresh()).toBe(true)
    expect(scheduledQuiz.value).toMatchObject({ quizNumber: '4', seats: [2, null, null] })
  })

  it('a refresh marks a quiz the schedule has dropped, keeping what was held', async () => {
    vi.mocked(getScheduledQuiz).mockResolvedValue(scheduled([seat(1, mockTeams[0]!)]))
    const { refresh, scheduledQuiz } = useMeetSession()
    await linkQuiz(42, '777')

    vi.mocked(getScheduledQuiz).mockResolvedValue(null)
    await refresh()
    expect(scheduledQuiz.value).toMatchObject({ quizNumber: '3', inSchedule: false })
  })

  it('a schedule that fails to come still lets the roster be renewed', async () => {
    vi.mocked(getScheduledQuiz).mockResolvedValue(scheduled([seat(1, mockTeams[0]!)]))
    const { refresh, scheduledQuiz, teamList } = useMeetSession()
    await linkQuiz(42, '777')

    vi.mocked(getMeetTeams).mockResolvedValue({ teams: [mockTeams[1]!], meetDivisions: ['1'] })
    vi.mocked(getScheduledQuiz).mockRejectedValue(new ApiError(500, 'Server error'))
    expect(await refresh()).toBe(true)
    expect(teamList.value.map((team) => team.id)).toEqual([2])
    expect(scheduledQuiz.value).toMatchObject({ quizNumber: '3', inSchedule: true })
  })

  it('a refresh that fails says so and keeps the copy held', async () => {
    vi.mocked(getScheduledQuiz).mockResolvedValue(scheduled([seat(1, mockTeams[0]!)]))
    const { refresh, scheduledQuiz } = useMeetSession()
    await linkQuiz(42, '777')

    vi.mocked(getMeetTeams).mockRejectedValue(new Error('network error'))
    expect(await refresh()).toBe(false)
    expect(scheduledQuiz.value).toMatchObject({ quizNumber: '3', inSchedule: true })
  })

  it('a refresh that returns after another quiz was begun leaves that quiz unlinked', async () => {
    vi.mocked(getScheduledQuiz).mockResolvedValue(scheduled([seat(1, mockTeams[0]!)]))
    const { refresh, startNewQuiz, quizId, scheduledQuiz } = useMeetSession()
    await linkQuiz(42, '777')

    let arrive!: (details: ScheduledQuizDetails) => void
    vi.mocked(getScheduledQuiz).mockReturnValue(new Promise((resolve) => (arrive = resolve)))
    const refreshing = refresh()
    startNewQuiz()
    arrive(scheduled([seat(1, mockTeams[1]!)]))
    await refreshing

    expect([quizId.value, scheduledQuiz.value]).toEqual([null, null])
  })

  it('keeps a pick whose slot was only re-seated while its roster loaded', async () => {
    const { loadMeet, assignTeam, setSlot, slotFor, reorderSlotQuizzers, getSlot } =
      useMeetSession()
    await loadMeet(42, 'Finals')
    setSlot(0, slotFor(mockTeams[0]!, mockQuizzers, emptyNames))
    let arrive!: (value: { quizzers: typeof mockQuizzers }) => void
    vi.mocked(getTeamQuizzers).mockReturnValueOnce(new Promise((resolve) => (arrive = resolve)))
    const picking = assignTeam(0, 1, emptyNames)
    reorderSlotQuizzers(0, 0, 1)
    arrive({ quizzers: mockQuizzers })
    expect(await picking).toBe(true)
    expect(getSlot(0)?.teamId).toBe(1)
  })

  it('drops a pick whose roster arrives after the slot was given another team', async () => {
    const { loadMeet, assignTeam, setSlot, slotFor, getSlot } = useMeetSession()
    await loadMeet(42, 'Finals')
    let arrive!: (value: { quizzers: typeof mockQuizzers }) => void
    vi.mocked(getTeamQuizzers).mockReturnValueOnce(new Promise((resolve) => (arrive = resolve)))
    const picking = assignTeam(0, 1, emptyNames)
    setSlot(0, slotFor(mockTeams[1]!, mockQuizzers, emptyNames))
    arrive({ quizzers: mockQuizzers })
    expect(await picking).toBe(false)
    expect(getSlot(0)?.teamId).toBe(2)
  })

  it("two slots' picks change places", async () => {
    const { loadMeet, assignTeam, swapSlots, getSlot } = useMeetSession()
    await loadMeet(42, 'Finals')
    await assignTeam(0, 1, emptyNames)
    swapSlots(0, 2)
    expect([getSlot(0), getSlot(2)?.teamId]).toEqual([undefined, 1])
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

  it('returns no teams while the quiz has no division', () => {
    const { teamsForDivision } = useMeetSession()
    expect(teamsForDivision('', false)).toHaveLength(0)
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

describe('who may submit to the linked meet', () => {
  const sendsAs = (sender: { admin: boolean; rooms: { id: number; name: string }[] }) =>
    vi.mocked(getSender).mockResolvedValue(sender)
  const guestOfficial = () => sendsAs({ admin: false, rooms: [{ id: 5, name: 'Room 1' }] })

  beforeEach(() => {
    useMeetSession().clearSession()
    vi.mocked(getMeetTeams).mockResolvedValue({ teams: mockTeams, meetDivisions: ['1'] })
    vi.mocked(getSender).mockReset().mockRejectedValue(new ApiError(403, 'Not an official'))
  })

  it('is no one but an admin or official of the meet', async () => {
    const meet = useMeetSession()
    await meet.loadMeet(1, 'Practice')
    expect(meet.sender.value).toBeNull()
    expect(meet.sender.value).toBeNull()
  })

  it('is no one signed out with no code for the meet', async () => {
    vi.mocked(getSender).mockRejectedValue(new ApiError(401, 'Authentication required'))
    const meet = useMeetSession()
    await meet.loadMeet(1, 'Practice')
    expect(meet.sender.value).toBeNull()
  })

  it('takes an official and their rooms from the API', async () => {
    guestOfficial()
    const meet = useMeetSession()
    await meet.loadMeet(1, 'Practice')
    expect(getSender).toHaveBeenCalledWith(1)
    expect(meet.sender.value).not.toBeNull()
    expect(meet.sender.value).toEqual({ admin: false, rooms: [{ id: 5, name: 'Room 1' }] })
  })

  it('takes an admin, and the rooms they may send for, from the API', async () => {
    const admin = {
      admin: true,
      rooms: [
        { id: 5, name: 'Room 1' },
        { id: 6, name: 'Room 2' },
      ],
    }
    sendsAs(admin)
    const meet = useMeetSession()
    await meet.loadMeet(1, 'Practice')
    expect(meet.sender.value).not.toBeNull()
    expect(meet.sender.value).toEqual(admin)
  })

  it("keeps who the user is when a refresh can't tell", async () => {
    guestOfficial()
    const meet = useMeetSession()
    await meet.loadMeet(1, 'Practice')
    vi.mocked(getSender).mockRejectedValue(new ApiError(500, 'Internal error'))
    await meet.refresh()
    expect(meet.sender.value).not.toBeNull()
  })

  it('works out who the user is again on refresh', async () => {
    const meet = useMeetSession()
    await meet.loadMeet(1, 'Practice')
    expect(meet.sender.value).toBeNull()
    guestOfficial()
    await meet.refresh()
    expect(meet.sender.value).not.toBeNull()
  })
})

describe('useMeetSession — the link a tab starts with', () => {
  it("is the tab's own, up to date, and never the old shared copy", async () => {
    localStorage.setItem('qzr-meet-session', JSON.stringify({ meetId: 1, meetName: 'Old' }))
    await writeMeta('migrated', true)
    const record = aRecord({ link: { meetId: 9, meetName: 'Ours' } as never })
    await writeRecord(record)
    currentTab()!.claim.release()
    sessionStorage.setItem('qzr-sheet:quiz', record.id)
    // A reload: the page starts its tab before the sheet's modules load
    vi.resetModules()
    await (await import('../../persistence/autoSave')).startTab()
    const fresh = await import('../useMeetSession')
    const { meetId, quizId } = fresh.useMeetSession()
    expect(meetId.value).toBe(9)
    expect(quizId.value).toBeNull()
  })
})
