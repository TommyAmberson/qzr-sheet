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
