declare const __API_URL__: string

const baseUrl = __API_URL__ || ''

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new ApiError(res.status, (body as { error?: string }).error ?? res.statusText)
  }
  return res.json() as Promise<T>
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
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
