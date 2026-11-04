import type { FrameRow, ScheduleDocument, ScheduleQuiz, Seat } from '@qzr/shared'

/**
 * Hand edits to a schedule, each a change to a draft document for `change` to record. Anything an
 * edit touches is pinned (FR-011), and nothing is refused: a broken rule is marked by the conflict
 * check (FR-035a).
 */

type Cell = ScheduleQuiz['cell']

function quiz(d: ScheduleDocument, id: string): ScheduleQuiz {
  const q = d.quizzes.find((x) => x.id === id)
  if (!q) throw new Error(`No quiz ${id}`)
  return q
}

/** Move a quiz to a cell, or to the unplaced tray with null; a quiz already there swaps back */
export function moveQuiz(d: ScheduleDocument, id: string, cell: Cell) {
  const q = quiz(d, id)
  const other = cell
    ? d.quizzes.find((x) => x !== q && x.cell?.slot === cell.slot && x.cell.room === cell.room)
    : undefined
  if (other) {
    other.cell = q.cell
    other.pinned = true
  }
  q.cell = cell
  q.pinned = true
}

export function swapSeats(d: ScheduleDocument, a: string, ia: number, b: string, ib: number) {
  const qa = quiz(d, a)
  const qb = quiz(d, b)
  const seat = qa.seats[ia]!
  qa.seats[ia] = qb.seats[ib]!
  qb.seats[ib] = seat
  qa.pinned = qb.pinned = true
}

export function setSeat(d: ScheduleDocument, id: string, index: number, seat: Seat) {
  const q = quiz(d, id)
  q.seats[index] = seat
  q.pinned = true
}

/** Renaming keeps every seat that refers to the quiz, since seats name quizzes by id (FR-035c) */
export function renameQuiz(d: ScheduleDocument, id: string, label: string) {
  const q = quiz(d, id)
  q.label = label
  q.pinned = true
}

export function setPinned(d: ScheduleDocument, id: string, pinned: boolean) {
  quiz(d, id).pinned = pinned
}

/**
 * Pin or unpin every quiz `pick` chooses: a room's column, a slot's row, a division (FR-011).
 * Unpinned quizzes go back to the generator at the next re-flow.
 */
export function pinWhere(
  d: ScheduleDocument,
  pick: (q: ScheduleDocument['quizzes'][number]) => boolean,
  pinned: boolean,
) {
  for (const q of d.quizzes) if (pick(q)) q.pinned = pinned
}

/** Unpin every quiz and row, so the next re-flow regenerates the whole grid around nothing */
export function unpinAll(d: ScheduleDocument) {
  for (const q of d.quizzes) q.pinned = false
  for (const r of d.frame) delete r.pinned
}

/**
 * Add a quiz by hand to an empty cell (FR-035a), pinned, with three empty seats. It takes the
 * division that already uses the room most and the next free quiz number, both changeable after.
 */
export function addQuiz(d: ScheduleDocument, cell: { slot: string; room: string }): string {
  const uses = new Map<string, number>()
  for (const q of d.quizzes) {
    if (q.cell?.room === cell.room) uses.set(q.division, (uses.get(q.division) ?? 0) + 1)
  }
  const division =
    [...uses].sort((a, b) => b[1] - a[1])[0]?.[0] ?? d.settings.divisions[0]?.id ?? ''
  const name = d.settings.divisions.find((x) => x.id === division)?.name ?? 'Quiz'
  const labels = new Set(d.quizzes.map((q) => q.label))
  let n = 1
  while (labels.has(`${name} Quiz ${n}`)) n++
  const id = crypto.randomUUID()
  d.quizzes.push({
    id,
    label: `${name} Quiz ${n}`,
    division,
    phase: 'elim',
    cell,
    seats: [{ kind: 'empty' }, { kind: 'empty' }, { kind: 'empty' }],
    pinned: true,
  })
  return id
}

