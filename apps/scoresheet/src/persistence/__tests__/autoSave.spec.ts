import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  claimRecord,
  discardRecent,
  listRecent,
  openTabCount,
  readMeta,
  readRecord,
  enforceLimits,
  findMatch,
  startTab,
  takeDropped,
  writeMeta,
  writeRecord,
} from '../autoSave'
import { aRecord } from './records'
import { locks, removeWebLocks } from './webLocks'
import { createQuizStore } from '../../stores/quizStore'
import { CellValue, FILE_VERSION } from '@qzr/shared'
import { serializeStore } from '../quizFile'

beforeEach(() => {
  localStorage.clear()
})

describe('quiz records', () => {
  it('reads back a record written, with every field', async () => {
    const record = aRecord({
      saved: { file: 'saved', undo: [{ changes: [] }] },
      submitted: { file: 'sent', undo: [], meetId: 3, quizId: 'q1', link: null },
      ahead: { file: 'ahead', undo: [] },
      fromNewerFile: true,
      unsaved: false,
      offered: true,
    })
    expect(await writeRecord(record)).toBe(true)
    expect(await readRecord(record.id)).toEqual(record)
  })

  it('lists as recent only records no tab holds', async () => {
    const free = aRecord()
    const held = aRecord()
    await writeRecord(free)
    await writeRecord(held)
    locks.holdAsOtherTab(`qzr-sheet:quiz:${held.id}`)
    expect((await listRecent()).map((r) => r.id)).toEqual([free.id])
    locks.closeOtherTab(`qzr-sheet:quiz:${held.id}`)
    expect((await listRecent()).map((r) => r.id).sort()).toEqual([free.id, held.id].sort())
  })

  it('lets one of two tabs claim a record, and the other once it is let go', async () => {
    const record = aRecord()
    await writeRecord(record)
    const first = await claimRecord(record.id)
    expect(first).not.toBeNull()
    expect(await claimRecord(record.id)).toBeNull()
    expect(await openTabCount()).toBe(1)
    first!.release()
    await vi.waitFor(async () => expect(await claimRecord(record.id)).not.toBeNull())
  })

  it('waits as long as asked for a record about to be let go', async () => {
    locks.holdAsOtherTab('qzr-sheet:quiz:r1')
    setTimeout(() => locks.closeOtherTab('qzr-sheet:quiz:r1'), 20)
    expect(await claimRecord('r1', { wait: 1000 })).not.toBeNull()
    locks.holdAsOtherTab('qzr-sheet:quiz:r2')
    expect(await claimRecord('r2', { wait: 20 })).toBeNull()
  })

  it('discards records, and keeps the bookkeeping', async () => {
    const record = aRecord()
    await writeRecord(record)
    expect(await discardRecent(record.id)).toBe(true)
    expect(await readRecord(record.id)).toBeUndefined()
    expect(await readMeta('dropped')).toBeUndefined()
    await writeMeta('dropped', ['Quiz 1'])
    await writeMeta('migrated', true)
    expect(await readMeta('dropped')).toEqual(['Quiz 1'])
    expect(await readMeta('migrated')).toBe(true)
  })

  it("without Web Locks, treats every record but the tab's own as recent", async () => {
    removeWebLocks()
    const own = aRecord()
    const other = aRecord()
    await writeRecord(own)
    await writeRecord(other)
    expect(await claimRecord(own.id)).not.toBeNull()
    expect(await claimRecord(own.id)).not.toBeNull()
    expect((await listRecent(own.id)).map((r) => r.id)).toEqual([other.id])
    expect(await openTabCount()).toBe(1)
  })

  it('reports a write the device refuses for lack of room', async () => {
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('No room', 'QuotaExceededError')
    })
    try {
      expect(await writeRecord(aRecord())).toBe(false)
    } finally {
      put.mockRestore()
    }
  })
})

