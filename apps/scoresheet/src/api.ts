import { createApiClient, type DivisionTeamNames, type QuizFile } from '@qzr/shared'
import { withGuestToken, type OnExisting, type Sender, type Stored } from '@qzr/ui'

declare const __API_URL__: string

/** Requests carry the guest token of the meet they're for (see `withGuestToken`) */
const request = withGuestToken(createApiClient(__API_URL__ || ''))

// ---- Types ----

export interface MeetSummary {
  meetId: number
  meetName: string
  role: string
  /** What the membership is for: an official's room name, a coach's church */
  label?: string
  /** A signed-in official's room in the meet */
  roomId?: number
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

/** Submit the sheet to the meet, which knows it by name, for a room or (an admin) none */
export function submitResult(
  meetId: number,
  quizFile: QuizFile,
  roomId: number | null,
  onExisting?: OnExisting,
): Promise<Stored> {
  return request(`/api/meets/${meetId}/results`, {
    method: 'POST',
    body: JSON.stringify({ quizFile, roomId: roomId ?? undefined, onExisting }),
  })
}

/** One revision of a stored quiz's file; a restoring revision gives the file it restores */
export function getRevision(
  meetId: number,
  resultId: number,
  revision: number,
): Promise<{ quizFile: QuizFile }> {
  return request(`/api/meets/${meetId}/results/${resultId}/revisions/${revision}`)
}

export function getTeamNames(meetId: number): Promise<DivisionTeamNames[]> {
  return request(`/api/meets/${meetId}/team-names`)
}

/** A meet's name, for linking the sheet to it */
export function getMeetName(meetId: number): Promise<{ meet: { name: string } }> {
  return request(`/api/meets/${meetId}`)
}

/** Who the user is when sending to the meet, as the API works it out; 401 or 403 when no one */
export function getSender(meetId: number): Promise<Sender> {
  return request(`/api/meets/${meetId}/results/sender`)
}

export function getMeetTeams(
  meetId: number,
): Promise<{ teams: MeetTeam[]; meetDivisions: string[] }> {
  return request(`/api/meets/${meetId}/teams`)
}

export function getTeamQuizzers(
  meetId: number,
  teamId: number,
): Promise<{ quizzers: MeetTeamQuizzer[] }> {
  return request(`/api/teams/${teamId}/quizzers`, undefined, meetId)
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
