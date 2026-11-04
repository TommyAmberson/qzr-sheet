import { teamKey } from './conflicts'
import { buildElimQuizzes } from './elims'
import { buildFrame, DEFAULT_SHAPE, defaultRoomCount, eventCells } from './frame'
import { placePrelims, sortPrelims, type PrelimDivision } from './placement'
import { drawPrelims } from './prelimDraw'
import { quizNumber } from './names'
import {
  lateLetters,
  type DivisionSettings,
  type FrameRow,
  type ScheduleDocument,
  type ScheduleQuiz,
  type ScheduleSettings,
} from './scheduleFile'

/** Prelim rounds a weekend starts from: five Friday evening, three Saturday morning */
const BASE_PRELIM_SLOTS = { weekend: 8, oneRoom: 8, oneDay: 6 } as const

/**
 * The rooms a schedule's settings call for (FR-018): the fewest, at least 3, that fit every
 * division's prelims in the frame's prelim slots
 */
export function recommendedRooms(
  settings: Pick<ScheduleSettings, 'framePreset' | 'prelimDraw' | 'quizzesPerTeam'> & {
    divisions: Pick<DivisionSettings, 'teams'>[]
  },
  /** The prelim quizzes, when the caller has drawn them already */
  prelims?: number,
): number {
  if (settings.framePreset === 'oneRoom') return 1
  const count =
    prelims ??
    settings.divisions
      .filter((d) => d.teams > 0)
      .reduce(
        (n, d) => n + drawPrelims(d.teams, settings.prelimDraw, settings.quizzesPerTeam).length,
        0,
      )
  return defaultRoomCount(count, BASE_PRELIM_SLOTS[settings.framePreset])
}

/** Beyond this many elim rounds something can never become ready; stop rather than loop */
const MAX_ELIM_ROUNDS = 60

type Use = 'prelim' | 'elim' | 'finals'

/**
 * The frame's quiz slots grouped by use, in order; a slot added by hand takes the use of the quiz
 * slot before it, and slots made for events take no quizzes
 */
function slotsByUse(frame: FrameRow[]): Record<Use, string[]> {
  const byUse: Record<Use, string[]> = { prelim: [], elim: [], finals: [] }
  let use: Use = 'prelim'
  for (const row of frame) {
    if (row.kind !== 'slot' || row.use === 'event') continue
    use = row.use ?? use
    byUse[use].push(row.id)
  }
  return byUse
}

/**
 * Elim rounds for every division's regular quizzes (Finals aside), each division in its own rooms,
 * around the rounds and rooms pinned quizzes already hold. A quiz is ready once every quiz it takes
 * a team from is in an earlier round (H-12), every quiz of the intermediate behind a `New n` seat is
 * far enough back to total (W-3), and, for a lane's deciding quiz, every other quiz of its lane is
 * earlier (H-13).
 */
