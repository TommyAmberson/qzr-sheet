import { describe, it, expect } from 'vitest'
import app from '../../index'

// Minimal Bindings stub — only what the health route touches
const env = { ENVIRONMENT: 'test', DB: {} as D1Database }

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const res = await app.request('/health', {}, env)
    expect(res.status).toBe(200)
  })

  it('returns status: ok and the environment name', async () => {
    const res = await app.request('/health', {}, env)
    const body = await res.json()
    expect(body).toEqual({ status: 'ok', environment: 'test' })
  })

  it('sets Content-Type to application/json', async () => {
    const res = await app.request('/health', {}, env)
    expect(res.headers.get('content-type')).toMatch(/application\/json/)
  })
})

describe('unknown routes', () => {
  it('returns 404 for an unregistered path', async () => {
    const res = await app.request('/does-not-exist', {}, env)
    expect(res.status).toBe(404)
  })
})
