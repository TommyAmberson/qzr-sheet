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
