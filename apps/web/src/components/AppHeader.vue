<script setup lang="ts">
import { computed } from 'vue'
import { useAuth } from '../composables/useAuth'
import SignInMenu from './SignInMenu.vue'

const scoresheetUrl = __SCORESHEET_URL__
const { session, signOut } = useAuth()

const isAdmin = computed(
  () => (session.value?.data?.user as Record<string, unknown> | undefined)?.role === 'admin',
)
</script>

<template>
  <header class="header">
    <div class="header-inner">
      <RouterLink to="/" class="logo">
        <span class="logo-mark">qzr-sheet</span>
      </RouterLink>
      <nav class="nav">
        <RouterLink v-if="isAdmin" :to="{ name: 'admin-meets' }" class="nav-link">Admin</RouterLink>
        <a :href="scoresheetUrl" class="nav-link">Scoresheet</a>
        <a
          href="https://github.com/TommyAmberson/qzr-sheet"
          target="_blank"
          rel="noopener noreferrer"
          class="nav-link"
          >GitHub</a
        >
        <template v-if="session.data">
          <span class="nav-user">{{ session.data.user.email ?? 'signed in' }}</span>
          <button class="nav-link nav-btn" @click="signOut">Sign out</button>
        </template>
        <SignInMenu v-else />
      </nav>
    </div>
  </header>
</template>

<style scoped>
.header {
  border-bottom: 1px solid var(--color-border-alt);
  background: var(--color-bg);
}

.header-inner {
  max-width: 52rem;
  margin: 0 auto;
  padding: 0 1.5rem;
  height: 3.25rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.logo {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  text-decoration: none;
  color: inherit;
}

.logo:hover {
  text-decoration: none;
}

.logo-mark {
  font-size: 1rem;
  font-weight: 800;
  letter-spacing: -0.04em;
  color: var(--color-accent);
}

.logo-name {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--color-text-muted);
}

.nav {
  display: flex;
  align-items: center;
  gap: 1.25rem;
}

.nav-link {
  font-size: 0.8rem;
  color: var(--color-text-faint);
  text-decoration: none;
  transition: color 0.15s;
}

.nav-link:hover {
  color: var(--color-text-muted);
  text-decoration: none;
}

.nav-user {
  font-size: 0.8rem;
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
