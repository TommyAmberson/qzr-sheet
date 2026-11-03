import { quizNumber } from './names'
import type { ScheduleDocument, ScheduleQuiz } from './scheduleFile'

/** A division's prelim quizzes, in draw order, with their letters */
export interface PrelimDivision {
  id: string
  quizzes: { id: string; letters: string[] }[]
}

export interface Cell {
  slot: string
  room: string
}

export interface PlacementInput {
  /** In division order: Div 1 takes the lowest rooms (P-2) */
  divisions: PrelimDivision[]
  /** The prelim slots, in time order */
  slots: string[]
  /** The rooms, in order */
  rooms: string[]
  /** Cells already taken (pinned quizzes, one-room events); a division's letters too, if given */
  fixed: (Cell & { division?: string; letters?: string[] })[]
}

export interface PlacementResult {
  cells: Map<string, Cell>
  /** Each division's own block of rooms, in division order; its elims keep to them (P-3) */
  blocks: string[][]
  /** Quizzes that fit nowhere without breaking a hard rule, and why (FR-013) */
  unplaced: { id: string; reason: string }[]
}

/**
 * Each division's share of the rooms, by its share of the quizzes, at least one room each while
 * there are rooms to go round (largest remainder), as adjacent blocks in division order (FR-019).
 */
function roomBlocks(divisions: PrelimDivision[], rooms: string[]): string[][] {
  const total = divisions.reduce((n, d) => n + d.quizzes.length, 0)
  if (total === 0) return divisions.map(() => [])
  const exact = divisions.map((d) => (d.quizzes.length / total) * rooms.length)
  const sizes = exact.map((x, i) =>
    divisions[i]!.quizzes.length > 0 ? Math.max(1, Math.floor(x)) : 0,
  )
  const order = exact
    .map((x, i) => ({ i, rest: x - Math.floor(x) }))
    .sort((a, b) => b.rest - a.rest)
  for (let k = 0; sizes.reduce((a, b) => a + b, 0) < rooms.length; k++)
    sizes[order[k % order.length]!.i]!++
  while (sizes.reduce((a, b) => a + b, 0) > rooms.length) {
    const biggest = sizes.indexOf(Math.max(...sizes))
    sizes[biggest]!--
  }
  const blocks: string[][] = []
  let next = 0
  for (const size of sizes) {
    blocks.push(rooms.slice(next, next + size))
    next += size
  }
  return blocks
}

/**
 * Where each prelim quiz goes (P-2 to P-5, P-8). Each division fills its own block of rooms slot by
 * slot from its first slot, picking the earliest-numbered quizzes that share no letter. What its
 * block can't hold is borrowed into the latest free cells, the nearest rooms first, so the room's
 * own division keeps it until done (P-3). A quiz that fits nowhere is left unplaced, never placed
 * against a hard rule.
 */
