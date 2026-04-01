import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { ApiError, listMeets, createMeet, deleteMeet, joinMeet } from '../api'

const mockFetch = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch)
})

afterEach(() => {
  mockFetch.mockReset()
})

describe('ApiError', () => {
  it('sets status and message', () => {
    const err = new ApiError(404, 'Not found')
    expect(err.status).toBe(404)
    expect(err.message).toBe('Not found')
    expect(err.name).toBe('ApiError')
  })

  it('is an instance of Error', () => {
    const err = new ApiError(500, 'Server error')
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(ApiError)
  })
})

describe('request()', () => {
  it('listMeets calls GET /api/meets with credentials', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ meets: [] }),
    })

    const result = await listMeets()
    expect(result).toEqual({ meets: [] })

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, init] = mockFetch.mock.calls[0]!
    // Vite define bakes in the dev base URL at compile time, so only check the path
    expect(url).toMatch(/\/api\/meets$/)
    expect(init.credentials).toBe('include')
    expect(init.headers['Content-Type']).toBe('application/json')
  })

  it('throws ApiError with status and error message on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      json: () => Promise.resolve({ error: 'Access denied' }),
    })

    await expect(listMeets()).rejects.toThrow(ApiError)

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      json: () => Promise.resolve({ error: 'Access denied' }),
    })

    try {
      await listMeets()
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError)
      expect((e as ApiError).status).toBe(403)
      expect((e as ApiError).message).toBe('Access denied')
    }
  })

  it('falls back to statusText when error body has no error field', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: () => Promise.resolve({}),
    })

    try {
      await listMeets()
    } catch (e) {
      expect((e as ApiError).message).toBe('Internal Server Error')
    }
  })

  it('falls back to statusText when error body is not JSON', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      json: () => Promise.reject(new Error('not json')),
    })

    try {
      await listMeets()
    } catch (e) {
      expect((e as ApiError).message).toBe('Bad Gateway')
    }
  })

  it('createMeet sends POST with JSON body', async () => {
    const meetData = {
      name: 'Fall 2025',
      dateFrom: '2025-09-01',
      viewerCode: 'fall25',
      divisions: ['A', 'B'],
    }
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ meet: { id: 1, ...meetData }, adminCode: 'abc123' }),
    })

    await createMeet(meetData)

    const [url, init] = mockFetch.mock.calls[0]!
    expect(url).toMatch(/\/api\/meets$/)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual(meetData)
  })

  it('deleteMeet sends DELETE to /api/meets/:id', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ deleted: true }),
    })

    await deleteMeet(42)

    const [url, init] = mockFetch.mock.calls[0]!
    expect(url).toMatch(/\/api\/meets\/42$/)
    expect(init.method).toBe('DELETE')
  })

  it('joinMeet sends POST to /api/join with code', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ meet: { id: 1, name: 'Test' }, role: 'viewer' }),
    })

    await joinMeet('some-code')

    const [url, init] = mockFetch.mock.calls[0]!
    expect(url).toMatch(/\/api\/join$/)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ code: 'some-code' })
  })
})
