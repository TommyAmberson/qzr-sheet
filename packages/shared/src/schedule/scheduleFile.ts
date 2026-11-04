import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

import type { SheetView } from './sheet'

/**
 * The schedule document: everything the builder needs, the same whether it is kept in the
 * browser, saved to a file, or stored as a meet's draft or published version. See
 * specs/005-schedule-redesign/data-model.md and contracts/schedule-file.md.
 */

/** Newest schedule file version this build reads and writes; independent of the quiz file's */
export const SCHEDULE_FILE_VERSION = 1

// ---- Settings ----

const LaneSchema = Type.Object({
  /** How many prelim ranks the lane takes */
  size: Type.Integer({ minimum: 0 }),
  format: Type.Union([Type.Literal('bracket'), Type.Literal('roundRobin')]),
  /** A bracket's library entry, when not the one for its size (the rule book's `ruleB`, say) */
  bracket: Type.Optional(Type.String()),
  /** A round robin's quizzes per team */
  perTeam: Type.Optional(Type.Integer({ minimum: 1, maximum: 3 })),
  /** Whether the deciding quiz is called a Finals; for a round robin, whether it has one */
  finals: Type.Boolean(),
  label: Type.Union([
    /** `Div 2C`, `Div 3CC` */
    Type.Object({ kind: Type.Literal('suffix') }),
    /** The division's own name, `Div 3 Quiz I` */
    Type.Object({ kind: Type.Literal('division') }),
    /** A name of its own, CMQ's `K` */
    Type.Object({ kind: Type.Literal('own'), name: Type.String() }),
  ]),
  lettering: Type.Union([Type.Literal('continue'), Type.Literal('restart')]),
})

const LineSchema = Type.Object({
  intermediate: Type.Optional(
    Type.Object({
      /** X, XY, XYZ or WXYZ */
      quizzes: Type.Integer({ minimum: 1, maximum: 4 }),
      kind: Type.Union([Type.Literal('rerank'), Type.Literal('playIn')]),
      /** How many of its ranks sit above the line */
      above: Type.Integer({ minimum: 1 }),
      /** For XY, the order seen in Nov 2024 instead of the usual one */
      seating: Type.Optional(Type.Literal('alternate')),
    }),
  ),
})

const DivisionSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  teams: Type.Integer({ minimum: 0 }),
  elims: Type.Object({
    lanes: Type.Array(LaneSchema),
    /** One per pair of adjacent lanes, top first */
    lines: Type.Array(LineSchema),
  }),
})

const SettingsSchema = Type.Object({
  framePreset: Type.Union([
    Type.Literal('weekend'),
    Type.Literal('oneDay'),
    Type.Literal('oneRoom'),
  ]),
  slotMinutes: Type.Integer({ minimum: 1 }),
  rooms: Type.Union([Type.Integer({ minimum: 1 }), Type.Literal('auto')]),
  quizzesPerTeam: Type.Union([Type.Literal(3), Type.Literal(6)]),
  prelimDraw: Type.Union([Type.Literal('ruleBook'), Type.Literal('noRematches')]),
  totallingMinutes: Type.Integer({ minimum: 0 }),
  finals: Type.Object({
    /** Lanes as `<division id>:<lane index>`, earliest first; empty means the default order */
    order: Type.Array(Type.String()),
    spacingMinutes: Type.Integer({ minimum: 0 }),
    /** How many Finals run at once */
    sideBySide: Type.Integer({ minimum: 1 }),
  }),
  autoApply: Type.Boolean(),
  divisions: Type.Array(DivisionSchema),
})

// ---- Grid ----

/** A row changed by hand; while any row is pinned, re-flow fits the quizzes into the frame as it is */
const RowPinned = { pinned: Type.Optional(Type.Boolean()) }

const FrameRowSchema = Type.Union([
  Type.Object({ kind: Type.Literal('day'), id: Type.String(), label: Type.String(), ...RowPinned }),
  Type.Object({
    kind: Type.Literal('slot'),
    id: Type.String(),
    /** Minutes after midnight on its day */
    at: Type.Integer({ minimum: 0 }),
    minutes: Type.Integer({ minimum: 1 }),
    /**
     * What the generator made it for; a slot added by hand takes the use of the quiz slot before
     * it. A slot made for events (Breakfast, Lunch) takes no generated quizzes.
     */
    use: Type.Optional(
      Type.Union([
        Type.Literal('prelim'),
        Type.Literal('elim'),
        Type.Literal('finals'),
        Type.Literal('event'),
      ]),
    ),
    ...RowPinned,
  }),
  Type.Object({ kind: Type.Literal('note'), id: Type.String(), text: Type.String(), ...RowPinned }),
])

const SeatSchema = Type.Union([
  Type.Object({ kind: Type.Literal('letter'), letter: Type.String({ minLength: 1 }) }),
  Type.Object({ kind: Type.Literal('rank'), rank: Type.Integer({ minimum: 1 }) }),
  Type.Object({ kind: Type.Literal('new'), rank: Type.Integer({ minimum: 1 }) }),
  /** A place in another quiz, by that quiz's id, so renames follow */
  Type.Object({
    kind: Type.Literal('place'),
    quiz: Type.String(),
    place: Type.Integer({ minimum: 1 }),
  }),
  /** A place in points across the lane's round robin */
  Type.Object({ kind: Type.Literal('points'), place: Type.Integer({ minimum: 1 }) }),
  Type.Object({ kind: Type.Literal('empty') }),
])

