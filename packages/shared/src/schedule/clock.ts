import type { ScheduleDocument } from './scheduleFile'
import { WEEKDAYS } from './frame'

/**
 * Schedule time on a meet's wall clock: a schedule day is a date, a slot a time on it, read in the
 * meet's time zone (specs/010-meet-day FR-021). The API's older schedule routes and the meet page
 * take days to dates the same way.
 */

// Building a formatter is costly, and a conversion needs one per slot, so each zone keeps its own
const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(tz: string): Intl.DateTimeFormat {
  const cached = formatters.get(tz)
  if (cached) return cached
  // A zone this runtime doesn't know (a typo in a request, say) reads as UTC rather than failing,
  // and only zones that exist are kept, so made-up ones can't grow the cache
  let zone = tz
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz })
  } catch {
    zone = 'UTC'
  }
  const f =
    formatters.get(zone) ??
    new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  formatters.set(zone, f)
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

/** A date, `YYYY-MM-DD`, `days` after another */
function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
}

/** The date a day row stands for: the first date from `from` on its weekday, or `from` itself */
function dayDate(label: string, from: string, first: boolean): string {
  const weekday = WEEKDAYS.indexOf(label.trim())
  if (weekday < 0) return from
  // The first day is the date nearest the meet's start with its weekday, which may come before a
  // start entered a day late; each later one is the next date on its weekday
  const steps = first ? [0, 1, -1, 2, -2, 3, -3] : [0, 1, 2, 3, 4, 5, 6]
  for (const i of steps) {
    const date = addDays(from, i)
    if (new Date(`${date}T00:00:00Z`).getUTCDay() === weekday) return date
  }
  return from
}

/**
 * Each day row's date: for the first day, the date nearest the meet's start on its weekday; for
 * each later one, the next date on its weekday, so a gap between days holds
 */
export function scheduleDayDates(doc: ScheduleDocument, dateFrom: string): Map<string, string> {
  const dates = new Map<string, string>()
  let date: string | null = null
  for (const row of doc.frame) {
    if (row.kind !== 'day') continue
    date = date ? dayDate(row.label, addDays(date, 1), false) : dayDate(row.label, dateFrom, true)
    dates.set(row.id, date)
  }
  return dates
}

/** When a slot runs: its start and end, in milliseconds since the epoch */
export interface SlotTime {
  start: number
  end: number
}

/**
 * When each slot runs: its time on its day's date (`scheduleDayDates`) in the meet's time zone.
 * Slots before the first day take that day's date, so the timeline runs in the frame's order, and
 * one past midnight (`at` of 24 hours or more) runs into the next date. The one rule for every
 * reader of slot times: the API's older routes and the phone schedule's time under way.
 */
export function slotTimes(
  doc: ScheduleDocument,
  dateFrom: string,
  timeZone: string,
): Map<string, SlotTime> {
  const dates = scheduleDayDates(doc, dateFrom)
  let date = dates.values().next().value ?? dateFrom
  const times = new Map<string, SlotTime>()
  for (const row of doc.frame) {
    if (row.kind === 'day') date = dates.get(row.id) ?? date
    if (row.kind !== 'slot') continue
    const start = instantOf(date, row.at, timeZone).getTime()
    times.set(row.id, { start, end: start + row.minutes * 60_000 })
  }
  return times
}
