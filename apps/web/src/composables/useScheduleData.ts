import { computed, ref, type Ref } from 'vue'
import { MeetRole } from '@qzr/shared'

import {
  createMeetSlot,
  createScheduledQuiz,
  deleteMeetSlot,
  deleteScheduledQuiz,
  getMeet,
  getMeetTeamCounts,
  getMyMeets,
  listMeetRooms,
  listMeetSlots,
  listMeetTeams,
  listPrelimAssignments,
  listScheduledQuizzes,
  replaceQuizSeats,
  setPrelimAssignments,
  updateMeetSlot,
  updateScheduledQuiz,
  updateTeam,
  type MeetDetail,
  type MeetMembership,
  type MeetRoom,
  type MeetSlot,
  type MeetTeamRow,
  type PrelimAssignment,
  type ScheduledQuiz,
  type SeatInput,
} from '../api'
import { defaultExtraLaneSize, type ExtraLane, type LaneId } from '../brackets'
import { bySortOrder } from '../scheduleGrid'

/**
 * Single source of truth for the schedule editor's server-bound state.
 * Owned data (meet, rooms, slots, quizzes, team counts, lane drafts) and
 * the mutations that update both the server and local refs in one place.
 *
 * UI-only state — dialog refs, form drafts, edit-mode toggles, division
 * filters — stays in the consuming view. The composable is pure plumbing
 * so V1 (modal-dialog editor) and V2 (typeset Studio) can share it
 * during the rethink without behaviour drift.
 */

interface CreateSlotInput {
  startAt: string | number
  durationMinutes: number
  kind: 'quiz' | 'event'
  eventLabel?: string | null
  sortOrder: number
}

interface UpdateSlotInput {
  startAt?: string | number
  durationMinutes?: number
  eventLabel?: string | null
  sortOrder?: number
}

interface CreateQuizInput {
  slotId: number
  roomId: number
  division: string
  phase: 'prelim' | 'elim'
  label: string
  seats?: SeatInput[]
}

