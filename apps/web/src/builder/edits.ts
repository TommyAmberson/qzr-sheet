import type { FrameRow, ScheduleDocument, ScheduleEvent, ScheduleQuiz, Seat } from '@qzr/shared'

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
  for (const e of d.events) e.pinned = false
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

// ---- Events, which sit in a slot's rooms like quizzes (FR-017) ----

function event(d: ScheduleDocument, id: string): ScheduleEvent {
  const e = d.events.find((x) => x.id === id)
  if (!e) throw new Error(`No event ${id}`)
  return e
}

/**
 * Events of the same name in one slot are one event (FR-017): the first takes the others' rooms,
 * or all rooms once it has every one, and the others go
 */
function mergeSameNamed(d: ScheduleDocument, slot: string | null) {
  if (!slot) return
  const all = d.rooms.map((r) => r.id)
  const byLabel = new Map<string, ScheduleEvent>()
  d.events = d.events.filter((e) => {
    if (e.slot !== slot) return true
    const first = byLabel.get(e.label)
    if (!first) {
      byLabel.set(e.label, e)
      return true
    }
    if (first.rooms !== 'all') {
      const rooms = e.rooms === 'all' ? all : [...new Set([...first.rooms, ...e.rooms])]
      first.rooms = all.every((r) => rooms.includes(r)) ? 'all' : rooms
    }
    first.pinned = true
    return false
  })
}

/** The event a new one became: itself, or the one of its name it joined in its slot */
function joined(d: ScheduleDocument, added: ScheduleEvent): string {
  const kept = d.events.find((e) => e.id === added.id)
  if (kept) return kept.id
  return d.events.find((e) => e.slot === added.slot && e.label === added.label)!.id
}

/** Add an event in one room's cell, pinned */
export function addEvent(d: ScheduleDocument, cell: { slot: string; room: string }): string {
  const added: ScheduleEvent = {
    id: crypto.randomUUID(),
    label: 'Event',
    slot: cell.slot,
    rooms: [cell.room],
    pinned: true,
  }
  d.events.push(added)
  mergeSameNamed(d, cell.slot)
  return joined(d, added)
}

/**
 * Move an event to a cell, or to the unplaced tray with null. Its rooms shift so the first lands
 * in the cell's room, keeping their spacing as far as the rooms go; an event in all rooms stays so.
 */
export function moveEvent(d: ScheduleDocument, id: string, cell: Cell) {
  const e = event(d, id)
  e.pinned = true
  if (!cell) {
    e.slot = null
    return
  }
  e.slot = cell.slot
  if (e.rooms === 'all') return
  const order = d.rooms.map((r) => r.id)
  const at = e.rooms.map((r) => order.indexOf(r)).filter((i) => i >= 0)
  const by = order.indexOf(cell.room) - Math.min(...at)
  const moved = [...new Set(at.map((i) => order[i + by]).filter((r): r is string => !!r))]
  e.rooms = moved.length > 0 ? moved : [cell.room]
  mergeSameNamed(d, e.slot)
}

export function editEvent(
  d: ScheduleDocument,
  id: string,
  patch: Partial<Pick<ScheduleEvent, 'label' | 'rooms'>>,
) {
  const e = event(d, id)
  Object.assign(e, patch, { pinned: true })
  mergeSameNamed(d, e.slot)
}

export function setEventPinned(d: ScheduleDocument, id: string, pinned: boolean) {
  event(d, id).pinned = pinned
}

export function deleteEvent(d: ScheduleDocument, id: string) {
  d.events = d.events.filter((e) => e.id !== id)
}

/** A quiz turned into an event in its cell, named for the quiz */
export function quizToEvent(d: ScheduleDocument, id: string): string {
  const q = quiz(d, id)
  const added: ScheduleEvent = {
    id: crypto.randomUUID(),
    label: 'Event',
    slot: q.cell?.slot ?? null,
    rooms: q.cell ? [q.cell.room] : [],
    pinned: true,
  }
  d.events.push(added)
  deleteQuiz(d, id)
  mergeSameNamed(d, added.slot)
  return joined(d, added)
}

