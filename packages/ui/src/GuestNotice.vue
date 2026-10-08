<script setup lang="ts">
import { guestNotice } from './guestSession'
</script>

<template>
  <div v-if="guestNotice" class="guest-notice" role="status">
    <span>{{ guestNotice }}</span>
    <button type="button" class="guest-notice__dismiss" @click="guestNotice = null">Dismiss</button>
  </div>
</template>

<style scoped>
.guest-notice {
  position: fixed;
  left: 50%;
  bottom: 1rem;
  transform: translateX(-50%);
  z-index: 1000;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  width: max-content;
  max-width: min(36rem, 92vw);
  padding: 0.6rem 0.9rem;
  border: 1px solid var(--color-border-alt);
  border-radius: 8px;
  background: var(--color-bg);
  color: var(--color-text);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
  font-size: 0.9rem;
}

.guest-notice__dismiss {
  padding: 0.25rem 0.6rem;
  border: 1px solid var(--color-border-alt);
  border-radius: 6px;
  background: var(--color-bg);
  color: var(--color-text);
  font: inherit;
  cursor: pointer;
}
</style>
