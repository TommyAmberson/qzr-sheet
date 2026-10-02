/** Better Auth's OAuth callback reports a failed social sign-in by sending the
 *  browser back to `errorCallbackURL` with `?error=<code>`. */
export interface SocialSignInError {
  message: string
  /** The address already has an account the sign-in couldn't link to, almost
   *  always an email and password one, so the form should open on email
   *  sign-in. */
  passwordAccount: boolean
}

/** Since better-auth 1.6.11, a GitHub or Google sign-in refuses to merge into an
 *  existing account whose email is unverified. Our password accounts never
 *  are; a social account can be too, if its provider's email wasn't. */
const ACCOUNT_NOT_LINKED = 'account_not_linked'

export function socialSignInError(search: string): SocialSignInError | null {
  const code = new URLSearchParams(search).get('error')
  if (!code) return null
  if (code === ACCOUNT_NOT_LINKED) {
    return {
      message:
        "This email already has an account that can't be linked automatically. Sign in the way you created it, usually with your email and password.",
      passwordAccount: true,
    }
  }
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
