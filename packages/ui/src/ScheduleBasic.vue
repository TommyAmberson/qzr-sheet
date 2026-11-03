<script setup lang="ts">
import { computed } from 'vue'
import { basicRows, formatClock, type ScheduleDocument } from '@qzr/shared'

/** The basic schedule sent to coaches: events, and "Quizzing" between them (FR-044) */
const props = defineProps<{ doc: ScheduleDocument }>()
const rows = computed(() => basicRows(props.doc))
</script>

<template>
  <table class="schedule-basic">
    <tbody>
      <tr v-for="(r, i) in rows" :key="i" :class="r.kind">
        <th v-if="r.kind === 'day'" colspan="2">{{ r.label }}</th>
        <template v-else>
          <td class="time">{{ formatClock(r.from!) }}</td>
          <td>{{ r.label }}</td>
        </template>
      </tr>
    </tbody>
  </table>
</template>

<style scoped>
.schedule-basic th {
  text-align: left;
  padding-top: 0.75rem;
}

.time {
  padding-right: 1rem;
  white-space: nowrap;
}

.quizzing {
  font-weight: 600;
}
</style>
