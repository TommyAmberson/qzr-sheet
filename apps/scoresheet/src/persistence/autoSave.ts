import {
  FILE_VERSION,
  NewerFileVersionError,
  parseQuizFile,
  quizName,
  type QuizFile,
} from '@qzr/shared'
import { type DBSchema, type IDBPDatabase, openDB } from 'idb'
import { canonicalQuizFile } from './quizFile'
import type { UndoStep } from '../composables/undoSteps'
import type { MeetSessionData } from '../composables/useMeetSession'

const STORAGE_KEY = 'qzr-sheet:current'
const KEPT_NEWER_PREFIX = 'qzr-sheet:newer-autosave:'

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

/**
 * Write a record over any with its id. When the device refuses it for lack of room, records no tab
 * holds make room: those not kept first, then saved recent quizzes, oldest first; unsaved ones
 * never do. False when there is still no room.
 */
export async function writeRecord(record: QuizRecord): Promise<boolean> {
  for (;;) {
    try {
      await (await records()).put('quizzes', record)
      return true
    } catch (e) {
      if ((e as { name?: string } | null)?.name !== 'QuotaExceededError') throw e
    }
    // Never the record being written, nor the tab's own, which a tab without Web Locks can't tell
    const left = (await unheld(record.id)).filter((r) => r.id !== record.id && r.id !== tab?.id)
    const [first] = [
      ...left.filter((r) => !isKept(r)),
      ...left.filter((r) => isKept(r) && !r.unsaved).sort(byChange),
    ]
    if (!first) return false
    // Taken by a tab meanwhile, it is held from now on, and the next pass looks past it
    await deleteRecords([first.id])
  }
}

const byChange = (a: QuizRecord, b: QuizRecord) => a.changedAt - b.changedAt

const UNSAVED_LIMIT = 80
const SAVED_LIMIT = 40

/** A state's quiz file as stored, or null when there is none or it can't be read */
export function storedQuizFile(file: string | undefined): QuizFile | null {
  if (!file) return null
  try {
    return JSON.parse(file) as QuizFile
  } catch {
    return null
  }
}

/** The quiz name a record's quiz goes by, for saying it was dropped */
function recordName(record: QuizRecord): string {
  const file = storedQuizFile(record.current?.file)
  return file ? quizName(file.quiz) : 'A quiz from a newer version'
}

/**
 * Keep the 80 most recently changed unsaved recent quizzes and the 40 saved ones, deleting the rest,
 * and remember the unsaved ones dropped so they can be named once. Quizzes in tabs don't count.
 */
export async function enforceLimits(ownId = tab?.id): Promise<void> {
  const left = await unheld(ownId)
  // A quiz with nothing done by hand was written only for its tab's reload
  const newestFirst = left.filter(isKept).sort(byChange).reverse()
  const unsaved = newestFirst.filter((r) => r.unsaved).slice(UNSAVED_LIMIT)
  const saved = newestFirst.filter((r) => !r.unsaved).slice(SAVED_LIMIT)
  const notKept = left.filter((r) => !isKept(r))
  await deleteRecords([...unsaved, ...saved, ...notKept].map((record) => record.id))
  if (unsaved.length > 0) await changeDropped((dropped) => [...dropped, ...unsaved.map(recordName)])
}

/** Unsaved quizzes dropped by the limits since last asked, which are then forgotten */
export async function takeDropped(): Promise<string[]> {
  let taken: string[] = []
  await changeDropped((dropped) => {
    taken = dropped
    return []
  })
  return taken
}

/** Change the names of dropped quizzes in one transaction, so two tabs at once lose none */
async function changeDropped(change: (dropped: string[]) => string[]): Promise<void> {
  const tx = (await records()).transaction('meta', 'readwrite')
  const dropped = ((await tx.store.get('dropped')) as string[] | undefined) ?? []
  const next = change(dropped)
  if (next.length > 0 || dropped.length > 0) await tx.store.put(next, 'dropped')
  await tx.done
}

/**
 * Delete the records no tab holds, in one transaction, each held meanwhile so another tab can't
 * take one as it goes. The ids deleted.
 */
async function deleteRecords(ids: string[]): Promise<string[]> {
  const claims = (
    await Promise.all(ids.map(async (id) => ({ id, claim: await holdRecord(id) })))
  ).flatMap(({ id, claim }) => (claim ? [{ id, claim }] : []))
  try {
    if (claims.length === 0) return []
    const tx = (await records()).transaction('quizzes', 'readwrite')
    await Promise.all([...claims.map(({ id }) => tx.store.delete(id)), tx.done])
    return claims.map(({ id }) => id)
  } finally {
    for (const { claim } of claims) claim.release()
  }
}

