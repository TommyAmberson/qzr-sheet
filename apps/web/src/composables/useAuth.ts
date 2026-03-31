import { createAuthClient } from 'better-auth/vue'

declare const __API_URL__: string

export const authClient = createAuthClient({
  baseURL: `${__API_URL__}/api/auth`,
})

export function useAuth() {
  const session = authClient.useSession()

  function signIn() {
    authClient.signIn.social({ provider: 'github', callbackURL: '/' })
  }

  function signOut() {
    authClient.signOut()
  }

  return { session, signIn, signOut }
}
