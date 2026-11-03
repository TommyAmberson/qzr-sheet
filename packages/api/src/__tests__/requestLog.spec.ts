import { afterEach, describe, it, expect, vi } from 'vitest'
import { app } from '../index'
import { testBindings as env } from '../test-utils'

describe('request log', () => {
  afterEach(() => vi.restoreAllMocks())

  it('logs the path without its query string', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await app.request('/health?code=secret-code&state=secret-state', {}, env)
    const lines = log.mock.calls.map((args) => String(args[0]))
    expect(lines.some((line) => line.includes('/health'))).toBe(true)
    expect(lines.join('\n')).not.toContain('secret')
  })
})
