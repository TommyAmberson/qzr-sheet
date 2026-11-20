import { ApiError } from '@qzr/shared'

/**
 * Whether the server answered that a request is no good (a room code, a quiz file, a phase that
 * doesn't allow it), so asking again won't change the answer, rather than failing, timing out,
 * limiting the rate, or finding the account signed out
 */
export function isRefusal(e: unknown): boolean {
  return (
    e instanceof ApiError &&
    e.status >= 400 &&
    e.status < 500 &&
    ![401, 408, 429].includes(e.status)
  )
}