describe("a tab's start", () => {
  const link = {
    meetId: 7,
    meetName: 'Meet',
    slots: [],
    teamList: [],
    meetDivisions: [],
    quizId: 'q',
    sender: null,
  }

  it('begins a new record when the tab has none, and keeps its id', async () => {
    const tab = await startTab()
    expect(tab.record).toBeUndefined()
    expect(sessionStorage.getItem('qzr-sheet:quiz')).toBe(tab.id)
    expect(await claimRecord(tab.id)).toBeNull()
  })

  it('takes back its own record on a reload or a restored session', async () => {
    const record = aRecord({ link })
    await writeRecord(record)
    sessionStorage.setItem('qzr-sheet:quiz', record.id)
    const tab = await startTab()
    expect(tab.id).toBe(record.id)
    expect(tab.record).toEqual(record)
  })

  it('takes back its own record when the page it replaces lets go late', async () => {
    const record = aRecord()
    await writeRecord(record)
    sessionStorage.setItem('qzr-sheet:quiz', record.id)
    locks.holdAsOtherTab(`qzr-sheet:quiz:${record.id}`)
    setTimeout(() => locks.closeOtherTab(`qzr-sheet:quiz:${record.id}`), 50)
    const tab = await startTab()
    expect(tab.id).toBe(record.id)
  })

  it("keeps a newer version's quiz as it was when its tab reloads, and begins another", async () => {
    const newer = JSON.stringify({ version: FILE_VERSION + 1, quiz: {}, teams: [], answers: [] })
    const record = aRecord({ current: { file: newer, undo: [], redo: [] } })
    await writeRecord(record)
    sessionStorage.setItem('qzr-sheet:quiz', record.id)
    const tab = await startTab()
    expect(tab.id).not.toBe(record.id)
    expect(tab.record).toBeUndefined()
    expect(await readRecord(record.id)).toMatchObject({ newerRaw: newer, current: undefined })
  })

  it("never makes room with the tab's own record, without Web Locks too", async () => {
    removeWebLocks()
    const tab = await startTab()
    const own = aRecord({ id: tab.id, unsaved: false, changedAt: 1 })
    await writeRecord(own)
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
      throw new DOMException('No room', 'QuotaExceededError')
    })
    expect(await writeRecord(aRecord())).toBe(false)
    put.mockRestore()
    expect(await readRecord(tab.id)).toBeDefined()
  })

  it('copies the record when another tab holds it, as a duplicated tab finds', async () => {
    const record = aRecord({
      link,
      current: { file: 'quiz', undo: [{ changes: [] }], redo: [] },
      offered: true,
    })
    await writeRecord(record)
    sessionStorage.setItem('qzr-sheet:quiz', record.id)
    locks.holdAsOtherTab(`qzr-sheet:quiz:${record.id}`)
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    const started = startTab()
    await vi.advanceTimersByTimeAsync(1000)
    vi.useRealTimers()
    const tab = await started
    expect(tab.id).not.toBe(record.id)
    expect(sessionStorage.getItem('qzr-sheet:quiz')).toBe(tab.id)
    // Its own quiz from now on, offered once its tab closes
    expect(tab.record).toEqual({ ...record, id: tab.id, offered: false })
    expect(await readRecord(tab.id)).toEqual(tab.record)
    expect(await readRecord(record.id)).toEqual(record)
  })
})

