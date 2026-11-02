/** What a failed code request says to the person, by the error the API gave
 *  (FR-010): never a raw error. */
export function codeErrorMessage(
  error: { code?: string | null; message?: string | null; status?: number } | null | undefined,
): string | null {
  if (!error) return null
  if (error.status === 429) return error.message ?? 'Too many requests. Try again later.'
  switch (error.code) {
    case 'INVALID_OTP':
      return "That code isn't valid. Check it, or send a new one."
    case 'OTP_EXPIRED':
      return 'That code has expired. Send a new one.'
    case 'TOO_MANY_ATTEMPTS':
      return 'Too many wrong tries. Send a new code.'
    default:
      return error.message ?? 'Something went wrong. Try again.'
  }
}

/** Which email limit stopped a send (FR-011). */
export type EmailLimit = 'address' | 'network'

export function tooManyRequestsMessage(limit: EmailLimit): string {
  const from = limit === 'network' ? 'from this network' : 'for this address'
  return `Too many requests ${from}. Try again later.`
}

/** The GitHub and Google sign-ins a password reset disconnected, from its
 *  response (FR-025). */
export function providersDisconnectedBy(data: unknown): string[] {
  const list = (data as { providersDisconnected?: unknown } | null | undefined)
    ?.providersDisconnected
  return Array.isArray(list) ? list.filter((p): p is string => typeof p === 'string') : []
}

/** Whether sign-up skipped its verification code, over the network's daily
 *  email limit (FR-006). */
export function signUpCodeSkipped(data: unknown): boolean {
  return (data as { codeSkipped?: unknown } | null | undefined)?.codeSkipped === true
}
