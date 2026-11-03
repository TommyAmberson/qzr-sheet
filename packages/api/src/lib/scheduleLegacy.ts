import {
  defaultElims,
  newScheduleDocument,
  type FrameRow,
  type ScheduleDocument,
  type ScheduleQuiz,
  type Seat,
} from '@qzr/shared'
import type * as schema from '../db/schema'

/**
 * The old schedule tables and the schedule document, both ways (research R5). A meet built with the
 * old editor is converted once, on first open; the old read routes, which installed scoresheets
 * still call, answer from the newest published document in their old shapes.
 */

// ---- Time ----

/** How far `tz`'s wall clock is ahead of UTC at `instant`, in milliseconds */
function zoneOffset(instant: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant))
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  const wall = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  )
  return wall - Math.floor(instant / 1000) * 1000
}

/** The day and minutes after midnight of an instant, on the meet's wall clock */
export function wallClock(instant: Date, tz: string): { date: string; minutes: number } {
  const wall = new Date(instant.getTime() + zoneOffset(instant.getTime(), tz))
  return {
    date: wall.toISOString().slice(0, 10),
    minutes: wall.getUTCHours() * 60 + wall.getUTCMinutes(),
  }
}

/** The instant a wall-clock time on a day falls at in the meet's time zone */
export function instantOf(date: string, minutes: number, tz: string): Date {
  const guess = Date.parse(`${date}T00:00:00Z`) + minutes * 60_000
  // Twice, so a guess that lands across a daylight-saving change settles on the right side
  const first = guess - zoneOffset(guess, tz)
  return new Date(guess - zoneOffset(first, tz))
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const ordinal = (n: number) =>
  `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`

/** A quiz's own name within its division: `A` of `Div 2 Quiz A` */
const shortName = (label: string) => label.trim().split(/\s+/).pop() ?? label

// ---- Old tables to a document ----

export interface LegacySchedule {
  meet: { id: number; name: string; divisions: string[] }
  rooms: { id: number; name: string }[]
  slots: schema.MeetSlot[]
  quizzes: schema.ScheduledQuiz[]
  seats: schema.ScheduledQuizSeat[]
  assignments: { division: string; letter: string; teamId: number }[]
  teams: { id: number; division: string; lateness: boolean }[]
}

/**
 * A meet's old schedule as a document: every quiz pinned so nothing moves until the admin says,
 * ids the old row ids as strings so links already shared resolve, late marks from
 * `teams.lateness` (research R6), and seats with no source left empty.
 */
export function documentFromLegacy(old: LegacySchedule, timeZone: string): ScheduleDocument {
  const doc = newScheduleDocument(old.meet.name)
  doc.link = { meetId: old.meet.id, timeZone }

  const divisions = [
    ...new Set([
      ...old.meet.divisions,
      ...old.quizzes.map((q) => q.division),
      ...old.teams.map((t) => t.division),
    ]),
  ]
  const lettersOf = (division: string) =>
    new Set(
      old.seats.flatMap((s) => {
        const q = old.quizzes.find((x) => x.id === s.quizId)
        return q?.division === division && q.phase === 'prelim' && s.letter ? [s.letter] : []
      }),
    )
  doc.settings.autoApply = false
  doc.settings.divisions = divisions.map((d) => {
    const teams = Math.max(old.teams.filter((t) => t.division === d).length, lettersOf(d).size)
    return { id: d, name: `Div ${d}`, teams, elims: defaultElims(teams) }
  })
  doc.applied = structuredClone(doc.settings)

  const slots = [...old.slots].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
  const frame: FrameRow[] = []
  let day = ''
  for (const slot of slots) {
    const at = wallClock(slot.startAt, timeZone)
    if (at.date !== day) {
      day = at.date
      const weekday = WEEKDAYS[new Date(`${day}T00:00:00Z`).getUTCDay()]!
      frame.push({ kind: 'day', id: `day-${day}`, label: weekday, pinned: true })
    }
    const id = String(slot.id)
    if (slot.kind === 'event') {
      frame.push({
        kind: 'event',
        id,
        at: at.minutes,
        minutes: slot.durationMinutes,
        label: slot.eventLabel ?? '',
        pinned: true,
      })
      continue
    }
    const inSlot = old.quizzes.filter((q) => q.slotId === slot.id)
    const use = inSlot.some((q) => q.phase === 'prelim') ? 'prelim' : 'elim'
    frame.push({
      kind: 'slot',
      id,
      at: at.minutes,
      minutes: slot.durationMinutes,
      use,
      pinned: true,
    })
  }
  doc.frame = frame
  doc.rooms = old.rooms.map((r) => ({ id: String(r.id), name: r.name, meetRoomId: r.id }))

  const seatsOf = (quizId: number) =>
    old.seats.filter((s) => s.quizId === quizId).sort((a, b) => a.seatNumber - b.seatNumber)
  const quizzes = old.quizzes
  /** An old seat's source: `7th place`, `1st of prelims`, `1st Quiz X`; anything else is empty */
  function seatOf(q: schema.ScheduledQuiz, s: schema.ScheduledQuizSeat): Seat {
    if (s.letter) return { kind: 'letter', letter: s.letter }
    const ref = s.seedRef?.trim() ?? ''
    const rank = /^(\d+)(?:st|nd|rd|th) (?:place|of prelims)$/i.exec(ref)
    if (rank) return { kind: 'rank', rank: Number(rank[1]) }
    const place = /^(\d+)(?:st|nd|rd|th) (?:Quiz )?(\S+)$/i.exec(ref)
    if (place) {
      const source = quizzes.find(
        (x) =>
          x.division === q.division &&
          x.id !== q.id &&
          (x.bracketLabel ?? shortName(x.label)) === place[2],
      )
      if (source) return { kind: 'place', quiz: String(source.id), place: Number(place[1]) }
    }
    return { kind: 'empty' }
  }
  doc.quizzes = quizzes.map((q): ScheduleQuiz => {
    const quiz: ScheduleQuiz = {
      id: String(q.id),
      label: q.label,
      division: q.division,
      phase: q.phase,
      cell: { slot: String(q.slotId), room: String(q.roomId) },
      seats: seatsOf(q.id).map((s) => seatOf(q, s)),
      pinned: true,
    }
    if (q.phase === 'elim') {
      if (q.lane === 'intermediate') quiz.line = 0
      else quiz.lane = q.lane === 'consolation' ? 1 : 0
      if (/\bfinals?\b/i.test(q.label)) quiz.deciding = true
    }
    return quiz
  })

  for (const d of divisions) {
    const letters = new Map(
      old.assignments.filter((a) => a.division === d).map((a) => [a.teamId, a.letter]),
    )
    doc.draw[d] = {
      stale: false,
      teams: old.teams
        .filter((t) => t.division === d)
        .sort((a, b) => a.id - b.id)
        .map((t) => ({
          teamId: t.id,
          late: t.lateness,
          absent: false,
          ...(letters.has(t.id) ? { letter: letters.get(t.id) } : {}),
        })),
    }
  }
  return doc
}

// ---- A document in the old routes' shapes ----

/** Numeric ids for the old routes: the old row id where the document kept one, else new ones above */
function numericIds(ids: string[]): Map<string, number> {
  const kept = ids.filter((id) => /^\d+$/.test(id)).map(Number)
  let next = Math.max(0, ...kept) + 1
  return new Map(ids.map((id) => [id, /^\d+$/.test(id) ? Number(id) : next++]))
}

export interface LegacyView {
  slots: {
    id: number
    meetId: number
    startAt: string
    durationMinutes: number
    kind: 'quiz' | 'event'
    eventLabel: string | null
    sortOrder: number
  }[]
  quizzes: {
    id: number
    meetId: number
    slotId: number
    roomId: number
    division: string
    phase: 'prelim' | 'elim'
    lane: 'main' | 'consolation' | 'intermediate' | null
    label: string
    bracketLabel: string | null
    publishedAt: string
    completedAt: null
    seats: {
      id: number
      quizId: number
      seatNumber: number
      letter: string | null
      seedRef: string | null
    }[]
  }[]
  assignments: {
    id: number
    meetId: number
    division: string
    letter: string
    teamId: number
    assignedAt: string
  }[]
}

/**
 * A published document as the old routes return it. Placed quizzes in rooms the meet has only;
 * note rows are left out, and a one-room event becomes an event for every room.
 */
export function legacyFromDocument(
  doc: ScheduleDocument,
  meet: { id: number; dateFrom: string },
  publishedAt: Date,
): LegacyView {
  const tz = doc.link?.timeZone ?? 'UTC'
  const timed = doc.frame.filter(
    (r): r is Extract<FrameRow, { kind: 'slot' | 'event' }> =>
      r.kind === 'slot' || r.kind === 'event',
  )
  const slotIds = numericIds(timed.map((r) => r.id))
  const quizIds = numericIds(doc.quizzes.map((q) => q.id))
  const meetRoom = new Map(doc.rooms.map((r) => [r.id, r.meetRoomId]))

  const slots: LegacyView['slots'] = []
  let dayIndex = -1
  for (const row of doc.frame) {
    if (row.kind === 'day') dayIndex++
    if (row.kind !== 'slot' && row.kind !== 'event') continue
    slots.push({
      id: slotIds.get(row.id)!,
      meetId: meet.id,
      startAt: instantOf(addDays(meet.dateFrom, Math.max(0, dayIndex)), row.at, tz).toISOString(),
      durationMinutes: row.minutes,
      kind: row.kind === 'slot' ? 'quiz' : 'event',
      eventLabel: row.kind === 'event' ? row.label : null,
      sortOrder: slots.length + 1,
    })
  }

  const label = (id: string) => {
    const q = doc.quizzes.find((x) => x.id === id)
    return q ? shortName(q.label) : '?'
  }
  const seedRef = (seat: Seat): string | null => {
    switch (seat.kind) {
      case 'rank':
      case 'new':
        return `${ordinal(seat.rank)} place`
      case 'place':
        return `${ordinal(seat.place)} Quiz ${label(seat.quiz)}`
      case 'points':
        return `${ordinal(seat.place)} in pts`
      default:
        return null
    }
  }

  const quizzes: LegacyView['quizzes'] = []
  for (const q of doc.quizzes) {
    const roomId = q.cell ? meetRoom.get(q.cell.room) : undefined
    const slotId = q.cell ? slotIds.get(q.cell.slot) : undefined
    if (roomId === undefined || slotId === undefined) continue
    const id = quizIds.get(q.id)!
    quizzes.push({
      id,
      meetId: meet.id,
      slotId,
      roomId,
      division: q.division,
      phase: q.phase,
      lane:
        q.phase === 'prelim'
          ? null
          : q.line !== undefined
            ? 'intermediate'
            : (q.lane ?? 0) > 0
              ? 'consolation'
              : 'main',
      label: q.label,
      bracketLabel: q.phase === 'elim' ? shortName(q.label) : null,
      publishedAt: publishedAt.toISOString(),
      completedAt: null,
      seats: q.seats.map((s, i) => ({
        id: id * 10 + i + 1,
        quizId: id,
        seatNumber: i + 1,
        letter: s.kind === 'letter' ? s.letter : null,
        seedRef: seedRef(s),
      })),
    })
  }

  const assignments: LegacyView['assignments'] = []
  for (const [division, draw] of Object.entries(doc.draw)) {
    for (const t of draw.teams) {
      if (!t.letter || t.teamId === undefined) continue
      assignments.push({
        id: assignments.length + 1,
        meetId: meet.id,
        division,
        letter: t.letter,
        teamId: t.teamId,
        assignedAt: publishedAt.toISOString(),
      })
    }
  }
  return { slots, quizzes, assignments }
}
