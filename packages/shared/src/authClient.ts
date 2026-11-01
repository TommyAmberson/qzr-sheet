import { createAuthClient } from 'better-auth/vue'
import { emailOTPClient } from 'better-auth/client/plugins'
import { withoutErrorParam } from './socialSignInError'

import { isSocialProvider, type SocialProvider } from './socialProviders'

export type { SocialProvider }

export interface AccountError {
  status: number
  code?: string
  message: string
}

/** Where a pending GitHub or Google sign-in is: proving the inbox with a
 *  code, or choosing "That's me" or "That's not me". */
export interface PendingProviderStep {
  step: 'code' | 'choice'
  provider: SocialProvider
  email: string
}

export function createAppAuthClient(baseURL: string) {
  const authClient = createAuthClient({ baseURL, plugins: [emailOTPClient()] })

  function useAuth() {
    const session = authClient.useSession()

    // A failed round-trip (e.g. `account_not_linked`) comes back to this page
    // with `?error=`, where the sign-in UI explains it, instead of landing on
    // Better Auth's own error page on the API.
    function signInSocial(provider: SocialProvider) {
      authClient.signIn.social({
        provider,
        callbackURL: window.location.href,
        errorCallbackURL: errorReturnURL(),
      })
    }

    // Better Auth appends `?error=` to this by string concatenation, so a
    // `#fragment` would swallow it; drop the fragment, and any old error.
    function errorReturnURL(): string {
      const url = new URL(withoutErrorParam(window.location.href))
      url.hash = ''
      return url.toString()
    }

    async function signInEmail(email: string, password: string) {
      return authClient.signIn.email({ email, password, callbackURL: window.location.href })
    }

    async function signUpEmail(email: string, password: string) {
      return authClient.signUp.email({
        email,
        password,
        name: email,
        callbackURL: window.location.href,
      })
    }

    function signOut() {
      authClient.signOut()
    }

    /** Emails a reset code; answers the same whether the address has an
     *  account. */
    async function requestPasswordReset(email: string) {
      return authClient.emailOtp.requestPasswordReset({ email })
    }

    /** Sets a new password with the emailed code. Signing in afterwards is a
     *  normal password sign-in. */
    async function resetPassword(email: string, code: string, password: string) {
      return authClient.emailOtp.resetPassword({ email, otp: code, password })
    }

    /** Emails a new verification code to the signed-in account's address. */
    async function sendVerificationCode(email: string) {
      return authClient.emailOtp.sendVerificationOtp({ email, type: 'email-verification' })
    }

    /** Verifies the signed-in account's address with its emailed code. */
    async function verifyEmail(email: string, code: string) {
      return authClient.emailOtp.verifyEmail({ email, otp: code })
    }

    /** The account's GitHub and Google sign-ins, for account settings. */
    async function connectedProviders(): Promise<SocialProvider[]> {
      const { data } = await authClient.listAccounts()
      return (data ?? []).map((a) => a.providerId).filter(isSocialProvider)
    }

    /** Connects GitHub or Google from account settings; the provider sends
     *  the browser back here, with `?error=` if it couldn't connect. */
    async function connectProvider(provider: SocialProvider) {
      return authClient.linkSocial({
        provider,
        callbackURL: window.location.href,
        errorCallbackURL: errorReturnURL(),
      })
    }

    /** Disconnects GitHub or Google with the account's password; every other
     *  session ends. */
    async function disconnectProvider(provider: SocialProvider, password: string) {
      return accountRequest('disconnect', { provider, password })
    }

    /** The step a pending GitHub or Google sign-in is on, held by a cookie
     *  set when the provider sent the browser back. */
    async function pendingProvider() {
      return accountRequest<PendingProviderStep>('provider')
    }

    /** The code step: the code emailed to the account's address. */
    async function confirmProviderCode(code: string) {
      return accountRequest<{ step: 'choice' }>('provider/confirm', { code })
    }

    async function resendProviderCode() {
      return accountRequest<{ step: PendingProviderStep['step'] }>('provider/resend', {})
    }

    /** "That's me", once signed in with the account's password. */
    async function claimProvider() {
      return accountRequest('provider/claim', {})
    }

    /** "That's not me": the account becomes the person's, and they are
     *  signed in. */
    async function takeOverAccount() {
      return accountRequest('provider/takeover', {})
    }

    return {
      session,
      signInSocial,
      signInEmail,
      signUpEmail,
      signOut,
      requestPasswordReset,
      resetPassword,
      sendVerificationCode,
      verifyEmail,
      connectedProviders,
      connectProvider,
      disconnectProvider,
      pendingProvider,
      confirmProviderCode,
      resendProviderCode,
      claimProvider,
      takeOverAccount,
    }
  }

  /** Calls one of the account routes: GET without a body, POST with one.
   *  Results come back in Better Auth's shape, so the forms handle both
   *  alike. */
  async function accountRequest<T = { ok: true }>(
    path: string,
    body?: unknown,
  ): Promise<{ data: T; error: null } | { data: null; error: AccountError }> {
    const res = await fetch(accountURL(path), {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'include',
      ...(body === undefined
        ? {}
        : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    })
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (res.ok) return { data: json as T, error: null }
    return {
      data: null,
      error: {
        status: res.status,
        code: typeof json.code === 'string' ? json.code : undefined,
        message: typeof json.error === 'string' ? json.error : res.statusText,
      },
    }
  }

  // The account routes sit beside Better Auth's: `.../api/auth` -> `.../api/account/<path>`.
  function accountURL(path: string): string {
    return `${baseURL.replace(/\/auth\/?$/, '')}/account/${path}`
  }

  return { authClient, useAuth }
}
