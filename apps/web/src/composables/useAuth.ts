import { ref, computed } from 'vue'

declare const __API_URL__: string

interface AuthUser {
  id: number
  email: string | null
  role: string
}

const token = ref<string | null>(localStorage.getItem('auth_token'))
const user = ref<AuthUser | null>(null)

export function useAuth() {
  const isSignedIn = computed(() => token.value !== null)

  async function fetchUser() {
    if (!token.value) return
    const res = await fetch(`${__API_URL__}/me`, {
      headers: { Authorization: `Bearer ${token.value}` },
    })
    if (res.ok) {
      user.value = await res.json()
    } else {
      signOut()
    }
  }

  function signIn() {
    window.location.href = `${__API_URL__}/auth/github`
  }

  function signOut() {
    token.value = null
    user.value = null
    localStorage.removeItem('auth_token')
  }

  async function setToken(newToken: string) {
    token.value = newToken
    await fetchUser()
  }

  return { isSignedIn, user, token, fetchUser, setToken, signIn, signOut }
}
