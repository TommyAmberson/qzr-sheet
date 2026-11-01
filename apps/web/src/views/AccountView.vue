<script setup lang="ts">
import { computed, ref } from 'vue'
import { codeErrorMessage } from '@qzr/shared'
import { useAuth } from '../composables/useAuth'

const { session, sendVerificationCode, verifyEmail } = useAuth()

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
