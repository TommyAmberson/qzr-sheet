import {
  defaultElims,
  newScheduleDocument,
  ordinal,
  quizNumber,
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

// Building a formatter is costly, and a conversion needs one per slot, so each zone keeps its own
const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz)
  if (!f) {
    // A zone this runtime doesn't know (a typo in a request, say) reads as UTC rather than failing
    const known = (() => {
      try {
        new Intl.DateTimeFormat('en-CA', { timeZone: tz })
        return tz
      } catch {
        return 'UTC'
      }
    })()
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: known,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    formatters.set(tz, f)
  }
  return f
}

/** How far `tz`'s wall clock is ahead of UTC at `instant`, in milliseconds */
function zoneOffset(instant: number, tz: string): number {
  const parts = formatterFor(tz).formatToParts(new Date(instant))
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

// ---- Old tables to a document ----

/**
 * An old quiz's number as the old scoresheet recorded it: its bracket label, or what follows the
 * last `Q` of a `D1-Q3` label, or its label's last word. Converted quizzes are labelled
 * `Div 1 Quiz 3` with it, so their result names match the results already saved.
 */
function oldNumber(q: schema.ScheduledQuiz): string {
  return q.bracketLabel ?? /Q([^\s]+)$/.exec(q.label)?.[1] ?? quizNumber(q)
}

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
  const quizById = new Map(old.quizzes.map((q) => [q.id, q]))
  const seatsByQuiz = new Map<number, schema.ScheduledQuizSeat[]>()
  for (const seat of old.seats) {
    seatsByQuiz.set(seat.quizId, [...(seatsByQuiz.get(seat.quizId) ?? []), seat])
  }
  const lettersOf = (division: string) =>
    new Set(
      old.seats.flatMap((s) => {
        const q = quizById.get(s.quizId)
        return q?.division === division && q.phase === 'prelim' && s.letter ? [s.letter] : []
      }),
    )
  doc.settings.autoApply = false
  // The meet's rooms, as many as it had, so re-flow keeps them
  if (old.rooms.length > 0) doc.settings.rooms = old.rooms.length
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
    (seatsByQuiz.get(quizId) ?? []).sort((a, b) => a.seatNumber - b.seatNumber)
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
        (x) => x.division === q.division && x.id !== q.id && oldNumber(x) === place[2],
      )
      if (source) return { kind: 'place', quiz: String(source.id), place: Number(place[1]) }
    }
    return { kind: 'empty' }
  }
  doc.quizzes = quizzes.map((q): ScheduleQuiz => {
    const quiz: ScheduleQuiz = {
      id: String(q.id),
      label: `Div ${q.division} Quiz ${oldNumber(q)}`,
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

/**
 * Numeric ids for the old routes: the old row id where the document kept one, else a number from
 * the id itself, well above old row ids, so a quiz keeps its number from one version to the next
 * whatever is added or removed around it.
 */
function numericIds(ids: string[]): Map<string, number> {
  const result = new Map<string, number>()
  const taken = new Set<number>()
  for (const id of ids.filter((x) => /^\d+$/.test(x))) {
    result.set(id, Number(id))
    taken.add(Number(id))
  }
  // Sorted, so a rare clash resolves the same way every time
  for (const id of ids.filter((x) => !/^\d+$/.test(x)).sort()) {
    let n = 1_000_000 + (fnv1a(id) % 1_000_000_000)
    while (taken.has(n)) n++
    result.set(id, n)
    taken.add(n)
  }
  return result
}

/** A 32-bit FNV-1a hash of a string */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash
}

/** The date a day row stands for: the first date from `from` on its weekday, or `from` itself */
function dayDate(label: string, from: string): string {
  const weekday = WEEKDAYS.indexOf(label.trim())
  if (weekday < 0) return from
  for (let i = 0; i < 7; i++) {
    const date = addDays(from, i)
    if (new Date(`${date}T00:00:00Z`).getUTCDay() === weekday) return date
  }
  return from
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
  // Days follow on from the meet's first day, each on its weekday, so a gap between days holds
  let date: string | null = null
  for (const row of doc.frame) {
    if (row.kind === 'day') date = dayDate(row.label, date ? addDays(date, 1) : meet.dateFrom)
    if (row.kind !== 'slot' && row.kind !== 'event') continue
    slots.push({
      id: slotIds.get(row.id)!,
      meetId: meet.id,
      startAt: instantOf(date ?? meet.dateFrom, row.at, tz).toISOString(),
      durationMinutes: row.minutes,
      kind: row.kind === 'slot' ? 'quiz' : 'event',
      eventLabel: row.kind === 'event' ? row.label : null,
      sortOrder: slots.length + 1,
    })
  }

  const quizById = new Map(doc.quizzes.map((q) => [q.id, q]))
  const label = (id: string) => {
    const q = quizById.get(id)
    return q ? quizNumber(q) : '?'
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
      // Installed scoresheets take the quiz number from here first, so prelims carry it too
      bracketLabel: quizNumber(q),
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
