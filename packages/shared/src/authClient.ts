import { createAuthClient } from 'better-auth/vue'

export function createAppAuthClient(baseURL: string) {
  const authClient = createAuthClient({ baseURL })

  function useAuth() {
    const session = authClient.useSession()

    function signInSocial(provider: 'github' | 'google') {
      authClient.signIn.social({ provider, callbackURL: window.location.href })
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
