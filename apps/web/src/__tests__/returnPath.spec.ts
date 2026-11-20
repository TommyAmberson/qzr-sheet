import { describe, it, expect } from 'vitest'
import { returnPath } from '../returnPath'

describe('returnPath', () => {
  it('returns to a page of the portal', () => {
    expect(returnPath('/fbc-2024/stats/2')).toBe('/fbc-2024/stats/2')
    expect(returnPath('/fall-2026/results?x=1')).toBe('/fall-2026/results?x=1')
  })

  it('refuses anything that could leave the portal, or is no path at all', () => {
    for (const next of [
      '//evil.example',
      '/\\evil.example',
      'https://evil.example',
      'stats',
      '',
      '/',
    ])
      expect(returnPath(next)).toBeNull()
    expect(returnPath(undefined)).toBeNull()
    expect(returnPath(['/a', '/b'])).toBeNull()
  })
})
