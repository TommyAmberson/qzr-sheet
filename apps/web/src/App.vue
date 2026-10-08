<script setup lang="ts">
import AppHeader from './components/AppHeader.vue'
import AppFooter from './components/AppFooter.vue'
import { GuestNotice, RoomCodeDialog, upgradeOnSignIn } from '@qzr/ui'
import { joinMeet } from './api'
import { useAuth } from './composables/useAuth'
import { roomCodeDialog } from './composables/useRoomCode'

const { session } = useAuth()
// Signing in, or starting signed in, upgrades the account with the guest sessions' codes
upgradeOnSignIn(
  () => session.value?.data?.user.id,
  () => ({ joinMeet, dialog: roomCodeDialog.value }),
)
</script>

<template>
  <div class="site">
    <AppHeader />
    <main class="site-main">
      <RouterView />
    </main>
    <AppFooter />
    <GuestNotice />
    <RoomCodeDialog ref="roomCodeDialog" />
  </div>
</template>

<style>
*,
*::before,
*::after {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html,
body {
  height: 100%;
}

body {
  font-family:
    'Segoe UI',
    system-ui,
    -apple-system,
    sans-serif;
  background: var(--color-bg-warm);
  color: var(--color-text);
  line-height: 1.6;
}

a {
  color: var(--color-accent);
  text-decoration: none;
}

a:hover {
  color: var(--color-accent-hover);
  text-decoration: underline;
}
</style>

<style scoped>
.site {
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
}

.site-main {
  flex: 1;
}
</style>
