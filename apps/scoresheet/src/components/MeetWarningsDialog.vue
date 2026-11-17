<script setup lang="ts">
import { ref } from 'vue'

/** A warning, with the one step that takes the meet's word for it where there is one */
export interface MeetWarning {
  line: string
  fix?: {
    /** Says what the step will do, since it is taken on its word */
    label: string
    run: () => void
  }
}

defineProps<{ warnings: MeetWarning[] }>()

const dialogRef = ref<HTMLDialogElement | null>(null)

function open() {
  dialogRef.value?.showModal()
}

function close() {
  dialogRef.value?.close()
}

defineExpose({ open })
</script>

<template>
  <dialog ref="dialogRef" class="meet-warnings" @click.self="close">
    <div class="meet-warnings__inner">
      <div class="meet-warnings__header">
        <span class="meet-warnings__title">Check these</span>
        <button class="meet-warnings__close" aria-label="Close" @click="close">×</button>
      </div>
      <p v-if="warnings.length === 0" class="meet-warnings__none">Nothing left to check.</p>
      <ul v-else class="meet-warnings__list">
        <!-- Lines can repeat, as a name typed twice does -->
        <li v-for="(warning, i) in warnings" :key="i" class="meet-warnings__item">
          <span class="meet-warnings__line">{{ warning.line }}</span>
          <button v-if="warning.fix" class="meet-warnings__fix" @click="warning.fix.run()">
            {{ warning.fix.label }}
          </button>
        </li>
      </ul>
      <p class="meet-warnings__note">
        Warnings never stop a quiz being sent: the room may be right and the meet wrong.
      </p>
    </div>
  </dialog>
</template>

<style scoped>
.meet-warnings {
  border: 1px solid var(--color-border-alt);
  border-radius: 10px;
  background: var(--color-bg);
  color: var(--color-text);
  padding: 0;
  width: min(34rem, 95vw);
  max-height: 90vh;
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  inset: 0;
  margin: auto;
}

.meet-warnings::backdrop {
  background: rgba(0, 0, 0, 0.4);
}

.meet-warnings__inner {
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  max-height: 90vh;
  overflow-y: auto;
}

.meet-warnings__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.meet-warnings__title {
  font-weight: 700;
  font-size: 0.9rem;
}

.meet-warnings__close {
  background: none;
  border: none;
  font-size: 1.1rem;
  line-height: 1;
  color: var(--color-text-faint);
  cursor: pointer;
  padding: 0.1rem 0.3rem;
  border-radius: 4px;
}

.meet-warnings__list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
}

.meet-warnings__item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem 0.75rem;
  font-size: 0.8rem;
}

.meet-warnings__fix {
  background: none;
  border: 1px solid var(--color-accent);
  border-radius: 6px;
  padding: 0.3rem 0.6rem;
  font-size: 0.75rem;
  font-family: inherit;
  color: var(--color-accent);
  cursor: pointer;
}

.meet-warnings__fix:hover {
  background: color-mix(in srgb, var(--color-accent) 12%, transparent);
}

.meet-warnings__none,
.meet-warnings__note {
  font-size: 0.75rem;
  color: var(--color-text-faint);
  margin: 0;
}
</style>
