import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { ApiError } from '@qzr/shared'

vi.mock('../../api', async () => ({
  ...(await vi.importActual<typeof import('../../api')>('../../api')),
  getMeetTeams: vi.fn(),
  getTeamQuizzers: vi.fn(),
  getSender: vi.fn(),
  getMyMeets: vi.fn(),
  getMeetName: vi.fn(),
  getTeamNames: vi.fn(),
  getScheduledQuiz: vi.fn(),
  getPublishedSchedule: vi.fn(),
  getStoredQuizzes: vi.fn(),
}))
vi.mock('../../persistence/fileIO', async () => ({
  ...(await vi.importActual<typeof import('../../persistence/fileIO')>('../../persistence/fileIO')),
  openAnyQuizFile: vi.fn(),
  confirmAction: vi.fn(),
}))

import {
  getMeetName,
  getMeetTeams,
  getMyMeets,
  getPublishedSchedule,
  getScheduledQuiz,
  getSender,
  getStoredQuizzes,
  getTeamNames,
  getTeamQuizzers,
} from '../../api'
import { confirmAction } from '../../persistence/fileIO'
import {
  currentTab,
  listRecent,
  readRecord,
  startTab,
  writeMeta,
  writeRecord,
  type QuizRecord,
} from '../../persistence/autoSave'
import { aRecord } from '../../persistence/__tests__/records'
import { locks } from '../../persistence/__tests__/webLocks'
import { useMeetSession } from '../../composables/useMeetSession'
import { portalLink } from '../../portalLink'
import {
  MEET_ID,
  MEET_NAME,
  button,
  calgary,
  mountSheet,
  pageText,
  pickScheduled,
  quizFile,
  regina,
  roster,
  rosters,
  saskatoon,
  scheduledQuiz,
  stubDialogs,
  teamNames,
  typeTeam,
  unmountSheets,
} from './linkedSheet'

/** A quiz left by a closed tab: a record no tab holds */
async function leftBehind(team: string, overrides: Partial<QuizRecord> = {}) {
  const record = aRecord({
    current: { file: JSON.stringify(quizFile([[team, 'Ann']])), undo: [], redo: [] },
    start: '',
    ...overrides,
  })
  await writeRecord(record)
  return record
}

/** The scoresheet opened in a new tab: no record of its own yet */
async function newTab(url = '/') {
  window.history.replaceState(null, '', url)
  sessionStorage.clear()
  // As the page starts it
  await startTab({ byLink: portalLink(location.search) !== null })
  return mountSheet()
}

const offered = () =>
  [...document.querySelectorAll('.recent-quizzes__name')].map((el) => el.textContent)

beforeEach(async () => {
  stubDialogs()
  localStorage.clear()
  await writeMeta('migrated', true)
  useMeetSession().clearSession()
  vi.stubGlobal('alert', vi.fn())
  vi.mocked(confirmAction).mockReset().mockResolvedValue(true)
  vi.mocked(getMeetTeams)
    .mockReset()
    .mockResolvedValue({ teams: roster, meetDivisions: ['1', '2'] })
  vi.mocked(getTeamQuizzers)
    .mockReset()
    .mockImplementation(async (_, teamId) => ({ quizzers: rosters[teamId]! }))
  vi.mocked(getSender).mockReset().mockResolvedValue({ admin: true, rooms: [] })
  vi.mocked(getMyMeets).mockReset().mockRejectedValue(new ApiError(401, 'Authentication required'))
  vi.mocked(getMeetName)
    .mockReset()
    .mockResolvedValue({ meet: { name: MEET_NAME } })
  vi.mocked(getTeamNames).mockReset().mockResolvedValue([])
  vi.mocked(getScheduledQuiz)
    .mockReset()
    .mockResolvedValue(scheduledQuiz([calgary, regina, saskatoon]))
  vi.mocked(getPublishedSchedule).mockReset().mockRejectedValue(new ApiError(404, 'Not published'))
  vi.mocked(getStoredQuizzes).mockReset().mockResolvedValue([])
})