/** An event turned into a quiz in the first room it takes */
export function eventToQuiz(d: ScheduleDocument, id: string): string {
  const e = event(d, id)
  const room = e.rooms === 'all' ? d.rooms[0]?.id : d.rooms.find((r) => e.rooms.includes(r.id))?.id
  const quizId = addQuiz(d, { slot: e.slot ?? '', room: room ?? d.rooms[0]?.id ?? '' })
  if (!e.slot || !room) quiz(d, quizId).cell = null
  deleteEvent(d, id)
  return quizId
}

/** A slot for events inserted after a row, holding one event across every room */
export function insertEvent(
  d: ScheduleDocument,
  after: string,
  time: { at: number; minutes: number },
): string {
  const slot = crypto.randomUUID()
  insertRow(d, after, { kind: 'slot', id: slot, ...time, use: 'event' })
  const id = crypto.randomUUID()
  d.events.push({ id, label: 'Event', slot, rooms: 'all', pinned: true })
  return id
}

/**
 * Keep a day's rows from overlapping (FR-016): its slots in time order, each note staying under
 * the slot before it, and any slot that starts before the one above ends moved down just enough.
 * Gaps between rows are left as they are.
 */
function settleDay(d: ScheduleDocument, id: string) {
  const i = d.frame.findIndex((r) => r.id === id)
  if (i < 0) return
  let start = i
  while (start > 0 && d.frame[start - 1]!.kind !== 'day') start--
  let end = i + 1
  while (end < d.frame.length && d.frame[end]!.kind !== 'day') end++
  // A slot with the notes under it moves as one; notes before the first slot stay first
  const groups: FrameRow[][] = []
  for (const row of d.frame.slice(start, end)) {
    if (row.kind === 'slot' || groups.length === 0) groups.push([row])
    else groups[groups.length - 1]!.push(row)
  }
  const at = (g: FrameRow[]) => (g[0]!.kind === 'slot' ? g[0]!.at : -1)
  groups.sort((a, b) => at(a) - at(b))
  let free = 0
  for (const group of groups) {
    const row = group[0]!
    if (row.kind !== 'slot') continue
    if (row.at < free) {
      row.at = free
      row.pinned = true
    }
    free = row.at + row.minutes
  }
  d.frame.splice(start, end - start, ...groups.flat())
}

/** Insert a row after another (or first), pinned; rows after it on its day move down to fit */
export function insertRow(d: ScheduleDocument, after: string | null, row: FrameRow) {
  const at = after === null ? 0 : d.frame.findIndex((r) => r.id === after) + 1
  d.frame.splice(at, 0, { ...row, pinned: true })
  settleDay(d, row.id)
}

/** Change a row; a retimed or longer slot takes its place in time, and rows after it move down */
export function editRow(d: ScheduleDocument, id: string, patch: Partial<FrameRow>) {
  const i = d.frame.findIndex((r) => r.id === id)
  if (i < 0) return
  d.frame[i] = { ...d.frame[i]!, ...patch, pinned: true } as FrameRow
  settleDay(d, id)
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
  for (const e of d.events) if (e.slot && gone.has(e.slot)) e.slot = null
  const first = d.frame[0]
  if (first) first.pinned = true
}

/** Delete a row; a slot's quizzes and events go to the unplaced tray */
export function deleteRow(d: ScheduleDocument, id: string) {
  d.frame = d.frame.filter((r) => r.id !== id)
  for (const q of d.quizzes) if (q.cell?.slot === id) q.cell = null
  for (const e of d.events) if (e.slot === id) e.slot = null
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

/** Remove a room; its quizzes go to the unplaced tray, and an event left with no room too */
export function removeRoom(d: ScheduleDocument, id: string) {
  // A schedule keeps at least one room
  if (d.rooms.length <= 1) return
  d.rooms = d.rooms.filter((r) => r.id !== id)
  for (const q of d.quizzes) if (q.cell?.room === id) q.cell = null
  for (const e of d.events) {
    if (e.rooms === 'all' || !e.rooms.includes(id)) continue
    e.rooms = e.rooms.filter((r) => r !== id)
    if (e.rooms.length === 0) e.slot = null
  }
  setRoomCount(d)
}
