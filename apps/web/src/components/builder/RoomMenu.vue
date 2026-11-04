<script setup lang="ts">
import { computed } from 'vue'
import type { ScheduleDocument } from '@qzr/shared'

import { pinWhere, removeRoom, renameRoom } from '../../builder/edits'
import BuilderPopover from './BuilderPopover.vue'

/**
 * A room's menu: rename it, pin or unpin its column, or remove it, its quizzes going to the
 * unplaced tray (FR-005c, FR-011)
 */
const props = defineProps<{ doc: ScheduleDocument; roomId: string; anchor: HTMLElement }>()
const emit = defineEmits<{
  change: [mutate: (d: ScheduleDocument) => void]
  /** A change the generator follows, as a settings change (unpinning) */
  settings: [mutate: (d: ScheduleDocument) => void]
  close: []
}>()

const inRoom = computed(() => props.doc.quizzes.filter((q) => q.cell?.room === props.roomId))
const pinnedCount = computed(() => inRoom.value.filter((q) => q.pinned).length)

function pinColumn(pinned: boolean) {
  const pick = (q: ScheduleDocument['quizzes'][number]) => q.cell?.room === props.roomId
  const mutate = (d: ScheduleDocument) => pinWhere(d, pick, pinned)
  // Pinning changes nothing on the grid; unpinning hands quizzes back to the generator
  if (pinned) emit('change', mutate)
  else emit('settings', mutate)
  emit('close')
}

const room = computed(() => props.doc.rooms.find((r) => r.id === props.roomId)!)

function rename(event: Event) {
  const name = (event.target as HTMLInputElement).value.trim()
  if (name && name !== room.value.name) emit('change', (d) => renameRoom(d, props.roomId, name))
}
</script>

<template>
  <BuilderPopover :anchor="anchor" :title="room.name" @close="emit('close')">
    <label class="field">
      Name
      <input :value="room.name" aria-label="Room name" @change="rename" />
    </label>
    <div class="actions">
      <button type="button" :disabled="pinnedCount === inRoom.length" @click="pinColumn(true)">
        Pin room
      </button>
      <button type="button" :disabled="pinnedCount === 0" @click="pinColumn(false)">
        Unpin room ({{ pinnedCount }})
      </button>
    </div>
    <button
      type="button"
      class="danger"
      @click="(emit('change', (d) => removeRoom(d, roomId)), emit('close'))"
    >
      Remove room
    </button>
  </BuilderPopover>
</template>

<style scoped>
.field {
  display: grid;
  gap: 0.25rem;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}

.danger {
  justify-self: start;
  color: var(--color-danger, #c33);
}
</style>