function elimRounds(
  divisions: { quizzes: ScheduleQuiz[]; all: ScheduleQuiz[]; rooms: string[] }[],
  gapRounds: number,
  fixed: Map<string, { round: number; room: string }>,
  maxRounds: number,
): { round: Map<string, number>; room: Map<string, string>; rounds: number } {
  const round = new Map<string, number>([...fixed].map(([id, f]) => [id, f.round]))
  const room = new Map<string, string>()
  const busy = new Set([...fixed.values()].map((f) => `${f.round}|${f.room}`))
  let r = 0
  const left = divisions.map((d) => [...d.quizzes])
  // The rooms each lane (or intermediate) has used, so it keeps to them and lanes don't swap
  // rooms from round to round (P-2, P-3)
  const laneOf = (q: ScheduleQuiz) =>
    `${q.division}:${q.line !== undefined ? `line${q.line}` : `lane${q.lane ?? 0}`}`
  const laneRooms = new Map<string, string[]>()
  while (left.some((l) => l.length > 0) && r < maxRounds) {
    divisions.forEach((division, d) => {
      const used = new Set<string>()
      const free = division.rooms.filter((rm) => !busy.has(`${r}|${rm}`))
      const ready = left[d]!.filter((q) => {
        for (const seat of q.seats) {
          if (seat.kind === 'place') {
            const at = round.get(seat.quiz)
            if (at === undefined || at >= r) return false
          }
          if (seat.kind === 'new') {
            // Its line's whole intermediate, or the quiz in its own bracket that seats the rank
            const seating = division.all.filter((x) =>
              x.seats.some((s) => s.kind === 'rank' && s.rank === seat.rank),
            )
            const line = seating.find((x) => x.line !== undefined)?.line
            const feeders =
              line === undefined ? seating : division.all.filter((x) => x.line === line)
            if (feeders.some((x) => (round.get(x.id) ?? Infinity) > r - 1 - gapRounds)) return false
          }
        }
        if (q.deciding) {
          const lane = division.all.filter((x) => x.lane === q.lane && x !== q)
          if (lane.some((x) => (round.get(x.id) ?? Infinity) >= r)) return false
        }
        return true
      })
      // Which quizzes run this round, as many as there are rooms, no team twice, the lanes taking
      // turns so each runs alongside the others in a room of its own rather than one lane
      // taking every room and the next taking them all after it
      const byLane = new Map<string, ScheduleQuiz[]>()
      for (const q of ready) byLane.set(laneOf(q), [...(byLane.get(laneOf(q)) ?? []), q])
      const turns: ScheduleQuiz[] = []
      for (let i = 0; turns.length < ready.length; i++) {
        for (const lane of byLane.values()) if (lane[i]) turns.push(lane[i]!)
      }
      const chosen: ScheduleQuiz[] = []
      for (const q of turns) {
        if (chosen.length === free.length) break
        const keys = q.seats.map((seat) => teamKey(q, seat)).filter((k): k is string => k !== null)
        if (keys.some((k) => used.has(k))) continue
        keys.forEach((k) => used.add(k))
        chosen.push(q)
      }
      // Then their rooms: a room the quiz's lane has used if one is free, else one no other lane
      // has used, else whatever is left
      const owned = new Set([...laneRooms.values()].flat())
      const give = (q: ScheduleQuiz, rm: string) => {
        free.splice(free.indexOf(rm), 1)
        // Divisions whose rooms overlap (more divisions than rooms) share the round's rooms
        busy.add(`${r}|${rm}`)
        round.set(q.id, r)
        room.set(q.id, rm)
        left[d]!.splice(left[d]!.indexOf(q), 1)
        const lane = laneRooms.get(laneOf(q)) ?? []
        if (!lane.includes(rm)) laneRooms.set(laneOf(q), [...lane, rm])
      }
      const later: ScheduleQuiz[] = []
      for (const q of chosen) {
        const home = (laneRooms.get(laneOf(q)) ?? []).find((rm) => free.includes(rm))
        if (home) give(q, home)
        else later.push(q)
      }
      for (const q of later) give(q, free.find((rm) => !owned.has(rm)) ?? free[0]!)
    })
    r++
  }
  return { round, room, rounds: round.size > 0 ? Math.max(...round.values()) + 1 : 0 }
}

/**
 * The order Finals run in: the highest division first, each division's consolation Finals, when
 * they run with the others, just before its own (FR-019a); the director changes it on the grid
 */
function finalsOrder(doc: ScheduleDocument, finals: ScheduleQuiz[]): ScheduleQuiz[] {
  const divisionIndex = (q: ScheduleQuiz) =>
    doc.settings.divisions.findIndex((d) => d.id === q.division)
  return [...finals].sort(
    (a, b) => divisionIndex(b) - divisionIndex(a) || (b.lane ?? 0) - (a.lane ?? 0),
  )
}

const isFinals = (q: ScheduleQuiz) => q.deciding === true && q.label.endsWith('Finals')

/**
 * Whether a Finals runs with the others in the Finals slots (FR-019a). With two divisions every
 * Finals does, consolations too, as in 2021 to 2024; with three or more a consolation's Finals runs
 * in its lane's rooms like the lane's other quizzes, as at FBC 2025, so the Finals don't push the
 * evening back.
 */
const inFinalsSlots = (q: ScheduleQuiz, divisions: number) =>
  isFinals(q) && (divisions < 3 || (q.lane ?? 0) === 0)

/**
 * The schedule re-flowed to its settings, around every pinned quiz (FR-012, H-19): pinned quizzes
 * keep their cell, label and seats, and everything else is placed again. A pinned quiz in a room
 * that no longer exists goes to the tray, still pinned. While any frame row is pinned the frame is
 * kept as it is and the quizzes fit into it; otherwise it is rebuilt to fit. Nothing is placed
 * against a hard rule; what can't be placed is left in the tray (FR-013).
 */
