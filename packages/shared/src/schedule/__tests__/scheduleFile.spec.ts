import { describe, expect, it } from 'vitest'
import {
  NewerScheduleFileError,
  newScheduleDocument,
  SCHEDULE_FILE_VERSION,
  parseScheduleFile,
  serializeSchedule,
  type ScheduleDocument,
} from '../scheduleFile'

/** A small schedule touching every kind of row, seat and draw mark */
function sample(): ScheduleDocument {
  const settings: ScheduleDocument['settings'] = {
    framePreset: 'weekend',
    slotMinutes: 25,
    rooms: 2,
    quizzesPerTeam: 3,
    prelimDraw: 'ruleBook',
    totallingMinutes: 15,
    finals: { spacingMinutes: 25, sideBySide: 1 },
    autoApply: true,
    divisions: [
      {
        id: 'd1',
        name: 'Div 1',
        teams: 6,
        elims: {
          lanes: [
            {
              size: 6,
              format: 'bracket',
              finals: true,
              label: { kind: 'suffix' },
              lettering: 'continue',
            },
          ],
          lines: [],
        },
      },
    ],
  }
  return {
    version: SCHEDULE_FILE_VERSION,
    id: 'sched-1',
    name: 'FBC 2025',
    settings,
    applied: settings,
    frame: [
      { kind: 'day', id: 'r1', label: 'Friday' },
      { kind: 'slot', id: 'r2', at: 19 * 60, minutes: 30, use: 'event' },
      { kind: 'slot', id: 's1', at: 20 * 60, minutes: 25 },
      { kind: 'note', id: 'n1', text: 'Stats will be calculated after this round' },
    ],
    rooms: [
      { id: 'room1', name: 'Room 1' },
      { id: 'room2', name: 'Room 2' },
    ],
    quizzes: [
      {
        id: 'q1',
        label: 'Div 1 Quiz 1',
        division: 'd1',
        phase: 'prelim',
        cell: { slot: 's1', room: 'room1' },
        seats: [
          { kind: 'letter', letter: 'A' },
          { kind: 'letter', letter: 'D' },
          { kind: 'letter', letter: 'E' },
        ],
        pinned: true,
      },
      {
        id: 'q2',
        label: 'Div 1 Quiz A',
        division: 'd1',
        phase: 'elim',
        lane: 0,
        cell: null,
        seats: [
          { kind: 'rank', rank: 1 },
          { kind: 'new', rank: 10 },
          { kind: 'place', quiz: 'q1', place: 2 },
        ],
        pinned: false,
      },
      {
        id: 'q3',
        label: 'Div 1 Finals',
        division: 'd1',
        phase: 'elim',
        lane: 0,
        cell: null,
        seats: [{ kind: 'points', place: 1 }, { kind: 'empty' }, { kind: 'empty' }],
        pinned: false,
        deciding: true,
        changedAfterResults: true,
      },
    ],
    events: [
      { id: 'e1', label: 'Registration', slot: 'r2', rooms: 'all', pinned: false },
      { id: 'e2', label: 'Coaches meeting', slot: 's1', rooms: ['room2'], pinned: true },
    ],
    draw: {
      d1: {
        teams: [
          { name: 'Northside 1', late: true, absent: false, letter: 'F' },
          { name: 'Lakeview 1', late: false, absent: true },
        ],
        stale: false,
      },
    },
  }
}

describe('schedule file', () => {
  it('reopens a saved schedule identically, pins and draw included', () => {
    const doc = sample()
    expect(parseScheduleFile(serializeSchedule(doc))).toEqual(doc)
  })

  it('keeps a meet link', () => {
    const doc = { ...sample(), link: { meetId: 7 } }
    expect(parseScheduleFile(serializeSchedule(doc)).link).toEqual({ meetId: 7 })
  })

  it('refuses a newer version, naming both versions', () => {
    const json = JSON.stringify({ ...sample(), version: SCHEDULE_FILE_VERSION + 1 })
    expect(() => parseScheduleFile(json)).toThrow(NewerScheduleFileError)
    expect(() => parseScheduleFile(json)).toThrow(
      new RegExp(`version ${SCHEDULE_FILE_VERSION + 1}.*version ${SCHEDULE_FILE_VERSION}`),
    )
  })

  it('refuses a document that fails validation, saying what is wrong', () => {
    const bad = sample() as unknown as { quizzes: [{ seats: unknown[] }] }
    bad.quizzes[0].seats[0] = { kind: 'letter' }
    expect(() => parseScheduleFile(JSON.stringify(bad))).toThrow(/quizzes\/0\/seats\/0/)
  })

  it('refuses something that is not JSON', () => {
    expect(() => parseScheduleFile('not json')).toThrow()
  })
})

describe('newScheduleDocument', () => {
  it('starts empty with Auto-apply on, and is a valid schedule', () => {
    const doc = newScheduleDocument('New schedule')
    expect(doc.settings.autoApply).toBe(true)
    expect(doc.settings.divisions).toEqual([])
    expect(parseScheduleFile(serializeSchedule(doc))).toEqual(doc)
  })
})
