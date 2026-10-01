// @vitest-environment node
// Worker specs run in Node, not the portal's jsdom: the Worker has no DOM.
import { describe, it, expect } from 'vitest'
import worker, { type Env } from '../index'

const shells: Record<string, string> = {
  '/qzr/': 'portal shell',
  '/qzr/scoresheet/': 'scoresheet shell',
}

// Stands in for the static-assets binding, which the script only reaches on a
// miss: serves the shells, and answers any conditional request with 304.
const env = {
  ASSETS: {
    fetch: async (request: Request) => {
      if (request.headers.has('If-None-Match')) return new Response(null, { status: 304 })
      return new Response(shells[new URL(request.url).pathname])
    },
  },
} as unknown as Env

function get(path: string, init?: RequestInit) {
  return worker.fetch(new Request(`https://www.versevault.ca${path}`, init), env)
}

describe('qzr-web worker', () => {
  it('serves the scoresheet shell under /qzr/scoresheet/', async () => {
    const res = await get('/qzr/scoresheet/anything')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('scoresheet shell')
  })

  it('serves the portal shell for other /qzr/ paths', async () => {
    const res = await get('/qzr/fall-2025/schedule')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('portal shell')
  })

  it('passes a 304 for the shell through on revalidation', async () => {
    const res = await get('/qzr/fall-2025/schedule', { headers: { 'If-None-Match': '"x"' } })
    expect(res.status).toBe(304)
  })

  it('rejects non-GET requests', async () => {
    const res = await get('/qzr/fall-2025', { method: 'POST' })
    expect(res.status).toBe(405)
  })
})
