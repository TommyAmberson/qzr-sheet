<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue'

/**
 * A popup beside the thing clicked on the grid. It closes with its ×, Escape, or a click anywhere outside
 * a popup, and never opens another in the same click (FR-005c).
 */
const props = defineProps<{ anchor: HTMLElement; title: string }>()
const emit = defineEmits<{ close: [] }>()

const rect = props.anchor.getBoundingClientRect()
const style = ref({ top: `${rect.bottom + 4}px`, left: `${Math.max(8, rect.left)}px` })

const box = useTemplateRef<HTMLElement>('box')
/** Above the anchor, or pushed up, when there isn't room for it below */
function keepOnScreen() {
  const el = box.value
  if (!el) return
  const height = el.offsetHeight
  if (rect.bottom + 4 + height <= window.innerHeight - 8) return
  const above = rect.top - 4 - height
  const top = above >= 8 ? above : Math.max(8, window.innerHeight - height - 8)
  style.value = { ...style.value, top: `${top}px` }
}
// Its contents change size as it's used, a seat editor's tabs for one
const resized = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(keepOnScreen)

function outside(event: PointerEvent) {
  if (!(event.target as HTMLElement | null)?.closest('.popover')) emit('close')
}
function escape(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close')
}
onMounted(() => {
  keepOnScreen()
  if (box.value) resized?.observe(box.value)
  document.addEventListener('pointerdown', outside, true)
  document.addEventListener('keydown', escape)
})
onBeforeUnmount(() => {
  resized?.disconnect()
  document.removeEventListener('pointerdown', outside, true)
  document.removeEventListener('keydown', escape)
})
</script>

<template>
  <div ref="box" class="popover" role="dialog" :aria-label="title" :style="style">
    <header>
      <slot name="head"
        ><strong>{{ title }}</strong></slot
      >
      <button type="button" class="close" aria-label="Close" @click="emit('close')">×</button>
    </header>
    <slot />
  </div>
</template>

<style scoped>
.popover {
  position: fixed;
  z-index: 50;
  min-width: 16rem;
  max-width: min(22rem, calc(100vw - 16px));
  background: var(--color-bg, #fff);
  border: 1px solid var(--color-border, #ddd);
  border-radius: 10px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  padding: 0.75rem;
  display: grid;
  gap: 0.5rem;
}

header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.close {
  font: inherit;
  font-size: 1.2rem;
  background: none;
  border: none;
  cursor: pointer;
}
</style>