/** Discard a recent quiz; false when a tab took it meanwhile */
export async function discardRecent(id: string): Promise<boolean> {
  return (await deleteRecords([id])).length > 0
}

/**
 * A record as this version can show it: one whose quiz file a newer version wrote is kept as it
 * was, as that version's quiz, listed and opened with a warning rather than shown and written over
 */
export function readable(record: QuizRecord): QuizRecord {
  const file = record.current?.file
  const version = storedQuizFile(file)?.version
  if (!file || version === undefined || version <= FILE_VERSION) return record
  return { ...record, current: undefined, newerRaw: file, fromNewerFile: true, offered: true }
}

/**
 * Whether a record is kept as a recent quiz once no tab holds it: something was done by hand
 * since its start, or it was saved or submitted. A record that isn't is the tab's own, written so
 * a reload brings it back, and goes once its tab does.
 */
export function isKept(record: QuizRecord): boolean {
  if (!record.current) return true
  return Boolean(record.saved || record.submitted || !untouched(record))
}

/** Nothing done by hand since a quiz's start: no undo or redo steps, and its state as it began */
export function untouched({ current, start }: Pick<QuizRecord, 'current' | 'start'>): boolean {
  return (
    current !== undefined &&
    current.undo.length === 0 &&
    current.redo.length === 0 &&
    current.file === start
  )
}

async function heldLocks(): Promise<Set<string>> {
  const snapshot = await navigator.locks.query()
  return new Set((snapshot.held ?? []).flatMap((lock) => (lock.name ? [lock.name] : [])))
}

/**
 * Records no open tab holds. Without Web Locks the tab is taken to be the only one, so every
 * record but its own (this tab's, unless another is named) is recent.
 */
export async function listRecent(ownId = tab?.id): Promise<QuizRecord[]> {
  return (await unheld(ownId)).filter(isKept)
}

