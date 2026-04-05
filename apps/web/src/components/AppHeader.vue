<script setup lang="ts">
import { ref } from 'vue'
import { useAuth } from '../composables/useAuth'
import SignInMenu from './SignInMenu.vue'

const scoresheetUrl = __SCORESHEET_URL__
const { session, signOut } = useAuth()

const menuOpen = ref(false)

function closeMenu() {
  menuOpen.value = false
}
</script>

<template>
  <header class="header">
    <div class="header-inner">
      <RouterLink to="/" class="logo">
        <span class="logo-mark">qzr-sheet</span>
      </RouterLink>

      <!-- Desktop nav -->
      <nav class="nav nav--desktop">
        <a :href="scoresheetUrl" class="nav-link">Scoresheet</a>
        <RouterLink to="/roadmap" class="nav-link">Roadmap</RouterLink>
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

      <!-- Mobile hamburger -->
      <button class="hamburger" aria-label="Menu" @click="menuOpen = !menuOpen">
        <span class="hamburger-bar" />
        <span class="hamburger-bar" />
        <span class="hamburger-bar" />
      </button>
    </div>

    <!-- Mobile sidebar -->
    <Teleport to="body">
      <div v-if="menuOpen" class="sidebar-backdrop" @click="closeMenu" />
      <nav class="sidebar" :class="{ 'sidebar--open': menuOpen }">
        <button class="sidebar-close" aria-label="Close menu" @click="closeMenu">×</button>
        <a :href="scoresheetUrl" class="sidebar-link" @click="closeMenu">Scoresheet</a>
        <RouterLink to="/roadmap" class="sidebar-link" @click="closeMenu">Roadmap</RouterLink>
        <a
          href="https://github.com/TommyAmberson/qzr-sheet"
          target="_blank"
          rel="noopener noreferrer"
          class="sidebar-link"
          >GitHub</a
        >
        <hr class="sidebar-divider" />
        <template v-if="session.data">
          <span class="sidebar-user">{{ session.data.user.email ?? 'signed in' }}</span>
          <button
            class="sidebar-link"
            @click="
              signOut()
              closeMenu()
            "
          >
            Sign out
          </button>
        </template>
        <template v-else>
          <SignInMenu @click="closeMenu" />
        </template>
      </nav>
    </Teleport>
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
  white-space: nowrap;
}

.nav--desktop {
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

/* Hamburger — hidden on desktop */
.hamburger {
  display: none;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0.5rem;
  flex-direction: column;
  gap: 4px;
}
.hamburger-bar {
  display: block;
  width: 18px;
  height: 2px;
  background: var(--color-text-muted);
  border-radius: 1px;
}

/* Sidebar */
.sidebar-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 999;
}
.sidebar {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(16rem, 80vw);
  background: var(--color-bg);
  border-left: 1px solid var(--color-border-alt);
  z-index: 1000;
  display: none;
  flex-direction: column;
  padding: 1rem 1.25rem;
  gap: 0.25rem;
  transform: translateX(100%);
  transition: transform 0.2s ease;
}
.sidebar--open {
  display: flex;
  transform: translateX(0);
}
.sidebar-close {
  align-self: flex-end;
  background: none;
  border: none;
  font-size: 1.4rem;
  color: var(--color-text-faint);
  cursor: pointer;
  padding: 0.25rem 0.5rem;
  line-height: 1;
  border-radius: 4px;
  margin-bottom: 0.5rem;
}
.sidebar-close:hover {
  color: var(--color-text);
  background: var(--color-border-alt);
}
.sidebar-link {
  display: block;
  font-size: 0.9rem;
  color: var(--color-text-muted);
  text-decoration: none;
  padding: 0.6rem 0.5rem;
  border-radius: 6px;
  background: none;
  border: none;
  font-family: inherit;
  cursor: pointer;
  text-align: left;
  width: 100%;
}
.sidebar-link:hover {
  background: var(--color-border-alt);
  color: var(--color-text);
}
.sidebar-divider {
  border: none;
  border-top: 1px solid var(--color-border-alt);
  margin: 0.5rem 0;
}
.sidebar-user {
  font-size: 0.8rem;
  color: var(--color-text-faint);
  padding: 0.4rem 0.5rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Responsive: show hamburger + sidebar on narrow, hide desktop nav */
@media (max-width: 767px) {
  .nav--desktop {
    display: none;
  }
  .hamburger {
    display: flex;
  }
  .header-inner {
    padding: 0 0.75rem;
  }
}
</style>
