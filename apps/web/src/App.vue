<script setup lang="ts">
import AppHeader from './components/AppHeader.vue'
import AppFooter from './components/AppFooter.vue'
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { ChoiceDialog, GuestNotice, RoomCodeDialog, upgradeOnSignIn } from '@qzr/ui'
import { joinMeet } from './api'
import { useAuth } from './composables/useAuth'
import { roomCodeDialog } from './composables/useRoomCode'
import { staleBuildDialog } from './staleBuild'

const { session } = useAuth()
/** A page for a screen, such as a meet's display schedule, shows without the site's header and footer */
const route = useRoute()
const bare = computed(() => !!route.meta.bare)
// Signing in, or starting signed in, upgrades the account with the guest sessions' codes
upgradeOnSignIn(
  () => session.value?.data?.user.id,
  () => ({ joinMeet, dialog: roomCodeDialog.value }),
)
</script>

<template>
  <div class="site">
    <AppHeader v-if="!bare" />
    <main class="site-main">
      <RouterView />
    </main>
    <AppFooter v-if="!bare" />
    <GuestNotice />
    <RoomCodeDialog ref="roomCodeDialog" />
    <ChoiceDialog ref="staleBuildDialog" />
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

/*
 * A printed page is only what the page is about: never the portal's header and footer, nor
 * anything outside the app (development overlays, browser extensions), nor what a page marks
 * `no-print`
 */
@media print {
  .site > .header,
  .site > .footer,
  body > :not(#app),
  .no-print {
    display: none !important;
  }

  body {
    background: #fff;
  }
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
