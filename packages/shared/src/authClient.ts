import { createAuthClient } from 'better-auth/vue'
import { withoutErrorParam } from './socialSignInError'

export type SocialProvider = 'github' | 'google'

export function createAppAuthClient(baseURL: string) {
  const authClient = createAuthClient({ baseURL })

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

    return { session, signInSocial, signInEmail, signUpEmail, signOut }
  }

  return { authClient, useAuth }
}
