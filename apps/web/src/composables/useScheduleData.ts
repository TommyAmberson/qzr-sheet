import { computed, ref, type Ref } from 'vue'
import { MeetRole } from '@qzr/shared'

import {
  getMeet,
  getMeetTeamCounts,
  getMyMeets,
  listMeetRooms,
  listMeetSlots,
  listMeetTeams,
  listPrelimAssignments,
  listScheduledQuizzes,
  syncSchedule,
  type MeetDetail,
  type MeetMembership,
  type MeetRoom,
  type MeetSlot,
  type MeetTeamRow,
  type PrelimAssignment,
  type ScheduleSyncPayload,
  type ScheduleSyncPrelimDivision,
  type ScheduleSyncTeamLateness,
  type ScheduledQuiz,
  type ScheduledQuizSeat,
  type SeatInput,
} from '../api'
import { defaultExtraLaneSize, type ExtraLane, type LaneId } from '../brackets'
import { bySortOrder } from '../scheduleGrid'

/**
 * Single source of truth for the schedule editor's server-bound state.
 *
 * Holds the editable schedule as a *draft*: every slot/quiz/seat/prelim/
 * lateness mutation runs locally and accumulates in the reactive refs.
 * `saveDraft()` POSTs the full state to `/schedule/sync` in one shot and
 * rebuilds local refs from the response; `discardDraft()` reverts the
 * refs to the last-committed snapshot. Modelled on the roster pattern
 * in `MeetTeamsView.vue`.
 *
 * Extra-lane state (`extraLanes`, `toggleLane`, `resizeLane`) and the
 * elim builder remain in-memory only (no persistence yet) and live
 * alongside the draft without participating in dirty detection.
 *
 * TODO: lock completed quizzes in the UI; the sync endpoint already
 * rejects destructive payloads against them.
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

interface UpdateQuizPatch {
  label?: string
  slotId?: number
  roomId?: number
  bracketLabel?: string | null
  publishedAt?: string | number | null
}

interface ScheduleSnapshot {
  slots: MeetSlot[]
  quizzes: ScheduledQuiz[]
  prelimAssignments: PrelimAssignment[]
  /** teamId → lateness, captured for diff in isDirty. */
  teamLateness: Record<number, boolean>
}

function emptySnapshot(): ScheduleSnapshot {
  return { slots: [], quizzes: [], prelimAssignments: [], teamLateness: {} }
}

function toIso(value: string | number): string {
  return typeof value === 'string' ? value : new Date(value).toISOString()
}

function cloneQuiz(q: ScheduledQuiz): ScheduledQuiz {
  return { ...q, seats: q.seats.map((s) => ({ ...s })) }
}

