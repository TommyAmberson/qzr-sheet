<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  codeErrorMessage,
  SOCIAL_PROVIDERS,
  SOCIAL_PROVIDER_LABEL,
  type SocialProvider,
} from '@qzr/shared'
import { useAuth } from '../composables/useAuth'
import { useSocialSignInError } from '../composables/useSocialSignInError'

const {
  session,
  sendVerificationCode,
  verifyEmail,
  connectedProviders,
  connectProvider,
  disconnectProvider,
} = useAuth()

const user = computed(() => session.value.data?.user ?? null)
const verified = computed(() => user.value?.emailVerified === true)

// Verifying later: send a code, then enter it here (FR-009).
const codeSent = ref(false)
const code = ref('')
const pending = ref(false)
const error = ref('')

async function sendCode() {
  if (!user.value) return
  error.value = ''
  pending.value = true
  try {
    const result = await sendVerificationCode(user.value.email)
    error.value = codeErrorMessage(result?.error) ?? ''
    if (!error.value) codeSent.value = true
  } catch {
    error.value = 'Something went wrong. Try again.'
  } finally {
    pending.value = false
  }
}

// Connect or disconnect GitHub and Google (FR-018). A connection leaves for
// the provider and comes back here, with `?error=` when it failed.
const connected = ref<SocialProvider[]>([])
const { error: connectError, clear: clearConnectError } = useSocialSignInError(useRouter())
const providerError = ref(connectError.value?.message ?? '')
clearConnectError()
const disconnecting = ref<SocialProvider | null>(null)
const password = ref('')
const providerPending = ref(false)

async function loadProviders() {
  connected.value = await connectedProviders().catch(() => connected.value)
}
onMounted(loadProviders)

async function connect(provider: SocialProvider) {
  providerError.value = ''
  providerPending.value = true
  try {
    const result = await connectProvider(provider)
    if (result?.error) providerError.value = result.error.message ?? 'Could not connect. Try again.'
  } catch {
    providerError.value = 'Something went wrong. Try again.'
  } finally {
    providerPending.value = false
  }
}

function askPassword(provider: SocialProvider) {
  providerError.value = ''
  password.value = ''
  disconnecting.value = provider
}

async function disconnect() {
  if (!disconnecting.value) return
  providerError.value = ''
  providerPending.value = true
  try {
    const result = await disconnectProvider(disconnecting.value, password.value)
    if (result.error) {
      providerError.value = result.error.message
      return
    }
    disconnecting.value = null
    password.value = ''
    await loadProviders()
  } catch {
    providerError.value = 'Something went wrong. Try again.'
  } finally {
    providerPending.value = false
  }
}

async function submitCode() {
  if (!user.value) return
  error.value = ''
  pending.value = true
  try {
    const result = await verifyEmail(user.value.email, code.value)
    error.value = codeErrorMessage(result?.error) ?? ''
    if (!error.value) await session.value.refetch?.()
  } catch {
    error.value = 'Something went wrong. Try again.'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <div class="page">
    <div class="container">
      <section class="section">
        <h2 class="section-title">Email address</h2>
        <p class="address">
          {{ user?.email }}
          <span v-if="verified" class="badge badge--ok">Verified</span>
          <span v-else class="badge badge--warn">Unverified</span>
        </p>
        <template v-if="user && !verified">
          <p class="warning">
            Until this address is verified, anyone with access to its inbox can take this account
            over.
          </p>
          <button v-if="!codeSent" class="btn" :disabled="pending" @click="sendCode">
            Send verification code
          </button>
          <form v-else class="code-form" @submit.prevent="submitCode">
            <input
              v-model="code"
              inputmode="numeric"
              autocomplete="one-time-code"
              pattern="[0-9]{6}"
              maxlength="6"
              placeholder="6-digit code"
              required
              class="field"
            />
            <button type="submit" class="btn" :disabled="pending">Verify</button>
            <button type="button" class="link-btn" :disabled="pending" @click="sendCode">
              Send a new code
            </button>
          </form>
          <p v-if="error" class="error-msg">{{ error }}</p>
        </template>
      </section>

      <section class="section">
        <h2 class="section-title">Sign-in methods</h2>
        <ul class="providers">
          <li v-for="id in SOCIAL_PROVIDERS" :key="id" class="provider">
            <span class="provider-name">{{ SOCIAL_PROVIDER_LABEL[id] }}</span>
            <template v-if="connected.includes(id)">
              <span class="badge badge--ok">Connected</span>
              <button
                v-if="disconnecting !== id"
                class="link-btn"
                :disabled="providerPending"
                @click="askPassword(id)"
              >
                Disconnect
              </button>
            </template>
            <button v-else class="btn" :disabled="providerPending" @click="connect(id)">
              Connect {{ SOCIAL_PROVIDER_LABEL[id] }}
            </button>
            <form v-if="disconnecting === id" class="code-form" @submit.prevent="disconnect">
              <input
                v-model="password"
                type="password"
                autocomplete="current-password"
                placeholder="Your password"
                required
                class="field field--wide"
              />
              <button type="submit" class="btn" :disabled="providerPending">Disconnect</button>
              <button type="button" class="link-btn" @click="disconnecting = null">Cancel</button>
            </form>
          </li>
        </ul>
        <p class="hint">Disconnecting signs you out everywhere else.</p>
        <p v-if="providerError" class="error-msg">{{ providerError }}</p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.page {
  padding: 2.5rem 0;
}

.container {
  max-width: 48rem;
  margin: 0 auto;
  padding: 0 1.5rem;
}

.section {
  margin-bottom: 2.5rem;
}

.section-title {
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-faint);
  margin-bottom: 1rem;
}

.address {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--color-text);
}

.badge {
  font-size: 0.75rem;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
}

.badge--ok {
  background: var(--color-success-bg, #dcfce7);
  color: var(--color-success, #15803d);
}

.badge--warn {
  background: var(--color-warning-bg, #fef3c7);
  color: var(--color-warning, #b45309);
}

.warning {
  color: var(--color-text-muted);
  margin: 0.75rem 0;
}

.code-form {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}

.field {
  padding: 0.4rem 0.6rem;
  width: 9rem;
}

.field--wide {
  width: 14rem;
}

.providers {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.provider {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}

.provider-name {
  min-width: 5rem;
  color: var(--color-text);
}

.hint {
  color: var(--color-text-faint);
  font-size: 0.85rem;
  margin-top: 0.75rem;
}

.btn {
  padding: 0.4rem 0.9rem;
}

.link-btn {
  background: none;
  border: none;
  text-decoration: underline;
  cursor: pointer;
  color: var(--color-text-muted);
}

.error-msg {
  color: var(--color-error, #b91c1c);
  margin-top: 0.5rem;
}
</style>
