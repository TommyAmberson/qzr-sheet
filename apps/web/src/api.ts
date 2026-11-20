import { ApiError, createApiClient, MeetRole } from '@qzr/shared'
import type {
  AttentionItem,
  DivisionStateValue,
  ChangeKind,
  DivisionStats,
  DivisionTeamNames,
  LinkHow,
  MeetPhase,
  PublishedSchedule,
  QuizFile,
  QuizProblem,
  ResultAction,
  ScheduleDocument,
  Stage,
  StageChoice,
  StageFrom,
  StatsSettings,
} from '@qzr/shared'
import {
  withGuestToken,
  type GuestJoinAnswer,
  type OnExisting,
  type Sender,
  type Stored,
} from '@qzr/ui'

import { browserTimeZone } from '@qzr/ui'

export type { MeetPhase, DivisionStateValue }

declare const __API_URL__: string

/** Requests carry the guest token of the meet they're for (see `withGuestToken`) */
const baseRequest = createApiClient(__API_URL__ || '')
const request = withGuestToken(baseRequest, joinMeetGuest)

// ---- Types ----

export interface QuizMeet {
  id: number
  name: string
  dateFrom: string
  dateTo: string | null
  viewerCode: string
  divisions: string[]
  createdAt: string
  phase?: MeetPhase
  registrationClosesAt?: string | null
  meetStartsAt?: string | null
}

export interface DivisionState {
  division: string
  state: DivisionStateValue
  transitionedAt?: string
  /** Whether every scheduled quiz of the stage it ends is stored and counting */
  ready: boolean
  /** The scheduled quizzes holding it back: missing, or stored and not counting */
  missing: { name: string }[]
  confirmed: { prelims?: { by: string; at: string }; rerank?: { by: string; at: string } }
  /** The stages the schedule has for the division */
  stages: Stage[]
}

export interface OfficialCode {
  id: number
  label: string
}

export interface MeetDetail {
  meet: QuizMeet
  officialCodes: OfficialCode[]
}

export interface MeetMembership {
  meetId: number
  meetName: string
  viewerCode: string
  role: MeetRole
  label?: string
  churchId?: number
  /** An official's room */
  roomId?: number
}

// ---- Meet CRUD (superuser) ----

export function listMeets(): Promise<{ meets: QuizMeet[] }> {
  return request('/api/meets')
}

export function getMeet(idOrSlug: number | string): Promise<MeetDetail> {
  return request(`/api/meets/${encodeURIComponent(idOrSlug)}`)
}