function sortedSeats(seats: ScheduledQuizSeat[]): ScheduledQuizSeat[] {
  return [...seats].sort((a, b) => a.seatNumber - b.seatNumber)
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

  const committed = ref<ScheduleSnapshot>(emptySnapshot())
  const saving = ref(false)
  const saveError = ref('')

  // Monotonically-decreasing negative ids for unsaved slots/quizzes.
  // Server resolves them to real ids on saveDraft via tempId maps; the
  // counter resets per load() so a long session doesn't accumulate
  // ever-larger negative numbers.
  let nextTempId = -1
  function mintTempId(): number {
    return nextTempId--
  }

  const meet = computed(() => detail.value?.meet ?? null)
  const meetId = computed(() => detail.value?.meet.id ?? null)
  const divisions = computed(() => meet.value?.divisions ?? [])
  const role = computed(() => membership.value?.role ?? null)
  const isAdmin = computed(() => role.value === MeetRole.Admin || role.value === MeetRole.Superuser)

  function takeSnapshot(): ScheduleSnapshot {
    return {
      slots: slots.value.map((s) => ({ ...s })),
      quizzes: quizzes.value.map(cloneQuiz),
      prelimAssignments: prelimAssignments.value.map((a) => ({ ...a })),
      teamLateness: Object.fromEntries(teams.value.map((t) => [t.id, t.lateness])),
    }
  }

  async function load() {
    loading.value = true
    error.value = ''
    nextTempId = -1
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
      slots.value = [...s.slots].sort(bySortOrder)
      quizzes.value = q.quizzes
      teamCounts.value = tc.counts
      teams.value = t.teams
      prelimAssignments.value = pa.assignments
      committed.value = takeSnapshot()
      // Extra lanes are in-memory only; admin opts in based on the
      // post-stats-break split. State doesn't participate in dirty/save.
      const seeded: Record<string, ExtraLane[]> = {}
      for (const d of meetDetail.meet.divisions) seeded[d] = []
      extraLanes.value = seeded
    } catch (e) {
      error.value = (e as Error).message
    } finally {
      loading.value = false
    }
  }

  // ---- Draft mutations (slots) ----

  function createSlot(input: CreateSlotInput): MeetSlot {
    if (!meetId.value) throw new Error('No meet loaded')
    const slot: MeetSlot = {
      id: mintTempId(),
      meetId: meetId.value,
      startAt: toIso(input.startAt),
      durationMinutes: input.durationMinutes,
      kind: input.kind,
      eventLabel: input.eventLabel ?? null,
      sortOrder: input.sortOrder,
    }
    slots.value = [...slots.value, slot].sort(bySortOrder)
    return slot
  }

  function updateSlot(slotId: number, patch: UpdateSlotInput): MeetSlot | null {
    const idx = slots.value.findIndex((s) => s.id === slotId)
    if (idx < 0) return null
    const current = slots.value[idx]!
    const updated: MeetSlot = {
      ...current,
      ...(patch.startAt !== undefined ? { startAt: toIso(patch.startAt) } : {}),
      ...(patch.durationMinutes !== undefined ? { durationMinutes: patch.durationMinutes } : {}),
      ...('eventLabel' in patch ? { eventLabel: patch.eventLabel ?? null } : {}),
      ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
    }
    slots.value = slots.value.map((s) => (s.id === slotId ? updated : s)).sort(bySortOrder)
    return updated
  }

  /** Delete locally and cascade to quizzes on that slot (mirrors the
   *  FK cascade the server applies on commit). */
  function deleteSlot(slotId: number): void {
    slots.value = slots.value.filter((s) => s.id !== slotId)
    quizzes.value = quizzes.value.filter((q) => q.slotId !== slotId)
  }

  // ---- Draft mutations (quizzes) ----

  function createQuiz(input: CreateQuizInput): ScheduledQuiz {
    if (!meetId.value) throw new Error('No meet loaded')
    const quizId = mintTempId()
    const quiz: ScheduledQuiz = {
      id: quizId,
      meetId: meetId.value,
      slotId: input.slotId,
      roomId: input.roomId,
      division: input.division,
      phase: input.phase,
      lane: null,
      label: input.label,
      bracketLabel: null,
      publishedAt: null,
      completedAt: null,
      seats: (input.seats ?? []).map((s) => ({
        id: mintTempId(),
        quizId,
        seatNumber: s.seatNumber,
        letter: s.letter ?? null,
        seedRef: s.seedRef ?? null,
      })),
    }
    quizzes.value = [...quizzes.value, quiz]
    return quiz
  }

  function updateQuiz(quizId: number, patch: UpdateQuizPatch, seats?: SeatInput[]): void {
    quizzes.value = quizzes.value.map((q) => {
      if (q.id !== quizId) return q
      const updated: ScheduledQuiz = {
        ...q,
        ...(patch.label !== undefined ? { label: patch.label } : {}),
        ...(patch.slotId !== undefined ? { slotId: patch.slotId } : {}),
        ...(patch.roomId !== undefined ? { roomId: patch.roomId } : {}),
        ...('bracketLabel' in patch ? { bracketLabel: patch.bracketLabel ?? null } : {}),
        ...('publishedAt' in patch
          ? {
              publishedAt:
                patch.publishedAt == null
                  ? null
                  : typeof patch.publishedAt === 'string'
                    ? patch.publishedAt
                    : new Date(patch.publishedAt).toISOString(),
            }
          : {}),
        ...(seats !== undefined
          ? {
              seats: seats.map((s) => ({
                id: mintTempId(),
                quizId: q.id,
                seatNumber: s.seatNumber,
                letter: s.letter ?? null,
                seedRef: s.seedRef ?? null,
              })),
            }
          : {}),
      }
      return updated
    })
  }

  function deleteQuiz(quizId: number): void {
    quizzes.value = quizzes.value.filter((q) => q.id !== quizId)
  }

  /** Bulk replace the quiz list with a Populate plan. Used by the
   *  view's runPopulate; deletes every existing quiz and recreates the
   *  full set in one local update, no network.
   *
   *  TODO: when completed-quiz lock UI lands, this needs to preserve
   *  any quiz with `completedAt` set instead of dropping it — otherwise
   *  saveDraft will 409 on the next save. */
  function replaceQuizzes(defs: CreateQuizInput[]): void {
    if (!meetId.value) throw new Error('No meet loaded')
    const mid = meetId.value
    quizzes.value = defs.map((def) => {
      const quizId = mintTempId()
      return {
        id: quizId,
        meetId: mid,
        slotId: def.slotId,
        roomId: def.roomId,
        division: def.division,
        phase: def.phase,
        lane: null,
        label: def.label,
        bracketLabel: null,
        publishedAt: null,
        completedAt: null,
        seats: (def.seats ?? []).map((s) => ({
          id: mintTempId(),
          quizId,
          seatNumber: s.seatNumber,
          letter: s.letter ?? null,
          seedRef: s.seedRef ?? null,
        })),
      }
    })
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

  // ---- Draft mutations (prelim assignments + lateness) ----

  /** Roll Teams for one division (purely local): sort by
   *  (lateness ASC, RAND ASC), zip onto letters A..N, replace this
   *  division's slice of `prelimAssignments`. Commits on saveDraft. */
  function rollTeams(division: string): void {
    if (!meetId.value) return
    const mid = meetId.value
    const divisionTeams = teams.value.filter((t) => t.division === division)
    if (divisionTeams.length === 0) return

    const shuffled = divisionTeams
      .map((t) => ({ team: t, key: [t.lateness ? 1 : 0, Math.random()] as const }))
      .sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1])
      .map((x) => x.team)

    const now = new Date().toISOString()
    const others = prelimAssignments.value.filter((a) => a.division !== division)
    const fresh: PrelimAssignment[] = shuffled.map((t, i) => ({
      // id is server-assigned; 0 marks "unsaved" but the field isn't
      // read locally and the full-replace endpoint discards old rows.
      id: 0,
      meetId: mid,
      division,
      letter: String.fromCharCode(65 + i),
      teamId: t.id,
      assignedAt: now,
    }))
    prelimAssignments.value = [...others, ...fresh]
  }

  /** Flip a team's lateness flag locally. No server call until save. */
  function updateTeamLateness(teamId: number, lateness: boolean): void {
    const idx = teams.value.findIndex((t) => t.id === teamId)
    if (idx < 0) return
    teams.value[idx] = { ...teams.value[idx]!, lateness }
  }

  // ---- Lane state (in-memory only — not part of the draft) ----

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

  // ---- Dirty detection ----

  const isDirty = computed(() => {
    const snap = committed.value
    if (slots.value.some((s) => s.id < 0)) return true
    {
      const draftSlotIds = new Set(slots.value.filter((s) => s.id > 0).map((s) => s.id))
      if (snap.slots.some((s) => !draftSlotIds.has(s.id))) return true
      const snapMap = new Map(snap.slots.map((s) => [s.id, s]))
      for (const s of slots.value) {
        if (s.id < 0) continue
        const orig = snapMap.get(s.id)
        if (!orig) continue
        if (
          orig.startAt !== s.startAt ||
          orig.durationMinutes !== s.durationMinutes ||
          orig.kind !== s.kind ||
          (orig.eventLabel ?? null) !== (s.eventLabel ?? null) ||
          orig.sortOrder !== s.sortOrder
        ) {
          return true
        }
      }
    }

    if (quizzes.value.some((q) => q.id < 0)) return true
    {
      const draftQuizIds = new Set(quizzes.value.filter((q) => q.id > 0).map((q) => q.id))
      if (snap.quizzes.some((q) => !draftQuizIds.has(q.id))) return true
      const snapMap = new Map(snap.quizzes.map((q) => [q.id, q]))
      for (const q of quizzes.value) {
        if (q.id < 0) continue
        const orig = snapMap.get(q.id)
        if (!orig) continue
        if (
          orig.slotId !== q.slotId ||
          orig.roomId !== q.roomId ||
          orig.division !== q.division ||
          orig.phase !== q.phase ||
          orig.label !== q.label ||
          (orig.bracketLabel ?? null) !== (q.bracketLabel ?? null)
        ) {
          return true
        }
        const a = sortedSeats(orig.seats)
        const b = sortedSeats(q.seats)
        if (a.length !== b.length) return true
        for (let i = 0; i < a.length; i++) {
          if (
            a[i]!.seatNumber !== b[i]!.seatNumber ||
            (a[i]!.letter ?? null) !== (b[i]!.letter ?? null) ||
            (a[i]!.seedRef ?? null) !== (b[i]!.seedRef ?? null)
          ) {
            return true
          }
        }
      }
    }

    {
      const draftKeys = new Map<string, number>()
      for (const a of prelimAssignments.value) {
        draftKeys.set(`${a.division}|${a.letter}`, a.teamId)
      }
      const snapKeys = new Map<string, number>()
      for (const a of snap.prelimAssignments) {
        snapKeys.set(`${a.division}|${a.letter}`, a.teamId)
      }
      if (draftKeys.size !== snapKeys.size) return true
      for (const [k, v] of draftKeys) {
        if (snapKeys.get(k) !== v) return true
      }
    }

    for (const t of teams.value) {
      const orig = snap.teamLateness[t.id]
      if (orig !== undefined && orig !== t.lateness) return true
    }
    return false
  })

  // ---- Save / discard ----

  function buildSyncPayload(): ScheduleSyncPayload {
    const snap = committed.value
    const slotPayload = slots.value.map((s) => ({
      id: s.id,
      startAt: s.startAt,
      durationMinutes: s.durationMinutes,
      kind: s.kind,
      eventLabel: s.eventLabel,
      sortOrder: s.sortOrder,
    }))
    const quizPayload = quizzes.value.map((q) => ({
      id: q.id,
      slotId: q.slotId,
      roomId: q.roomId,
      division: q.division,
      phase: q.phase,
      label: q.label,
      bracketLabel: q.bracketLabel,
      seats: q.seats.map((s) => ({
        seatNumber: s.seatNumber,
        letter: s.letter,
        seedRef: s.seedRef,
      })),
    }))

    // Include any division that appears in the current draft OR in the
    // committed snapshot, so dropping a division's assignments to an
    // empty mapping propagates to the server.
    const divs = new Set<string>()
    for (const a of prelimAssignments.value) divs.add(a.division)
    for (const a of snap.prelimAssignments) divs.add(a.division)
    const prelimPayload: ScheduleSyncPrelimDivision[] = []
    for (const division of divs) {
      const mapping = prelimAssignments.value
        .filter((a) => a.division === division)
        .map((a) => ({ letter: a.letter, teamId: a.teamId }))
      prelimPayload.push({ division, mapping })
    }

    const lateness: ScheduleSyncTeamLateness[] = []
    for (const t of teams.value) {
      const orig = snap.teamLateness[t.id]
      if (orig === undefined || orig !== t.lateness) {
        lateness.push({ teamId: t.id, lateness: t.lateness })
      }
    }

    return {
      slots: slotPayload,
      quizzes: quizPayload,
      prelimAssignments: prelimPayload,
      teamLateness: lateness,
    }
  }

  async function saveDraft(): Promise<void> {
    if (!meetId.value) throw new Error('No meet loaded')
    if (saving.value) return
    saving.value = true
    saveError.value = ''
    try {
      const result = await syncSchedule(meetId.value, buildSyncPayload())
      slots.value = [...result.slots].sort(bySortOrder)
      quizzes.value = result.quizzes
      prelimAssignments.value = result.prelimAssignments
      // Merge lateness back into the joined team rows (church names,
      // numbers, etc. come from the original listMeetTeams response).
      const latenessMap = new Map(result.teams.map((t) => [t.id, t.lateness]))
      teams.value = teams.value.map((t) => {
        const fresh = latenessMap.get(t.id)
        return fresh === undefined ? t : { ...t, lateness: fresh }
      })
      committed.value = takeSnapshot()
    } catch (e) {
      saveError.value = (e as Error).message
      throw e
    } finally {
      saving.value = false
    }
  }

  function discardDraft(): boolean {
    if (!isDirty.value) return true
    if (!confirm('Discard all unsaved schedule changes?')) return false
    const snap = committed.value
    slots.value = snap.slots.map((s) => ({ ...s }))
    quizzes.value = snap.quizzes.map(cloneQuiz)
    prelimAssignments.value = snap.prelimAssignments.map((a) => ({ ...a }))
    teams.value = teams.value.map((t) => {
      const orig = snap.teamLateness[t.id]
      return orig === undefined ? t : { ...t, lateness: orig }
    })
    saveError.value = ''
    return true
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
    replaceQuizzes,
    nextQuizNumber,
    toggleLane,
    resizeLane,
    updateTeamLateness,
    rollTeams,
    isDirty,
    saving,
    saveError,
    saveDraft,
    discardDraft,
  }
}
