import {
  type DeserializeResult,
  NewerFileVersionError,
  parseQuizFile,
  type Timeout,
} from '@qzr/shared'
import { type DBSchema, type IDBPDatabase, openDB } from 'idb'
import { serializeStore } from './quizFile'
import type { QuizStore } from '../stores/quizStore'
import type { UndoStep } from '../composables/undoSteps'
import type { MeetSessionData } from '../composables/useMeetSession'

const STORAGE_KEY = 'qzr-sheet:current'
const KEPT_NEWER_PREFIX = 'qzr-sheet:newer-autosave:'

// Keys holding a newer quiz that couldn't be set aside, so it stays where it is and nothing may
// write over it. For STORAGE_KEY that means auto-save pauses until the official discards it.
const keptInPlace = new Set<string>()

export function saveToStorage(
  store: QuizStore,
  noJumps: Map<string, boolean>,
  timeouts: Map<number, Timeout[]>,
): void {
  if (keptInPlace.has(STORAGE_KEY)) return
  try {
    localStorage.setItem(STORAGE_KEY, serializeStore(store, noJumps, timeouts))
  } catch {
    // localStorage full or unavailable — silently ignore
    return
  }
  // The quiz is now saved, so copies held back until it was can go
  for (const key of removeAfterSave) localStorage.removeItem(key)
  removeAfterSave.clear()
}

// Keys holding the only copy of the current quiz until auto-save next succeeds
const removeAfterSave = new Set<string>()

/** Remove `key` once the current quiz has actually been auto-saved (now, unless auto-save is paused) */
export function removeOnceSaved(key: string): void {
  if (keptInPlace.has(STORAGE_KEY)) removeAfterSave.add(key)
  else localStorage.removeItem(key)
}

/** Whether any newer quiz is kept where it was found; the tutorial won't start until none is */
export function hasNewerKeptInPlace(): boolean {
  return keptInPlace.size > 0
}

/** Set a newer build's quiz aside, under its own key so later auto-saves can't overwrite it */
export function keepNewerAutoSave(raw: string): boolean {
  try {
    localStorage.setItem(KEPT_NEWER_PREFIX + new Date().toISOString(), raw)
    return true
  } catch {
    return false
  }
}

export function loadFromStorage(): DeserializeResult | null {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return parseQuizFile(raw)
  } catch (e) {
    // A newer build's quiz can't be scored here but mustn't be lost: if it can't be set aside,
    // it stays where it is and auto-save pauses
    if (e instanceof NewerFileVersionError && raw) {
      if (keepNewerAutoSave(raw)) localStorage.removeItem(STORAGE_KEY)
      else keptInPlace.add(STORAGE_KEY)
      return null
    }
    localStorage.removeItem(STORAGE_KEY)
    return null
  }
}

/** Keys of auto-saves from a newer version that were set aside on startup, most recent first */
export function listKeptNewerAutoSaves(): string[] {
  const keys: string[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(KEPT_NEWER_PREFIX)) keys.push(key)
    }
  } catch {
    return []
  }
  // ISO timestamps sort chronologically as strings
  keys.sort().reverse()
  return [...keptInPlace, ...keys]
}

/** Whether auto-save is paused to protect a newer auto-save that couldn't be set aside */
export function isAutoSavePausedForNewer(): boolean {
  return keptInPlace.has(STORAGE_KEY)
}

export function readKeptNewerAutoSave(key: string): string | null {
  return localStorage.getItem(key)
}

/** Record a newer quiz that couldn't be set aside: it stays at `key`, listed and never overwritten */
export function keepNewerInPlace(key: string): void {
  keptInPlace.add(key)
}

export function discardKeptNewerAutoSave(key: string): void {
  if (keptInPlace.delete(key) || key.startsWith(KEPT_NEWER_PREFIX)) localStorage.removeItem(key)
}

export function clearStorage(): void {
  if (keptInPlace.has(STORAGE_KEY)) return
  localStorage.removeItem(STORAGE_KEY)
}

// --- Quiz records ---
//
// Every tab's quiz, and every quiz a tab no longer shows, is a record in IndexedDB, shared by the
// tabs. A tab holds a Web Lock named after the record it shows; a record no tab holds is a recent
// quiz. The browser lets a closed or crashed tab's lock go, so nothing needs writing as it closes.

/** A state of a quiz: its canonical file and the undo steps that led to it, oldest first */
export interface QuizState {
  file: string
  undo: UndoStep[]
}

/** The state a quiz was last sent to the meet in, and where it was sent */
export interface SubmittedState extends QuizState {
  meetId: number
  /** The scheduled quiz it was sent as, or null */
  quizId: string | null
  /** The meet link the quiz was sent with */
  link: MeetSessionData | null
}

