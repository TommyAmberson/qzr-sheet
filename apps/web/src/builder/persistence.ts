import { parseScheduleFile, serializeSchedule, type ScheduleDocument } from '@qzr/shared'

/**
 * Where the builder keeps schedules: one key per schedule plus an index, in this browser, and
 * schedule files saved and opened the way the scoresheet does it in a browser (research R4).
 * Every save goes through here.
 */

const INDEX_KEY = 'qzr-schedules'
const scheduleKey = (id: string) => `qzr-schedule:${id}`

export interface KeptSchedule {
  id: string
  name: string
  savedAt: string
  /** A meet's linked draft, which its meet page edits, kept here only for reloads */
  linked?: boolean
}

function readIndex(): KeptSchedule[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY)
    return raw ? (JSON.parse(raw) as KeptSchedule[]) : []
  } catch {
    return []
  }
}

function writeIndex(index: KeptSchedule[]) {
  localStorage.setItem(INDEX_KEY, JSON.stringify(index))
}

/** The schedules kept in this browser, most recently saved first (FR-002) */
export function listSchedules(): KeptSchedule[] {
  return readIndex().sort((a, b) => b.savedAt.localeCompare(a.savedAt))
}

/** Keep a schedule in this browser; called on every change */
export function keepSchedule(doc: ScheduleDocument): boolean {
  try {
    localStorage.setItem(scheduleKey(doc.id), serializeSchedule(doc))
    const index = readIndex().filter((s) => s.id !== doc.id)
    index.push({
      id: doc.id,
      name: doc.name,
      savedAt: new Date().toISOString(),
      ...(doc.link ? { linked: true } : {}),
    })
    writeIndex(index)
    return true
  } catch {
    // Storage full or unavailable; the builder says so rather than failing
    return false
  }
}

/** A kept schedule, or null when it isn't in this browser (any more) */
export function loadSchedule(id: string): ScheduleDocument | null {
  try {
    const raw = localStorage.getItem(scheduleKey(id))
    return raw ? parseScheduleFile(raw) : null
  } catch {
    return null
  }
}

export function forgetSchedule(id: string) {
  try {
    localStorage.removeItem(scheduleKey(id))
    writeIndex(readIndex().filter((s) => s.id !== id))
  } catch {
    // Storage unavailable: there's nothing kept to forget
  }
}

export function renameSchedule(id: string, name: string) {
  const doc = loadSchedule(id)
  if (doc) keepSchedule({ ...doc, name })
}

/** A copy under a new id and name */
export function duplicateSchedule(id: string): ScheduleDocument | null {
  const doc = loadSchedule(id)
  if (!doc) return null
  const copy = { ...structuredClone(doc), id: crypto.randomUUID(), name: `${doc.name} (copy)` }
  delete copy.link
  keepSchedule(copy)
  return copy
}

interface WindowWithFilePicker extends Window {
  showSaveFilePicker(options?: {
    suggestedName?: string
    types?: { description: string; accept: Record<string, string[]> }[]
  }): Promise<{
    name: string
    createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>
  }>
}

/**
 * Save to a `.qzrschedule.json` file: the save picker where the browser has one, else a download.
 * Says which file it went to, or null when the picker was cancelled.
 */
export async function saveScheduleFile(
  doc: ScheduleDocument,
): Promise<{ name: string; downloaded: boolean } | null> {
  const json = serializeSchedule(doc)
  const name = `${doc.name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'schedule'}.qzrschedule.json`
  if ('showSaveFilePicker' in window) {
    try {
      const handle = await (window as WindowWithFilePicker).showSaveFilePicker({
        suggestedName: name,
        types: [{ description: 'Schedule', accept: { 'application/json': ['.json'] } }],
      })
      const writable = await handle.createWritable()
      await writable.write(json)
      await writable.close()
      return { name: handle.name, downloaded: false }
    } catch (e) {
      // Cancelling the picker isn't an error; a write that failed is
      if (e instanceof DOMException && e.name === 'AbortError') return null
      throw e
    }
  }
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  // Some browsers start the download after the click returns, so the URL stays a while
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return { name, downloaded: true }
}

/**
 * Read a schedule file the director picked. Throws with the reason for a newer or invalid file,
 * and leaves what's open untouched (FR-003).
 */
export async function readScheduleFile(file: File): Promise<ScheduleDocument> {
  return parseScheduleFile(await file.text())
}