/** Every record no open tab holds, kept or not */
async function unheld(ownId = tab?.id): Promise<QuizRecord[]> {
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

/** A record this tab holds until it lets it go, as the last tab to hold it left it */
export interface RecordClaim {
  release: () => void
  /** The record, read once the lock was granted; absent when there is none */
  record?: QuizRecord
}

/**
 * Hold record `id` for this tab, or null when another tab holds it, with the record as it is once
 * held: another tab may have changed it since it was last read. With `wait`, wait that many ms for
 * the tab holding it to let go.
 */
export async function claimRecord(id: string, { wait = 0 } = {}): Promise<RecordClaim | null> {
  const hold = await holdRecord(id, { wait })
  if (!hold) return null
  try {
    return { ...hold, record: await readRecord(id) }
  } catch (e) {
    hold.release()
    throw e
  }
}

/**
 * Take record `id`'s lock for this tab, or null when another tab holds it. The browser grants a
 * lock to one tab only, which settles two tabs claiming the same quiz.
 */
function holdRecord(id: string, { wait = 0 } = {}): Promise<{ release: () => void } | null> {
  if (!navigator.locks) return Promise.resolve({ release: () => {} })
  return new Promise((resolve, reject) => {
    let release!: () => void
    const held = new Promise<void>((done) => (release = done))
    const giveUp = new AbortController()
    const timer = wait > 0 ? setTimeout(() => giveUp.abort(), wait) : undefined
    const options: LockOptions = wait > 0 ? { signal: giveUp.signal } : { ifAvailable: true }
    navigator.locks
      .request(lockName(id), options, async (lock) => {
        clearTimeout(timer)
        if (!lock) return resolve(null)
        resolve({ release })
        await held
      })
      // Not granted in time: another tab still holds it
      .catch((e: unknown) => {
        if ((e as { name?: string } | null)?.name === 'AbortError') resolve(null)
        else reject(e)
      })
  })
}

/** Which of a record's states: its current one, or the one last saved or submitted */
export type StateKind = 'current' | 'saved' | 'submitted'

/** What an Open shows: its canonical file, and for a quiz from the meet, where it came from */
export interface Opened {
  file: string
  fromMeet?: { meetId: number; quizId: string | null }
}

/** A recent quiz an Open continues, claimed by this tab, and which of its states it matched */
export interface Match {
  record: QuizRecord
  claim: RecordClaim
  state: StateKind
}

/** The state of `record` that `opened` is, if any: a submitted state only for the same meet's quiz */
function matchingState(record: QuizRecord, { file, fromMeet }: Opened): StateKind | undefined {
  if (record.current?.file === file) return 'current'
  if (record.saved?.file === file) return 'saved'
  const sent = record.submitted
  if (sent?.file === file && fromMeet?.meetId === sent.meetId && fromMeet.quizId === sent.quizId) {
    return 'submitted'
  }
  return undefined
}

/**
 * The recent quiz an Open continues: the most recently changed whose current, saved or submitted
 * state is what was opened, claimed for this tab. 'held' when every such quiz is open in another
 * tab; null when none matches, or the device's storage fails, which must not stop the Open. The
 * tab's own record, the one the Open replaces, is never a match.
 */
export async function findMatch(opened: Opened, ownId = tab?.id): Promise<Match | 'held' | null> {
  try {
    const candidates = (await (await records()).getAll('quizzes'))
      .filter((r) => r.id !== ownId && isKept(r) && matchingState(r, opened))
      .sort(byChange)
      .reverse()
    let held = false
    for (const { id } of candidates) {
      const claim = await claimRecord(id)
      if (!claim) {
        held = true
        continue
      }
      const state = claim.record && matchingState(claim.record, opened)
      if (claim.record && state) return { record: claim.record, claim, state }
      claim.release()
    }
    return held ? 'held' : null
  } catch (e) {
    console.error('Could not look among the recent quizzes', e)
    return null
  }
}

/** Delete every recent quiz; quizzes open in tabs are kept */
export async function discardAllRecent(): Promise<void> {
  await deleteRecords((await unheld()).map((record) => record.id))
}

export async function readMeta<K extends keyof Meta>(key: K): Promise<Meta[K] | undefined> {
  return (await (await records()).get('meta', key)) as Meta[K] | undefined
}

export async function writeMeta<K extends keyof Meta>(key: K, value: Meta[K]): Promise<void> {
  await (await records()).put('meta', value, key)
}

// --- The tab's own record ---

const TAB_KEY = 'qzr-sheet:quiz'
// A reload's old page may still hold the tab's lock for a moment as the new one starts
const RELOAD_WAIT_MS = 1000

/** The record this tab shows, and its lock */
export interface Tab {
  id: string
  claim: RecordClaim
  /** The record as last read or written; absent until the tab's quiz is first written */
  record?: QuizRecord
  /** The tab's meet link, written with its quiz */
  link: MeetSessionData | null
}

let tab: Tab | null = null
let linkListener: (() => void) | null = null

/** The tab's writer hears of every change to its meet link */
export function onTabLinkChange(listener: () => void): () => void {
  linkListener = listener
  return () => {
    if (linkListener === listener) linkListener = null
  }
}

/** The meet link changed: it goes with the tab's quiz, and nowhere shared */
export function setTabLink(link: MeetSessionData | null): void {
  if (!tab) return
  // A plain copy: the link is a reactive object, which IndexedDB can't store
  tab.link = link && (JSON.parse(JSON.stringify(link)) as MeetSessionData)
  linkListener?.()
}

/** This tab's record, once startTab has run */
export function currentTab(): Tab | null {
  return tab
}

/** What a tab found as it started, for the sheet to show */
export interface StartNotes {
  /** Unsaved quizzes left by closed tabs, offered to this one */
  offer: QuizRecord[]
  /** How many unsaved quizzes wait, for a tab opened by a link, which offers none */
  waiting: number
  /** Unsaved quizzes the limits dropped since they were last named */
  dropped: string[]
}

let notes: StartNotes = { offer: [], waiting: 0, dropped: [] }

export function startNotes(): StartNotes {
  return notes
}

/**
 * Start the tab, before the sheet mounts: move the previous version's keys once, then take the
 * tab's own record (a reload or restored session), copy it (a duplicated tab, whose original still
 * holds it), or begin a new one. A new tab also looks for unsaved quizzes left by closed tabs,
 * each offered once: one, with no other tab open, comes back by itself.
 */
export async function startTab({ byLink = false } = {}): Promise<Tab> {
  try {
    return await startOwnTab(byLink)
  } catch (e) {
    storageFailed = true
    throw e
  }
}

let storageFailed = false

/** The tab could not be started on the device's storage, so nothing it shows is kept */
export function storageFailedAtStart(): boolean {
  return storageFailed
}

async function startOwnTab(byLink: boolean): Promise<Tab> {
  notes = { offer: [], waiting: 0, dropped: [] }
  const migratedId = await migrate()
  const ownId = sessionStorage.getItem(TAB_KEY) ?? migratedId
  tab = ownId ? await takeBack(ownId) : await begin(newRecordId())
  await enforceLimits()
  if (!ownId) {
    await lookForLeftBehind(tab, byLink)
    notes.dropped = await takeDropped()
  }
  sessionStorage.setItem(TAB_KEY, tab.id)
  return tab
}

async function lookForLeftBehind(newTab: Tab, byLink: boolean): Promise<void> {
  const waiting = (await listRecent(newTab.id))
    .map(readable)
    .filter((r) => r.current && r.unsaved && !r.offered)
  if (byLink) {
    notes.waiting = waiting.length
    return
  }
  const [only] = waiting
  if (only && waiting.length === 1 && (await openTabCount()) === 1) {
    const claim = await claimRecord(only.id)
    const record = claim?.record
    if (claim && record?.current) {
      return moveTab(newTab, { id: only.id, claim, record }, Promise.resolve())
    }
    claim?.release()
  }
  notes.offer = waiting
  await markOffered(waiting.map((record) => record.id))
}

/** Mark records offered, each read and written in one transaction, so a newer write stays */
async function markOffered(ids: string[]): Promise<void> {
  const tx = (await records()).transaction('quizzes', 'readwrite')
  for (const id of ids) {
    const record = await tx.store.get(id)
    if (record) await tx.store.put({ ...record, offered: true })
  }
  await tx.done
}

/**
 * The tab's quiz is replaced: its record becomes a recent quiz, once `written` (the tab's writes to
 * it) has settled, and the tab shows `to`, a record it has claimed, or else begins a new one. A new
 * one has a fresh id no other tab can hold, so the tab writes to it at once and takes its lock on
 * the way.
 */
export function moveTab(
  tab: Tab,
  to: { id: string; claim: RecordClaim; record: QuizRecord } | undefined,
  written: Promise<unknown>,
): void {
  const left = tab.claim
  // Another tab may take the record left only as this one last wrote it
  void written.then(() => {
    left.release()
    // The record it leaves may push the oldest of its kind out
    enforceLimits().catch((e: unknown) => console.error('Could not trim recent quizzes', e))
  })
  if (to) {
    Object.assign(tab, held(to.id, to.claim, to.record))
    sessionStorage.setItem(TAB_KEY, to.id)
    return
  }
  const id = newRecordId()
  Object.assign(tab, { id, record: undefined, claim: { release: () => {} } })
  sessionStorage.setItem(TAB_KEY, id)
  claimRecord(id).then(
    (claim) => {
      if (claim && tab.id === id) tab.claim = claim
      else claim?.release()
    },
    (e: unknown) => console.error('Could not hold the new quiz', e),
  )
}

async function begin(id: string, record?: QuizRecord): Promise<Tab> {
  // A fresh id no other tab can hold
  const claim = (await claimRecord(id))!
  return held(id, claim, record)
}

function held(id: string, claim: RecordClaim, record?: QuizRecord): Tab {
  return { id, claim, record, link: record?.link ?? null }
}

async function takeBack(id: string): Promise<Tab> {
  const claim = await claimRecord(id, { wait: RELOAD_WAIT_MS })
  if (claim) {
    const record = claim.record && readable(claim.record)
    if (record === claim.record) return held(id, claim, record)
    // A newer version's quiz is kept as it was, and the tab begins a quiz of its own
    await writeRecord(record!)
    claim.release()
    return begin(newRecordId())
  }
  const record = await readRecord(id)
  // Still held: this tab is a copy of the one holding it, and from now on keeps its own, which a
  // new tab offers once this one closes like any other
  if (!record || readable(record) !== record) return begin(newRecordId())
  const copy: QuizRecord = { ...record, id: newRecordId(), offered: false }
  // Held before it is written, so no other tab takes it as a quiz left behind
  const copied = await begin(copy.id, copy)
  await writeRecord(copy)
  return copied
}

// --- Moving from the previous version ---

/** A meet link as kept by an earlier version, with the fields added since filled in */
function upToDateSession(data: MeetSessionData): MeetSessionData {
  if (!data.meetDivisions) data.meetDivisions = []
  if (data.quizId === undefined) data.quizId = null
  // Quiz ids were numbers before schedules became documents; converted meets kept them as strings
  if (typeof data.quizId === 'number') data.quizId = String(data.quizId)
  if (data.sender === undefined) data.sender = null
  if (data.scheduledQuiz === undefined) data.scheduledQuiz = null
  return data
}

const OLD_KEYS = {
  quiz: STORAGE_KEY,
  meetSession: 'qzr-meet-session',
  fromNewerFile: 'qzr-sheet:opened-from-newer-file',
  tutorialQuiz: 'qzr-sheet:tutorial-snapshot',
  tutorialMeetSession: 'qzr-sheet:tutorial-meet-snapshot',
  tutorialFromNewerFile: 'qzr-sheet:tutorial-from-newer-file',
}

/**
 * Move the previous version's quiz, meet link and set-aside newer quizzes into records, once, with
 * other tabs kept out meanwhile. Returns the id of the record made from the quiz on the sheet,
 * which becomes the starting tab's.
 */
async function migrate(): Promise<string | undefined> {
  if (await readMeta('migrated')) return undefined
  if (!navigator.locks) return moveOldKeys()
  return navigator.locks.request('qzr-sheet:migrate', async () =>
    (await readMeta('migrated')) ? undefined : moveOldKeys(),
  )
}

async function moveOldKeys(): Promise<string | undefined> {
  const moved: string[] = []
  let failed = false
  const keep = async (record: QuizRecord, keys: string[]) => {
    if (await writeRecord(record)) moved.push(...keys)
    else failed = true
  }

  const sheetKeys = [OLD_KEYS.quiz, OLD_KEYS.meetSession, OLD_KEYS.fromNewerFile]
  const tutorialKeys = [
    OLD_KEYS.tutorialQuiz,
    OLD_KEYS.tutorialMeetSession,
    OLD_KEYS.tutorialFromNewerFile,
  ]
  /** The quiz kept under `keys` as a record; the record, unless there was none to keep */
  const moveQuiz = async (names: string[]) => {
    const [quizKey, meetKey, newerKey] = names
    const raw = localStorage.getItem(quizKey!)
    const meetRaw = localStorage.getItem(meetKey!)
    let link: MeetSessionData | null = null
    try {
      link = meetRaw ? upToDateSession(JSON.parse(meetRaw) as MeetSessionData) : null
    } catch {
      // An unreadable link is left behind, as the meet session's own load did
    }
    const record = raw ? oldQuizRecord(raw, link, localStorage.getItem(newerKey!) === '1') : null
    if (record) await keep(record, names)
    else moved.push(...names)
    return { record, link }
  }

  // A tutorial that crashed left the quiz it replaced aside, and the sheet holds its practice
  // quiz; unless the quiz set aside was a newer version's, kept where it was, and the sheet has
  // been scored on since: then both are kept
  let sheetId: string | undefined
  let link: MeetSessionData | null = null
  const fromTutorial = localStorage.getItem(OLD_KEYS.tutorialQuiz) !== null
  if (fromTutorial) {
    const aside = await moveQuiz(tutorialKeys)
    link = aside.link
    if (aside.record && !aside.record.newerRaw && !failed) sheetId = aside.record.id
    if (aside.record?.newerRaw) {
      const sheet = await moveQuiz(sheetKeys)
      if (sheet.record && !sheet.record.newerRaw && !failed) sheetId = sheet.record.id
    } else moved.push(...sheetKeys)
  } else {
    const sheet = await moveQuiz(sheetKeys)
    link = sheet.link
    if (sheet.record && !sheet.record.newerRaw && !failed) sheetId = sheet.record.id
    moved.push(...tutorialKeys)
  }

  for (const key of listOldNewerKeys()) {
    const kept = localStorage.getItem(key)
    if (kept === null) continue
    const at = Date.parse(key.slice(KEPT_NEWER_PREFIX.length))
    await keep(newerRecord(kept, link, Number.isNaN(at) ? Date.now() : at), [key])
  }

  for (const key of moved) localStorage.removeItem(key)
  if (!failed) await writeMeta('migrated', true)
  return sheetId
}

function listOldNewerKeys(): string[] {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith(KEPT_NEWER_PREFIX)) keys.push(key)
  }
  return keys
}

/** The previous version's quiz as a record, or null when it can't be read at all */
function oldQuizRecord(
  raw: string,
  link: MeetSessionData | null,
  fromNewerFile: boolean,
): QuizRecord | null {
  try {
    const file = canonicalQuizFile(parseQuizFile(raw))
    return {
      id: newRecordId(),
      current: { file, undo: [], redo: [] },
      // Begun before this version: never its start, so it is kept even if left untouched
      start: '',
      link,
      fromNewerFile,
      unsaved: true,
      changedAt: Date.now(),
      offered: false,
    }
  } catch (e) {
    if (e instanceof NewerFileVersionError) return newerRecord(raw, link, Date.now())
    return null
  }
}

/** A newer version's quiz this version cannot read: listed, and kept as it was until discarded */
function newerRecord(raw: string, link: MeetSessionData | null, changedAt: number): QuizRecord {
  return {
    id: newRecordId(),
    start: '',
    link,
    fromNewerFile: true,
    newerRaw: raw,
    unsaved: true,
    changedAt,
    // Listed, never offered: restoring one warns it may be scored wrong
    offered: true,
  }
}
