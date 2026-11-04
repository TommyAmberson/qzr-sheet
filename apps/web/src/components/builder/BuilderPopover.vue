<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue'

/**
 * A popup beside the thing clicked on the grid. It closes with its ×, Escape, or a click anywhere outside
 * a popup, and never opens another in the same click (FR-005c).
 */
const props = defineProps<{
  anchor: HTMLElement
  title: string
  /** What it's the menu of, beside the title: Slot, Room, Event, or a quiz's division */
  tag?: string
  /** A division's colour, ticked before the tag */
  colour?: string
}>()
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
      <strong class="title">{{ title }}</strong>
      <span v-if="tag" class="tag" :style="colour ? { '--qc': colour } : undefined">
        <span v-if="colour" class="tick" />{{ tag }}
      </span>
      <button type="button" class="close" aria-label="Close" @click="emit('close')">×</button>
    </header>
    <slot />
  </div>
</template>

<style scoped>
/* A popup drawn like the settings cards: a raised panel with a gold edge */
.popover {
  position: fixed;
  z-index: 50;
  display: grid;
  gap: 0.5rem;
  min-width: 17rem;
  max-width: min(22rem, calc(100vw - 16px));
  /* Only a popup taller than the window scrolls, as a whole */
  max-height: calc(100vh - 16px);
  overflow-y: auto;
  padding: 0.6rem 0.75rem 0.7rem;
  border: 1px solid var(--color-meta-accent);
  border-top: 3px solid var(--color-meta-accent);
  border-radius: 8px;
  background: var(--color-bg-raised, var(--color-bg));
  box-shadow: var(--b-shadow-lift);
}

header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding-bottom: 0.4rem;
  border-bottom: 1px solid var(--color-border-alt);
}

.title {
  color: var(--color-heading);
}

.tag {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  color: var(--color-text-faint);
  font-size: 0.7rem;
  font-weight: 650;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.popover .close {
  margin-left: auto;
  padding: 0 0.35rem;
  border: 0;
  background: none;
  font-size: 1.1rem;
}
</style>
