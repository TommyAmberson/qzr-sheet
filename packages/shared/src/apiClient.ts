export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** The error response's whole body, for errors that carry more than a message */
    public body: unknown = undefined,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/** The error a refused response stands for, with the message the API gave */
async function errorOf(res: Response): Promise<ApiError> {
  const body = await res.json().catch(() => ({}))
  return new ApiError(res.status, (body as { error?: string }).error ?? res.statusText, body)
}

export function createApiClient(baseUrl: string) {
  return async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    })
    if (!res.ok) throw await errorOf(res)
    return res.json() as Promise<T>
  }
}

/**
 * Like `createApiClient`, for a file: answers with the response itself, so its bytes and headers
 * can be read, and sets no content type, so the body goes as given.
 */
export function createFileClient(baseUrl: string) {
  return async function request<T = Response>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, { ...init, credentials: 'include' })
    if (!res.ok) throw await errorOf(res)
    return res as T
  }
}
