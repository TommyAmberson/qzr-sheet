/** Better Auth's OAuth callback reports a failed social sign-in by sending the
 *  browser back to `errorCallbackURL` with `?error=<code>`. */
export interface SocialSignInError {
  message: string
  /** The address already has an account the sign-in couldn't link to, almost
   *  always an email and password one, so the form should open on email
   *  sign-in. */
  passwordAccount: boolean
}

/** The address already has an account a provider sign-in can't join without
 *  proof of the inbox (FR-013). */
const ACCOUNT_NOT_LINKED = 'account_not_linked'

/** Why a GitHub or Google sign-in, or connecting one from account settings,
 *  failed. */
const PROVIDER_ERRORS: Record<string, string> = {
  // FR-026
  provider_email_unverified:
    "That account's email address isn't verified. Confirm it with the provider, or sign up with " +
    'email instead.',
  verify_email_first: 'Verify your email address first, then connect it.',
  account_already_linked_to_different_user:
    'That account is already connected to a different qzr account.',
  "email_doesn't_match":
    "That account uses a different email address. Connect one that uses this account's address.",
}

export function socialSignInError(search: string): SocialSignInError | null {
  const code = new URLSearchParams(search).get('error')
  if (!code) return null
  if (code === ACCOUNT_NOT_LINKED) {
    return {
      message:
        'This email already has an account. Sign in with its password, then connect GitHub or ' +
        'Google from account settings.',
      passwordAccount: true,
    }
  }
  const message = PROVIDER_ERRORS[code]
  if (message) return { message, passwordAccount: false }
  return { message: 'Sign-in failed. Please try again.', passwordAccount: false }
}

/** The query parameters Better Auth adds to `errorCallbackURL`. */
export const ERROR_PARAMS = ['error', 'error_description'] as const

/** `href` without the error query parameters, so a reload or the next sign-in
 *  doesn't show the same message again. */
export function withoutErrorParam(href: string): string {
  const url = new URL(href)
  for (const param of ERROR_PARAMS) url.searchParams.delete(param)
  return url.toString()
}
