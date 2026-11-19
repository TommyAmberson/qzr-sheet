<script setup lang="ts">
import type { StandingsState } from '@qzr/shared'

import { STANDINGS_STATES } from '../stats'

/** The state a standings table is in, in the same words everywhere (FR-020) */
defineProps<{ state: StandingsState }>()
</script>

<template>
  <span class="standing-state" :title="STANDINGS_STATES[state].meaning">
    {{ STANDINGS_STATES[state].label }}
  </span>
</template>

<style scoped>
.standing-state {
  margin-left: 0.5rem;
  padding: 0.05rem 0.45rem;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--color-text-muted);
  vertical-align: middle;
}
</style>