afterEach(() => {
  unmountSheets()
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

describe('replacing a quiz', () => {
  it('asks nothing, and keeps the quiz it replaced as unsaved', async () => {
    const sheet = await newTab()
    await typeTeam(sheet, 0, 'Lions')
    const replaced = currentTab()!.id

    expect(await pickScheduled(sheet, 'New', 'New from schedule')).toBe(true)
    await sheet.vm.newQuiz()

    expect(confirmAction).not.toHaveBeenCalled()
    const kept = await readRecord(replaced)
    expect(JSON.parse(kept!.current!.file).teams[0].name).toBe('Lions')
    expect(kept).toMatchObject({ unsaved: true, offered: true })
    expect((await listRecent()).map((r) => r.id)).toContain(replaced)
  })

  it('keeps nothing of a quiz with nothing done by hand', async () => {
    const sheet = await newTab()
    await pickScheduled(sheet, 'New', 'New from schedule')
    await sheet.vm.newQuiz()
    await flushPromises()
    expect(await listRecent(currentTab()!.id)).toEqual([])
  })
})

describe('a new tab', () => {
  it('brings back the one unsaved quiz left by a closed tab, without asking', async () => {
    const record = await leftBehind('Lions')
    const sheet = await newTab()
    expect(currentTab()!.id).toBe(record.id)
    expect(teamNames(sheet)).toEqual(['Lions', '', ''])
    expect(offered()).toEqual([])
  })

  it('offers several, or one while another tab is open, with a blank quiz instead', async () => {
    await leftBehind('Lions')
    await leftBehind('Bears')
    await newTab()
    expect(offered()).toEqual(['D1 Q7', 'D1 Q7'])
    expect(pageText()).toContain('Lions')
    expect(pageText()).toContain('Bears')
    expect(pageText()).toContain('Start a blank quiz')
    unmountSheets()

    const other = await leftBehind('Tigers')
    locks.holdAsOtherTab('qzr-sheet:quiz:open-elsewhere')
    const sheet = await newTab()
    expect(currentTab()!.id).not.toBe(other.id)
    expect(pageText()).toContain('Tigers')
    expect(teamNames(sheet)).toEqual(['', '', ''])
  })

  it('offers each quiz once: a later tab offers only those left since', async () => {
    await leftBehind('Lions')
    await leftBehind('Bears')
    const first = await newTab()
    await button(first, 'Start a blank quiz').trigger('click')
    unmountSheets()
    currentTab()!.claim.release()

    await leftBehind('Tigers')
    const sheet = await newTab()
    // Tigers alone is offered, so it comes back by itself; the others stay recent
    expect(teamNames(sheet)).toEqual(['Tigers', '', ''])
    expect(await listRecent(currentTab()!.id)).toHaveLength(2)
  })

  it("marks quizzes offered without undoing another tab's edit to them", async () => {
    const lions = await leftBehind('Lions')
    await leftBehind('Bears')
    let listings = 0
    const query = locks.query.bind(locks)
    vi.spyOn(locks, 'query').mockImplementation(async () => {
      const snapshot = await query()
      // The second listing is the new tab looking for left quizzes: another tab edits Lions now
      if (++listings === 2) {
        await writeRecord({
          ...lions,
          current: {
            file: JSON.stringify(quizFile([['Lions edited', 'Ann']])),
            undo: [],
            redo: [],
          },
        })
      }
      return snapshot
    })
    await newTab()
    const after = (await readRecord(lions.id))!
    expect(JSON.parse(after.current!.file).teams[0].name).toBe('Lions edited')
    expect(after.offered).toBe(true)
  })

  it('never offers a saved quiz', async () => {
    const file = JSON.stringify(quizFile([['Lions', 'Ann']]))
    await leftBehind('Lions', { saved: { file, undo: [] }, unsaved: false })
    const sheet = await newTab()
    expect(teamNames(sheet)).toEqual(['', '', ''])
    expect(offered()).toEqual([])
  })

  it('opened by a portal link opens it, and says unsaved quizzes are waiting', async () => {
    await leftBehind('Lions')
    await newTab(`/?meetId=${MEET_ID}&quiz=q7`)
    await flushPromises()
    expect(offered()).toEqual([])
    expect(pageText()).toContain('1 unsaved quiz from closed tabs.')
    expect(pageText()).toContain('See them')
  })

  it('never offers on a reload', async () => {
    const own = await leftBehind('Lions', { offered: true })
    await leftBehind('Bears')
    await leftBehind('Tigers')
    sessionStorage.setItem('qzr-sheet:quiz', own.id)
    await startTab()
    const sheet = await mountSheet()
    expect(teamNames(sheet)).toEqual(['Lions', '', ''])
    expect(offered()).toEqual([])
  })
})