export function createMeet(data: {
  name: string
  dateFrom: string
  dateTo?: string
  viewerCode: string
  divisions: string[]
}): Promise<{ meet: QuizMeet; adminCode: string }> {
  return request('/api/meets', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export function updateMeet(
  id: number,
  data: {
    name?: string
    dateFrom?: string
    dateTo?: string | null
    viewerCode?: string
    divisions?: string[]
    registrationClosesAt?: string | null
    meetStartsAt?: string | null
  },
): Promise<{ meet: QuizMeet }> {
  return request(`/api/meets/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export function deleteMeet(id: number): Promise<{ deleted: true }> {
  return request(`/api/meets/${id}`, { method: 'DELETE' })
}

// ---- Admin code ----

export function rotateAdminCode(
  meetId: number,
  clearMembers = false,
): Promise<{ adminCode: string }> {
  return request(`/api/meets/${meetId}/rotate-admin-code`, {
    method: 'POST',
    body: JSON.stringify({ clearMembers }),
  })
}

// ---- Official codes ----

export function createOfficialCode(
  meetId: number,
  label: string,
): Promise<{ officialCode: OfficialCode; code: string }> {
  return request(`/api/meets/${meetId}/official-codes`, {
    method: 'POST',
    body: JSON.stringify({ label }),
  })
}

export function deleteOfficialCode(meetId: number, codeId: number): Promise<{ deleted: true }> {
  return request(`/api/meets/${meetId}/official-codes/${codeId}`, { method: 'DELETE' })
}

export function rotateOfficialCode(
  meetId: number,
  codeId: number,
  clearMembers = false,
): Promise<{ officialCode: OfficialCode; code: string }> {
  return request(`/api/meets/${meetId}/official-codes/${codeId}/rotate`, {
    method: 'POST',
    body: JSON.stringify({ clearMembers }),
  })
}

// ---- Phase / division state ----

export function setMeetPhase(
  meetId: number,
  phase: MeetPhase,
): Promise<{ phase: MeetPhase; reversed: boolean; unchanged?: boolean }> {
  return request(`/api/meets/${meetId}/phase`, {
    method: 'POST',
    body: JSON.stringify({ phase }),
  })
}

/**
 * Move a division one step. Without `confirm` the API answers 409 with the scheduled quizzes
 * missing (`missing`), or the stored quizzes seated from an order being withdrawn (`affected`), in
 * the error's body.
 */
export function setDivisionState(
  meetId: number,
  division: string,
  state: DivisionStateValue,
  confirm = false,
): Promise<{ state: DivisionStateValue; reversed: boolean; unchanged?: boolean }> {
  // The API answers 503 before it changes anything, while it prepares the division's stats
  return whenPrepared(() =>
    request(`/api/meets/${meetId}/divisions/${encodeURIComponent(division)}/state`, {
      method: 'POST',
      body: JSON.stringify({ state, ...(confirm ? { confirm } : {}) }),
    }),
  )
}

/** Each division's state and readiness, which asks again while the API prepares the stats */
export function getDivisionStates(meetId: number): Promise<{ divisionStates: DivisionState[] }> {
  return whenPrepared(() => request(`/api/meets/${meetId}/divisions/state`))
}

// ---- Join / memberships ----

export function joinMeet(
  code: string,
): Promise<{ meet: { id: number; name: string }; role: MeetRole; label?: string }> {
  return request('/api/join', {
    method: 'POST',
    body: JSON.stringify({ code }),
  })
}

export function joinMeetGuest(
  code: string,
): Promise<GuestJoinAnswer & { role: MeetRole; label?: string }> {
  // Without a guest token: renewing a session joins through here
  return baseRequest('/api/join/guest', {
    method: 'POST',
    body: JSON.stringify({ code }),
  })
}

export function getMyMeets(): Promise<{ memberships: MeetMembership[] }> {
  return request('/api/my-meets')
}

// ---- Members ----

export interface MeetMember {
  userId: string
  name: string
  email: string
  role: MeetRole
  churchId?: number
  officialCodeId?: number
}

export function listMembers(meetId: number): Promise<{ members: MeetMember[] }> {
  return request(`/api/meets/${meetId}/members`)
}

export function revokeMember(
  meetId: number,
  userId: string,
  scope: { role: MeetRole; churchId?: number; officialCodeId?: number },
): Promise<{ deleted: true }> {
  return request(`/api/meets/${meetId}/members/${userId}`, {
    method: 'DELETE',
    body: JSON.stringify(scope),
  })
}

// ---- Churches ----

export interface Church {
  id: number
  meetId: number
  name: string
  shortName: string
  teamCount: number
}

export interface Team {
  id: number
  meetId: number
  churchId: number
  division: string
  number: number
  consolation: boolean
  /** Read once, to seed the late marks when the meet's schedule is first made; the schedule's draw
   *  owns lateness after that (research R6) */
  lateness: boolean
}

export interface Quizzer {
  quizzerId: number
  name: string
}

export function listChurches(meetId: number): Promise<{ churches: Church[] }> {
  return request(`/api/meets/${meetId}/churches`)
}

export function createChurch(
  meetId: number,
  data: { name: string; shortName?: string },
): Promise<{ church: Church; coachCode: string }> {
  return request(`/api/meets/${meetId}/churches`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export function rotateChurchCoachCode(
  churchId: number,
  clearMembers = false,
): Promise<{ coachCode: string }> {
  return request(`/api/churches/${churchId}/rotate-coach-code`, {
    method: 'POST',
    body: JSON.stringify({ clearMembers }),
  })
}

export function deleteChurch(churchId: number): Promise<{ deleted: true }> {
  return request(`/api/churches/${churchId}`, { method: 'DELETE' })
}

export function updateChurch(
  churchId: number,
  data: { name?: string; shortName?: string },
): Promise<{ church: Church }> {
  return request(`/api/churches/${churchId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export function listTeams(churchId: number): Promise<{ teams: Team[] }> {
  return request(`/api/churches/${churchId}/teams`)
}

/** Team row joined with its church label and the meet's division list,
 *  for any view that needs to render team names per division (the
 *  schedule builder's draw, say). */
export interface MeetTeamRow {
  id: number
  churchId: number
  churchName: string
  churchShortName: string
  division: string
  number: number
  consolation: boolean
  lateness: boolean
}

export function listMeetTeams(
  meetId: number,
): Promise<{ teams: MeetTeamRow[]; meetDivisions: string[] }> {
  return request(`/api/meets/${meetId}/teams`)
}

export function createTeam(churchId: number, data: { division: string }): Promise<{ team: Team }> {
  return request(`/api/churches/${churchId}/teams`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export function updateTeam(
  teamId: number,
  data: { division?: string; number?: number; lateness?: boolean },
): Promise<{ team: Team }> {
  return request(`/api/teams/${teamId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export function deleteTeam(teamId: number): Promise<{ deleted: true }> {
  return request(`/api/teams/${teamId}`, { method: 'DELETE' })
}

export function listQuizzers(teamId: number): Promise<{ quizzers: Quizzer[] }> {
  return request(`/api/teams/${teamId}/quizzers`)
}

export function addQuizzer(teamId: number, name: string): Promise<{ quizzer: Quizzer }> {
  return request(`/api/teams/${teamId}/quizzers`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

export function updateQuizzer(
  teamId: number,
  quizzerId: number,
  name: string,
): Promise<{ quizzer: Quizzer }> {
  return request(`/api/teams/${teamId}/quizzers/${quizzerId}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  })
}

export function removeQuizzer(teamId: number, quizzerId: number): Promise<{ deleted: true }> {
  return request(`/api/teams/${teamId}/quizzers/${quizzerId}`, { method: 'DELETE' })
}

// ---- Roster sync / import ----

export interface SyncQuizzer {
  id: number
  name: string
}

export interface SyncTeam {
  id: number
  division: string
  quizzers: SyncQuizzer[]
}

export interface SyncRosterPayload {
  teams: SyncTeam[]
  unassigned: SyncQuizzer[]
}

export interface SyncRosterTeamResult {
  id: number
  meetId: number
  churchId: number
  division: string
  number: number
  consolation?: boolean
  quizzers: Array<{ quizzerId: number; name: string }>
}

export interface SyncRosterResult {
  teams: SyncRosterTeamResult[]
  unassigned: Array<{ quizzerId: number; name: string }>
}

export function syncRoster(
  churchId: number,
  payload: SyncRosterPayload,
): Promise<SyncRosterResult> {
  return request(`/api/churches/${churchId}/roster/sync`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export interface RosterImportEntry {
  church: string
  division: string
  teamName: string
  quizzerName: string
}

export function importRoster(
  meetId: number,
  entries: RosterImportEntry[],
): Promise<{ churchesCreated: number; teamsCreated: number; quizzersAdded: number }> {
  return request(`/api/meets/${meetId}/roster/import`, {
    method: 'POST',
    body: JSON.stringify(entries),
  })
}

export interface RosterExportEntry {
  churchId: number
  churchName: string
  churchShortName: string
  teamId: number
  teamNumber: number
  division: string
  quizzerName: string
}

export function exportRoster(meetId: number): Promise<{ entries: RosterExportEntry[] }> {
  return request(`/api/meets/${meetId}/roster/export`)
}

// ---- Rooms ----

export interface MeetRoom {
  id: number
  name: string
  sortOrder: number
  hasCode: boolean
}

export function listMeetRooms(meetId: number): Promise<{ rooms: MeetRoom[] }> {
  return request(`/api/meets/${meetId}/rooms`)
}

// ---- Results ----

/** A quiz stored for a meet, with its newest revision */
export interface StoredQuiz {
  id: number
  /** The first revision's saver and how it was saved: where the quiz came from */
  origin: { action: ResultAction; name: string }
  /** What it counts for; null when it counts for nothing */
  stage: Stage | null
  /** Whose choice the stage is; null with no stage, unless an admin set it to not counted */
  stageFrom: StageFrom | null
  /** The scheduled quiz it is linked to, and how it came to be */
  link: { scheduleQuizId: string; how: LinkHow } | null
  /** What is wrong with it; null while its score is still being made */
  problems: QuizProblem[] | null
  /** Whether an admin accepted its current content as scored */
  accepted: boolean
  /** Seated from an order since withdrawn, and not kept by an admin since */
  withdrawnOrder?: true
  /** Its own way of scoring level teams differs from the meet's, which the tables use */
  otherFormula?: true
  revision: number
  /** How the newest revision was saved */
  action: ResultAction
  savedAt: string
  savedBy: { name: string }
  quizFile: QuizFile
}

export function getTeamNames(meetId: number): Promise<DivisionTeamNames[]> {
  return request(`/api/meets/${meetId}/team-names`)
}

/** Replace the meet's team names; answers them as saved, tidied */
export function setTeamNames(
  meetId: number,
  lists: DivisionTeamNames[],
): Promise<DivisionTeamNames[]> {
  return request(`/api/meets/${meetId}/team-names`, {
    method: 'PUT',
    body: JSON.stringify(lists),
  })
}

export function listResults(meetId: number): Promise<StoredQuiz[]> {
  return request(`/api/meets/${meetId}/results`)
}

/** Upload a saved quiz file to a meet, by name, for a room or (an admin) none */
export function uploadResult(
  meetId: number,
  quizFile: QuizFile,
  roomId: number | null,
  onExisting?: OnExisting,
): Promise<Stored> {
  return request(`/api/meets/${meetId}/results`, {
    method: 'POST',
    body: JSON.stringify({ quizFile, roomId: roomId ?? undefined, onExisting, upload: true }),
  })
}

/** One entry of a stored quiz's history: a save, or a count or uncount */
export type HistoryEntry =
  | {
      kind: 'revision'
      revision: number
      action: ResultAction
      /** For a revision that restores another, the revision whose file it restores */
      restoredFrom?: number
      savedBy: { name: string }
      savedAt: string
      /** Whether its file is the quiz's current content */
      current: boolean
      /** Its file; a restoring revision's is the file it restores */
      quizFile: QuizFile
    }
  | { kind: 'counting'; counted: boolean; changedBy: { name: string }; changedAt: string }
  | {
      kind: 'change'
      what: ChangeKind
      stage?: StageChoice | null
      scheduleQuizId?: string | null
      how?: LinkHow
      revision?: number
      accepted?: boolean
      changedBy: { name: string }
      changedAt: string
    }

/** A stored quiz's saves and counting records, newest first */
export function getHistory(meetId: number, resultId: number): Promise<HistoryEntry[]> {
  return request(`/api/meets/${meetId}/results/${resultId}/revisions`)
}

/** Make an earlier revision current again; nothing is added when it already is */
export function restoreRevision(
  meetId: number,
  resultId: number,
  revision: number,
): Promise<{ id: number; revision: number }> {
  return request(`/api/meets/${meetId}/results/${resultId}/restore`, {
    method: 'POST',
    body: JSON.stringify({ revision }),
  })
}

/**
 * Whether a save was refused because a newer revision was saved since its base. The edit route
 * answers 409 for a taken name or a closed phase too; only this one carries the newest revision.
 */
export function isStaleSave(e: unknown): boolean {
  return (
    e instanceof ApiError &&
    e.status === 409 &&
    typeof (e.body as { revision?: unknown } | undefined)?.revision === 'number'
  )
}

/**
 * Save an edited stored quiz as a new revision, labelled `merged` for a merge of team names (R10). A
 * rename onto another quiz's name is refused. With `baseRevision`, the revision the file was made
 * from, the API also refuses (409, see `isStaleSave`) when a newer one has been saved since, rather
 * than undo it.
 */
export function editResult(
  meetId: number,
  resultId: number,
  quizFile: QuizFile,
  { action, baseRevision }: { action?: 'merged'; baseRevision?: number } = {},
): Promise<{ id: number; revision: number }> {
  return request(`/api/meets/${meetId}/results/${resultId}`, {
    method: 'PUT',
    body: JSON.stringify({ quizFile, action, baseRevision }),
  })
}

/** Who the user is when sending to a meet, as the API works it out; 401 or 403 when no one */
export function getSender(meetId: number): Promise<Sender> {
  return request(`/api/meets/${meetId}/results/sender`)
}

/** Set what quizzes of a meet count for, or with `null` return them to their link's stage */
export function setResultsStage(
  meetId: number,
  ids: number[],
  stage: StageChoice | null,
): Promise<{ changed: number[] }> {
  return request(`/api/meets/${meetId}/results/stage`, {
    method: 'PATCH',
    body: JSON.stringify({ ids, stage }),
  })
}

/** Link a stored quiz to a scheduled quiz by hand, or with `null` remove its link */
export function linkResult(
  meetId: number,
  resultId: number,
  scheduleQuizId: string | null,
): Promise<{ link: StoredQuiz['link'] }> {
  return request(`/api/meets/${meetId}/results/${resultId}/link`, {
    method: 'PUT',
    body: JSON.stringify({ scheduleQuizId }),
  })
}

/** Accept a stored quiz as scored at a revision, so it counts in spite of its errors, or withdraw that */
export function setAcceptance(
  meetId: number,
  resultId: number,
  revision: number,
  accepted: boolean,
): Promise<{ revision: number; accepted: boolean }> {
  return request(`/api/meets/${meetId}/results/${resultId}/acceptance`, {
    method: 'PUT',
    body: JSON.stringify({ revision, accepted }),
  })
}

// ---- Stats (specs/006-meet-stats/contracts/stats-api.md) ----

/** How long to keep asking for stats the API is still preparing, one try a second */
const STATS_TRIES = 60

/**
 * The meet's divisions with their states, and whether the caller is one of its admins: empty for
 * anyone but an admin before the meet is live
 */
export function getStatsDivisions(meetId: number): Promise<{
  phase: MeetPhase
  admin: boolean
  divisions: { division: string; state: DivisionStateValue }[]
}> {
  return request(`/api/meets/${meetId}/stats`)
}

/**
 * The meet's stats settings; for admins, who saved them last, and how many stored quizzes score
 * level teams another way than the meet
 */
export interface StatsSettingsRead {
  settings: StatsSettings
  changed?: { by: string; at: string }
  otherFormula?: number
}

export function getStatsSettings(meetId: number): Promise<StatsSettingsRead> {
  return request(`/api/meets/${meetId}/stats/settings`)
}

export function saveStatsSettings(
  meetId: number,
  settings: StatsSettings,
): Promise<StatsSettingsRead> {
  return request(`/api/meets/${meetId}/stats/settings`, {
    method: 'PUT',
    body: JSON.stringify({ settings }),
  })
}

/** Set stored quizzes scored another way to the meet's way of scoring level teams, a few a time */
export async function setQuizzesToMeetFormula(meetId: number): Promise<number> {
  let changed = 0
  for (;;) {
    const res = await request<{ changed: number; remaining: number }>(
      `/api/meets/${meetId}/results/formula`,
      { method: 'POST' },
    )
    changed += res.changed
    if (res.remaining === 0 || res.changed === 0) return changed
  }
}

/** Keep a quiz as it is after an order it was seated from was withdrawn */
export function keepQuiz(meetId: number, resultId: number): Promise<{ kept: true }> {
  return request(`/api/meets/${meetId}/results/${resultId}/keep`, { method: 'POST' })
}

/** Everything that needs an admin's attention across the meet, asked again while being prepared */
export function getAttention(meetId: number): Promise<{ items: AttentionItem[] }> {
  return whenPrepared(() => request(`/api/meets/${meetId}/stats/attention`))
}

/** Say two look-alike names are different teams, or with `team` different quizzers on it */
export function dismissNames(
  meetId: number,
  division: string,
  names: [string, string],
  team?: string,
): Promise<{ ok: true }> {
  return request(`/api/meets/${meetId}/stats/dismissals`, {
    method: 'POST',
    body: JSON.stringify({ division, names, ...(team === undefined ? {} : { team }) }),
  })
}

/**
 * One division's stats; an admin may ask for them as a viewer sees them, which asks again while
 * the API prepares them
 */
export function getDivisionStats(
  meetId: number,
  division: string,
  asViewer = false,
): Promise<DivisionStats> {
  return whenPrepared(() =>
    request(
      `/api/meets/${meetId}/stats/${encodeURIComponent(division)}${asViewer ? '?as=viewer' : ''}`,
    ),
  )
}

/**
 * A request for stats, asked again until they are ready. The API answers 503 while it is still
 * scoring a division's stored quizzes, a few with each request.
 */
async function whenPrepared<T>(read: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await read()
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 503 || attempt >= STATS_TRIES) throw e
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }
}

// ---- Linked schedules (specs/005-schedule-redesign/contracts/api.md) ----

export interface LinkedScheduleState {
  draft: ScheduleDocument | null
  draftRevision: number
  draftSavedAt: string | null
  published: ScheduleDocument | null
  publishedAt: string | null
  version: number | null
  /** Result names with submitted results, protected in the builder (H-20) */
  results: string[]
}

/** The meet's draft and newest version; a meet built with the old editor is converted first */
export function getLinkedSchedule(meetId: number, timeZone: string): Promise<LinkedScheduleState> {
  return request(`/api/meets/${meetId}/schedule?timeZone=${encodeURIComponent(timeZone)}`)
}

export interface DraftSaved {
  draftRevision: number
  draftSavedAt: string
}

/** Throws a 409 `ApiError` whose body has the newer `draft` and `draftRevision` when stale */
export function saveScheduleDraft(
  meetId: number,
  document: ScheduleDocument,
  baseRevision: number,
  /** Replace the server's draft even when it's a different one ("keep mine") */
  replace = false,
): Promise<DraftSaved> {
  return request(`/api/meets/${meetId}/schedule/draft`, {
    method: 'PUT',
    body: JSON.stringify({ document, baseRevision, replace }),
  })
}

export interface Published extends DraftSaved {
  version: number
  publishedAt: string
  /** The schedule's rooms, each with its meet room */
  rooms: ScheduleDocument['rooms']
  /** Meet rooms the schedule doesn't use, kept because they have a room code, officials or results */
  unusedRooms: { id: number; name: string }[]
}

/** Throws a 409 `ApiError` whose body has `conflicts` when there are hard conflicts unconfirmed */
export function publishSchedule(
  meetId: number,
  baseRevision: number,
  confirmConflicts: boolean,
): Promise<Published> {
  return request(`/api/meets/${meetId}/schedule/publish`, {
    method: 'POST',
    body: JSON.stringify({ baseRevision, confirmConflicts }),
  })
}

export interface ScheduleVersion {
  version: number
  publishedAt: string
  publishedBy: string
}

export function listScheduleVersions(meetId: number): Promise<ScheduleVersion[]> {
  return request(`/api/meets/${meetId}/schedule/versions`)
}

export function getScheduleVersion(
  meetId: number,
  version: number,
): Promise<ScheduleVersion & { document: ScheduleDocument }> {
  return request(`/api/meets/${meetId}/schedule/versions/${version}`)
}

export function restoreScheduleVersion(
  meetId: number,
  version: number,
  baseRevision: number,
): Promise<DraftSaved & { document: ScheduleDocument }> {
  return request(`/api/meets/${meetId}/schedule/versions/${version}/restore`, {
    method: 'POST',
    body: JSON.stringify({ baseRevision }),
  })
}

export function unlinkSchedule(meetId: number): Promise<{ ok: true }> {
  return request(`/api/meets/${meetId}/schedule`, { method: 'DELETE' })
}

export function getPublishedSchedule(meetId: number): Promise<PublishedSchedule> {
  // The time zone places a schedule still in the old tables on the meet's days
  return request(
    `/api/meets/${meetId}/schedule/published?timeZone=${encodeURIComponent(browserTimeZone())}`,
  )
}
