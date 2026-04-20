<script setup lang="ts">
import { ref } from 'vue'
import { SignInForm } from '@qzr/ui'
import { useAuth } from '../composables/useAuth'

const { signInSocial, signInEmail, signUpEmail } = useAuth()

const open = ref(false)
</script>

<template>
  <div class="menu-wrap">
    <button class="nav-link nav-btn" @click="open = !open">Sign in</button>

    <div v-if="open" class="backdrop" @click="open = false" />

    <div v-if="open" class="menu">
      <SignInForm
        :sign-in-social="signInSocial"
        :sign-in-email="signInEmail"
        :sign-up-email="signUpEmail"
        @success="open = false"
      />
    </div>
  </div>
</template>

<style scoped>
.menu-wrap {
  position: relative;
}

.backdrop {
  position: fixed;
  inset: 0;
  z-index: 10;
}

.menu {
  position: absolute;
  right: 0;
  top: calc(100% + 0.5rem);
  z-index: 20;
  background: var(--color-bg-alt, #1a1a1a);
  border: 1px solid var(--color-border-alt);
  border-radius: 0.5rem;
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-width: 220px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
}

.nav-link {
  font-size: 0.8rem;
  color: var(--color-text-faint);
  transition: color 0.15s;
}

.nav-link:hover {
  color: var(--color-text-muted);
}

.nav-btn {
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  font-family: inherit;
}
</style>