describe('moving from the previous version', () => {
  const quiz = () => {
    const store = createQuizStore()
    store.setAnswer(store.quizzers[0]!.id, '1', CellValue.Correct)
    return serializeStore(store, new Map(), new Map())
  }
  const meet = {
    meetId: 7,
    meetName: 'Meet',
    slots: [],
    teamList: [],
    meetDivisions: [],
    sender: null,
  }

  it("makes the quiz and meet link the starting tab's record, with no undo or saved state", async () => {
    localStorage.setItem('qzr-sheet:current', quiz())
    localStorage.setItem('qzr-meet-session', JSON.stringify(meet))
    localStorage.setItem('qzr-sheet:opened-from-newer-file', '1')
    const tab = await startTab()
    expect(JSON.parse(tab.record!.current!.file).answers).toHaveLength(1)
    expect(tab.record!.current!.undo).toEqual([])
    expect(tab.record!.saved).toBeUndefined()
    expect(tab.record!.fromNewerFile).toBe(true)
    // The link's fields as the meet session's load brings them up to date
    expect(tab.record!.link).toMatchObject({ meetId: 7, quizId: null, scheduledQuiz: null })
    for (const key of [
      'qzr-sheet:current',
      'qzr-meet-session',
      'qzr-sheet:opened-from-newer-file',
    ]) {
      expect(localStorage.getItem(key)).toBeNull()
    }
    expect(await readMeta('migrated')).toBe(true)
  })

  it("makes each newer version's set-aside quiz a recent record holding its text", async () => {
    const raw = JSON.stringify({ version: FILE_VERSION + 1 })
    localStorage.setItem('qzr-sheet:newer-autosave:2026-01-01T00:00:00.000Z', raw)
    const tab = await startTab()
    const recent = await listRecent(tab.id)
    expect(recent).toHaveLength(1)
    expect(recent[0]!.newerRaw).toBe(raw)
    expect(recent[0]!.current).toBeUndefined()
    expect(localStorage.length).toBe(0)
  })

  it("takes the tutorial's copy left by a crash over the practice quiz", async () => {
    localStorage.setItem(
      'qzr-sheet:current',
      serializeStore(createQuizStore(), new Map(), new Map()),
    )
    localStorage.setItem('qzr-sheet:tutorial-snapshot', quiz())
    localStorage.setItem('qzr-sheet:tutorial-meet-snapshot', JSON.stringify(meet))
    const tab = await startTab()
    expect(JSON.parse(tab.record!.current!.file).answers).toHaveLength(1)
    expect(tab.record!.link).toMatchObject({ meetId: 7 })
    expect(localStorage.length).toBe(0)
  })

  it("keeps both when the tutorial's copy was a newer version's kept in place", async () => {
    const newer = JSON.stringify({ version: FILE_VERSION + 1 })
    localStorage.setItem('qzr-sheet:current', quiz())
    localStorage.setItem('qzr-meet-session', JSON.stringify(meet))
    localStorage.setItem('qzr-sheet:tutorial-snapshot', newer)
    const tab = await startTab()
    expect(JSON.parse(tab.record!.current!.file).answers).toHaveLength(1)
    expect(tab.record!.link).toMatchObject({ meetId: 7 })
    const recent = await listRecent(tab.id)
    expect(recent.map((r) => r.newerRaw)).toEqual([newer])
    expect(localStorage.length).toBe(0)
  })

  it('moves nothing another tab moved meanwhile', async () => {
    localStorage.setItem('qzr-sheet:current', quiz())
    locks.holdAsOtherTab('qzr-sheet:migrate')
    const started = startTab()
    await writeMeta('migrated', true)
    locks.closeOtherTab('qzr-sheet:migrate')
    const tab = await started
    expect(tab.record).toBeUndefined()
    expect(await listRecent(tab.id)).toEqual([])
  })

  it('leaves a key whose record could not be written for the next start', async () => {
    localStorage.setItem('qzr-sheet:current', quiz())
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('No room', 'QuotaExceededError')
    })
    try {
      await startTab()
    } finally {
      put.mockRestore()
    }
    expect(localStorage.getItem('qzr-sheet:current')).not.toBeNull()
    expect(await readMeta('migrated')).toBeUndefined()
  })
})

