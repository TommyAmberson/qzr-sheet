<script setup lang="ts">
import { ref } from 'vue'

type SignInResult = { error?: { message?: string | null } | null } | undefined

const props = defineProps<{
  signInSocial: (provider: 'github' | 'google') => void
  signInEmail: (email: string, password: string) => Promise<SignInResult>
  signUpEmail: (email: string, password: string) => Promise<SignInResult>
}>()

const emit = defineEmits<{ (e: 'success'): void }>()

const mode = ref<'pick' | 'signin' | 'signup'>('pick')
const email = ref('')
const password = ref('')
const error = ref('')
const pending = ref(false)

function reset() {
  mode.value = 'pick'
  email.value = ''
  password.value = ''
  error.value = ''
  pending.value = false
}

defineExpose({ reset })

async function submitEmail() {
  error.value = ''
  pending.value = true
  const fn = mode.value === 'signup' ? props.signUpEmail : props.signInEmail
  const result = await fn(email.value, password.value)
  pending.value = false
  if (result?.error) {
    error.value = result.error.message ?? 'Something went wrong'
  } else {
    emit('success')
  }
}
</script>

<template>
  <!-- Provider pick -->
  <template v-if="mode === 'pick'">
    <button class="provider-btn" @click="signInSocial('github')">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path
          d="M12 2C6.477 2 2 6.477 2 12c0 4.418 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.008-.868-.013-1.703-2.782.604-3.369-1.341-3.369-1.341-.454-1.154-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0 1 12 6.836a9.59 9.59 0 0 1 2.504.337c1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.202 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.337 4.687-4.565 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z"
        />
      </svg>
      Continue with GitHub
    </button>
    <button class="provider-btn" @click="signInSocial('google')">
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="#4285F4"
          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        />
        <path
          fill="#34A853"
          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        />
        <path
          fill="#FBBC05"
          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
        />
        <path
          fill="#EA4335"
          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        />
      </svg>
      Continue with Google
    </button>
    <div class="divider"><span>or</span></div>
    <button class="email-toggle" @click="mode = 'signin'">Sign in with email</button>
    <button class="email-toggle" @click="mode = 'signup'">Create account</button>
  </template>

  <!-- Email form -->
  <template v-else>
    <button class="back-btn" @click="mode = 'pick'">← Back</button>
    <p class="form-title">{{ mode === 'signup' ? 'Create account' : 'Sign in' }}</p>
    <form @submit.prevent="submitEmail">
      <input
        v-model="email"
        type="email"
        placeholder="Email"
        autocomplete="email"
        required
        class="field"
      />
      <input
        v-model="password"
        type="password"
        placeholder="Password"
        autocomplete="current-password"
        required
        class="field"
      />
      <p v-if="error" class="error-msg">{{ error }}</p>
      <button type="submit" class="submit-btn" :disabled="pending">
        {{ pending ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in' }}
      </button>
    </form>
  </template>
</template>

<style scoped>
.provider-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.5rem 0.75rem;
  border-radius: 0.375rem;
  border: 1px solid var(--color-border-alt);
  background: var(--color-bg);
  color: var(--color-text-muted);
  font-size: 0.8rem;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s;
}

.provider-btn:hover {
  background: var(--color-bg-alt);
}

.divider {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--color-text-faint);
  font-size: 0.75rem;
}

.divider::before,
.divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--color-border-alt);
}

.email-toggle {
  width: 100%;
  padding: 0.4rem 0.75rem;
  background: none;
  border: 1px solid var(--color-border-alt);
  border-radius: 0.375rem;
  color: var(--color-text-faint);
  font-size: 0.8rem;
  font-family: inherit;
  cursor: pointer;
  transition: color 0.15s;
}

.email-toggle:hover {
  color: var(--color-text-muted);
}

.back-btn {
  background: none;
  border: none;
  padding: 0;
  color: var(--color-text-faint);
  font-size: 0.75rem;
  font-family: inherit;
  cursor: pointer;
  text-align: left;
}

.back-btn:hover {
  color: var(--color-text-muted);
}

.form-title {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-text-muted);
  margin: 0;
}

.field {
  width: 100%;
  padding: 0.4rem 0.6rem;
  background: var(--color-bg);
  border: 1px solid var(--color-border-alt);
  border-radius: 0.375rem;
  color: var(--color-text);
  font-size: 0.8rem;
  font-family: inherit;
  box-sizing: border-box;
}

.field:focus {
  outline: none;
  border-color: var(--color-accent);
}

.error-msg {
  font-size: 0.75rem;
  color: var(--color-error, #f87171);
  margin: 0;
}

.submit-btn {
  width: 100%;
  padding: 0.45rem 0.75rem;
  background: var(--color-accent);
  border: none;
  border-radius: 0.375rem;
  color: #fff;
  font-size: 0.8rem;
  font-family: inherit;
  cursor: pointer;
  transition: opacity 0.15s;
}

.submit-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
