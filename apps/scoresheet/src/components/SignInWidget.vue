<script setup lang="ts">
import { ref } from 'vue'
import { SignInForm } from '@qzr/ui'
import { useAuth } from '../composables/useAuth'
import { useMeetSession } from '../composables/useMeetSession'

const { session, signInSocial, signInEmail, signUpEmail, signOut } = useAuth()
const { clearSession } = useMeetSession()

const open = ref(false)
const menuPos = ref({ top: 0, right: 0 })

function toggle(event: MouseEvent) {
  if (open.value) {
    open.value = false
    return
  }
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  // Anchor to right edge of button so menu aligns right
  menuPos.value = { top: rect.bottom + 4, right: window.innerWidth - rect.right }
  open.value = true
}

async function doSignOut() {
  clearSession()
  await signOut()
  open.value = false
}
</script>

<template>
  <div class="widget-wrap">
    <button v-if="session.data" class="meta-btn" @click="toggle">
      {{ session.data.user.email }}
    </button>
    <button v-else class="meta-btn" @click="toggle">Sign in</button>

    <Teleport to="body">
      <div v-if="open" class="sign-in-backdrop" @click="open = false" />

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
          @success="open = false"
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
