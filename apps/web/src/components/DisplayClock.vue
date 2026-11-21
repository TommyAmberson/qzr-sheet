<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { formatClock, wallClock } from '@qzr/shared'

/**
 * The time now on the meet's clock, for a screen in the room: moved on at the start of each minute
 * while the page is in view, and caught up at once when it comes back
 */
const props = defineProps<{ timeZone: string }>()

const now = ref(new Date())
let ticking: ReturnType<typeof setTimeout> | undefined
function tick() {
  now.value = new Date()
  ticking = setTimeout(tick, 60_000 - (now.value.getTime() % 60_000))
}
function onVisibility() {
  clearTimeout(ticking)
  if (document.visibilityState === 'visible') tick()
}
onMounted(() => {
  tick()
  document.addEventListener('visibilitychange', onVisibility)
})
onUnmounted(() => {
  clearTimeout(ticking)
  document.removeEventListener('visibilitychange', onVisibility)
})

/** Written as the schedule writes its times, so the two read alike */
const text = computed(() => formatClock(wallClock(now.value, props.timeZone).minutes))
</script>

<template>
  <time class="display-clock" :datetime="now.toISOString()">{{ text }}</time>
</template>

<style scoped>
.display-clock {
  color: var(--color-heading);
  font-size: 1.25rem;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  line-height: 1;
}
</style>