export function useScheduleData(slug: Ref<string>) {
  const detail = ref<MeetDetail | null>(null)
  const membership = ref<MeetMembership | null>(null)
  const rooms = ref<MeetRoom[]>([])
  const slots = ref<MeetSlot[]>([])
  const quizzes = ref<ScheduledQuiz[]>([])
  const teamCounts = ref<Record<string, number>>({})
  const teams = ref<MeetTeamRow[]>([])
  const prelimAssignments = ref<PrelimAssignment[]>([])
  const extraLanes = ref<Record<string, ExtraLane[]>>({})
  const loading = ref(true)
  const error = ref('')

  const meet = computed(() => detail.value?.meet ?? null)
  const meetId = computed(() => detail.value?.meet.id ?? null)
  const divisions = computed(() => meet.value?.divisions ?? [])
  const role = computed(() => membership.value?.role ?? null)
  const isAdmin = computed(() => role.value === MeetRole.Admin || role.value === MeetRole.Superuser)

  async function load() {
    loading.value = true
    error.value = ''
    try {
      const [meetDetail, myMeetsRes] = await Promise.all([getMeet(slug.value), getMyMeets()])
      detail.value = meetDetail
      membership.value = myMeetsRes.memberships.find((m) => m.meetId === meetDetail.meet.id) ?? null
      const id = meetDetail.meet.id
      const [r, s, q, tc, t, pa] = await Promise.all([
        listMeetRooms(id),
        listMeetSlots(id),
        listScheduledQuizzes(id),
        getMeetTeamCounts(id),
        listMeetTeams(id),
        listPrelimAssignments(id),
      ])
      rooms.value = r.rooms
      slots.value = s.slots
      quizzes.value = q.quizzes
      teamCounts.value = tc.counts
      teams.value = t.teams
      prelimAssignments.value = pa.assignments
      // Main lane is implicit per division. Extra lanes (C / CC) start
      // empty; admin opts in based on the post-stats-break split. State
      // is in-memory only until persistence ships with the elim builder.
      const seeded: Record<string, ExtraLane[]> = {}
      for (const d of meetDetail.meet.divisions) seeded[d] = []
      extraLanes.value = seeded
    } catch (e) {
      error.value = (e as Error).message
    } finally {
      loading.value = false
    }
  }

  async function createSlot(input: CreateSlotInput): Promise<MeetSlot> {
    if (!meetId.value) throw new Error('No meet loaded')
    const res = await createMeetSlot(meetId.value, input)
    slots.value = [...slots.value, res.slot].sort(bySortOrder)
    return res.slot
  }

  async function updateSlot(slotId: number, input: UpdateSlotInput): Promise<MeetSlot> {
    if (!meetId.value) throw new Error('No meet loaded')
    const res = await updateMeetSlot(meetId.value, slotId, input)
    slots.value = slots.value.map((s) => (s.id === res.slot.id ? res.slot : s)).sort(bySortOrder)
    return res.slot
  }

  async function deleteSlot(slotId: number): Promise<void> {
    if (!meetId.value) throw new Error('No meet loaded')
    await deleteMeetSlot(meetId.value, slotId)
    slots.value = slots.value.filter((s) => s.id !== slotId)
    quizzes.value = quizzes.value.filter((q) => q.slotId !== slotId)
  }

  /** Create a quiz, then refetch the list to pick up server-assigned seat
   *  ids (POST returns the row without seats). */
  async function createQuiz(input: CreateQuizInput): Promise<void> {
    if (!meetId.value) throw new Error('No meet loaded')
    await createScheduledQuiz(meetId.value, input)
    const refreshed = await listScheduledQuizzes(meetId.value)
    quizzes.value = refreshed.quizzes
  }

  async function deleteQuiz(quizId: number): Promise<void> {
    if (!meetId.value) throw new Error('No meet loaded')
    await deleteScheduledQuiz(meetId.value, quizId)
    quizzes.value = quizzes.value.filter((q) => q.id !== quizId)
  }

  /** Update a quiz's mutable fields (label, slot, room, bracket label).
   *  Optionally replace its seats in the same call; refetches once at the
   *  end so consumers see consistent post-state. */
  async function updateQuiz(
    quizId: number,
    patch: {
      label?: string
      slotId?: number
      roomId?: number
      bracketLabel?: string | null
      publishedAt?: string | number | null
    },
    seats?: SeatInput[],
  ): Promise<void> {
    if (!meetId.value) throw new Error('No meet loaded')
    if (Object.keys(patch).length > 0) {
      await updateScheduledQuiz(meetId.value, quizId, patch)
    }
    if (seats) {
      await replaceQuizSeats(meetId.value, quizId, seats)
    }
    const refreshed = await listScheduledQuizzes(meetId.value)
    quizzes.value = refreshed.quizzes
  }

  /** Lowest unused integer suffix for "Div N Quiz K" auto-labelling. */
  function nextQuizNumber(division: string): number {
    const used = new Set<number>()
    for (const q of quizzes.value) {
      if (q.division !== division) continue
      const m = q.label.match(/(\d+)\s*$/)
      if (m) used.add(Number(m[1]))
    }
    let n = 1
    while (used.has(n)) n++
    return n
  }

  function toggleLane({ division, lane }: { division: string; lane: LaneId }) {
    const current = extraLanes.value[division] ?? []
    const has = current.some((l) => l.id === lane)
    let next: ExtraLane[]
    if (has) {
      next = current.filter((l) => l.id !== lane)
    } else {
      const usedSoFar = current.reduce((sum, l) => sum + l.teamCount, 0)
      const remainingInMain = (teamCounts.value[division] ?? 0) - usedSoFar
      next = [...current, { id: lane, teamCount: defaultExtraLaneSize(remainingInMain) }]
    }
    // CC implies C — adding CC auto-enables C; removing C also removes CC.
    if (next.some((l) => l.id === 'cc') && !next.some((l) => l.id === 'c')) {
      const remaining =
        (teamCounts.value[division] ?? 0) - next.reduce((sum, l) => sum + l.teamCount, 0)
      next = [...next, { id: 'c', teamCount: defaultExtraLaneSize(remaining) }]
    }
    if (!next.some((l) => l.id === 'c')) {
      next = next.filter((l) => l.id !== 'cc')
    }
    extraLanes.value = { ...extraLanes.value, [division]: next }
  }

  /** Roll Teams for one division: sort by (lateness ASC, RAND ASC),
   *  zip onto letters A..N, and persist via setPrelimAssignments. The
   *  rule-book pattern is left alone — a separate `swapLateTeamsLater`
   *  pass handles physically moving late teams' quizzes later. */
  async function rollTeams(division: string) {
    if (!meetId.value) throw new Error('No meet loaded')
    const divisionTeams = teams.value.filter((t) => t.division === division)
    if (divisionTeams.length === 0) return

    const shuffled = divisionTeams
      .map((t) => ({ team: t, key: [t.lateness ? 1 : 0, Math.random()] as const }))
      .sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1])
      .map((x) => x.team)
    const mapping = shuffled.map((t, i) => ({
      letter: String.fromCharCode(65 + i),
      teamId: t.id,
    }))

    const res = await setPrelimAssignments(meetId.value, division, mapping)
    prelimAssignments.value = [
      ...prelimAssignments.value.filter((a) => a.division !== division),
      ...res.assignments,
    ]
  }

  /** Push late teams' prelim quizzes to later slots within their
   *  division. Robust for any room count (1, 2, 3+) by re-arranging
   *  from scratch:
   *
   *  1. Group the division's quizzes by room (each room is a "lane"
   *     that holds one quiz per slot).
   *  2. Walk slots from LAST → FIRST. At each slot, pick the
   *     **letter-disjoint tuple** (one quiz from each room, or
   *     `null` for an empty room) that maximises the late-quiz
   *     count — ties broken by tuple size, so empty cells only
   *     appear when no fuller alternative is letter-compatible.
   *  3. Apply the chosen quizzes to that slot, remove them from the
   *     pool, repeat for the next-earlier slot.
   *
   *  Net effect: late quizzes get drawn into the latest slots they
   *  can fit (subject to "no team in two rooms at once"), and non-
   *  late quizzes naturally settle into the early slots. Labels and
   *  seats stay attached to each quiz; only slotId changes.
   *
   *  Returns the count of quizzes moved. */
  async function swapLateTeamsLater(division: string): Promise<number> {
    if (!meetId.value) throw new Error('No meet loaded')

    const lateTeamIds = new Set(
      teams.value.filter((t) => t.lateness && t.division === division).map((t) => t.id),
    )
    if (lateTeamIds.size === 0) return 0

    const divAssignments = prelimAssignments.value.filter((a) => a.division === division)
    const lateLetters = new Set<string>()
    for (const a of divAssignments) {
      if (lateTeamIds.has(a.teamId)) lateLetters.add(a.letter)
    }
    if (lateLetters.size === 0) return 0

    const lettersOf = (q: ScheduledQuiz): Set<string> => {
      const set = new Set<string>()
      for (const s of q.seats) if (s.letter) set.add(s.letter)
      return set
    }
    const containsLate = (q: ScheduledQuiz): boolean => {
      for (const s of q.seats) if (s.letter && lateLetters.has(s.letter)) return true
      return false
    }
    const disjoint = (a: Set<string>, b: Set<string>): boolean => {
      for (const l of a) if (b.has(l)) return false
      return true
    }

    const prelims = quizzes.value.filter((q) => q.division === division && q.phase === 'prelim')
    if (prelims.length === 0) return 0

    const slotIdsOrdered = [...new Set(prelims.map((q) => q.slotId))]
      .map((id) => slots.value.find((s) => s.id === id))
      .filter((s): s is MeetSlot => s !== undefined)
      .sort(bySortOrder)
      .map((s) => s.id)

    const roomIds = [...new Set(prelims.map((q) => q.roomId))]
      .map((id) => rooms.value.find((r) => r.id === id))
      .filter((r): r is MeetRoom => r !== undefined)
      .sort(bySortOrder)
      .map((r) => r.id)

    // Quizzes pooled per room. Mutated as the algorithm consumes them.
    const pool: ScheduledQuiz[][] = roomIds.map((rid) => prelims.filter((q) => q.roomId === rid))

    // Working assignment: assignment[slotIdx] = chosen quizzes for that slot.
    const assignment: ScheduledQuiz[][] = slotIdsOrdered.map(() => [])

    for (let slotIdx = slotIdsOrdered.length - 1; slotIdx >= 0; slotIdx--) {
      const tuple = pickBestTuple(pool, lettersOf, containsLate, disjoint)
      if (!tuple) continue
      for (let roomIdx = 0; roomIdx < tuple.length; roomIdx++) {
        const quiz = tuple[roomIdx]
        if (!quiz) continue
        assignment[slotIdx]!.push(quiz)
        const idx = pool[roomIdx]!.indexOf(quiz)
        if (idx >= 0) pool[roomIdx]!.splice(idx, 1)
      }
    }

    // If anything's left in the pool (e.g. all slots filled but some
    // quizzes couldn't fit anywhere conflict-free), drop them at the
    // first available slot — preserves prior placement at worst.
    for (let roomIdx = 0; roomIdx < pool.length; roomIdx++) {
      for (const quiz of pool[roomIdx]!) {
        for (let slotIdx = 0; slotIdx < slotIdsOrdered.length; slotIdx++) {
          const existing = assignment[slotIdx]!
          if (existing.some((q) => q.roomId === quiz.roomId)) continue
          // Must still be letter-compatible with the others at this slot.
          const qLetters = lettersOf(quiz)
          if (existing.some((q) => !disjoint(lettersOf(q), qLetters))) continue
          existing.push(quiz)
          break
        }
      }
    }

    const moves: { quizId: number; slotId: number }[] = []
    for (let slotIdx = 0; slotIdx < slotIdsOrdered.length; slotIdx++) {
      const targetSlotId = slotIdsOrdered[slotIdx]!
      for (const quiz of assignment[slotIdx]!) {
        if (quiz.slotId !== targetSlotId) {
          moves.push({ quizId: quiz.id, slotId: targetSlotId })
        }
      }
    }
    return await applySlotMoves(moves)
  }

  /** Pick the best K-tuple from a per-room pool: one quiz per room
   *  (or `null` to leave a room empty), pairwise letter-disjoint,
   *  maximising late-quiz count then tuple size. Backtracking
   *  enumeration; for typical division sizes (≤20 quizzes per room,
   *  ≤4 rooms) this runs in microseconds. */
  function pickBestTuple(
    pool: ScheduledQuiz[][],
    lettersOf: (q: ScheduledQuiz) => Set<string>,
    containsLate: (q: ScheduledQuiz) => boolean,
    disjoint: (a: Set<string>, b: Set<string>) => boolean,
  ): (ScheduledQuiz | null)[] | null {
    let bestTuple: (ScheduledQuiz | null)[] | null = null
    let bestLate = -1
    let bestSize = -1
    const current: (ScheduledQuiz | null)[] = []

    const recurse = (roomIdx: number, lateCount: number, size: number): void => {
      if (roomIdx === pool.length) {
        if (lateCount > bestLate || (lateCount === bestLate && size > bestSize)) {
          bestLate = lateCount
          bestSize = size
          bestTuple = [...current]
        }
        return
      }
      for (const quiz of pool[roomIdx]!) {
        const qLetters = lettersOf(quiz)
        let ok = true
        for (const picked of current) {
          if (picked && !disjoint(lettersOf(picked), qLetters)) {
            ok = false
            break
          }
        }
        if (!ok) continue
        current.push(quiz)
        recurse(roomIdx + 1, lateCount + (containsLate(quiz) ? 1 : 0), size + 1)
        current.pop()
      }
      // Also consider leaving this room empty for this slot.
      current.push(null)
      recurse(roomIdx + 1, lateCount, size)
      current.pop()
    }

    recurse(0, 0, 0)
    return bestTuple
  }

  /** Apply a batch of slotId reassignments to scheduled quizzes,
   *  bypassing updateQuiz so we refetch only once at the end. */
  async function applySlotMoves(moves: { quizId: number; slotId: number }[]): Promise<number> {
    if (!meetId.value) throw new Error('No meet loaded')
    if (moves.length === 0) return 0
    for (const m of moves) {
      await updateScheduledQuiz(meetId.value, m.quizId, { slotId: m.slotId })
    }
    const refreshed = await listScheduledQuizzes(meetId.value)
    quizzes.value = refreshed.quizzes
    return moves.length
  }

  /** Toggle a team's lateness flag. Optimistic local update + PATCH;
   *  rolls back on failure so the UI doesn't lie about persistence. */
  async function updateTeamLateness(teamId: number, lateness: boolean) {
    const idx = teams.value.findIndex((t) => t.id === teamId)
    if (idx < 0) return
    const before = teams.value[idx]!.lateness
    teams.value[idx] = { ...teams.value[idx]!, lateness }
    try {
      await updateTeam(teamId, { lateness })
    } catch (e) {
      teams.value[idx] = { ...teams.value[idx]!, lateness: before }
      throw e
    }
  }

  function resizeLane({
    division,
    lane,
    teamCount,
  }: {
    division: string
    lane: LaneId
    teamCount: number
  }) {
    const current = extraLanes.value[division] ?? []
    extraLanes.value = {
      ...extraLanes.value,
      [division]: current.map((l) =>
        l.id === lane ? { ...l, teamCount: Math.max(0, teamCount) } : l,
      ),
    }
  }

  return {
    rooms,
    slots,
    quizzes,
    teamCounts,
    teams,
    prelimAssignments,
    extraLanes,
    loading,
    error,
    meet,
    meetId,
    divisions,
    isAdmin,
    load,
    createSlot,
    updateSlot,
    deleteSlot,
    createQuiz,
    updateQuiz,
    deleteQuiz,
    nextQuizNumber,
    toggleLane,
    resizeLane,
    updateTeamLateness,
    rollTeams,
    swapLateTeamsLater,
  }
}
