import { createAppAuthClient } from '@qzr/shared'

declare const __API_URL__: string

// Better Auth needs an absolute URL, and uses one with a path as-is, so pass the
// full auth endpoint: /qzr/api/auth in production, the dev API's /api/auth locally.
export const { authClient, useAuth } = createAppAuthClient(
  new URL(`${__API_URL__}/api/auth`, window.location.origin).href,
)

export type SessionData = typeof authClient.$Infer.Session | null

/** The session store's state, as Better Auth keeps it */
interface SessionState {
  data: SessionData
  isPending: boolean
  isRefetching: boolean
}

/**
 * The session as the store `useAuth` reads holds it, once it has an answer: the one request made
 * on opening the app, shared with every `useAuth`, rather than a `getSession()` per caller. A read
 * on its way, such as the one after signing in or out, is waited for.
 */
export function settledSession(): Promise<SessionData> {
  const store = authClient.$store.atoms.session as {
    subscribe(listener: (value: SessionState) => void): () => void
  }
  return new Promise((resolve) => {
    let done = false
    let unsubscribe: (() => void) | undefined = undefined
    // Subscribing keeps the store mounted until the answer, and starts its first read
    unsubscribe = store.subscribe((value) => {
      if (done || !value || value.isPending || value.isRefetching) return
      done = true
      resolve(value.data)
      // Not yet assigned when the store already had its answer: unsubscribed below instead
      unsubscribe?.()
    })
    if (done) unsubscribe()
  })
}
