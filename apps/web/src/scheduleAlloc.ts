import type { MeetRoom, MeetSlot } from './api'
import { bySortOrder } from './scheduleGrid'

/**
 * Slot×room cell allocation for the schedule grid.
 *
 * Given a set of divisions (with team counts) and a grid of (slot, room)
 * cells, decide which division owns each cell. The result is a per-
 * division cell list in row-major order — Q1 of each division lands at
 * the upper-left of its allocation, Qn at the lower-right.
 *
 * Two-layer algorithm:
 *
 * 1. **Room ownership** (column-major fill): walk rooms in order; each
 *    division claims cells until its team count is met, then the next
 *    division takes over. A division finishing mid-room makes that room
 *    shared with the next division. Each room hosts ≤2 divisions.
 *
 * 2. **Slot distribution within shared rooms**: place the minor division
 *    (fewer cells) at evenly-spaced slots via `floor((k + 0.5)·S/X) + 1`.
 *    The major division fills the rest. For non-shared rooms with
 *    leftover empty cells, the division fills slots 1..N contiguously
 *    and the empty cells sit at the bottom.
 */

export interface Cell {
  slotId: number
  roomId: number
}

export interface RoomEntry {
  division: string
  count: number
}

export interface AllocationResult {
  /** Cells per division in row-major order (sorted by slot, then room). */
  perDivision: Map<string, Cell[]>
  /** For each room (sorted by sortOrder), the 1-2 divisions sharing it. */
  roomOwnership: Array<{ roomId: number; entries: RoomEntry[] }>
  /** Total cells with no division (capacity slack at the bottom of the
   *  last room). Always 0 when divisions exactly fill the grid. */
  emptyCellCount: number
  /** Cells short of capacity. Positive ⇒ divisions don't all fit; the
   *  caller should warn before populating. */
  shortfall: number
}

/** Walk rooms column-major, claiming cells for each division in turn. */
function computeRoomOwnership(
  divisions: string[],
  teamCounts: Record<string, number>,
  slotCount: number,
  roomCount: number,
): { ownership: RoomEntry[][]; shortfall: number } {
  const ownership: RoomEntry[][] = Array.from({ length: roomCount }, () => [])
  let divIdx = 0
  let divRemaining = divisions[0] ? (teamCounts[divisions[0]] ?? 0) : 0
  let roomIdx = 0
  let cellsLeftInRoom = slotCount

  while (divIdx < divisions.length && roomIdx < roomCount) {
    if (divRemaining === 0) {
      divIdx++
      divRemaining = divIdx < divisions.length ? (teamCounts[divisions[divIdx]!] ?? 0) : 0
      continue
    }
    if (cellsLeftInRoom === 0) {
      roomIdx++
      cellsLeftInRoom = slotCount
      continue
    }
    const take = Math.min(divRemaining, cellsLeftInRoom)
    ownership[roomIdx]!.push({ division: divisions[divIdx]!, count: take })
    divRemaining -= take
    cellsLeftInRoom -= take
  }

  // Any remaining divRemaining (or unprocessed divs) = shortfall.
  let shortfall = divRemaining
  for (let i = divIdx + 1; i < divisions.length; i++) {
    shortfall += teamCounts[divisions[i]!] ?? 0
  }
  return { ownership, shortfall }
}

/** For each room, return slotIdx → division. Empty cells map to nothing. */
function distributeSlots(ownership: RoomEntry[][], slotCount: number): Array<Map<number, string>> {
  return ownership.map((roomEntries) => {
    const slotToDiv = new Map<number, string>()
    if (roomEntries.length === 0) return slotToDiv

    if (roomEntries.length === 1) {
      // Single division. Fill from slot 0 onwards; trailing cells empty.
      const { division, count } = roomEntries[0]!
      for (let s = 0; s < count; s++) slotToDiv.set(s, division)
      return slotToDiv
    }

    // Two divisions sharing the room. Minor gets evenly-spaced slots.
    const [a, b] = roomEntries as [RoomEntry, RoomEntry]
    const minor = a.count <= b.count ? a : b
    const major = a.count <= b.count ? b : a
    const minorSlots = new Set<number>()
    for (let k = 0; k < minor.count; k++) {
      const slot = Math.floor(((k + 0.5) * slotCount) / minor.count)
      minorSlots.add(slot)
    }
    let majorPlaced = 0
    for (let s = 0; s < slotCount; s++) {
      if (minorSlots.has(s)) {
        slotToDiv.set(s, minor.division)
      } else if (majorPlaced < major.count) {
        slotToDiv.set(s, major.division)
        majorPlaced++
      }
    }
    return slotToDiv
  })
}

/** Iterate the grid row-major; each cell goes into its division's list. */
function buildDivisionCells(
  perRoomSlotToDiv: Array<Map<number, string>>,
  sortedSlots: MeetSlot[],
  sortedRooms: MeetRoom[],
  divisions: string[],
): Map<string, Cell[]> {
  const perDivision = new Map<string, Cell[]>()
  for (const d of divisions) perDivision.set(d, [])

  for (let s = 0; s < sortedSlots.length; s++) {
    for (let r = 0; r < sortedRooms.length; r++) {
      const div = perRoomSlotToDiv[r]?.get(s)
      if (!div) continue
      perDivision.get(div)!.push({
        slotId: sortedSlots[s]!.id,
        roomId: sortedRooms[r]!.id,
      })
    }
  }
  return perDivision
}

/** Main entry point. Allocate (slot, room) cells across divisions and
 *  return per-division cell lists in row-major order. */
export function allocateCells(
  divisions: string[],
  teamCounts: Record<string, number>,
  slots: MeetSlot[],
  rooms: MeetRoom[],
): AllocationResult {
  const sortedSlots = [...slots].sort(bySortOrder)
  const sortedRooms = [...rooms].sort(bySortOrder)
  const S = sortedSlots.length
  const R = sortedRooms.length

  const { ownership, shortfall } = computeRoomOwnership(divisions, teamCounts, S, R)
  const perRoomSlotToDiv = distributeSlots(ownership, S)
  const perDivision = buildDivisionCells(perRoomSlotToDiv, sortedSlots, sortedRooms, divisions)

  const allocatedCells = [...perDivision.values()].reduce((sum, cells) => sum + cells.length, 0)
  const emptyCellCount = S * R - allocatedCells - shortfall

  const roomOwnership = sortedRooms.map((room, idx) => ({
    roomId: room.id,
    entries: ownership[idx] ?? [],
  }))

  return { perDivision, roomOwnership, emptyCellCount, shortfall }
}
