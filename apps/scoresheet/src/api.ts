import { createApiClient, type QuizFile } from '@qzr/shared'
import { getGuestToken } from './composables/useGuestSession'

declare const __API_URL__: string

const baseRequest = createApiClient(__API_URL__ || '')

/**
 * Attach `Authorization: Bearer <jwt>` whenever a guest session is active so
 * the API's session middleware can recognize the caller. Cookie sessions take
 * precedence on the server, so signed-in users never need the header.
 */
function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getGuestToken()
  if (!token) return baseRequest<T>(path, init)
  return baseRequest<T>(path, {
    ...init,
    headers: { ...init?.headers, Authorization: `Bearer ${token}` },
  })
}

// ---- Types ----

export interface MeetSummary {
  meetId: number
  meetName: string
  role: string
}

export interface MeetTeam {
  id: number
  churchId: number
  churchName: string
  churchShortName: string
  division: string
  number: number
  consolation: boolean
}

export interface MeetTeamQuizzer {
  quizzerId: number
  name: string
}

// ---- API calls ----

export function getMyMeets(): Promise<{ memberships: MeetSummary[] }> {
  return request('/api/my-meets')
}

export function getMeetTeams(
  meetId: number,
): Promise<{ teams: MeetTeam[]; meetDivisions: string[] }> {
  return request(`/api/meets/${meetId}/teams`)
}

export function getTeamQuizzers(teamId: number): Promise<{ quizzers: MeetTeamQuizzer[] }> {
  return request(`/api/teams/${teamId}/quizzers`)
}

export interface ScheduledQuizSummary {
  id: number
  meetId: number
  meetName: string
  slotId: number
  roomId: number
  division: string
  phase: 'prelim' | 'elim'
  lane: 'main' | 'consolation' | 'intermediate' | null
  label: string
  bracketLabel: string | null
  slotStartAt: string
  roomName: string
}

export interface ScheduledQuizSeat {
  seatNumber: number
  letter: string | null
  seedRef: string | null
  team: MeetTeam | null
  quizzers: MeetTeamQuizzer[]
}

export interface ScheduledQuizDetails {
  quiz: ScheduledQuizSummary
  seats: ScheduledQuizSeat[]
}

export function getScheduledQuiz(meetId: number, quizId: number): Promise<ScheduledQuizDetails> {
  return request(`/api/meets/${meetId}/quizzes/${quizId}/teams`)
}

// ---- Picker bulk reads (used by SchedulePickerDialog) ----

export interface MeetRoomSummary {
  id: number
  name: string
  sortOrder: number
  hasCode: boolean
}

export interface MeetSlotSummary {
  id: number
  meetId: number
  startAt: string
  durationMinutes: number
  kind: 'quiz' | 'event'
  eventLabel: string | null
  sortOrder: number
}

export interface ScheduledQuizSummaryRow {
  id: number
  meetId: number
  slotId: number
  roomId: number
  division: string
  phase: 'prelim' | 'elim'
  lane: 'main' | 'consolation' | 'intermediate' | null
  label: string
  bracketLabel: string | null
  publishedAt: string | null
  completedAt: string | null
  seats: Array<{
    id: number
    quizId: number
    seatNumber: number
    letter: string | null
    seedRef: string | null
  }>
}

export interface PrelimAssignmentRow {
  id: number
  meetId: number
  division: string
  letter: string
  teamId: number
  assignedAt: string | number
}

export function listMeetRooms(meetId: number): Promise<{ rooms: MeetRoomSummary[] }> {
  return request(`/api/meets/${meetId}/rooms`)
}

export function listMeetSlots(meetId: number): Promise<{ slots: MeetSlotSummary[] }> {
  return request(`/api/meets/${meetId}/slots`)
}

export function listScheduledQuizzes(
  meetId: number,
): Promise<{ quizzes: ScheduledQuizSummaryRow[] }> {
  return request(`/api/meets/${meetId}/quizzes`)
}

export function listPrelimAssignments(
  meetId: number,
): Promise<{ assignments: PrelimAssignmentRow[] }> {
  return request(`/api/meets/${meetId}/prelim-assignments`)
}

export function joinMeet(
  code: string,
): Promise<{ meet: { id: number; name: string }; role: string }> {
  return request('/api/join', { method: 'POST', body: JSON.stringify({ code }) })
}

/**
 * Unauthenticated guest join — does NOT use the request wrapper because the
 * wrapper attaches a Bearer token we don't have yet. Returns a 24h JWT plus
 * the resolved meet identity.
 */
export async function joinMeetGuest(
  code: string,
): Promise<{ token: string; meet: { id: number; name: string }; role: string } | null> {
  const res = await fetch(`${__API_URL__ || ''}/api/join/guest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  })
  if (!res.ok) return null
  return (await res.json()) as { token: string; meet: { id: number; name: string }; role: string }
}

// ---- Saves + results ----

export interface SubmitSaveResponse {
  id: number
  savedAt: string
}

export function postSave(
  meetId: number,
  payload: {
    quizFile: QuizFile
    kind: 'autosave' | 'checkpoint'
    scheduledQuizId: number | null
    roomId: number | null
    label?: string | null
  },
): Promise<SubmitSaveResponse> {
  return request(`/api/meets/${meetId}/saves`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export interface SubmitResultResponse {
  id: number
  submittedAt: string
}

export function postResult(
  meetId: number,
  payload: {
    quizFile: QuizFile
    quizId: number | null
    roomId: number | null
  },
): Promise<SubmitResultResponse> {
  return request(`/api/meets/${meetId}/results`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}
