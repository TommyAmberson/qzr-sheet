import { createAuthClient } from 'better-auth/vue'

declare const __API_URL__: string

export const authClient = createAuthClient({
  baseURL: __API_URL__ || window.location.origin,
})

export function useAuth() {
  const session = authClient.useSession()

  function signInGithub() {
    authClient.signIn.social({ provider: 'github', callbackURL: window.location.href })
  }

  function signInGoogle() {
    authClient.signIn.social({ provider: 'google', callbackURL: window.location.href })
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

  return { session, signInGithub, signInGoogle, signInEmail, signUpEmail, signOut }
}
