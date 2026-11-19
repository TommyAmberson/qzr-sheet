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
import { confirmAction, openAnyQuizFile } from '../../persistence/fileIO'
import {
  currentTab,
  listRecent,
  claimRecord,
  readRecord,
  startTab,
  writeMeta,
  writeRecord,
  type QuizRecord,
} from '../../persistence/autoSave'
import { aRecord } from '../../persistence/__tests__/records'
import { locks, removeWebLocks } from '../../persistence/__tests__/webLocks'
import { useMeetSession } from '../../composables/useMeetSession'
import { portalLink } from '../../portalLink'
import {
  MEET_ID,
  MEET_NAME,
  button,
  calgary,
  menu,
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
    // Written, and let go, once the writes before it have landed
    await vi.waitFor(async () => {
      const kept = await readRecord(replaced)
      expect(JSON.parse(kept!.current!.file).teams[0].name).toBe('Lions')
      expect(kept).toMatchObject({ unsaved: true, offered: true })
      expect((await listRecent()).map((r) => r.id)).toContain(replaced)
    })
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

  it('says nothing is left to restore once other tabs took every quiz offered', async () => {
    const lions = await leftBehind('Lions')
    const bears = await leftBehind('Bears')
    await newTab()
    await claimRecord(lions.id)
    await claimRecord(bears.id)
    for (const restore of [
      ...document.querySelectorAll<HTMLButtonElement>('.recent-quizzes__row button'),
    ].filter((b) => b.textContent?.trim() === 'Restore')) {
      restore.click()
      await vi.waitFor(() =>
        expect(pageText()).toContain('That quiz was just opened in another tab.'),
      )
    }
    await vi.waitFor(() => expect(pageText()).toContain('Nothing left to restore.'))
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

describe('Open ▸ Recent quizzes', () => {
  const rows = () =>
    [...document.querySelectorAll('.recent-quizzes__row')].map((r) => r.textContent)
  const rowButton = (row: number, label: string) =>
    [...document.querySelectorAll('.recent-quizzes__row')[row]!.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === label,
    )!
  async function openList(sheet: Awaited<ReturnType<typeof newTab>>) {
    await menu(sheet, 'Open', 'Recent quizzes…')
    await flushPromises()
  }

  it('lists every recent quiz, unsaved first and marked, with teams, answers and when', async () => {
    const file = JSON.stringify(quizFile([['Bears', 'Bo']]))
    await leftBehind('Bears', { saved: { file, undo: [] }, unsaved: false, changedAt: Date.now() })
    await leftBehind('Lions', { offered: true, changedAt: Date.now() - 86_400_000 })
    const sheet = await newTab()
    await openList(sheet)
    expect(rows()[0]).toContain('Unsaved')
    expect(rows()[0]).toContain('Lions')
    expect(rows()[0]).toContain('0 answers · yesterday')
    expect(rows()[1]).not.toContain('Unsaved')
    expect(rows()[1]).toContain('today')
  })

  it('shows a quiz saved, then submitted, then edited as three rows, each restoring its state', async () => {
    const saved = JSON.stringify(quizFile([['Saved']]))
    const sent = JSON.stringify(quizFile([['Sent']]))
    const link = {
      meetId: MEET_ID,
      meetName: MEET_NAME,
      slots: [],
      teamList: [],
      meetDivisions: [],
      quizId: 'q7',
      sender: null,
    }
    await leftBehind('Edited', {
      offered: true,
      link: { ...link, meetName: 'Other' },
      saved: { file: saved, undo: [] },
      submitted: { file: sent, undo: [], meetId: MEET_ID, quizId: 'q7', link },
    })
    const sheet = await newTab()
    await typeTeam(sheet, 0, 'Mine')
    await openList(sheet)
    expect(rows()).toHaveLength(3)
    expect(rows()[1]).toContain('As saved to a file')
    expect(rows()[2]).toContain(`As submitted to ${MEET_NAME}`)

    rowButton(2, 'Restore').click()
    await flushPromises()
    expect(teamNames(sheet)).toEqual(['Sent', '', ''])
    expect(useMeetSession().meetName.value).toBe(MEET_NAME)
    // The quiz the tab showed is recent now
    await vi.waitFor(async () => {
      const recent = await listRecent(currentTab()!.id)
      expect(recent.some((r) => r.current?.file.includes('Mine'))).toBe(true)
    })
  })

  it('discards a quiz, and all, asking first and keeping quizzes open in tabs', async () => {
    await leftBehind('Lions', { offered: true })
    await leftBehind('Bears', { offered: true })
    const held = await leftBehind('Tigers', { offered: true })
    locks.holdAsOtherTab(`qzr-sheet:quiz:${held.id}`)
    const sheet = await newTab()
    await openList(sheet)
    expect(rows()).toHaveLength(2)
    rowButton(0, 'Discard').click()
    await vi.waitFor(() => expect(rows()).toHaveLength(1))
    expect(confirmAction).toHaveBeenCalledWith(expect.stringContaining('cannot be undone'))
    await button(sheet, 'Discard all').trigger('click')
    await vi.waitFor(() => expect(pageText()).toContain('No recent quizzes.'))
    expect(await readRecord(held.id)).toBeDefined()
  })

  it("leaves the tab's own quiz out, without Web Locks too", async () => {
    removeWebLocks()
    const sheet = await newTab()
    await typeTeam(sheet, 0, 'Mine')
    await vi.waitFor(async () => expect(await readRecord(currentTab()!.id)).toBeDefined())
    await openList(sheet)
    expect(pageText()).toContain('No recent quizzes.')
    await button(sheet, 'Close').trigger('click')
    await leftBehind('Lions', { offered: true })
    await openList(sheet)
    await button(sheet, 'Discard all').trigger('click')
    await vi.waitFor(() => expect(pageText()).toContain('No recent quizzes.'))
    expect(await readRecord(currentTab()!.id)).toBeDefined()
  })

  it('discards nothing another tab has just opened, and says so', async () => {
    const lions = await leftBehind('Lions', { offered: true })
    const sheet = await newTab()
    await openList(sheet)
    locks.holdAsOtherTab(`qzr-sheet:quiz:${lions.id}`)
    rowButton(0, 'Discard').click()
    await vi.waitFor(() =>
      expect(pageText()).toContain('That quiz was just opened in another tab.'),
    )
    expect(await readRecord(lions.id)).toBeDefined()
  })

  it('says a quiz was just opened in another tab, and keeps the list open', async () => {
    const lions = await leftBehind('Lions', { offered: true })
    const sheet = await newTab()
    await openList(sheet)
    await claimRecord(lions.id)
    rowButton(0, 'Restore').click()
    await flushPromises()
    expect(pageText()).toContain('That quiz was just opened in another tab.')
    expect(teamNames(sheet)).toEqual(['', '', ''])
  })

  it('restores a quiz as another tab last left it, not as it was listed', async () => {
    const lions = await leftBehind('Lions', { offered: true })
    const sheet = await newTab()
    await openList(sheet)
    // Another tab restores it, edits it and closes, while the list is open here
    const claim = (await claimRecord(lions.id))!
    await writeRecord({
      ...lions,
      current: { file: JSON.stringify(quizFile([['Lions edited', 'Ann']])), undo: [], redo: [] },
    })
    claim.release()
    await flushPromises()
    rowButton(0, 'Restore').click()
    await vi.waitFor(() => expect(teamNames(sheet)).toEqual(['Lions edited', '', '']))
  })

  it("lists a newer version's quiz, and asks before opening a copy of it", async () => {
    const raw = JSON.stringify({ ...quizFile([['Future']]), version: 99 })
    await writeRecord(
      aRecord({ current: undefined, newerRaw: raw, offered: true, fromNewerFile: true }),
    )
    const sheet = await newTab()
    await openList(sheet)
    expect(rows()[0]).toContain('From a newer version')
    rowButton(0, 'Restore').click()
    await flushPromises()
    expect(confirmAction).toHaveBeenCalledWith(expect.stringContaining('newer version'))
    expect(teamNames(sheet)).toEqual(['Future', '', ''])
    expect(await listRecent(currentTab()!.id)).toHaveLength(1)
  })
})

describe('Open finding the quiz it came from', () => {
  it('opens the file as a new quiz when the device storage fails', async () => {
    const sheet = await newTab()
    const transaction = vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(() => {
      throw new DOMException('gone', 'InvalidStateError')
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const file = JSON.stringify(quizFile([['Lions', 'Ann']]))
    vi.mocked(openAnyQuizFile).mockResolvedValue({ type: 'json', content: file } as never)
    await menu(sheet, 'Open', 'From file…')
    await vi.waitFor(() => expect(teamNames(sheet)).toEqual(['Lions', '', '']))
    expect(alert).not.toHaveBeenCalled()
    transaction.mockRestore()
  })

  it('says so, and opens a separate quiz, when that quiz is open in another tab', async () => {
    const file = JSON.stringify(quizFile([['Lions', 'Ann']]))
    const elsewhere = await leftBehind('Lions', { offered: true, saved: { file: '', undo: [] } })
    const { canonicalQuizFile } = await import('../../persistence/quizFile')
    const { deserialize } = await import('@qzr/shared')
    const canonical = canonicalQuizFile(deserialize(JSON.parse(file)))
    await writeRecord({ ...elsewhere, current: { file: canonical, undo: [], redo: [] } })
    locks.holdAsOtherTab(`qzr-sheet:quiz:${elsewhere.id}`)
    const sheet = await newTab()
    vi.mocked(openAnyQuizFile).mockResolvedValue({ type: 'json', content: file } as never)
    await menu(sheet, 'Open', 'From file…')
    await flushPromises()
    expect(pageText()).toContain(
      'This quiz is open in another tab. It opened here as a separate quiz.',
    )
    expect(teamNames(sheet)).toEqual(['Lions', '', ''])
    expect(currentTab()!.id).not.toBe(elsewhere.id)
  })
})