describe('the limits on recent quizzes', () => {
  const named = (n: number) =>
    JSON.stringify({
      ...JSON.parse(aRecord().current!.file),
      quiz: { ...JSON.parse(aRecord().current!.file).quiz, division: '1', quizNumber: String(n) },
    })

  it('keeps the 80 most recently changed unsaved and 40 saved, and says which unsaved went', async () => {
    for (let n = 0; n < 81; n++) {
      await writeRecord(
        aRecord({ changedAt: 1000 + n, current: { file: named(n), undo: [], redo: [] } }),
      )
    }
    for (let n = 0; n < 41; n++) await writeRecord(aRecord({ unsaved: false, changedAt: 1000 + n }))
    const held = aRecord({ changedAt: 0 })
    await writeRecord(held)
    locks.holdAsOtherTab(`qzr-sheet:quiz:${held.id}`)

    await enforceLimits()

    const recent = await listRecent()
    expect(recent.filter((r) => r.unsaved)).toHaveLength(80)
    expect(recent.filter((r) => !r.unsaved)).toHaveLength(40)
    expect(Math.min(...recent.map((r) => r.changedAt))).toBe(1001)
    expect(await readRecord(held.id)).toBeDefined()
    expect(await takeDropped()).toEqual(['D1 Q0'])
    expect(await takeDropped()).toEqual([])
  })

  it('makes room from saved recent quizzes, oldest first, and never from unsaved ones', async () => {
    const oldSaved = aRecord({ unsaved: false, changedAt: 1 })
    const newSaved = aRecord({ unsaved: false, changedAt: 2 })
    const unsaved = aRecord({ changedAt: 0 })
    for (const r of [oldSaved, newSaved, unsaved]) await writeRecord(r)
    // The device has room for the new record once one quiz is gone
    let refusals = 1
    const put = IDBObjectStore.prototype.put
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      ...args
    ) {
      if (refusals-- > 0) throw new DOMException('No room', 'QuotaExceededError')
      return put.apply(this, args)
    })
    try {
      expect(await writeRecord(aRecord())).toBe(true)
    } finally {
      spy.mockRestore()
    }
    expect(await readRecord(oldSaved.id)).toBeUndefined()
    expect(await readRecord(newSaved.id)).toBeDefined()
    expect(await readRecord(unsaved.id)).toBeDefined()
  })
})

describe('an Open finding the quiz it came from', () => {
  const state = (file: string) => ({ file, undo: [] })

  it('continues a recent quiz in its current, saved or submitted state', async () => {
    const a = aRecord({ current: { file: 'A', undo: [], redo: [] }, saved: state('A0') })
    const b = aRecord({ submitted: { ...state('B'), meetId: 3, quizId: 'q', link: null } })
    for (const r of [a, b]) await writeRecord(r)
    const current = await findMatch({ file: 'A' }, 'own')
    expect(current).toMatchObject({ record: a, state: 'current' })
    if (current && current !== 'held') current.claim.release()
    await Promise.resolve()
    const saved = await findMatch({ file: 'A0' }, 'own')
    expect(saved).toMatchObject({ record: { id: a.id }, state: 'saved' })
  })

  it('matches a submitted state only from the meet, as the same scheduled quiz', async () => {
    const b = aRecord({ submitted: { ...state('B'), meetId: 3, quizId: 'q', link: null } })
    await writeRecord(b)
    expect(await findMatch({ file: 'B' }, 'own')).toBeNull()
    expect(
      await findMatch({ file: 'B', fromMeet: { meetId: 3, quizId: 'other' } }, 'own'),
    ).toBeNull()
    expect(
      await findMatch({ file: 'B', fromMeet: { meetId: 3, quizId: 'q' } }, 'own'),
    ).toMatchObject({
      state: 'submitted',
    })
  })

  it('takes the most recently changed of several, and says when each is open elsewhere', async () => {
    const older = aRecord({ current: { file: 'X', undo: [], redo: [] }, changedAt: 1 })
    const newer = aRecord({ current: { file: 'X', undo: [], redo: [] }, changedAt: 2 })
    for (const r of [older, newer]) await writeRecord(r)
    const match = await findMatch({ file: 'X' }, 'own')
    expect(match).toMatchObject({ record: { id: newer.id } })
    locks.holdAsOtherTab(`qzr-sheet:quiz:${older.id}`)
    expect(await findMatch({ file: 'X' }, 'own')).toBe('held')
  })

  it("never continues the tab's own quiz, and finds nothing when nothing matches", async () => {
    const own = aRecord({ current: { file: 'O', undo: [], redo: [] } })
    await writeRecord(own)
    expect(await findMatch({ file: 'O' }, own.id)).toBeNull()
    expect(await findMatch({ file: 'nothing' }, own.id)).toBeNull()
  })
})