export function placePrelims(input: PlacementInput): PlacementResult {
  const { divisions, slots, rooms } = input
  const cells = new Map<string, Cell>()
  const taken = new Set(input.fixed.map((f) => `${f.slot}|${f.room}`))
  const lettersAt = new Map<string, Set<string>>()
  const busyLetters = (slot: string, division: string) => {
    const key = `${slot}|${division}`
    let set = lettersAt.get(key)
    if (!set) lettersAt.set(key, (set = new Set()))
    return set
  }
  for (const f of input.fixed) {
    if (f.division && f.letters) for (const l of f.letters) busyLetters(f.slot, f.division).add(l)
  }
  const place = (division: string, q: { id: string; letters: string[] }, cell: Cell) => {
    cells.set(q.id, cell)
    taken.add(`${cell.slot}|${cell.room}`)
    for (const l of q.letters) busyLetters(cell.slot, division).add(l)
  }

  const blocks = roomBlocks(divisions, rooms)
  const freeIn = (slot: string, room: string) => !taken.has(`${slot}|${room}`)

  // First every division in its own rooms; a division that doesn't fit is set aside
  const overflowing: number[] = []
  divisions.forEach((division, d) => {
    const freeAt = slots.map((slot) => blocks[d]!.filter((room) => freeIn(slot, room)))
    const plan = packDivision(division.quizzes, freeAt, (i) => busyLetters(slots[i]!, division.id))
    if (plan.left.length > 0) overflowing.push(d)
    else
      plan.placed.forEach(({ quiz, slot, room }) =>
        place(division.id, quiz, { slot: slots[slot]!, room }),
      )
  })

  // Then each one that didn't fit borrows other rooms' free cells, latest and nearest first, only
  // as many as it needs, so a borrowed room stays its own division's until that one is done (P-3)
  const unplaced: PlacementResult['unplaced'] = []
  for (const d of overflowing) {
    const division = divisions[d]!
    const home = blocks[d]!.map((r) => rooms.indexOf(r))
    const centre = home.length > 0 ? (Math.min(...home) + Math.max(...home)) / 2 : 0
    const borrowable = slots
      .map((slot, i) => ({ slot, i }))
      .reverse()
      .flatMap(({ slot, i }) =>
        rooms
          .filter((room) => !blocks[d]!.includes(room) && freeIn(slot, room))
          .sort((a, b) => Math.abs(rooms.indexOf(a) - centre) - Math.abs(rooms.indexOf(b) - centre))
          .map((room) => ({ slot: i, room })),
      )
    const ownCapacity = slots.reduce(
      (n, slot) => n + blocks[d]!.filter((room) => freeIn(slot, room)).length,
      0,
    )
    let plan: ReturnType<typeof packDivision> | null = null
    for (
      let extra = Math.max(0, division.quizzes.length - ownCapacity);
      extra <= borrowable.length;
      extra++
    ) {
      const lent = borrowable.slice(0, extra)
      const freeAt = slots.map((slot, i) => [
        ...blocks[d]!.filter((room) => freeIn(slot, room)),
        ...lent.filter((c) => c.slot === i).map((c) => c.room),
      ])
      plan = packDivision(division.quizzes, freeAt, (i) => busyLetters(slots[i]!, division.id))
      if (plan.left.length === 0) break
    }
    plan?.placed.forEach(({ quiz, slot, room }) =>
      place(division.id, quiz, { slot: slots[slot]!, room }),
    )
    for (const q of plan?.left ?? division.quizzes) {
      unplaced.push({
        id: q.id,
        reason: 'No free room in a prelim slot where its teams are all free',
      })
    }
  }

  return { cells, blocks, unplaced }
}

type Quiz = { id: string; letters: string[] }

/** How many search steps one division may take before settling for the best plan found */
const SEARCH_LIMIT = 20000

/**
 * A division's quizzes packed into its own rooms slot by slot from the first slot, with no letter
 * twice in a slot: a depth-first search that tries the earliest-numbered sets first and backtracks
 * when a later slot can't take what's left, keeping the plan that leaves fewest quizzes over.
 */
function packDivision(
  quizzes: Quiz[],
  freeAt: string[][],
  busyAt: (slot: number) => Set<string>,
): { placed: { quiz: Quiz; slot: number; room: string }[]; left: Quiz[] } {
  const capacityFrom = freeAt.map((_, i) => freeAt.slice(i).reduce((n, f) => n + f.length, 0))
  let best: { placed: { quiz: Quiz; slot: number; room: string }[]; left: Quiz[] } | null = null
  let steps = 0
  const placed: { quiz: Quiz; slot: number; room: string }[] = []

  const search = (slot: number, queue: Quiz[]): boolean => {
    if (++steps > SEARCH_LIMIT) return true
    const unavoidable = queue.length - (capacityFrom[slot] ?? 0)
    if (best && Math.max(0, unavoidable) >= best.left.length) return false
    if (queue.length === 0 || slot === freeAt.length) {
      if (!best || queue.length < best.left.length) best = { placed: [...placed], left: [...queue] }
      return queue.length === 0
    }
    const rooms = freeAt[slot]!
    for (const set of disjointSets(queue, Math.min(rooms.length, queue.length), busyAt(slot))) {
      set.forEach((qi, k) => placed.push({ quiz: queue[qi]!, slot, room: rooms[k]! }))
      const rest = queue.filter((_, qi) => !set.includes(qi))
      if (search(slot + 1, rest)) return true
      placed.length -= set.length
    }
    return false
  }
  search(0, quizzes)
  return best ?? { placed: [], left: quizzes }
}

/**
 * Sets of up to `count` quizzes sharing no letter with each other or with `busy`, largest first and
 * earliest-numbered first within a size; the empty set last, so a slot can be left for later.
 */
