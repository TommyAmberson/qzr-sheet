import { createApiClient, MeetRole } from '@qzr/shared'
import type { MeetPhase, DivisionStateValue } from '@qzr/shared'

export type { MeetPhase, DivisionStateValue }

declare const __API_URL__: string

const request = createApiClient(__API_URL__ || '')

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
  transitionedAt: string
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
): Promise<{ officialCode: OfficialCode; code: string }> {
  return request(`/api/meets/${meetId}/official-codes/${codeId}/rotate`, { method: 'POST' })
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

export function setDivisionState(
  meetId: number,
  division: string,
  state: DivisionStateValue,
): Promise<{ state: DivisionStateValue; reversed: boolean; unchanged?: boolean }> {
  return request(`/api/meets/${meetId}/divisions/${encodeURIComponent(division)}/state`, {
    method: 'POST',
    body: JSON.stringify({ state }),
  })
}

export function getDivisionStates(meetId: number): Promise<{ divisionStates: DivisionState[] }> {
  return request(`/api/meets/${meetId}/divisions/state`)
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
): Promise<{ token: string; meet: { id: number; name: string }; role: MeetRole; label?: string }> {
  return request('/api/join/guest', {
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

export function createTeam(churchId: number, data: { division: string }): Promise<{ team: Team }> {
  return request(`/api/churches/${churchId}/teams`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export function updateTeam(
  teamId: number,
  data: { division?: string; number?: number },
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
