import { createApiClient } from '@qzr/shared'
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

export function joinMeet(
  code: string,
): Promise<{ meet: { id: number; name: string }; role: string }> {
  return request('/api/join', { method: 'POST', body: JSON.stringify({ code }) })
}
