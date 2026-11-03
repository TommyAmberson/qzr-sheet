import { buildElimQuizzes } from './elims'
import { buildFrame, DEFAULT_SHAPE, defaultRoomCount } from './frame'
import { placePrelims, type PrelimDivision } from './placement'
import { drawPrelims } from './prelimDraw'
import { quizNumber } from './names'
import type {
  DivisionSettings,
  FrameRow,
  ScheduleDocument,
  ScheduleQuiz,
  ScheduleSettings,
  Seat,
} from './scheduleFile'

/** Prelim rounds a weekend starts from: five Friday evening, three Saturday morning */
const BASE_PRELIM_SLOTS = { weekend: 8, oneRoom: 8, oneDay: 6 } as const

/** Beyond this many elim rounds something can never become ready; stop rather than loop */
const MAX_ELIM_ROUNDS = 60

type Use = 'prelim' | 'elim' | 'finals'

/** A seat's team as a key, so two quizzes in one round can't share one (H-1) */
function seatKey(seat: Seat): string | null {
  switch (seat.kind) {
    case 'rank':
    case 'new':
      return `${seat.kind}:${seat.rank}`
    case 'place':
      return `place:${seat.quiz}:${seat.place}`
    case 'points':
      return `points:${seat.place}`
    default:
      return null
  }
}

/** The frame's slots grouped by use, in order; a slot added by hand takes the use of the one before */
function slotsByUse(frame: FrameRow[]): Record<Use, string[]> {
  const byUse: Record<Use, string[]> = { prelim: [], elim: [], finals: [] }
  let use: Use = 'prelim'
  for (const row of frame) {
    if (row.kind !== 'slot') continue
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
      for (const q of ready) {
        if (free.length === 0) break
        const keys = q.seats.map(seatKey).filter((k): k is string => k !== null)
        if (keys.some((k) => used.has(k))) continue
        keys.forEach((k) => used.add(k))
        round.set(q.id, r)
        room.set(q.id, free.shift()!)
        left[d]!.splice(left[d]!.indexOf(q), 1)
      }
    })
    r++
  }
  return { round, room, rounds: round.size > 0 ? Math.max(...round.values()) + 1 : 0 }
}

/**
 * The order Finals run in: the director's, or by default the highest division first, each
 * division's consolation Finals just before its own (FR-019a)
 */
function finalsOrder(doc: ScheduleDocument, finals: ScheduleQuiz[]): ScheduleQuiz[] {
  const key = (q: ScheduleQuiz) => `${q.division}:${q.lane ?? 0}`
  const chosen = doc.settings.finals.order
  const divisionIndex = (q: ScheduleQuiz) =>
    doc.settings.divisions.findIndex((d) => d.id === q.division)
  return [...finals].sort((a, b) => {
    const ia = chosen.indexOf(key(a))
    const ib = chosen.indexOf(key(b))
    if (ia >= 0 || ib >= 0) return (ia < 0 ? Infinity : ia) - (ib < 0 ? Infinity : ib)
    return divisionIndex(b) - divisionIndex(a) || (b.lane ?? 0) - (a.lane ?? 0)
  })
}

const isFinals = (q: ScheduleQuiz) => q.deciding === true && q.label.endsWith('Finals')

/**
 * The schedule re-flowed to its settings, around every pinned quiz (FR-012, H-19): pinned quizzes
 * keep their cell, label and seats, and everything else is placed again. A pinned quiz in a room
 * that no longer exists goes to the tray, still pinned. While any frame row is pinned the frame is
 * kept as it is and the quizzes fit into it; otherwise it is rebuilt to fit. Nothing is placed
 * against a hard rule; what can't be placed is left in the tray (FR-013).
 */