function* disjointSets(queue: Quiz[], count: number, busy: Set<string>): Generator<number[]> {
  for (let size = count; size >= 0; size--) {
    let yielded = 0
    const chosen: number[] = []
    const used = new Set(busy)
    function* grow(from: number): Generator<number[]> {
      if (chosen.length === size) {
        yield [...chosen]
        return
      }
      for (let i = from; i < queue.length; i++) {
        const letters = queue[i]!.letters
        if (letters.some((l) => used.has(l))) continue
        chosen.push(i)
        for (const l of letters) used.add(l)
        yield* grow(i + 1)
        chosen.pop()
        for (const l of letters) used.delete(l)
      }
    }
    for (const set of grow(0)) {
      yield set
      // Many sets of one size differ only in later quizzes; a few is enough to back out of a corner
      if (++yielded >= 8) break
    }
  }
}

// ---- Sort (FR-042a) ----

export interface SortOptions {
  /** The divisions to sort; all when absent */
  divisions?: string[]
  /** Sort pinned prelims too, unpinning them */
  includePinned: boolean
  /** Let every sorted quiz move between rooms */
  acrossRooms: boolean
}

interface SortCell {
  t: number
  room: string
}

const prelimNumber = (q: ScheduleQuiz) => Number(quizNumber(q)) || 0

/**
 * Prelims placed again in quiz order, with drawn late teams' quizzes in the latest cells
 * available, including empty cells and free cells in other divisions' rooms (P-1); the others stay
 * in their division's rooms. Across rooms, every sorted quiz may move between rooms, but each
 * division keeps a block of adjacent rooms whose edge with the next moves at most once, so no room
 * switches back (P-2, P-3). Pinned quizzes stay unless included. Sorting is never a side effect.
 */
