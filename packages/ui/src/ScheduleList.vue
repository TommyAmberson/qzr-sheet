<script setup lang="ts">
import { computed } from 'vue'
import { formatClock, seatText, type ScheduleDocument, type SheetView } from '@qzr/shared'

/** The schedule as one list in time order: how a one-room meet prints it (FR-015, FR-044) */
const props = withDefaults(defineProps<{ doc: ScheduleDocument; view?: SheetView }>(), {
  view: 'letters',
})

const items = computed(() => {
  const roomName = new Map(props.doc.rooms.map((r) => [r.id, r.name]))
  const multiRoom = props.doc.rooms.length > 1
  return props.doc.frame.flatMap((row) => {
    if (row.kind === 'day') return [{ key: row.id, kind: 'day', text: row.label }]
    if (row.kind === 'note') return [{ key: row.id, kind: 'note', text: row.text }]
    if (row.kind === 'event')
      return [{ key: row.id, kind: 'event', text: `${formatClock(row.at)} ${row.label}` }]
    return props.doc.quizzes
      .filter((q) => q.cell?.slot === row.id)
      .map((q) => ({
        key: q.id,
        kind: 'quiz',
        text: `${formatClock(row.at)} ${q.label}${multiRoom ? ` · ${roomName.get(q.cell!.room) ?? ''}` : ''}: ${q.seats
          .map((s) => seatText(props.doc, q, s, props.view))
          .join(', ')}`,
      }))
  })
})
</script>

<template>
  <ol class="schedule-list">
    <li v-for="item in items" :key="item.key" :class="item.kind">{{ item.text }}</li>
  </ol>
</template>

<style scoped>
.schedule-list {
  list-style: none;
  padding: 0;
  columns: 2;
}

.day {
  font-weight: 600;
  margin-top: 0.75rem;
  break-after: avoid;
}

.event,
.note {
  font-style: italic;
}

li {
  break-inside: avoid;
}
</style>
