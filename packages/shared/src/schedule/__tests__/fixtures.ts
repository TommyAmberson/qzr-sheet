import {
  SCHEDULE_FILE_VERSION,
  type ScheduleDocument,
  type ScheduleQuiz,
  type Seat,
} from '../scheduleFile'

/** Seats written the short way: `A` a letter, `3` a rank, `N10` New 10, `2ofq7` a place, `P1` points, `_` empty */
export function seats(...specs: string[]): Seat[] {
  return specs.map((s): Seat => {
    if (s === '_') return { kind: 'empty' }
    if (/^\d+$/.test(s)) return { kind: 'rank', rank: Number(s) }
    if (/^N\d+$/.test(s)) return { kind: 'new', rank: Number(s.slice(1)) }
    if (/^P\d+$/.test(s)) return { kind: 'points', place: Number(s.slice(1)) }
    const place = /^(\d)of(.+)$/.exec(s)
    if (place) return { kind: 'place', place: Number(place[1]), quiz: place[2]! }
    return { kind: 'letter', letter: s }
  })
}

export function quiz(
  id: string,
  over: Partial<ScheduleQuiz> & { seats?: Seat[] } = {},
): ScheduleQuiz {
  return {
    id,
    label: `Div 1 Quiz ${id}`,
    division: 'd1',
    phase: 'prelim',
    cell: null,
    seats: seats('A', 'B', 'C'),
    pinned: false,
    ...over,
  }
}

/**
 * A two-room, one-day schedule with slots s1 to s6 every 25 minutes from 8:00 PM and one division
 * `d1` of `teams` teams; quizzes and settings are the caller's.
 */
export function doc(over: Partial<ScheduleDocument> = {}, teams = 6): ScheduleDocument {
  const settings: ScheduleDocument['settings'] = {
    framePreset: 'weekend',
    slotMinutes: 25,
    rooms: 2,
    quizzesPerTeam: 3,
    prelimDraw: 'ruleBook',
    totallingMinutes: 15,
    finals: { order: [], spacingMinutes: 25, sideBySide: 1 },
    autoApply: true,
    divisions: [
      {
        id: 'd1',
        name: 'Div 1',
        teams,
        elims: { lanes: [], lines: [] },
      },
    ],
  }
  return {
    version: SCHEDULE_FILE_VERSION,
    id: 'test',
    name: 'Test',
    settings,
    applied: settings,
    frame: [
      { kind: 'day', id: 'day1', label: 'Friday' },
      ...[1, 2, 3, 4, 5, 6].map((n) => ({
        kind: 'slot' as const,
        id: `s${n}`,
        at: 20 * 60 + (n - 1) * 25,
        minutes: 25,
      })),
    ],
    rooms: [
      { id: 'r1', name: 'Room 1' },
      { id: 'r2', name: 'Room 2' },
    ],
    quizzes: [],
    draw: {},
    ...over,
  }
}

export const at = (slot: string, room = 'r1') => ({ slot, room })