export function reflowSchedule(
  doc: ScheduleDocument,
  /** Keep the frame as it is even with nothing in it pinned, as re-placing elims does */
  options: { keepFrame?: boolean } = {},
): ScheduleDocument {
  const { settings } = doc
  const divisions = settings.divisions.filter((d) => d.teams > 0)
  const keepFrame =
    options.keepFrame ?? (doc.frame.some((r) => r.pinned) || doc.events.some((e) => e.pinned))
  const oldSlots = slotsByUse(doc.frame)
  const positionOf = new Map<string, { use: Use; k: number }>()
  for (const use of ['prelim', 'elim', 'finals'] as const) {
    oldSlots[use].forEach((id, k) => positionOf.set(id, { use, k }))
  }

  const prelims: PrelimDivision[] = divisions.map((d) => ({
    id: d.id,
    quizzes: drawPrelims(d.teams, settings.prelimDraw, settings.quizzesPerTeam).map(
      (letters, i) => ({ id: `${d.id}-P${i + 1}`, letters }),
    ),
  }))
  const totalPrelims = prelims.reduce((n, d) => n + d.quizzes.length, 0)

  const base = BASE_PRELIM_SLOTS[settings.framePreset]
  const roomCount =
    settings.framePreset === 'oneRoom'
      ? 1
      : settings.rooms === 'auto'
        ? recommendedRooms(settings, totalPrelims)
        : settings.rooms
  // The rooms there are stay as they are, names and meet rooms included; any more are added
  const taken = new Set(doc.rooms.map((r) => r.id))
  const rooms = Array.from({ length: roomCount }, (_, i) => {
    const kept = doc.rooms[i]
    if (kept) return kept
    let n = i + 1
    while (taken.has(`room-${n}`)) n++
    taken.add(`room-${n}`)
    return { id: `room-${n}`, name: `Room ${i + 1}` }
  })
  const roomIds = new Set(rooms.map((r) => r.id))

  // Pinned quizzes stay as they are; one in a room that's gone waits in the tray
  const pinned = doc.quizzes
    .filter((q) => q.pinned)
    .map((q) => (q.cell && !roomIds.has(q.cell.room) ? { ...q, cell: null } : q))
  // A pinned quiz stands in for the generated quiz it is, by id or, for a schedule converted from
  // the old editor whose quizzes kept their old ids, by division, lane and number
  const pinnedIds = new Set(pinned.map((q) => q.id))
  const pinnedKeys = new Set(pinned.map(quizKey))
  const isPinned = (
    q: Pick<ScheduleQuiz, 'id' | 'division' | 'phase' | 'lane' | 'line' | 'label'>,
  ) => pinnedIds.has(q.id) || pinnedKeys.has(quizKey(q))
  // A generated elim that is a quiz already in the schedule takes that quiz's id, pinned or not,
  // and seats follow, so places keep naming the quizzes they did
  const idByKey = new Map(doc.quizzes.map((q) => [quizKey(q), q.id]))
  const standInFor = (quizzes: ScheduleQuiz[]) => {
    const renamed = new Map<string, string>()
    for (const q of quizzes) {
      const id = idByKey.get(quizKey(q))
      if (id !== undefined && id !== q.id) renamed.set(q.id, id)
    }
    if (renamed.size === 0) return quizzes
    return quizzes.map((q) => ({
      ...q,
      id: renamed.get(q.id) ?? q.id,
      seats: q.seats.map((s) =>
        s.kind === 'place' && renamed.has(s.quiz) ? { ...s, quiz: renamed.get(s.quiz)! } : s,
      ),
    }))
  }
  const prelimPinned = (d: DivisionSettings, n: number, id: string) =>
    isPinned({ id, division: d.id, phase: 'prelim', label: `${d.name} Quiz ${n + 1}` })
  const pinnedAt = (use: Use) =>
    pinned.flatMap((q) => {
      const pos = q.cell ? positionOf.get(q.cell.slot) : undefined
      return pos?.use === use ? [{ q, k: pos.k, room: q.cell!.room }] : []
    })

  // Prelims, around pinned quizzes' cells and letters
  // Cells events take (H-3), by use and position; only a kept frame has hand-made events
  const eventTaken = keepFrame
    ? [...eventCells(doc.frame, doc.events, [...roomIds])].flatMap((cell) => {
        const [slot, room] = cell.split('|') as [string, string]
        const pos = positionOf.get(slot)
        return pos && roomIds.has(room) ? [{ ...pos, room }] : []
      })
    : []
  const fixedPrelims = [
    ...[...pinnedAt('prelim')].map(({ q, k, room }) => ({
      slot: `p${k}`,
      room,
      division: q.phase === 'prelim' ? q.division : undefined,
      letters: q.seats.flatMap((s) => (s.kind === 'letter' ? [s.letter] : [])),
    })),
    ...eventTaken.filter((e) => e.use === 'prelim').map((e) => ({ slot: `p${e.k}`, room: e.room })),
  ]
  const toPlace = prelims.map((d, i) => ({
    ...d,
    quizzes: d.quizzes.filter((q, n) => !prelimPinned(divisions[i]!, n, q.id)),
  }))
  const slotNames = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`)
  const minPrelims = Math.max(0, ...fixedPrelims.map((f) => Number(f.slot.slice(1)) + 1))
  let prelimSlots = keepFrame
    ? oldSlots.prelim.length
    : divisions.length === 0
      ? DEFAULT_SHAPE.prelimSlots
      : Math.max(base, minPrelims, Math.ceil(totalPrelims / roomCount))
  const place = (n: number) =>
    placePrelims({
      divisions: toPlace,
      slots: slotNames(n),
      rooms: [...roomIds],
      fixed: fixedPrelims,
    })
  let placement = place(prelimSlots)
  while (!keepFrame && placement.unplaced.length > 0 && prelimSlots < base * 4) {
    placement = place(++prelimSlots)
  }
  // Prelim rounds left empty at the end are dropped, so no empty row waits before the stats break
  if (!keepFrame && divisions.length > 0) {
    const used = [...placement.cells.values()].map((c) => Number(c.slot.slice(1)) + 1)
    prelimSlots = Math.max(1, minPrelims, ...used)
  }

  // Elims, each division in its own rooms, around pinned elims
  const elims = divisions.map((d) => standInFor(buildElimQuizzes(d)))
  const fixedElims = new Map(pinnedAt('elim').map(({ q, k, room }) => [q.id, { round: k, room }]))
  for (const e of eventTaken) {
    if (e.use === 'elim') fixedElims.set(`event:${e.k}|${e.room}`, { round: e.k, room: e.room })
  }
  // A pinned elim outside the elim slots (the tray, say) holds no cell but counts as decided, so
  // the quizzes it feeds still get placed
  for (const q of pinned) {
    if (q.phase === 'elim' && !fixedElims.has(q.id)) fixedElims.set(q.id, { round: -1, room: '' })
  }
  const gapRounds = Math.ceil(settings.totallingMinutes / settings.slotMinutes)
  // A division's elims use its prelim block; with every prelim pinned there is no block, so the
  // rooms its pinned prelims mostly use (a room it borrowed for a quiz or two isn't its own), or
  // failing those every room
  const elimRooms = (d: number) => {
    const block = placement.blocks[d] ?? []
    if (block.length > 0) return block
    const count = new Map<string, number>()
    for (const q of pinned) {
      if (q.phase === 'prelim' && q.division === divisions[d]!.id && q.cell) {
        count.set(q.cell.room, (count.get(q.cell.room) ?? 0) + 1)
      }
    }
    const most = Math.max(0, ...count.values())
    const used = [...roomIds].filter((r) => (count.get(r) ?? 0) * 2 >= most && most > 0)
    return used.length > 0 ? used : [...roomIds]
  }
  const scheduled = elimRounds(
    elims.map((quizzes, d) => ({
      quizzes: quizzes.filter((q) => !inFinalsSlots(q, divisions.length) && !isPinned(q)),
      all: quizzes,
      rooms: elimRooms(d),
    })),
    gapRounds,
    fixedElims,
    keepFrame ? oldSlots.elim.length : MAX_ELIM_ROUNDS,
  )

  // Finals in the sequence's free places
  // Finals are placed by place, a finals slot times the Finals side by side plus the room; no more
  // run side by side than there are rooms
  const side = Math.max(1, Math.min(settings.finals.sideBySide, roomIds.size))
  const pinnedFinals = new Set(
    pinnedAt('finals').flatMap(({ k, room }) => {
      const r = [...roomIds].indexOf(room)
      // In a room the Finals don't use, it still runs then, so it takes the whole slot
      return r >= 0 && r < side
        ? [k * side + r]
        : Array.from({ length: side }, (_, i) => k * side + i)
    }),
  )
  // A one-room event in a finals slot takes its room's place there too (H-3)
  for (const e of eventTaken) {
    const r = [...roomIds].indexOf(e.room)
    if (e.use === 'finals' && r >= 0 && r < side) pinnedFinals.add(e.k * side + r)
  }
  const finals = finalsOrder(
    doc,
    elims.flat().filter((q) => inFinalsSlots(q, divisions.length) && !isPinned(q)),
  )
  const finalsPlaces: number[] = []
  for (let k = 0; finalsPlaces.length < finals.length; k++)
    if (!pinnedFinals.has(k)) finalsPlaces.push(k)
  const finalsSlots = keepFrame
    ? oldSlots.finals.length
    : Math.ceil((Math.max(-1, ...finalsPlaces, ...pinnedFinals) + 1) / side)

  const built = keepFrame
    ? { rows: doc.frame, events: doc.events }
    : buildFrame(
        settings.framePreset,
        settings.slotMinutes,
        divisions.length === 0
          ? DEFAULT_SHAPE
          : { prelimSlots, elimSlots: scheduled.rounds, finalsSlots },
        settings.finals.spacingMinutes,
      )
  const frame = built.rows
  // An event keeps the rooms that are still there; one with none left waits in the tray
  const events = built.events.map((e) => {
    if (e.rooms === 'all') return e
    const kept = e.rooms.filter((r) => roomIds.has(r))
    return kept.length === e.rooms.length
      ? e
      : { ...e, rooms: kept, slot: kept.length ? e.slot : null }
  })
  const slots = slotsByUse(frame)
  const orderedRooms = rooms.map((r) => r.id)

  const quizzes: ScheduleQuiz[] = [...pinned]
  divisions.forEach((d, i) => {
    prelims[i]!.quizzes.forEach((q, n) => {
      if (prelimPinned(d, n, q.id)) return
      const cell = placement.cells.get(q.id)
      const slot = cell ? slots.prelim[Number(cell.slot.slice(1))] : undefined
      const label = `${d.name} Quiz ${n + 1}`
      quizzes.push({
        // The prelim already in the schedule keeps its id, so links to it still work
        id: idByKey.get(quizKey({ division: d.id, phase: 'prelim', label })) ?? q.id,
        label,
        division: d.id,
        phase: 'prelim',
        cell: cell && slot ? { slot, room: cell.room } : null,
        seats: q.letters.map((letter) => ({ kind: 'letter', letter })),
        pinned: false,
      })
    })
    for (const q of elims[i]!) {
      if (isPinned(q)) continue
      const round = scheduled.round.get(q.id)
      const room = scheduled.room.get(q.id)
      const f = finals.indexOf(q)
      let cell: ScheduleQuiz['cell'] = null
      if (f >= 0) {
        const k = finalsPlaces[f]!
        const slot = slots.finals[Math.floor(k / side)]
        if (slot) cell = { slot, room: orderedRooms[k % side] ?? orderedRooms[0]! }
      } else if (round !== undefined && room !== undefined) {
        const slot = slots.elim[round]
        if (slot) cell = { slot, room }
      }
      quizzes.push({ ...q, cell })
    }
  })

  const flowed = { ...doc, applied: structuredClone(settings), frame, rooms, quizzes, events }
  // Late teams play late (P-1): re-flow sorts what it places, as Sort does within each division's
  // rooms, so a settings change never undoes a Sort
  const late = divisions.filter((d) => lateLetters(doc, d.id).size > 0).map((d) => d.id)
  return late.length > 0
    ? sortPrelims(flowed, { divisions: late, includePinned: false, acrossRooms: false })
    : flowed
}

/**
 * Divisions' elims placed again where the generator would put them, around everything else as it
 * is (FR-034a): the frame, the prelims, other divisions' elims and, unless included, their own
 * pinned elims. It works from the settings the grid was built with, so waiting settings changes
 * aren't applied by it. Re-placed elims come out unpinned.
 */
export function replaceElims(
  doc: ScheduleDocument,
  options: { divisions: string[]; includePinned: boolean },
): ScheduleDocument {
  const chosen = new Set(options.divisions)
  // Only elims the generator makes can be placed again; one added by hand stays where it is, held
  // with everything else so no re-placed quiz lands in its cell
  const made = new Set(
    doc.applied.divisions
      .filter((d) => chosen.has(d.id) && d.teams > 0)
      .flatMap((d) => buildElimQuizzes(d).map(quizKey)),
  )
  const moving = (q: ScheduleQuiz) =>
    q.phase === 'elim' &&
    chosen.has(q.division) &&
    (options.includePinned || !q.pinned) &&
    made.has(quizKey(q))
  // Everything else is held where it is for the re-flow, then given back its own pins
  const held: ScheduleDocument = {
    ...doc,
    settings: doc.applied,
    quizzes: doc.quizzes.map((q) => ({ ...q, pinned: !moving(q) })),
  }
  const after = reflowSchedule(held, { keepFrame: true })
  // Every quiz not being re-placed stays exactly as it is, and the re-placed ones come back from
  // the re-flow, unpinned: only those, so a quiz the director deleted, in any division, stays gone
  const kept = doc.quizzes.filter((q) => !moving(q))
  const movingIds = new Set(doc.quizzes.filter(moving).map((q) => q.id))
  const placed = after.quizzes
    .filter((q) => movingIds.has(q.id))
    .map((q) => ({ ...q, pinned: false }))
  return {
    ...after,
    settings: doc.settings,
    applied: doc.applied,
    // Rows and events never move with a re-place
    frame: doc.frame,
    events: doc.events,
    quizzes: [...kept, ...placed],
  }
}

/** A whole schedule from its settings, nothing pinned (FR-009) */
export function generateSchedule(doc: ScheduleDocument): ScheduleDocument {
  return reflowSchedule({
    ...doc,
    frame: doc.frame.map((r) => ({ ...r, pinned: false })),
    events: doc.events.map((e) => ({ ...e, pinned: false })),
    quizzes: [],
  })
}

/** A setting whose value differs from what the grid was built with, and that value (FR-012a) */
export interface UnappliedSetting {
  section: 'teams' | 'frame' | 'prelims' | 'elims'
  key: string
  applied: string
}

const show = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v))

/** Every setting changed since the grid was last built, with its applied value (FR-012a) */
export function unappliedSettings(doc: ScheduleDocument): UnappliedSetting[] {
  const list: UnappliedSetting[] = []
  const { settings: now, applied: was } = doc
  const top: [keyof ScheduleSettings, UnappliedSetting['section']][] = [
    ['framePreset', 'frame'],
    ['slotMinutes', 'frame'],
    ['rooms', 'frame'],
    ['quizzesPerTeam', 'prelims'],
    ['prelimDraw', 'prelims'],
    ['lateTeams', 'prelims'],
    ['totallingMinutes', 'elims'],
    ['finals', 'elims'],
  ]
  for (const [key, section] of top) {
    if (show(now[key]) !== show(was[key])) list.push({ section, key, applied: show(was[key]) })
  }
  const before = new Map(was.divisions.map((d) => [d.id, d]))
  // The divisions themselves, not only how many: one removed and another added keeps the count
  const sameDivisions =
    now.divisions.length === was.divisions.length && now.divisions.every((d) => before.has(d.id))
  if (!sameDivisions) {
    list.push({ section: 'teams', key: 'divisions', applied: String(was.divisions.length) })
  }
  for (const d of now.divisions) {
    const old = before.get(d.id)
    if (!old) continue
    if (d.name !== old.name) list.push({ section: 'teams', key: `${d.id}.name`, applied: old.name })
    if (d.teams !== old.teams) {
      list.push({ section: 'teams', key: `${d.id}.teams`, applied: String(old.teams) })
    }
    if (show(d.elims) !== show(old.elims)) {
      list.push({ section: 'elims', key: `${d.id}.elims`, applied: show(old.elims) })
    }
  }
  return list
}

/** How many quizzes are in another cell after a change, the tray counting as a cell */
export function cellMoves(before: ScheduleDocument, after: ScheduleDocument): number {
  const was = new Map(before.quizzes.map((q) => [q.id, show(q.cell)]))
  return after.quizzes.filter((q) => was.get(q.id) !== show(q.cell)).length
}

/** How many quizzes Apply would move, change or remove (FR-012a) */
export function applyMoves(
  doc: ScheduleDocument,
  /** The re-flowed schedule, when the caller has it already */
  next = reflowSchedule(doc),
): number {
  const before = new Map(
    doc.quizzes.map((q) => [q.id, show({ c: q.cell, s: q.seats, l: q.label })]),
  )
  const kept = new Set(next.quizzes.map((q) => q.id))
  const changed = next.quizzes.filter(
    (q) => before.get(q.id) !== show({ c: q.cell, s: q.seats, l: q.label }),
  ).length
  return changed + doc.quizzes.filter((q) => !kept.has(q.id)).length
}

/** Which generated quiz a quiz is: its division, phase, lane or line, and number */
function quizKey(q: Pick<ScheduleQuiz, 'division' | 'phase' | 'lane' | 'line' | 'label'>): string {
  const place = q.phase === 'prelim' ? '' : q.line !== undefined ? `l${q.line}` : `${q.lane ?? 0}`
  return [q.division, q.phase, place, quizNumber(q)].join('|')
}