const QuizSchema = Type.Object({
  id: Type.String(),
  label: Type.String(),
  division: Type.String(),
  phase: Type.Union([Type.Literal('prelim'), Type.Literal('elim')]),
  /** Elims: the lane, by index */
  lane: Type.Optional(Type.Integer({ minimum: 0 })),
  /** Elims: the intermediate on this line, by index */
  line: Type.Optional(Type.Integer({ minimum: 0 })),
  /** A slot and a room, or null for the unplaced tray */
  cell: Type.Union([Type.Object({ slot: Type.String(), room: Type.String() }), Type.Null()]),
  seats: Type.Array(SeatSchema),
  pinned: Type.Boolean(),
  deciding: Type.Optional(Type.Boolean()),
  changedAfterResults: Type.Optional(Type.Boolean()),
})

/** Sits in a slot's rooms like a quiz (FR-017) */
const EventSchema = Type.Object({
  id: Type.String(),
  label: Type.String(),
  /** Its slot, or null for the unplaced tray */
  slot: Type.Union([Type.String(), Type.Null()]),
  /** The rooms it takes, or all of them, however many there are */
  rooms: Type.Union([Type.Array(Type.String()), Type.Literal('all')]),
  pinned: Type.Boolean(),
})

// ---- Draw ----

const DrawTeamSchema = Type.Object({
  /** Typed when standalone; when linked, the name is the meet's */
  name: Type.Optional(Type.String()),
  /** When linked, the meet's team */
  teamId: Type.Optional(Type.Integer()),
  late: Type.Boolean(),
  absent: Type.Boolean(),
  /** The letter the draw gave the team */
  letter: Type.Optional(Type.String()),
})

const DivisionDrawSchema = Type.Object({
  teams: Type.Array(DrawTeamSchema),
  /** The team count changed since the draw, so it needs redoing */
  stale: Type.Boolean(),
})

export const ScheduleDocumentSchema = Type.Object({
  version: Type.Literal(SCHEDULE_FILE_VERSION),
  id: Type.String(),
  name: Type.String(),
  settings: SettingsSchema,
  applied: SettingsSchema,
  frame: Type.Array(FrameRowSchema),
  rooms: Type.Array(
    Type.Object({
      id: Type.String(),
      name: Type.String(),
      /** When linked, the meet's room; publishing adds the rooms that have none yet */
      meetRoomId: Type.Optional(Type.Integer()),
    }),
  ),
  quizzes: Type.Array(QuizSchema),
  events: Type.Array(EventSchema),
  draw: Type.Record(Type.String(), DivisionDrawSchema),
  link: Type.Optional(
    Type.Object({
      meetId: Type.Integer(),
      /** The meet's time zone, which turns a day's times into instants for the meet's old routes */
      timeZone: Type.Optional(Type.String()),
    }),
  ),
})

export type ScheduleDocument = Static<typeof ScheduleDocumentSchema>
export type ScheduleSettings = Static<typeof SettingsSchema>
export type DivisionSettings = Static<typeof DivisionSchema>
export type LaneSettings = Static<typeof LaneSchema>
export type LineSettings = Static<typeof LineSchema>
export type FrameRow = Static<typeof FrameRowSchema>
export type ScheduleQuiz = Static<typeof QuizSchema>
export type ScheduleEvent = Static<typeof EventSchema>
export type Seat = Static<typeof SeatSchema>
export type DivisionDraw = Static<typeof DivisionDrawSchema>

/** `GET /api/meets/:id/schedule/published`: the newest version, in the view the reader gets */
export interface PublishedSchedule {
  document: ScheduleDocument
  publishedAt: string
  view: SheetView
  /** The meet's own name, which the schedule's may not be */
  meetName: string
}

// ---- Codec ----

/** A schedule saved by a newer builder */
export class NewerScheduleFileError extends Error {
  constructor(found: number) {
    super(
      `This schedule was saved as version ${found}, and this builder reads up to version ${SCHEDULE_FILE_VERSION}`,
    )
    this.name = 'NewerScheduleFileError'
  }
}

export function serializeSchedule(doc: ScheduleDocument): string {
  return JSON.stringify(doc)
}

/**
 * Parse a schedule file. Throws `NewerScheduleFileError` for a newer version, and an error naming
 * the first problem for anything that isn't a valid schedule.
 */
export function parseScheduleFile(json: string): ScheduleDocument {
  const raw: unknown = JSON.parse(json)
  const version = (raw as { version?: unknown } | null)?.version
  if (typeof version === 'number' && version > SCHEDULE_FILE_VERSION) {
    throw new NewerScheduleFileError(version)
  }
  if (Value.Check(ScheduleDocumentSchema, raw)) return raw
  const [first] = Value.Errors(ScheduleDocumentSchema, raw)
  throw new Error(`Not a valid schedule: ${first?.path || '/'} ${first?.message ?? ''}`.trim())
}

/** A new, empty schedule: no divisions yet, with the Weekend defaults (FR-015, FR-016, FR-012a) */
export function newScheduleDocument(name: string): ScheduleDocument {
  const settings: ScheduleSettings = {
    framePreset: 'weekend',
    slotMinutes: 25,
    rooms: 'auto',
    quizzesPerTeam: 3,
    prelimDraw: 'ruleBook',
    totallingMinutes: 15,
    finals: { order: [], spacingMinutes: 30, sideBySide: 1 },
    autoApply: true,
    divisions: [],
  }
  return {
    version: SCHEDULE_FILE_VERSION,
    id: crypto.randomUUID(),
    name,
    settings,
    applied: structuredClone(settings),
    frame: [],
    rooms: [],
    quizzes: [],
    events: [],
    draw: {},
  }
}
