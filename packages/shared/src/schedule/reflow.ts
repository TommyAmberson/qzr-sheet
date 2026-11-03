import { buildElimQuizzes } from './elims'
import { buildFrame, DEFAULT_SHAPE, defaultRoomCount } from './frame'
import { placePrelims, type PrelimDivision } from './placement'
import { drawPrelims } from './prelimDraw'
import type { ScheduleDocument, ScheduleQuiz, Seat } from './scheduleFile'

/** Prelim rounds a weekend starts from: five Friday evening, three Saturday morning */
const BASE_PRELIM_SLOTS = { weekend: 8, oneRoom: 8, oneDay: 6 } as const

/** Beyond this many elim rounds something can never become ready; stop rather than loop */
const MAX_ELIM_ROUNDS = 60

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

/**
 * Elim rounds for every division's regular quizzes (Finals aside), each division in its own rooms.
 * A quiz is ready once every quiz it takes a team from is in an earlier round (H-12), every quiz of
 * the intermediate behind a `New n` seat is far enough back to total (W-3), and, for a lane's
 * deciding quiz, every other quiz of its lane is earlier (H-13).
 */
function elimRounds(
  divisions: { quizzes: ScheduleQuiz[]; rooms: string[] }[],
  gapRounds: number,
): { round: Map<string, number>; room: Map<string, string>; rounds: number } {
  const round = new Map<string, number>()
  const room = new Map<string, string>()
  let r = 0
  const left = divisions.map((d) => [...d.quizzes])
  while (left.some((l) => l.length > 0) && r < MAX_ELIM_ROUNDS) {
    divisions.forEach((division, d) => {
      const used = new Set<string>()
      const free = [...division.rooms]
      const ready = left[d]!.filter((q) => {
        for (const seat of q.seats) {
          if (seat.kind === 'place') {
            const at = round.get(seat.quiz)
            if (at === undefined || at >= r) return false
          }
          if (seat.kind === 'new') {
            // Its line's whole intermediate, or the quiz in its own bracket that seats the rank
            const seating = division.quizzes.filter((x) =>
              x.seats.some((s) => s.kind === 'rank' && s.rank === seat.rank),
            )
            const line = seating.find((x) => x.line !== undefined)?.line
            const feeders =
              line === undefined ? seating : division.quizzes.filter((x) => x.line === line)
            if (feeders.some((x) => (round.get(x.id) ?? Infinity) > r - 1 - gapRounds)) return false
          }
        }
        if (q.deciding) {
          const lane = division.quizzes.filter((x) => x.lane === q.lane && x !== q)
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

/**
 * A whole schedule from its settings: frame, rooms, prelims, each division's stats break, elims and
 * Finals (FR-009), with nothing pinned. The generator never places a quiz against a hard rule;
 * what can't be placed is left in the tray (FR-013).
 */
export function generateSchedule(doc: ScheduleDocument): ScheduleDocument {
  const { settings } = doc
  const divisions = settings.divisions.filter((d) => d.teams > 0)

  const prelims: PrelimDivision[] = divisions.map((d) => ({
    id: d.id,
    quizzes: drawPrelims(d.teams, settings.prelimDraw, settings.quizzesPerTeam).map(
      (letters, i) => ({
        id: `${d.id}-P${i + 1}`,
        letters,
      }),
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
  const rooms = Array.from({ length: roomCount }, (_, i) => ({
    id: `room-${i + 1}`,
    name: `Room ${i + 1}`,
  }))
  const roomIds = rooms.map((r) => r.id)

  // Enough prelim rounds for every prelim quiz to find a cell
  let prelimSlots =
    divisions.length === 0
      ? DEFAULT_SHAPE.prelimSlots
      : Math.max(base, Math.ceil(totalPrelims / roomCount))
  const slotNames = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`)
  let placement = placePrelims({
    divisions: prelims,
    slots: slotNames(prelimSlots),
    rooms: roomIds,
    fixed: [],
  })
  while (placement.unplaced.length > 0 && prelimSlots < base * 4) {
    prelimSlots++
    placement = placePrelims({
      divisions: prelims,
      slots: slotNames(prelimSlots),
      rooms: roomIds,
      fixed: [],
    })
  }

  const elims = divisions.map((d) => buildElimQuizzes(d))
  const isFinals = (q: ScheduleQuiz) => q.deciding === true && q.label.endsWith('Finals')
  const gapRounds = Math.ceil(settings.totallingMinutes / settings.slotMinutes)
  const scheduled = elimRounds(
    elims.map((quizzes, d) => ({
      quizzes: quizzes.filter((q) => !isFinals(q)),
      rooms: placement.blocks[d] ?? [],
    })),
    gapRounds,
  )
  const finals = finalsOrder(doc, elims.flat().filter(isFinals))
  const finalsSlots = Math.ceil(finals.length / settings.finals.sideBySide)

  const frame = buildFrame(
    settings.framePreset,
    settings.slotMinutes,
    divisions.length === 0
      ? DEFAULT_SHAPE
      : { prelimSlots, elimSlots: scheduled.rounds, finalsSlots },
    settings.finals.spacingMinutes,
  )
  const slotIds = frame.flatMap((r) => (r.kind === 'slot' ? [r.id] : []))
  const prelimSlotId = (name: string) => slotIds[Number(name.slice(1))]!
  const elimSlotId = (round: number) => slotIds[prelimSlots + round]!
  const finalsSlotId = (k: number) =>
    slotIds[prelimSlots + scheduled.rounds + Math.floor(k / settings.finals.sideBySide)]!

  const quizzes: ScheduleQuiz[] = []
  divisions.forEach((d, i) => {
    prelims[i]!.quizzes.forEach((q, n) => {
      const cell = placement.cells.get(q.id)
      quizzes.push({
        id: q.id,
        label: `${d.name} Quiz ${n + 1}`,
        division: d.id,
        phase: 'prelim',
        cell: cell ? { slot: prelimSlotId(cell.slot), room: cell.room } : null,
        seats: q.letters.map((letter) => ({ kind: 'letter', letter })),
        pinned: false,
      })
    })
    for (const q of elims[i]!) {
      const round = scheduled.round.get(q.id)
      const room = scheduled.room.get(q.id)
      const finalsAt = finals.indexOf(q)
      const cell =
        finalsAt >= 0
          ? {
              slot: finalsSlotId(finalsAt),
              room: roomIds[finalsAt % settings.finals.sideBySide] ?? roomIds[0]!,
            }
          : round !== undefined && room !== undefined
            ? { slot: elimSlotId(round), room }
            : null
      quizzes.push({ ...q, cell })
    }
  })

  return { ...doc, applied: structuredClone(settings), frame, rooms, quizzes }
}
