declare const __API_URL__: string

const baseUrl = __API_URL__ || ''

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
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

export interface QuizMeet {
  id: number
  name: string
  dateFrom: string
  dateTo: string | null
  viewerCode: string
  divisions: string[]
  createdAt: string
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
  role: 'head_coach' | 'official' | 'viewer' | 'admin'
  label?: string
}

// ---- Meet CRUD (admin) ----

export function listMeets(): Promise<{ meets: QuizMeet[] }> {
  return request('/api/meets')
}

export function getMeet(id: number): Promise<MeetDetail> {
  return request(`/api/meets/${id}`)
}

export function createMeet(data: {
  name: string
  dateFrom: string
  dateTo?: string
  viewerCode: string
  divisions: string[]
}): Promise<{ meet: QuizMeet; coachCode: string }> {
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

// ---- Coach code ----

export function rotateCoachCode(meetId: number): Promise<{ coachCode: string }> {
  return request(`/api/meets/${meetId}/rotate-coach-code`, { method: 'POST' })
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

// ---- Join / memberships ----

export function joinMeet(
  code: string,
): Promise<{ meet: { id: number; name: string }; role: string; label?: string }> {
  return request('/api/join', {
    method: 'POST',
    body: JSON.stringify({ code }),
  })
}

export function joinMeetGuest(
  code: string,
): Promise<{ token: string; meet: { id: number; name: string }; role: string; label?: string }> {
  return request('/api/join/guest', {
    method: 'POST',
    body: JSON.stringify({ code }),
  })
}

export function getMyMeets(): Promise<{ memberships: MeetMembership[] }> {
  return request('/api/my-meets')
}

// ---- Churches ----

export interface Church {
  id: number
  meetId: number
  createdBy: string
  name: string
  shortName: string
}

export interface Team {
  id: number
  meetId: number
  churchId: number
  division: string
  number: number
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
  data: { name: string; shortName: string },
): Promise<{ church: Church }> {
  return request(`/api/meets/${meetId}/churches`, {
    method: 'POST',
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
