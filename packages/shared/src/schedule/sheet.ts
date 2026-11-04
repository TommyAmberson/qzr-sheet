import { ordinal, quizNumber } from './names'
import { eventRooms } from './frame'
import type { FrameRow, ScheduleDocument, ScheduleEvent, ScheduleQuiz, Seat } from './scheduleFile'

/** Letters, or the drawn team's name where the division has a draw (FR-043) */
export type SheetView = 'letters' | 'teams'

/** "8:00 PM" for minutes after midnight */
export function formatClock(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24
  const m = minutes % 60
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

/** What a seat shows: a letter or team, a rank, `New 10`, `2 of A`, `1st in pts` (FR-035) */
export function seatText(
  doc: ScheduleDocument,
  quiz: ScheduleQuiz,
  seat: Seat,
  view: SheetView,
): string {
  switch (seat.kind) {
    case 'letter': {
      if (view === 'letters') return seat.letter
      const teams = doc.draw[quiz.division]?.teams ?? []
      const index = teams.findIndex((t) => t.letter === seat.letter)
      // An unnamed team goes by its place in the list, as the Teams section shows it
      if (index < 0) return seat.letter
      return teams[index]!.name ?? `Team ${index + 1}`
    }
    case 'rank':
      return String(seat.rank)
    case 'new':
      return `New ${seat.rank}`
    case 'place': {
      const source = doc.quizzes.find((q) => q.id === seat.quiz)
      return `${seat.place} of ${source ? quizNumber(source) : '?'}`
    }
    case 'points':
      return `${ordinal(seat.place)} in pts`
    case 'empty':
      return 'Choose…'
  }
}

/** A cell of a slot: a room's quiz, an event over one or more adjacent rooms, or an empty room */
export type SheetCell =
  | { kind: 'quiz'; room: string; quiz: ScheduleQuiz }
  | { kind: 'event'; rooms: string[]; event: ScheduleEvent }
  | { kind: 'empty'; room: string }

/** One row of the printed sheet */
export type SheetRow =
  | { kind: 'day'; row: Extract<FrameRow, { kind: 'day' }> }
  | { kind: 'note'; row: Extract<FrameRow, { kind: 'note' }> }
  | {
      kind: 'slot'
      row: Extract<FrameRow, { kind: 'slot' }>
      /** Its cells in room order, an event's adjacent rooms merged into one */
      cells: SheetCell[]
      /** No quizzes and every room taken by events: drawn as a short event row (FR-017) */
      short: boolean
    }

/**
 * The grid as rows (FR-017). A slot's quiz takes its room even under an event, where it's marked
 * (H-3); an event's rooms next to each other are one cell, and rooms apart are separate cells.
 */
export function sheetRows(doc: ScheduleDocument): SheetRow[] {
  const byCell = new Map(
    doc.quizzes.flatMap((q) => (q.cell ? [[`${q.cell.slot}|${q.cell.room}`, q] as const] : [])),
  )
  const roomIds = doc.rooms.map((r) => r.id)
  const eventsIn = new Map<string, ScheduleEvent[]>()
  for (const e of doc.events) {
    if (e.slot) eventsIn.set(e.slot, [...(eventsIn.get(e.slot) ?? []), e])
  }
  return doc.frame.map((row): SheetRow => {
    if (row.kind === 'day') return { kind: 'day', row }
    if (row.kind === 'note') return { kind: 'note', row }
    const events = eventsIn.get(row.id) ?? []
    const cells: SheetCell[] = []
    for (const room of roomIds) {
      const quiz = byCell.get(`${row.id}|${room}`)
      const event = events.find((e) => eventRooms(e, roomIds).includes(room))
      const last = cells[cells.length - 1]
      if (quiz) cells.push({ kind: 'quiz', room, quiz })
      else if (!event) cells.push({ kind: 'empty', room })
      else if (last?.kind === 'event' && last.event.id === event.id) last.rooms.push(room)
      else cells.push({ kind: 'event', rooms: [room], event })
    }
    const short = cells.length > 0 && cells.every((c) => c.kind === 'event')
    return { kind: 'slot', row, cells, short }
  })
}

/** The divisions that use a room, Finals aside (FR-019) */
export function roomDivisions(doc: ScheduleDocument, room: string): string[] {
  const ids = new Set(
    doc.quizzes
      .filter((q) => q.cell?.room === room && !(q.deciding && q.label.endsWith('Finals')))
      .map((q) => q.division),
  )
  return doc.settings.divisions.filter((d) => ids.has(d.id)).map((d) => d.name)
}

/**
 * Each division's stats break: from the end of its last prelim to the start of its first elim, in
 * minutes after midnight, or null while it has no placed prelims or elims (FR-020)
 */
export function statsBreaks(
  doc: ScheduleDocument,
): { division: string; from: number; to: number }[] {
  const slots = new Map(doc.frame.flatMap((r) => (r.kind === 'slot' ? [[r.id, r] as const] : [])))
  const order = new Map([...slots.keys()].map((id, i) => [id, i]))
  return doc.settings.divisions.flatMap((d) => {
    const placed = (phase: 'prelim' | 'elim') =>
      doc.quizzes
        .filter((q) => q.division === d.id && q.phase === phase && q.cell && slots.has(q.cell.slot))
        .map((q) => slots.get(q.cell!.slot)!)
        .sort((a, b) => order.get(a.id)! - order.get(b.id)!)
    const prelims = placed('prelim')
    const elims = placed('elim')
    const last = prelims[prelims.length - 1]
    const first = elims[0]
    if (!last || !first) return []
    return [{ division: d.name, from: last.at + last.minutes, to: first.at }]
  })
}

/**
 * The basic schedule: event rows as they are, and each run of quiz slots collapsed into one
 * "Quizzing" row from its first start to its last end (FR-044). A slot made for events that has
 * none left is skipped.
 */
export function basicRows(
  doc: ScheduleDocument,
): { kind: 'day' | 'event' | 'quizzing'; label: string; from?: number; to?: number }[] {
  const rows: { kind: 'day' | 'event' | 'quizzing'; label: string; from?: number; to?: number }[] =
    []
  for (const r of sheetRows(doc)) {
    if (r.kind === 'day') rows.push({ kind: 'day', label: r.row.label })
    if (r.kind !== 'slot') continue
    const { at, minutes, use } = r.row
    if (r.short) {
      const labels = [...new Set(r.cells.map((c) => (c.kind === 'event' ? c.event.label : '')))]
      rows.push({ kind: 'event', label: labels.join(' · '), from: at, to: at + minutes })
      continue
    }
    if (use === 'event' && r.cells.every((c) => c.kind !== 'quiz')) continue
    const last = rows[rows.length - 1]
    if (last?.kind === 'quizzing') last.to = at + minutes
    else rows.push({ kind: 'quizzing', label: 'Quizzing', from: at, to: at + minutes })
  }
  return rows
}
