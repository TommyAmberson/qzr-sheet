<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import type { TutorialStep } from '../tutorial/tutorialSteps'

const props = defineProps<{
  step: TutorialStep
  stepIndex: number
  totalSteps: number
  targetEls: HTMLElement[]
  completed: boolean
}>()

const emit = defineEmits<{
  next: []
  skip: []
}>()

const spotlightRect = ref<DOMRect | null>(null)
const tooltipRef = ref<HTMLElement | null>(null)
const PADDING = 8

function computeUnionRect(els: HTMLElement[]): DOMRect | null {
  if (els.length === 0) return null
  let top = Infinity
  let left = Infinity
  let bottom = -Infinity
  let right = -Infinity
  for (const el of els) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) continue
    top = Math.min(top, r.top)
    left = Math.min(left, r.left)
    bottom = Math.max(bottom, r.bottom)
    right = Math.max(right, r.right)
  }
  if (top === Infinity) return null
  return new DOMRect(left, top, right - left, bottom - top)
}

function updateRect() {
  spotlightRect.value = computeUnionRect(props.targetEls)
}

let resizeObserver: ResizeObserver | null = null
let scrollCleanup: (() => void) | null = null

function setupTracking() {
  cleanupTracking()
  updateRect()

  if (props.targetEls.length > 0) {
    resizeObserver = new ResizeObserver(updateRect)
    for (const el of props.targetEls) resizeObserver.observe(el)
  }

  const wrapper = document.querySelector('.scoresheet-wrapper')
  if (wrapper) {
    wrapper.addEventListener('scroll', updateRect)
    scrollCleanup = () => wrapper.removeEventListener('scroll', updateRect)
  }

  window.addEventListener('resize', updateRect)
}

function cleanupTracking() {
  resizeObserver?.disconnect()
  resizeObserver = null
  scrollCleanup?.()
  scrollCleanup = null
  window.removeEventListener('resize', updateRect)
}

watch(() => props.targetEls, setupTracking)
watch(() => props.stepIndex, updateRect)
onMounted(setupTracking)
onUnmounted(cleanupTracking)

const spotlightStyle = computed(() => {
  const r = spotlightRect.value
  if (!r) return null
  return {
    top: `${r.top - PADDING}px`,
    left: `${r.left - PADDING}px`,
    width: `${r.width + PADDING * 2}px`,
    height: `${r.height + PADDING * 2}px`,
  }
})

const tooltipStyle = computed(() => {
  const r = spotlightRect.value
  const tooltip = tooltipRef.value
  const placement = props.step.placement
  const gap = 12

  if (!r) {
    return {
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
    }
  }

  const tooltipWidth = tooltip?.offsetWidth ?? 320
  const tooltipHeight = tooltip?.offsetHeight ?? 200
  const vw = window.innerWidth
  const vh = window.innerHeight

  let top = 0
  let left = 0

  if (placement === 'bottom') {
    top = r.bottom + PADDING + gap
    left = r.left + r.width / 2 - tooltipWidth / 2
  } else if (placement === 'top') {
    top = r.top - PADDING - gap - tooltipHeight
    left = r.left + r.width / 2 - tooltipWidth / 2
  } else if (placement === 'right') {
    top = r.top + r.height / 2 - tooltipHeight / 2
    left = r.right + PADDING + gap
  } else {
    top = r.top + r.height / 2 - tooltipHeight / 2
    left = r.left - PADDING - gap - tooltipWidth
  }

  left = Math.max(8, Math.min(left, vw - tooltipWidth - 8))
  top = Math.max(8, Math.min(top, vh - tooltipHeight - 8))

  return {
    top: `${top}px`,
    left: `${left}px`,
  }
})

const buttonLabel = computed(() => (props.completed ? 'Next' : 'Skip'))
</script>

<template>
  <Teleport to="body">
    <div class="tutorial-overlay">
      <div v-if="spotlightStyle" class="tutorial-spotlight" :style="spotlightStyle" />
      <div v-else class="tutorial-backdrop" />

      <div ref="tooltipRef" class="tutorial-tooltip" :style="tooltipStyle">
        <h3 class="tutorial-tooltip__title">{{ step.title }}</h3>
        <p class="tutorial-tooltip__body">{{ step.body }}</p>
        <div class="tutorial-tooltip__controls">
          <span class="tutorial-tooltip__counter">{{ stepIndex + 1 }} / {{ totalSteps }}</span>
          <button class="tutorial-tooltip__next" @click="emit('next')">{{ buttonLabel }}</button>
          <button class="tutorial-tooltip__skip" @click="emit('skip')">End Tutorial</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style>
.tutorial-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  pointer-events: none;
}

.tutorial-spotlight {
  position: fixed;
  border-radius: 6px;
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.5);
  pointer-events: none;
  transition: all 0.2s ease;
}

.tutorial-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  pointer-events: none;
}

.tutorial-tooltip {
  position: fixed;
  background: var(--color-bg, #fff);
  color: var(--color-text, #1a1a1a);
  border-radius: 8px;
  padding: 1rem 1.25rem;
  max-width: 340px;
  min-width: 260px;
  box-shadow:
    0 4px 20px rgba(0, 0, 0, 0.25),
    0 0 0 1px rgba(0, 0, 0, 0.08);
  pointer-events: auto;
  z-index: 10001;
}

.tutorial-tooltip__title {
  font-size: 1rem;
  font-weight: 700;
  margin: 0 0 0.5rem;
}

.tutorial-tooltip__body {
  font-size: 0.875rem;
  line-height: 1.5;
  margin: 0 0 0.75rem;
  color: var(--color-text-secondary, #555);
}

.tutorial-tooltip__controls {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.tutorial-tooltip__counter {
  font-size: 0.75rem;
  color: var(--color-text-faint, #888);
  margin-right: auto;
}

.tutorial-tooltip__next {
  background: var(--color-accent, #2563eb);
  color: #fff;
  border: none;
  padding: 0.35rem 1rem;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.8rem;
  font-weight: 600;
}

.tutorial-tooltip__next:hover {
  opacity: 0.9;
}

.tutorial-tooltip__skip {
  background: none;
  border: none;
  color: var(--color-text-faint, #888);
  cursor: pointer;
  font-size: 0.75rem;
  text-decoration: underline;
  padding: 0.25rem 0.5rem;
}

.tutorial-tooltip__skip:hover {
  color: var(--color-text, #1a1a1a);
}
</style>