export function reflowSchedule(doc: ScheduleDocument): ScheduleDocument {
  const { settings } = doc
  const divisions = settings.divisions.filter((d) => d.teams > 0)
  const keepFrame = doc.frame.some((r) => r.pinned)
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
        ? defaultRoomCount(totalPrelims, base)
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
  const prelimPinned = (d: DivisionSettings, n: number, id: string) =>
    isPinned({ id, division: d.id, phase: 'prelim', label: `${d.name} Quiz ${n + 1}` })
  const pinnedAt = (use: Use) =>
    pinned.flatMap((q) => {
      const pos = q.cell ? positionOf.get(q.cell.slot) : undefined
      return pos?.use === use ? [{ q, k: pos.k, room: q.cell!.room }] : []
    })

  // Prelims, around pinned quizzes' cells and letters
  const fixedPrelims = [...pinnedAt('prelim')].map(({ q, k, room }) => ({
    slot: `p${k}`,
    room,
    division: q.phase === 'prelim' ? q.division : undefined,
    letters: q.seats.flatMap((s) => (s.kind === 'letter' ? [s.letter] : [])),
  }))
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

  // Elims, each division in its own rooms, around pinned elims
  const elims = divisions.map((d) => buildElimQuizzes(d))
  const fixedElims = new Map(pinnedAt('elim').map(({ q, k, room }) => [q.id, { round: k, room }]))
  const gapRounds = Math.ceil(settings.totallingMinutes / settings.slotMinutes)
  const scheduled = elimRounds(
    elims.map((quizzes, d) => ({
      quizzes: quizzes.filter((q) => !isFinals(q) && !isPinned(q)),
      all: quizzes,
      rooms: placement.blocks[d] ?? [],
    })),
    gapRounds,
    fixedElims,
    keepFrame ? oldSlots.elim.length : MAX_ELIM_ROUNDS,
  )

  // Finals in the sequence's free places
  const pinnedFinals = new Set(pinnedAt('finals').map(({ k }) => k))
  const finals = finalsOrder(
    doc,
    elims.flat().filter((q) => isFinals(q) && !isPinned(q)),
  )
  const finalsPlaces: number[] = []
  for (let k = 0; finalsPlaces.length < finals.length; k++)
    if (!pinnedFinals.has(k)) finalsPlaces.push(k)
  const side = settings.finals.sideBySide
  const finalsSlots = keepFrame
    ? oldSlots.finals.length
    : Math.ceil((Math.max(-1, ...finalsPlaces, ...pinnedFinals) + 1) / side)

  const frame = keepFrame
    ? doc.frame
    : buildFrame(
        settings.framePreset,
        settings.slotMinutes,
        divisions.length === 0
          ? DEFAULT_SHAPE
          : { prelimSlots, elimSlots: scheduled.rounds, finalsSlots },
        settings.finals.spacingMinutes,
      )
  const slots = slotsByUse(frame)
  const orderedRooms = rooms.map((r) => r.id)

  const quizzes: ScheduleQuiz[] = [...pinned]
  divisions.forEach((d, i) => {
    prelims[i]!.quizzes.forEach((q, n) => {
      if (prelimPinned(d, n, q.id)) return
      const cell = placement.cells.get(q.id)
      const slot = cell ? slots.prelim[Number(cell.slot.slice(1))] : undefined
      quizzes.push({
        id: q.id,
        label: `${d.name} Quiz ${n + 1}`,
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

  return { ...doc, applied: structuredClone(settings), frame, rooms, quizzes }
}

/** A whole schedule from its settings, nothing pinned (FR-009) */
export function generateSchedule(doc: ScheduleDocument): ScheduleDocument {
  return reflowSchedule({
    ...doc,
    frame: doc.frame.map((r) => ({ ...r, pinned: false })),
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
    ['finals', 'frame'],
    ['quizzesPerTeam', 'prelims'],
    ['prelimDraw', 'prelims'],
    ['totallingMinutes', 'elims'],
  ]
  for (const [key, section] of top) {
    if (show(now[key]) !== show(was[key])) list.push({ section, key, applied: show(was[key]) })
  }
  const before = new Map(was.divisions.map((d) => [d.id, d]))
  if (now.divisions.length !== was.divisions.length) {
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

/** What Apply would do, and how many quizzes it would move or change (FR-012a) */
export function applyPreview(doc: ScheduleDocument): { doc: ScheduleDocument; moves: number } {
  const next = reflowSchedule(doc)
  const before = new Map(
    doc.quizzes.map((q) => [q.id, show({ c: q.cell, s: q.seats, l: q.label })]),
  )
  const moves = next.quizzes.filter(
    (q) => before.get(q.id) !== show({ c: q.cell, s: q.seats, l: q.label }),
  ).length
  return {
    doc: next,
    moves: moves + doc.quizzes.filter((q) => !next.quizzes.some((n) => n.id === q.id)).length,
  }
}

/** Which generated quiz a quiz is: its division, phase, lane or line, and number */
function quizKey(q: Pick<ScheduleQuiz, 'division' | 'phase' | 'lane' | 'line' | 'label'>): string {
  const place = q.phase === 'prelim' ? '' : q.line !== undefined ? `l${q.line}` : `${q.lane ?? 0}`
  return [q.division, q.phase, place, quizNumber(q)].join('|')
}
