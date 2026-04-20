import { ApiError, createApiClient } from '@qzr/shared'

declare const __API_URL__: string

const request = createApiClient(__API_URL__ || '')

export { ApiError }

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

export function joinMeet(
  code: string,
): Promise<{ meet: { id: number; name: string }; role: string }> {
  return request('/api/join', { method: 'POST', body: JSON.stringify({ code }) })
}
