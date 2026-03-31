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

export interface Meet {
  id: number
  name: string
  dateFrom: string
  dateTo: string | null
  viewerCode: string
  createdAt: string
}

export interface OfficialCode {
  id: number
  label: string
}

export interface MeetDetail {
  meet: Meet
  officialCodes: OfficialCode[]
}

export interface MeetMembership {
  meetId: number
  meetName: string
  role: 'head_coach' | 'official' | 'viewer'
  label?: string
}

// ---- Meet CRUD (admin) ----

export function listMeets(): Promise<{ meets: Meet[] }> {
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
}): Promise<{ meet: Meet; coachCode: string }> {
  return request('/api/meets', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export function updateMeet(
  id: number,
  data: { name?: string; dateFrom?: string; dateTo?: string | null; viewerCode?: string },
): Promise<{ meet: Meet }> {
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

export function getMyMeets(): Promise<{ memberships: MeetMembership[] }> {
  return request('/api/my-meets')
}
