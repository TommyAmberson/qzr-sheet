import { describe, it, expect, vi, beforeEach } from 'vitest'

interface State {
  data: { user: { id: string } } | null
  isPending: boolean
  isRefetching: boolean
}

/** A store like Better Auth's session atom: subscribing calls the listener at once */
const store = vi.hoisted(() => {
  let value: State = { data: null, isPending: true, isRefetching: false }
  const listeners = new Set<(value: State) => void>()
  return {
    get listeners() {
      return listeners.size
    },
    set(next: State) {
      value = next
      for (const listener of [...listeners]) listener(value)
    },
    subscribe(listener: (value: State) => void) {
      listeners.add(listener)
      listener(value)
      return () => listeners.delete(listener)
    },
  }
})

vi.mock('@qzr/shared', () => ({
  createAppAuthClient: () => ({
    authClient: { $store: { atoms: { session: store } } },
    useAuth: () => ({}),
  }),
}))

import { settledSession } from '../useAuth'

const user = { user: { id: 'u1' } }

beforeEach(() => {
  store.set({ data: null, isPending: true, isRefetching: false })
})

describe('settledSession', () => {
  it('waits for the first read', async () => {
    const read = settledSession()
    store.set({ data: user, isPending: false, isRefetching: false })
    expect(await read).toEqual(user)
    expect(store.listeners).toBe(0)
  })

  it('answers at once from a read already done, without staying subscribed', async () => {
    store.set({ data: null, isPending: false, isRefetching: false })
    expect(await settledSession()).toBeNull()
    expect(store.listeners).toBe(0)
  })

  it('waits for a read on its way, such as after signing in', async () => {
    store.set({ data: null, isPending: false, isRefetching: true })
    const read = settledSession()
    store.set({ data: user, isPending: false, isRefetching: false })
    expect(await read).toEqual(user)
  })
})
