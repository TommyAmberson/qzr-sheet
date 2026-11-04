import { ordinal, quizNumber } from './names'
import type { FrameRow, ScheduleDocument, ScheduleQuiz, Seat } from './scheduleFile'

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

/** One row of the printed sheet */
export type SheetRow =
  | { kind: 'day'; row: Extract<FrameRow, { kind: 'day' }> }
  | { kind: 'note'; row: Extract<FrameRow, { kind: 'note' }> }
  | { kind: 'event'; row: Extract<FrameRow, { kind: 'event' }> }
  | {
      kind: 'slot'
      row: Extract<FrameRow, { kind: 'slot' }>
      /** Per room, in room order: its quiz, the one-room event taking it, or nothing */
      cells: {
        room: string
        quiz: ScheduleQuiz | null
        event: string | null
        /** The one-room event's row, to open it */
        eventId: string | null
      }[]
    }

/** The grid as rows, slots carrying a cell per room (H-3: a one-room event takes its room's cell) */
export function sheetRows(doc: ScheduleDocument): SheetRow[] {
  const byCell = new Map(
    doc.quizzes.flatMap((q) => (q.cell ? [[`${q.cell.slot}|${q.cell.room}`, q] as const] : [])),
  )
  const rows: SheetRow[] = []
  let day = 0
  const roomEvents: {
    id: string
    day: number
    at: number
    end: number
    room: string
    label: string
  }[] = []
  for (const row of doc.frame) {
    if (row.kind === 'day') day++
    if (row.kind === 'event' && row.room) {
      roomEvents.push({
        id: row.id,
        day,
        at: row.at,
        end: row.at + row.minutes,
        room: row.room,
        label: row.label,
      })
    }
  }
  day = 0
  for (const row of doc.frame) {
    if (row.kind === 'day') {
      day++
      rows.push({ kind: 'day', row })
    } else if (row.kind === 'note') rows.push({ kind: 'note', row })
    else if (row.kind === 'event') {
      // A one-room event shows in its slot's cell, not as a row of its own
      if (!row.room) rows.push({ kind: 'event', row })
    } else {
      const end = row.at + row.minutes
      rows.push({
        kind: 'slot',
        row,
        cells: doc.rooms.map((room) => {
          const event = roomEvents.find(
            (e) => e.room === room.id && e.day === day && e.at < end && row.at < e.end,
          )
          return {
            room: room.id,
            quiz: byCell.get(`${row.id}|${room.id}`) ?? null,
            event: event?.label ?? null,
            eventId: event?.id ?? null,
          }
        }),
      })
    }
  }
  return rows
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
 * The basic schedule: events as they are, and each run of quiz slots collapsed into one "Quizzing"
 * row from its first start to its last end (FR-044)
 */
export function basicRows(
  doc: ScheduleDocument,
): { kind: 'day' | 'event' | 'quizzing'; label: string; from?: number; to?: number }[] {
  const rows: { kind: 'day' | 'event' | 'quizzing'; label: string; from?: number; to?: number }[] =
    []
  for (const row of doc.frame) {
    if (row.kind === 'day') rows.push({ kind: 'day', label: row.label })
    else if (row.kind === 'event' && !row.room) {
      rows.push({ kind: 'event', label: row.label, from: row.at, to: row.at + row.minutes })
    } else if (row.kind === 'slot') {
      const last = rows[rows.length - 1]
      if (last?.kind === 'quizzing') last.to = row.at + row.minutes
      else
        rows.push({ kind: 'quizzing', label: 'Quizzing', from: row.at, to: row.at + row.minutes })
    }
  }
  return rows
}
