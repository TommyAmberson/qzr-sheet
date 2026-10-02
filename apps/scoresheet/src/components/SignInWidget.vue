<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { socialSignInError, withoutErrorParam } from '@qzr/shared'
import { SignInForm } from '@qzr/ui'
import { useAuth } from '../composables/useAuth'
import { useMeetSession } from '../composables/useMeetSession'

const { session, signInSocial, signInEmail, signUpEmail, signOut } = useAuth()
const { clearSession } = useMeetSession()

const open = ref(false)
const menuPos = ref({ top: 0, right: 0 })
// The widget's one visible button (email when signed in, Sign in otherwise):
// the menu anchors to it.
const button = ref<HTMLElement | null>(null)

// A failed GitHub/Google sign-in returns with `?error=`. Show why once, and
// strip it (keeping history.state) so a reload doesn't repeat it.
const oauthError = ref(socialSignInError(window.location.search))
if (oauthError.value) {
  window.history.replaceState(window.history.state, '', withoutErrorParam(window.location.href))
}
onMounted(() => {
  if (oauthError.value) openMenu()
})

function openMenu() {
  if (!button.value) return
  const rect = button.value.getBoundingClientRect()
  // Anchor to right edge of button so menu aligns right
  menuPos.value = { top: rect.bottom + 4, right: window.innerWidth - rect.right }
  open.value = true
}

function close() {
  open.value = false
  oauthError.value = null
}

function toggle() {
  if (open.value) close()
  else openMenu()
}

async function doSignOut() {
  clearSession()
  await signOut()
  open.value = false
}
</script>

<template>
  <div class="widget-wrap">
    <button v-if="session.data" ref="button" class="meta-btn" @click="toggle">
      {{ session.data.user.email }}
    </button>
    <button v-else ref="button" class="meta-btn" @click="toggle">Sign in</button>

    <Teleport to="body">
      <div v-if="open" class="sign-in-backdrop" @click="close" />

      <div
        v-if="open"
        class="sign-in-menu"
        :style="{ top: menuPos.top + 'px', right: menuPos.right + 'px' }"
      >
        <template v-if="session.data">
          <p class="menu-email">{{ session.data.user.email }}</p>
          <button class="sign-out-btn" @click="doSignOut">Sign out</button>
        </template>

        <SignInForm
          v-else
          :sign-in-social="signInSocial"
          :sign-in-email="signInEmail"
          :sign-up-email="signUpEmail"
          :oauth-error="oauthError"
          @success="close"
        />
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.widget-wrap {
  position: relative;
}

.meta-btn {
  background: none;
  border: none;
  padding: 0;
  font-family: inherit;
  font-size: 0.75rem;
  color: var(--color-text-faint);
  cursor: pointer;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color 0.15s;
}

.meta-btn:hover {
  color: var(--color-text-muted);
}

.sign-in-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10;
}

.sign-in-menu {
  position: fixed;
  z-index: 9999;
  background: var(--color-bg);
  border: 1px solid var(--color-border-alt);
  border-radius: 0.5rem;
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-width: 200px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
  animation: menu-enter 0.12s ease;
}

@keyframes menu-enter {
  from {
    opacity: 0;
    transform: scale(0.97) translateY(-4px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

.menu-email {
  font-size: 0.75rem;
  color: var(--color-text-faint);
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sign-out-btn {
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

.sign-out-btn:hover {
  color: var(--color-text-muted);
}
</style>
