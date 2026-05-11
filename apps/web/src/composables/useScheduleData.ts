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
  listScheduledQuizzes,
  updateMeetSlot,
  type MeetDetail,
  type MeetMembership,
  type MeetRoom,
  type MeetSlot,
  type ScheduledQuiz,
  type SeatInput,
} from '../api'
import { defaultExtraLaneSize, type ExtraLane, type LaneId } from '../brackets'

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
  const extraLanes = ref<Record<string, ExtraLane[]>>({})
  const loading = ref(true)
  const error = ref('')

  const meet = computed(() => detail.value?.meet ?? null)
  const meetId = computed(() => detail.value?.meet.id ?? null)
  const divisions = computed(() => meet.value?.divisions ?? [])
  const role = computed(() => membership.value?.role ?? null)
  const isAdmin = computed(() => role.value === MeetRole.Admin || role.value === MeetRole.Superuser)

  function slotSort(a: MeetSlot, b: MeetSlot): number {
    return a.sortOrder - b.sortOrder || a.id - b.id
  }

  async function load() {
    loading.value = true
    error.value = ''
    try {
      const [meetDetail, myMeetsRes] = await Promise.all([getMeet(slug.value), getMyMeets()])
      detail.value = meetDetail
      membership.value = myMeetsRes.memberships.find((m) => m.meetId === meetDetail.meet.id) ?? null
      const id = meetDetail.meet.id
      const [r, s, q, tc] = await Promise.all([
        listMeetRooms(id),
        listMeetSlots(id),
        listScheduledQuizzes(id),
        getMeetTeamCounts(id),
      ])
      rooms.value = r.rooms
      slots.value = s.slots
      quizzes.value = q.quizzes
      teamCounts.value = tc.counts
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
    slots.value = [...slots.value, res.slot].sort(slotSort)
    return res.slot
  }

  async function updateSlot(slotId: number, input: UpdateSlotInput): Promise<MeetSlot> {
    if (!meetId.value) throw new Error('No meet loaded')
    const res = await updateMeetSlot(meetId.value, slotId, input)
    slots.value = slots.value.map((s) => (s.id === res.slot.id ? res.slot : s)).sort(slotSort)
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
    detail,
    membership,
    rooms,
    slots,
    quizzes,
    teamCounts,
    extraLanes,
    loading,
    error,
    meet,
    meetId,
    divisions,
    role,
    isAdmin,
    load,
    createSlot,
    updateSlot,
    deleteSlot,
    createQuiz,
    deleteQuiz,
    nextQuizNumber,
    slotSort,
    toggleLane,
    resizeLane,
  }
}
