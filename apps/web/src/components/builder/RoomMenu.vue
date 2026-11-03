<script setup lang="ts">
import { computed } from 'vue'
import type { ScheduleDocument } from '@qzr/shared'

import { removeRoom, renameRoom } from '../../builder/edits'
import BuilderPopover from './BuilderPopover.vue'

/** A room's menu: rename it or remove it, its quizzes going to the unplaced tray (FR-005c) */
const props = defineProps<{ doc: ScheduleDocument; roomId: string; anchor: HTMLElement }>()
const emit = defineEmits<{ change: [mutate: (d: ScheduleDocument) => void]; close: [] }>()

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

.danger {
  justify-self: start;
  color: var(--color-danger, #c33);
}
</style>
