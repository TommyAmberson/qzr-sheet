<script setup lang="ts">
import { VueDatePicker } from '@vuepic/vue-datepicker'
import '@vuepic/vue-datepicker/dist/main.css'

interface PickerTime {
  hours: number
  minutes: number
  seconds?: number
}

defineProps<{
  modelValue: PickerTime
  title?: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: PickerTime | null): void
}>()

const prefersDark =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-color-scheme: dark)').matches

/** Locale-driven: en-US gives 12h, fr-FR gives 24h, etc. */
const pickerTimeConfig = {
  is24: !new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hour12,
  minutesGridIncrement: 5,
}
</script>

<template>
  <VueDatePicker
    :model-value="modelValue"
    time-picker
    :time-config="pickerTimeConfig"
    auto-apply
    :dark="prefersDark"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <template #trigger="{ toggleMenu }">
      <button type="button" class="time-editor" :title="title" @click="toggleMenu">
        <span class="time-text"><slot /></span>
      </button>
    </template>
  </VueDatePicker>
</template>

<style scoped>
/* Plain text + dashed underline signals "this is editable" without
   adding width that would shift the time relative to other rows. */
.time-editor {
  cursor: pointer;
  color: var(--color-text);
  font: inherit;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  background: none;
  border: 0;
  padding: 0;
}

.time-editor .time-text {
  text-decoration: underline dashed var(--color-text-faint);
  text-underline-offset: 3px;
  text-decoration-thickness: 1px;
  transition:
    color 100ms ease,
    text-decoration-color 100ms ease;
}

.time-editor:hover .time-text,
.time-editor:focus-visible .time-text {
  color: var(--color-accent);
  text-decoration-color: var(--color-accent);
}

/* VueDatePicker wraps the #trigger slot in a div with class .dp__main.
   Strip its default block styling so the button still centers in its
   container like a plain span would. */
:deep(.dp__main) {
  display: inline-block;
}

:deep(.dp__theme_light),
:deep(.dp__theme_dark) {
  --dp-border-radius: 6px;
  --dp-font-family: inherit;
  --dp-primary-color: var(--color-accent);
  --dp-menu-min-width: 200px;
  --dp-menu-padding: 10px 18px;
}

:deep(.dp__theme_light) {
  --dp-background-color: var(--color-bg-raised);
  --dp-text-color: var(--color-text);
  --dp-hover-color: var(--color-bg);
  --dp-hover-text-color: var(--color-text);
  --dp-menu-border-color: var(--color-border-alt);
  --dp-border-color: var(--color-border-alt);
  --dp-icon-color: var(--color-text-muted);
}

:deep(.dp__theme_dark) {
  --dp-background-color: var(--color-bg-raised);
  --dp-text-color: var(--color-text);
  --dp-hover-color: var(--color-bg);
  --dp-hover-text-color: var(--color-text);
  --dp-menu-border-color: var(--color-border);
  --dp-border-color: var(--color-border);
  --dp-icon-color: var(--color-text-muted);
}

/* The arrow points to wherever the popup happens to align with the
   trigger — when the popup is wider than our compact button, it lands
   off-center. Just drop it; the boxed popup reads cleanly on its own. */
:deep(.dp__arrow_top),
:deep(.dp__arrow_bottom) {
  display: none;
}

/* AM/PM button lives in an unclassed wrapper, so it hugs the popup's
   right edge unless we give it a margin directly. */
:deep(.dp__pm_am_button) {
  margin-inline-end: 0.75rem;
}
</style>
