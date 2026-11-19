import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  saveToStorage,
  loadFromStorage,
  clearStorage,
  listKeptNewerAutoSaves,
  readKeptNewerAutoSave,
  discardKeptNewerAutoSave,
  isAutoSavePausedForNewer,
  keepNewerInPlace,
  claimRecord,
  deleteRecord,
  listRecent,
  openTabCount,
  readMeta,
  readRecord,
  writeMeta,
  writeRecord,
} from '../autoSave'
import { aRecord } from './records'
import { locks, removeWebLocks } from './webLocks'
import { resetAutoSave } from './resetAutoSave'
import { createQuizStore } from '../../stores/quizStore'
import { CellValue, FILE_VERSION } from '@qzr/shared'
import { serializeStore } from '../quizFile'

beforeEach(() => {
  resetAutoSave()
})

describe('autoSave', () => {
  it('returns null when nothing is stored', () => {
    expect(loadFromStorage()).toBeNull()
  })

  it('round-trips a default store', () => {
    const store = createQuizStore()
    saveToStorage(store, new Map(), new Map())
    const result = loadFromStorage()
    expect(result).not.toBeNull()
    expect(result!.quiz.division).toBe(store.quiz.division)
    expect(result!.teams).toHaveLength(3)
  })

  it('round-trips answers and noJumps', () => {
    const store = createQuizStore()
    const qzr = store.quizzersByTeam(store.teams[0]!.id)[0]!
    store.setAnswer(qzr.id, '1', CellValue.Correct)
    const noJumps = new Map([['3', true]])
    saveToStorage(store, noJumps, new Map())

    const result = loadFromStorage()!
    expect(result.answers).toHaveLength(1)
    expect(result.answers[0]!.value).toBe(CellValue.Correct)
    expect(result.noJumps.get('3')).toBe(true)
  })

  it('clearStorage removes persisted data', () => {
    const store = createQuizStore()
    saveToStorage(store, new Map(), new Map())
    clearStorage()
    expect(loadFromStorage()).toBeNull()
  })

  it('returns null and cleans up on corrupt data', () => {
    localStorage.setItem('qzr-sheet:current', '{bad json')
    expect(loadFromStorage()).toBeNull()
    expect(localStorage.getItem('qzr-sheet:current')).toBeNull()
  })
})

describe('autoSave — an auto-save from a newer version', () => {
  function newerJson(division: string) {
    const store = createQuizStore()
    store.quiz.division = division
    const file = JSON.parse(serializeStore(store, new Map(), new Map()))
    return JSON.stringify({ ...file, version: FILE_VERSION + 1 })
  }

  it('is moved aside unchanged instead of deleted', () => {
    const json = newerJson('7')
    localStorage.setItem('qzr-sheet:current', json)
    expect(loadFromStorage()).toBeNull()
    expect(localStorage.getItem('qzr-sheet:current')).toBeNull()
    const kept = listKeptNewerAutoSaves()
    expect(kept).toHaveLength(1)
    expect(kept[0]).toMatch(/^qzr-sheet:newer-autosave:/)
    expect(readKeptNewerAutoSave(kept[0]!)).toBe(json)
  })

  it('gives each kept auto-save its own key, newest first', async () => {
    localStorage.setItem('qzr-sheet:current', newerJson('1'))
    loadFromStorage()
    await new Promise((resolve) => setTimeout(resolve, 5))
    localStorage.setItem('qzr-sheet:current', newerJson('2'))
    loadFromStorage()
    const kept = listKeptNewerAutoSaves()
    expect(kept).toHaveLength(2)
    expect(JSON.parse(readKeptNewerAutoSave(kept[0]!)!).quiz.division).toBe('2')
  })

  it('is never touched by later auto-saves, only by an explicit discard', () => {
    localStorage.setItem('qzr-sheet:current', newerJson('7'))
    loadFromStorage()
    saveToStorage(createQuizStore(), new Map(), new Map())
    const [kept] = listKeptNewerAutoSaves()
    expect(kept).toBeDefined()
    discardKeptNewerAutoSave(kept!)
    expect(listKeptNewerAutoSaves()).toHaveLength(0)
  })
})

describe('autoSave — a newer auto-save that cannot be set aside', () => {
  it('stays in place, and auto-save pauses until it is discarded', () => {
    const store = createQuizStore()
    const newer = JSON.stringify({
      ...JSON.parse(serializeStore(store, new Map(), new Map())),
      version: FILE_VERSION + 1,
    })
    localStorage.setItem('qzr-sheet:current', newer)
    // Storage is full: setting the quiz aside fails
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key) {
      if (String(key).startsWith('qzr-sheet:newer-autosave:')) throw new Error('quota')
    })
    try {
      expect(loadFromStorage()).toBeNull()
    } finally {
      setItem.mockRestore()
    }
    expect(isAutoSavePausedForNewer()).toBe(true)
    expect(listKeptNewerAutoSaves()).toEqual(['qzr-sheet:current'])

    saveToStorage(store, new Map(), new Map())
    clearStorage()
    expect(localStorage.getItem('qzr-sheet:current')).toBe(newer)

    discardKeptNewerAutoSave('qzr-sheet:current')
    expect(isAutoSavePausedForNewer()).toBe(false)
    saveToStorage(store, new Map(), new Map())
    expect(localStorage.getItem('qzr-sheet:current')).not.toBe(newer)
  })
})

describe('autoSave — another newer quiz kept in place', () => {
  it('is listed and discardable, without pausing auto-save', () => {
    localStorage.setItem('qzr-sheet:tutorial-snapshot', '{"version":99}')
    keepNewerInPlace('qzr-sheet:tutorial-snapshot')
    expect(listKeptNewerAutoSaves()).toEqual(['qzr-sheet:tutorial-snapshot'])
    expect(isAutoSavePausedForNewer()).toBe(false)
    discardKeptNewerAutoSave('qzr-sheet:tutorial-snapshot')
    expect(listKeptNewerAutoSaves()).toEqual([])
    expect(localStorage.getItem('qzr-sheet:tutorial-snapshot')).toBeNull()
  })
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

  it('deletes records, and keeps the bookkeeping', async () => {
    const record = aRecord()
    await writeRecord(record)
    await deleteRecord(record.id)
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
