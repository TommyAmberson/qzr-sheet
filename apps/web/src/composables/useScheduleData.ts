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
import { getPrelimDraw } from '../prelimDraw'
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

  /** Roll Teams for one division. Two layers of biasing:
   *
   *  1. Team→letter binding: sort by (lateness ASC, RAND ASC), zip onto
   *     letters A..N. Late teams land on the highest-numbered letters.
   *  2. Quiz reorder: any pattern row that contains a late letter is
   *     pushed to the end of the prelim sequence (preserving relative
   *     order otherwise). The seats of every prelim quiz in this
   *     division are rewritten to match the reordered pattern, so the
   *     late team's first quiz physically lands in a later slot.
   *
   *  Step 2 only kicks in when at least one team is marked late and
   *  the team count has a published rule-book pattern — otherwise the
   *  rule-book row order stays as-is. */
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

    // Reorder the prelim quizzes' seats to push late letters later.
    const draw = getPrelimDraw(divisionTeams.length)
    const lateLetters = new Set(
      mapping.filter((m) => shuffled.find((t) => t.id === m.teamId)?.lateness).map((m) => m.letter),
    )
    if (draw && lateLetters.size > 0) {
      const reorderedRows = draw
        .map((row, originalIdx) => ({
          row,
          originalIdx,
          hasLate: row.some((l) => lateLetters.has(l)),
        }))
        .sort((a, b) => (a.hasLate ? 1 : 0) - (b.hasLate ? 1 : 0) || a.originalIdx - b.originalIdx)
        .map((x) => x.row)

      const divPrelims = quizzes.value
        .filter((q) => q.division === division && q.phase === 'prelim')
        .map((q) => ({
          quiz: q,
          slot: slots.value.find((s) => s.id === q.slotId),
          room: rooms.value.find((r) => r.id === q.roomId),
        }))
        .filter((x) => x.slot && x.room)
        .sort((a, b) => bySortOrder(a.slot!, b.slot!) || bySortOrder(a.room!, b.room!))

      for (let i = 0; i < divPrelims.length && i < reorderedRows.length; i++) {
        const triple = reorderedRows[i]!
        const quiz = divPrelims[i]!.quiz
        const seats = [
          { seatNumber: 1, letter: triple[0] ?? null },
          { seatNumber: 2, letter: triple[1] ?? null },
          { seatNumber: 3, letter: triple[2] ?? null },
        ]
        // Skip the round-trip if the seats already match — re-rolling
        // with no late teams shouldn't churn the DB.
        const current = [...quiz.seats].sort((a, b) => a.seatNumber - b.seatNumber)
        const sameSeats =
          current.length === 3 && current.every((s, j) => s.letter === seats[j]!.letter)
        if (!sameSeats) {
          await updateQuiz(quiz.id, {}, seats)
        }
      }
    }

    const res = await setPrelimAssignments(meetId.value, division, mapping)
    // Replace this division's rows in the local cache; leave others as-is.
    prelimAssignments.value = [
      ...prelimAssignments.value.filter((a) => a.division !== division),
      ...res.assignments,
    ]
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
  }
}
