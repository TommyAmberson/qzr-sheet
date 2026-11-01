<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import {
  codeErrorMessage,
  SOCIAL_PROVIDER_LABEL,
  tooManyRequestsMessage,
  type PendingProviderStep,
} from '@qzr/shared'
import { useAuth } from '../composables/useAuth'

// A GitHub or Google sign-in for an address with an unverified password
// account lands here (FR-015): first the code step, unless Google hosts the
// address, then "That's me" or "That's not me". A cookie the API set holds the
// sign-in; the page only shows its step.
const {
  session,
  signInEmail,
  pendingProvider,
  confirmProviderCode,
  resendProviderCode,
  claimProvider,
  takeOverAccount,
} = useAuth()
const route = useRoute()

type Stage = 'loading' | 'gone' | 'code' | 'choice' | 'mine' | 'notMine' | 'claimed' | 'takenOver'
const stage = ref<Stage>('loading')
const pending = ref<PendingProviderStep | null>(null)
const providerLabel = computed(() =>
  pending.value ? SOCIAL_PROVIDER_LABEL[pending.value.provider] : '',
)

const code = ref('')
const password = ref('')
const busy = ref(false)
const error = ref('')

// Over an email limit the callback sent no code, and says which limit.
const limited = route.query.limited
if (limited === 'address' || limited === 'network') error.value = tooManyRequestsMessage(limited)

onMounted(async () => {
  const result = await pendingProvider().catch(() => null)
  if (!result?.data) {
    stage.value = 'gone'
    return
  }
  pending.value = result.data
  stage.value = result.data.step
})

/** Runs a step, showing its error; true when it succeeded. */
async function run(step: () => Promise<{ error: unknown } | null>): Promise<boolean> {
  error.value = ''
  busy.value = true
  try {
    const result = await step()
    const failed = result?.error as Parameters<typeof codeErrorMessage>[0]
    if (failed?.code === 'PENDING_INVALID') stage.value = 'gone'
    error.value = codeErrorMessage(failed) ?? ''
    return !error.value
  } catch {
    error.value = 'Something went wrong. Try again.'
    return false
  } finally {
    busy.value = false
  }
}

async function submitCode() {
  if (await run(() => confirmProviderCode(code.value))) stage.value = 'choice'
}

async function resend() {
  if (await run(() => resendProviderCode())) code.value = ''
}

async function claim() {
  if (!pending.value) return
  const email = pending.value.email
  if (!(await run(() => signInEmail(email, password.value)))) return
  if (await run(() => claimProvider())) {
    stage.value = 'claimed'
    await session.value.refetch?.()
  }
}

async function takeOver() {
  if (await run(() => takeOverAccount())) {
    stage.value = 'takenOver'
    await session.value.refetch?.()
  }
}
</script>

<template>
  <div class="page">
    <div class="container">
      <p v-if="stage === 'loading'" class="muted">Loading…</p>

      <section v-else-if="stage === 'gone'">
        <h2 class="title">This sign-in has expired</h2>
        <p class="muted">Sign in again from the menu to start over.</p>
        <RouterLink to="/" class="btn">Home</RouterLink>
      </section>

      <section v-else-if="stage === 'code'">
        <h2 class="title">Check your email</h2>
        <p>
          To sign in with {{ providerLabel }}, enter the code we sent to
          <strong>{{ pending?.email }}</strong
          >.
        </p>
        <form class="row" @submit.prevent="submitCode">
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
          <button type="submit" class="btn" :disabled="busy">Continue</button>
          <button type="button" class="link-btn" :disabled="busy" @click="resend">
            Send a new code
          </button>
        </form>
      </section>

      <section v-else-if="stage === 'choice'">
        <h2 class="title">Is this your account?</h2>
        <p>
          An account with <strong>{{ pending?.email }}</strong> already exists, set up with a
          password but never confirmed. Did you create it?
        </p>
        <div class="row">
          <button class="btn" @click="stage = 'mine'">That's me</button>
          <button class="btn btn--plain" @click="stage = 'notMine'">That's not me</button>
        </div>
      </section>

      <section v-else-if="stage === 'mine'">
        <h2 class="title">Sign in to connect {{ providerLabel }}</h2>
        <p>Enter the password for {{ pending?.email }}.</p>
        <form class="row" @submit.prevent="claim">
          <input
            v-model="password"
            type="password"
            autocomplete="current-password"
            placeholder="Password"
            required
            class="field field--wide"
          />
          <button type="submit" class="btn" :disabled="busy">Sign in</button>
          <button type="button" class="link-btn" @click="stage = 'choice'">Back</button>
        </form>
      </section>

      <section v-else-if="stage === 'notMine'">
        <h2 class="title">Take over this account?</h2>
        <p class="warning">
          Whoever set its password will lose access: the password stops working, everyone signed in
          is signed out, and any meets it had joined are removed. You'll sign in with
          {{ providerLabel }} from now on.
        </p>
        <div class="row">
          <button class="btn btn--danger" :disabled="busy" @click="takeOver">
            Take over the account
          </button>
          <button class="link-btn" @click="stage = 'choice'">Back</button>
        </div>
      </section>

      <section v-else-if="stage === 'claimed'">
        <h2 class="title">{{ providerLabel }} connected</h2>
        <p>You can now sign in with {{ providerLabel }} or your password.</p>
        <RouterLink to="/" class="btn">Continue</RouterLink>
      </section>

      <section v-else-if="stage === 'takenOver'">
        <h2 class="title">The account is yours</h2>
        <p>
          You're signed in with {{ providerLabel }}. Any meet access it had was cleared, so join
          your meets again with their codes.
        </p>
        <RouterLink to="/" class="btn">Continue</RouterLink>
      </section>

      <p v-if="error" class="error-msg">{{ error }}</p>
    </div>
  </div>
</template>

<style scoped>
.page {
  padding: 2.5rem 0;
}

.container {
  max-width: 36rem;
  margin: 0 auto;
  padding: 0 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  color: var(--color-text);
}

.title {
  font-size: 1.25rem;
  margin-bottom: 0.75rem;
}

.muted {
  color: var(--color-text-muted);
}

.warning {
  color: var(--color-warning, #b45309);
}

.row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
  margin-top: 0.75rem;
}

.field {
  padding: 0.4rem 0.6rem;
  width: 9rem;
}

.field--wide {
  width: 14rem;
}

.btn {
  padding: 0.4rem 0.9rem;
  display: inline-block;
}

.btn--plain {
  background: none;
}

.btn--danger {
  background: var(--color-error, #b91c1c);
  color: #fff;
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
}
</style>
