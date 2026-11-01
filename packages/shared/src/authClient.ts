import { createAuthClient } from 'better-auth/vue'
import { emailOTPClient } from 'better-auth/client/plugins'
import { withoutErrorParam } from './socialSignInError'

export type SocialProvider = 'github' | 'google'

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
      return (data ?? [])
        .map((a) => a.providerId)
        .filter((p): p is SocialProvider => p === 'github' || p === 'google')
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
     *  session ends. Errors come back in Better Auth's result shape. */
    async function disconnectProvider(provider: SocialProvider, password: string) {
      const res = await fetch(accountURL('disconnect'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, password }),
      })
      if (res.ok) return { error: null }
      const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string }
      return {
        error: { status: res.status, code: body.code, message: body.error ?? res.statusText },
      }
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
    }
  }

  // The account routes sit beside Better Auth's: `.../api/auth` -> `.../api/account/<path>`.
  function accountURL(path: string): string {
    return `${baseURL.replace(/\/auth\/?$/, '')}/account/${path}`
  }

  return { authClient, useAuth }
}