export function deleteQuiz(d: ScheduleDocument, id: string) {
  d.quizzes = d.quizzes.filter((q) => q.id !== id)
}

/** Insert a row after another (or first), pinned; later times are left as they are */
export function insertRow(d: ScheduleDocument, after: string | null, row: FrameRow) {
  const at = after === null ? 0 : d.frame.findIndex((r) => r.id === after) + 1
  d.frame.splice(at, 0, { ...row, pinned: true })
}

export function editRow(d: ScheduleDocument, id: string, patch: Partial<FrameRow>) {
  const i = d.frame.findIndex((r) => r.id === id)
  if (i < 0) return
  d.frame[i] = { ...d.frame[i]!, ...patch, pinned: true } as FrameRow
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** The rows of a day: its heading and everything up to the next day */
function dayRows(d: ScheduleDocument, id: string) {
  const start = d.frame.findIndex((r) => r.id === id)
  let end = start + 1
  while (end < d.frame.length && d.frame[end]!.kind !== 'day') end++
  return { start, end }
}

/** Add a day after another, named for the weekday after it, empty until rows are inserted */
export function insertDay(d: ScheduleDocument, after: string) {
  const { end } = dayRows(d, after)
  const before = d.frame.find((r) => r.id === after)
  const weekday = before?.kind === 'day' ? WEEKDAYS.indexOf(before.label) : -1
  const label = weekday >= 0 ? WEEKDAYS[(weekday + 1) % 7]! : 'New day'
  d.frame.splice(end, 0, { kind: 'day', id: crypto.randomUUID(), label, pinned: true })
}

/** Add a day after the last one */
export function addDay(d: ScheduleDocument) {
  const days = d.frame.filter((r) => r.kind === 'day')
  const last = days[days.length - 1]
  if (last) return insertDay(d, last.id)
  d.frame.unshift({ kind: 'day', id: crypto.randomUUID(), label: 'New day', pinned: true })
}

/** Delete a whole day: its heading and rows go, and its quizzes to the unplaced tray */
export function deleteDay(d: ScheduleDocument, id: string) {
  const { start, end } = dayRows(d, id)
  const gone = new Set(d.frame.slice(start, end).map((r) => r.id))
  d.frame.splice(start, end - start)
  for (const q of d.quizzes) if (q.cell && gone.has(q.cell.slot)) q.cell = null
  const first = d.frame[0]
  if (first) first.pinned = true
}

/** Delete a row; a slot's quizzes go to the unplaced tray */
export function deleteRow(d: ScheduleDocument, id: string) {
  d.frame = d.frame.filter((r) => r.id !== id)
  for (const q of d.quizzes) if (q.cell?.slot === id) q.cell = null
  // A deleted row is a hand edit to the frame, so re-flow keeps the frame as it now is
  const first = d.frame[0]
  if (first) first.pinned = true
}

/** Rooms changed on the grid apply at once, as every hand edit does */
function setRoomCount(d: ScheduleDocument) {
  d.settings.rooms = d.rooms.length
  d.applied.rooms = d.rooms.length
}

export function addRoom(d: ScheduleDocument) {
  const n = d.rooms.length + 1
  let id = `room-${n}`
  for (let k = n; d.rooms.some((r) => r.id === id); k++) id = `room-${k + 1}`
  d.rooms.push({ id, name: `Room ${n}` })
  setRoomCount(d)
}

export function renameRoom(d: ScheduleDocument, id: string, name: string) {
  const room = d.rooms.find((r) => r.id === id)
  if (room) room.name = name
}

/** Remove a room; its quizzes go to the unplaced tray */
export function removeRoom(d: ScheduleDocument, id: string) {
  // A schedule keeps at least one room
  if (d.rooms.length <= 1) return
  d.rooms = d.rooms.filter((r) => r.id !== id)
  for (const q of d.quizzes) if (q.cell?.room === id) q.cell = null
  setRoomCount(d)
}