export function sortPrelims(doc: ScheduleDocument, options: SortOptions): ScheduleDocument {
  const next = structuredClone(doc)
  let use: string = 'prelim'
  const slots: string[] = []
  for (const row of next.frame) {
    if (row.kind !== 'slot') continue
    use = row.use ?? use
    if (use === 'prelim') slots.push(row.id)
  }
  const slotIndex = new Map(slots.map((id, i) => [id, i]))
  const rooms = next.rooms.map((r) => r.id)
  const sorted = next.settings.divisions.filter(
    (d) => d.teams > 0 && (!options.divisions || options.divisions.includes(d.id)),
  )
  const prelimsOf = (division: string) =>
    next.quizzes.filter((q) => q.division === division && q.phase === 'prelim')
  const lateLetters = (division: string) =>
    new Set(
      (next.draw[division]?.teams ?? []).filter((t) => t.late && t.letter).map((t) => t.letter!),
    )
  const letters = (q: ScheduleQuiz) =>
    q.seats.flatMap((s) => (s.kind === 'letter' ? [s.letter] : []))
  const lateness = (q: ScheduleQuiz, late: Set<string>) =>
    letters(q).filter((l) => late.has(l)).length

  // Where each sorted division's prelims are now, for its own rooms and block edges
  const homeRooms = new Map(
    next.settings.divisions.map((d) => [
      d.id,
      rooms.filter((r) => prelimsOf(d.id).some((q) => q.cell?.room === r)),
    ]),
  )

  // Take the sorted quizzes off the grid
  const moving = new Map<string, ScheduleQuiz[]>()
  for (const d of sorted) {
    const qs = prelimsOf(d.id).filter((q) => options.includePinned || !q.pinned)
    for (const q of qs) {
      q.cell = null
      q.pinned = false
    }
    moving.set(d.id, qs)
  }
  const taken = new Set(
    next.quizzes.flatMap((q) => (q.cell ? [`${q.cell.slot}|${q.cell.room}`] : [])),
  )
  for (const row of next.frame) {
    if (row.kind === 'event' && row.room) {
      for (const s of next.frame) {
        if (
          s.kind === 'slot' &&
          slotIndex.has(s.id) &&
          row.at < s.at + s.minutes &&
          s.at < row.at + row.minutes
        ) {
          taken.add(`${s.id}|${row.room}`)
        }
      }
    }
  }
  const busy = new Map<string, Set<string>>()
  const busyAt = (t: number, division: string) => {
    const key = `${t}|${division}`
    let set = busy.get(key)
    if (!set) busy.set(key, (set = new Set()))
    return set
  }
  for (const q of next.quizzes) {
    if (q.phase === 'prelim' && q.cell && slotIndex.has(q.cell.slot)) {
      for (const l of letters(q)) busyAt(slotIndex.get(q.cell.slot)!, q.division).add(l)
    }
  }
  const put = (q: ScheduleQuiz, cell: SortCell) => {
    q.cell = { slot: slots[cell.t]!, room: cell.room }
    taken.add(`${q.cell.slot}|${cell.room}`)
    for (const l of letters(q)) busyAt(cell.t, q.division).add(l)
  }
  const fits = (q: ScheduleQuiz, cell: SortCell) =>
    !taken.has(`${slots[cell.t]}|${cell.room}`) &&
    letters(q).every((l) => !busyAt(cell.t, q.division).has(l))

  if (!options.acrossRooms) {
    for (const d of sorted) {
      const qs = moving.get(d.id)!
      const late = lateLetters(d.id)
      const own = homeRooms.get(d.id)!.length > 0 ? homeRooms.get(d.id)! : rooms
      const anyRoom = [...own, ...rooms.filter((r) => !own.includes(r))]
      // Late teams' quizzes first, from the latest slot back, in any room, own rooms first
      const lateQs = qs
        .filter((q) => lateness(q, late) > 0)
        .sort((a, b) => lateness(b, late) - lateness(a, late) || prelimNumber(b) - prelimNumber(a))
      for (let t = slots.length - 1; t >= 0; t--) {
        for (const room of anyRoom) {
          const i = lateQs.findIndex((q) => fits(q, { t, room }))
          if (i >= 0) put(lateQs.splice(i, 1)[0]!, { t, room })
        }
      }
      // Then the rest from the first slot in quiz order, in its own rooms, borrowing what's left
      const onTime = [...qs.filter((q) => lateness(q, late) === 0), ...lateQs].sort(
        (a, b) => prelimNumber(a) - prelimNumber(b),
      )
      const plan = packDivision(
        onTime.map((q) => ({ id: q.id, letters: letters(q) })),
        slots.map((slot) => own.filter((room) => !taken.has(`${slot}|${room}`))),
        (t) => busyAt(t, d.id),
      )
      for (const p of plan.placed)
        put(onTime.find((q) => q.id === p.quiz.id)!, { t: p.slot, room: p.room })
      for (const left of plan.left) {
        const q = onTime.find((x) => x.id === left.id)!
        for (let t = slots.length - 1; t >= 0 && !q.cell; t--) {
          const room = anyRoom.find((r) => fits(q, { t, room: r }))
          if (room) put(q, { t, room })
        }
      }
    }
    return next
  }

  // Across rooms: the block-edge search
  const divisions = next.settings.divisions.filter((d) => d.teams > 0)
  const R = rooms.length
  const T = slots.length
  const own = divisions.map((_, k) =>
    Math.min(
      R,
      Math.max(
        0,
        ...divisions
          .slice(0, k + 1)
          .flatMap((d) => homeRooms.get(d.id)!.map((r) => rooms.indexOf(r) + 1)),
      ),
    ),
  )
  type Edge = [before: number, after: number, from: number]
  const at = ([s, e, c]: Edge, t: number) => (t < c ? s : e)
  const options_ = (s: number): Edge[] => [
    [s, s, T],
    ...Array.from({ length: R + 1 }, (_, e) => e)
      .filter((e) => e !== s)
      .flatMap((e) => Array.from({ length: T - 1 }, (_, c) => [s, e, c + 1] as Edge)),
  ]
  interface Block {
    cells: SortCell[]
    placed: (ScheduleQuiz | null)[]
    left: ScheduleQuiz[]
    start: number
  }
  const fillBlock = (division: string, cells: SortCell[]): Block => {
    const late = lateLetters(division)
    const pool = moving.get(division) ?? []
    const used = new Map<number, Set<string>>()
    const inSlot = (t: number) => {
      let set = used.get(t)
      if (!set) used.set(t, (set = new Set(busyAt(t, division))))
      return set
    }
    const placed: (ScheduleQuiz | null)[] = cells.map(() => null)
    const ok = (q: ScheduleQuiz, t: number) => letters(q).every((l) => !inSlot(t).has(l))
    const set = (q: ScheduleQuiz, i: number) => {
      placed[i] = q
      for (const l of letters(q)) inSlot(cells[i]!.t).add(l)
    }
    const unset = (i: number) => {
      for (const l of letters(placed[i]!)) inSlot(cells[i]!.t).delete(l)
      placed[i] = null
    }
    const lateQs = pool
      .filter((q) => lateness(q, late) > 0)
      .sort((a, b) => lateness(b, late) - lateness(a, late) || prelimNumber(b) - prelimNumber(a))
    const rest = pool
      .filter((q) => lateness(q, late) === 0)
      .sort((a, b) => prelimNumber(a) - prelimNumber(b))
    const take = (list: ScheduleQuiz[], t: number) => {
      const i = list.findIndex((q) => ok(q, t))
      return i < 0 ? null : list.splice(i, 1)[0]!
    }
    for (let i = cells.length - 1; i >= 0 && lateQs.length > 0; i--) {
      const q = take(lateQs, cells[i]!.t)
      if (q) set(q, i)
    }
    for (let i = 0; i < cells.length && rest.length > 0; i++) {
      if (placed[i]) continue
      const q = take(rest, cells[i]!.t)
      if (q) set(q, i)
    }
    // A leftover takes a free cell, or swaps with the latest quiz it can, that quiz moving to a free
    // cell in another slot
    const left = [...lateQs, ...rest].filter((q) => {
      const free = placed.findIndex((x, n) => !x && ok(q, cells[n]!.t))
      if (free >= 0) return (set(q, free), false)
      for (let j = cells.length - 1; j >= 0; j--) {
        const y = placed[j]
        if (!y) continue
        unset(j)
        const k = ok(q, cells[j]!.t)
          ? placed.findIndex(
              (x, n) => !x && n !== j && cells[n]!.t !== cells[j]!.t && ok(y, cells[n]!.t),
            )
          : -1
        if (k >= 0) return (set(q, j), set(y, k), false)
        set(y, j)
      }
      return true
    })
    const first = (l: string) =>
      Math.min(T, ...placed.flatMap((q, i) => (q && letters(q).includes(l) ? [cells[i]!.t] : [])))
    // Spare cells drift to the end, as long as no late team starts earlier (P-8)
    for (let i = 0; i < cells.length; i++) {
      if (placed[i]) continue
      for (let j = cells.length - 1; j > i; j--) {
        const q = placed[j]
        if (!q || cells[j]!.t === cells[i]!.t || !ok(q, cells[i]!.t)) continue
        if (letters(q).some((l) => late.has(l) && cells[i]!.t < first(l))) continue
        unset(j)
        set(q, i)
        break
      }
    }
    return { cells, placed, left, start: [...late].reduce((n, l) => n + first(l), 0) }
  }

  const memo = new Map<string, Block>()
  const blockOf = (k: number, lo: Edge, hi: Edge): Block | null => {
    const division = divisions[k]!
    if (!moving.has(division.id)) return null
    const key = `${k}|${lo}|${hi}`
    if (!memo.has(key)) {
      const cells: SortCell[] = []
      for (let t = 0; t < T; t++) {
        for (let r = at(lo, t) + 1; r <= at(hi, t); r++) {
          const room = rooms[r - 1]!
          if (!taken.has(`${slots[t]}|${room}`)) cells.push({ t, room })
        }
      }
      memo.set(key, fillBlock(division.id, cells))
    }
    return memo.get(key)!
  }
  interface Plan {
    left: number
    start: number
    moves: number
    dist: number
    blocks: Block[]
  }
  let best: Plan | null = null
  const better = (a: Plan, b: Plan | null) =>
    !b || (a.left - b.left || b.start - a.start || a.moves - b.moves || a.dist - b.dist) < 0
  const edges: Edge[] = [[0, 0, T]]
  const search = (k: number, acc: Plan) => {
    if (best && acc.left > best.left) return
    const last = k === divisions.length - 1
    for (const hi of last ? [[R, R, T] as Edge] : options_(own[k]!)) {
      if (Array.from({ length: T }, (_, t) => t).some((t) => at(hi, t) < at(edges[k]!, t))) continue
      const block = blockOf(k, edges[k]!, hi)
      const plan: Plan = {
        left: acc.left + (block?.left.length ?? 0),
        start: acc.start + (block?.start ?? 0),
        moves: acc.moves + Math.abs(hi[0] - hi[1]),
        dist:
          acc.dist +
          (last
            ? 0
            : Array.from({ length: T }, (_, t) => Math.abs(at(hi, t) - own[k]!)).reduce(
                (a, b) => a + b,
                0,
              )),
        blocks: block ? [...acc.blocks, block] : acc.blocks,
      }
      if (last) {
        if (better(plan, best)) best = plan
        continue
      }
      edges.push(hi)
      search(k + 1, plan)
      edges.pop()
    }
  }
  if (divisions.length > 0) search(0, { left: 0, start: 0, moves: 0, dist: 0, blocks: [] })
  for (const block of (best as Plan | null)?.blocks ?? []) {
    block.placed.forEach((q, i) => q && put(q, block.cells[i]!))
  }
  return next
}
