<script setup lang="ts">
/**
 * A number field with − and + either side, drawn like the elim steppers instead of the browser's
 * spinner. Attributes and listeners go to the input, and a step fires the input's own change event,
 * so callers read `$event.target` as they would from a plain input.
 */
import { useTemplateRef } from 'vue'

defineOptions({ inheritAttrs: false })

const input = useTemplateRef<HTMLInputElement>('input')

function step(by: 1 | -1) {
  const el = input.value
  if (!el || el.disabled) return
  if (by > 0) el.stepUp()
  else el.stepDown()
  el.dispatchEvent(new Event('change', { bubbles: true }))
}
</script>

<template>
  <span class="number-input" :class="{ disabled: $attrs.disabled }">
    <!-- The arrow keys already step the input, so the buttons stay out of the tab order -->
    <button
      type="button"
      tabindex="-1"
      aria-hidden="true"
      :disabled="!!$attrs.disabled"
      @click="step(-1)"
    >
      −
    </button>
    <input ref="input" type="number" v-bind="$attrs" />
    <button
      type="button"
      tabindex="-1"
      aria-hidden="true"
      :disabled="!!$attrs.disabled"
      @click="step(1)"
    >
      +
    </button>
  </span>
</template>

<style scoped>
.number-input {
  display: inline-flex;
  align-items: stretch;
  border: 1px solid var(--color-meta-accent);
  border-radius: 5px;
  background: var(--color-bg);
}

.number-input:focus-within {
  border-color: var(--color-accent);
}

.number-input.disabled {
  opacity: 0.5;
}

.number-input.number-input button {
  padding: 0 0.45rem;
  border: 0;
  border-radius: 0;
  background: transparent;
  font-size: 0.9rem;
}

.number-input.number-input input {
  width: 3rem;
  border: 0;
  border-radius: 0;
  outline: 0;
  background: transparent;
  -moz-appearance: textfield;
  appearance: textfield;
}

.number-input input::-webkit-inner-spin-button,
.number-input input::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
</style>
