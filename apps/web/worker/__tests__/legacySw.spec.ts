// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { legacyServiceWorker } from '../legacySw'

type Listener = (event: { waitUntil: (p: Promise<unknown>) => void }) => void

/** Runs the worker source against fake service-worker globals. */
function install(cacheNames: string[], clientUrls: string[]) {
  const listeners: Record<string, Listener> = {}
  const calls: string[] = []
  const deleted: string[] = []
  const navigated: string[] = []
  const self = {
    addEventListener: (type: string, fn: Listener) => (listeners[type] = fn),
    skipWaiting: vi.fn(),
    registration: { unregister: async () => void calls.push('unregister') },
    caches: {
      keys: async () => cacheNames,
      delete: async (name: string) => void deleted.push(name),
    },
    clients: {
      matchAll: async () =>
        clientUrls.map((url) => ({
          url,
          navigate: async (to: string) => {
            calls.push('navigate')
            navigated.push(to)
          },
        })),
    },
  }
  new Function('self', legacyServiceWorker)(self)

  async function fire(type: string) {
    const pending: Promise<unknown>[] = []
    listeners[type]({ waitUntil: (p) => pending.push(p) })
    await Promise.all(pending)
  }
  return { self, fire, calls, deleted, navigated }
}

describe('self-destroying service worker', () => {
  it('takes over immediately on install', async () => {
    const sw = install([], [])
    await sw.fire('install')
    expect(sw.self.skipWaiting).toHaveBeenCalled()
  })

  it('deletes only the old scope caches, then unregisters, then moves open windows', async () => {
    const sw = install(
      [
        'workbox-precache-v2-https://www.versevault.ca/scoresheet/',
        'workbox-precache-v2-https://www.versevault.ca/qzr/scoresheet/',
      ],
      ['https://www.versevault.ca/scoresheet/?meet=fall-2025'],
    )
    await sw.fire('activate')
    expect(sw.deleted).toEqual(['workbox-precache-v2-https://www.versevault.ca/scoresheet/'])
    expect(sw.calls).toEqual(['unregister', 'navigate'])
    expect(sw.navigated).toEqual(['/qzr/scoresheet/?meet=fall-2025'])
  })
})