/** One quiz: one undo history, and the states it keeps (data-model.md "Quiz record") */
export interface QuizRecord {
  id: string
  /** The quiz as last shown, with its redo steps; absent only for a newer version's quiz */
  current?: QuizState & { redo: UndoStep[] }
  /** The state the quiz began in, after names a link filled in before any edit by hand */
  start: string
  saved?: QuizState
  submitted?: SubmittedState
  /** While positioned behind its latest state: that latest state */
  ahead?: QuizState
  link: MeetSessionData | null
  /** The quiz came from a newer version's file and may be scored wrong */
  fromNewerFile: boolean
  /** A newer version's auto-save this version cannot read, kept as it was */
  newerRaw?: string
  /** Derived when written: the current state matches neither saved state */
  unsaved: boolean
  /** When the current state last changed, ms since the epoch */
  changedAt: number
  /** Already offered to a new tab, or replaced rather than left by a closed tab */
  offered: boolean
}

interface Meta {
  /** Names of unsaved quizzes dropped by the limits, not yet announced */
  dropped: string[]
  /** The previous version's keys were moved into records */
  migrated: boolean
}

interface RecordsSchema extends DBSchema {
  quizzes: { key: string; value: QuizRecord }
  meta: { key: keyof Meta; value: Meta[keyof Meta] }
}

const DB_NAME = 'qzr-sheet'
const LOCK_PREFIX = 'qzr-sheet:quiz:'
const lockName = (id: string) => LOCK_PREFIX + id

let connection: Promise<IDBPDatabase<RecordsSchema>> | null = null

function records(): Promise<IDBPDatabase<RecordsSchema>> {
  connection ??= openDB<RecordsSchema>(DB_NAME, 1, {
    upgrade(db) {
      db.createObjectStore('quizzes', { keyPath: 'id' })
      db.createObjectStore('meta')
    },
    // Another tab needs the database closed (a newer version, or it is being deleted)
    blocking(_current, _blocked, event) {
      ;(event.target as IDBDatabase).close()
      connection = null
    },
    terminated() {
      connection = null
    },
  })
  return connection
}

export function newRecordId(): string {
  return crypto.randomUUID()
}

export async function readRecord(id: string): Promise<QuizRecord | undefined> {
  return (await records()).get('quizzes', id)
}

/** Write a record over any with its id; false when the device refuses it for lack of room */
export async function writeRecord(record: QuizRecord): Promise<boolean> {
  try {
    await (await records()).put('quizzes', record)
    return true
  } catch (e) {
    if ((e as { name?: string } | null)?.name === 'QuotaExceededError') return false
    throw e
  }
}

export async function deleteRecord(id: string): Promise<void> {
  await (await records()).delete('quizzes', id)
}

async function heldLocks(): Promise<Set<string>> {
  const snapshot = await navigator.locks.query()
  return new Set((snapshot.held ?? []).flatMap((lock) => (lock.name ? [lock.name] : [])))
}

/**
 * Records no open tab holds. Without Web Locks the tab is taken to be the only one, so every
 * record but its own is recent.
 */
export async function listRecent(ownId?: string): Promise<QuizRecord[]> {
  const all = await (await records()).getAll('quizzes')
  if (!navigator.locks) return all.filter((r) => r.id !== ownId)
  const held = await heldLocks()
  return all.filter((r) => !held.has(lockName(r.id)))
}

/** How many tabs show a quiz, this one included */
export async function openTabCount(): Promise<number> {
  if (!navigator.locks) return 1
  return [...(await heldLocks())].filter((name) => name.startsWith(LOCK_PREFIX)).length
}

/** A record this tab holds until it lets it go */
export interface RecordClaim {
  release: () => void
}

/**
 * Hold record `id` for this tab, or null when another tab holds it. The browser grants a lock to
 * one tab only, which settles two tabs claiming the same quiz. With `wait`, wait that many ms for
 * the tab holding it to let go.
 */
export function claimRecord(id: string, { wait = 0 } = {}): Promise<RecordClaim | null> {
  if (!navigator.locks) return Promise.resolve({ release: () => {} })
  return new Promise((resolve, reject) => {
    let release!: () => void
    const held = new Promise<void>((done) => (release = done))
    const options: LockOptions =
      wait > 0 ? { signal: AbortSignal.timeout(wait) } : { ifAvailable: true }
    navigator.locks
      .request(lockName(id), options, async (lock) => {
        if (!lock) return resolve(null)
        resolve({ release })
        await held
      })
      // Not granted in time: another tab still holds it
      .catch((e: unknown) => {
        const name = (e as { name?: string } | null)?.name
        if (name === 'AbortError' || name === 'TimeoutError') resolve(null)
        else reject(e)
      })
  })
}

export async function readMeta<K extends keyof Meta>(key: K): Promise<Meta[K] | undefined> {
  return (await (await records()).get('meta', key)) as Meta[K] | undefined
}

export async function writeMeta<K extends keyof Meta>(key: K, value: Meta[K]): Promise<void> {
  await (await records()).put('meta', value, key)
}
