<script setup lang="ts">
import { ref, shallowRef } from 'vue'

interface Question {
  title: string
  detail: string
  choices: { label: string; value: unknown; primary?: boolean }[]
}

const dialogRef = ref<HTMLDialogElement | null>(null)
const question = shallowRef<Question | null>(null)
let settle: ((value: unknown) => void) | null = null

/**
 * Ask a question with a button for each choice. Resolves to the chosen value, or null when the
 * dialog is dismissed.
 */
function ask<T>(
  title: string,
  detail: string,
  choices: { label: string; value: T | null; primary?: boolean }[],
): Promise<T | null> {
  // A question asked over an unanswered one dismisses it, so no caller waits forever
  settle?.(null)
  question.value = { title, detail, choices }
  dialogRef.value?.showModal()
  return new Promise((resolve) => (settle = resolve as (value: unknown) => void))
}

function choose(value: unknown) {
  dialogRef.value?.close()
  settle?.(value)
  settle = null
}

defineExpose({ ask })
</script>

<template>
  <dialog ref="dialogRef" class="choice-dialog" @cancel="choose(null)">
    <div v-if="question" class="choice-dialog__inner">
      <p class="choice-dialog__title">{{ question.title }}</p>
      <p class="choice-dialog__detail">{{ question.detail }}</p>
      <div class="choice-dialog__actions">
        <button
          v-for="choice in question.choices"
          :key="choice.label"
          class="choice-dialog__btn"
          :class="{ 'choice-dialog__btn--primary': choice.primary }"
          @click="choose(choice.value)"
        >
          {{ choice.label }}
        </button>
      </div>
    </div>
  </dialog>
</template>

<style scoped>
.choice-dialog {
  border: 1px solid var(--color-border-alt);
  border-radius: 10px;
  background: var(--color-bg);
  color: var(--color-text);
  padding: 0;
  width: min(26rem, 90vw);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  inset: 0;
  margin: auto;
}

.choice-dialog::backdrop {
  background: rgba(0, 0, 0, 0.4);
}

.choice-dialog__inner {
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.choice-dialog__title {
  font-weight: 700;
  font-size: 0.9rem;
}

.choice-dialog__detail {
  font-size: 0.8rem;
}

.choice-dialog__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.5rem;
}

.choice-dialog__btn {
  background: none;
  border: 1px solid var(--color-border-alt);
  border-radius: 6px;
  padding: 0.4rem 0.8rem;
  font-size: 0.8rem;
  font-family: inherit;
  color: inherit;
  cursor: pointer;
}

.choice-dialog__btn--primary {
  background: var(--color-accent);
  border-color: var(--color-accent);
  color: #fff;
}
</style>
