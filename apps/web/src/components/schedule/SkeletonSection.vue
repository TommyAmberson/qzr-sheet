<script setup lang="ts">
import { computed } from 'vue'

import { type MeetRoom, type MeetSlot } from '../../api'
import { formatSlotTime } from '../../scheduleGrid'

const props = defineProps<{
  rooms: MeetRoom[]
  slots: MeetSlot[]
  /** Total quiz budget from RosterTally — feeds the capacity sentence. */
  quizBudget: number
  editable: boolean
}>()

interface DayBlock {
  date: string
  start: string
  end: string
  slotCount: number
  quizSlots: number
}

const quizSlotCount = computed(() => props.slots.filter((s) => s.kind === 'quiz').length)

const capacity = computed(() => quizSlotCount.value * props.rooms.length)

const headroom = computed(() => capacity.value - props.quizBudget)

/** Common pitch (mode of slot durations). `null` when slots are mixed
 *  enough that calling it a single pitch would mislead. */
const dominantPitch = computed<number | null>(() => {
  const quizSlots = props.slots.filter((s) => s.kind === 'quiz')
  if (quizSlots.length === 0) return null
  const counts = new Map<number, number>()
  for (const s of quizSlots) counts.set(s.durationMinutes, (counts.get(s.durationMinutes) ?? 0) + 1)
  let best: [number, number] | null = null
  for (const entry of counts) {
    if (!best || entry[1] > best[1]) best = entry
  }
  if (!best) return null
  // Only call it dominant when the mode covers at least 60% of slots.
  return best[1] / quizSlots.length >= 0.6 ? best[0] : null
})

const dayBlocks = computed<DayBlock[]>(() => {
  if (props.slots.length === 0) return []
  const byDate = new Map<string, MeetSlot[]>()
  for (const s of props.slots) {
    const d = new Date(s.startAt)
    if (Number.isNaN(d.getTime())) continue
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    const arr = byDate.get(key) ?? []
    arr.push(s)
    byDate.set(key, arr)
  }
  const blocks: DayBlock[] = []
  for (const [, daySlots] of byDate) {
    const sorted = [...daySlots].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
    const first = sorted[0]
    const last = sorted[sorted.length - 1]
    if (!first || !last) continue
    const firstStart = new Date(first.startAt)
    const lastEnd = new Date(new Date(last.startAt).getTime() + last.durationMinutes * 60_000)
    blocks.push({
      date: firstStart.toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
      }),
      start: formatSlotTime(first.startAt),
      end: formatSlotTime(lastEnd.toISOString()),
      slotCount: sorted.length,
      quizSlots: sorted.filter((s) => s.kind === 'quiz').length,
    })
  }
  return blocks
})
</script>

<template>
  <section class="skeleton">
    <header class="section-head">
      <h2 class="section-title">Skeleton</h2>
      <p class="section-meta">
        <span>{{ rooms.length }} rooms</span>
        <span class="rule" aria-hidden="true">/</span>
        <span>{{ slots.length }} slots</span>
        <template v-if="dominantPitch">
          <span class="rule" aria-hidden="true">/</span>
          <span>{{ dominantPitch }}-min pitch</span>
        </template>
      </p>
    </header>

    <p v-if="slots.length === 0" class="skeleton-empty">
      No slots yet. The composer will generate a chained cadence from a single start time and pitch
      — coming soon.
    </p>

    <p v-else class="capacity">
      <span class="capacity-eq">
        <span class="capacity-num">{{ rooms.length }}</span>
        <span class="capacity-op">rooms ×</span>
        <span class="capacity-num">{{ quizSlotCount }}</span>
        <span class="capacity-op">quiz slots =</span>
        <span class="capacity-num capacity-num--lead">{{ capacity }}</span>
        <span class="capacity-op">cells</span>
      </span>
      <span class="capacity-sep" aria-hidden="true">·</span>
      <span class="capacity-budget">
        budget <span class="capacity-num">{{ quizBudget }}</span>
      </span>
      <span class="capacity-sep" aria-hidden="true">·</span>
      <span class="capacity-verdict" :class="headroom < 0 ? 'is-short' : 'is-spare'">
        <span class="capacity-num">{{ Math.abs(headroom) }}</span>
        {{ headroom < 0 ? 'cells short' : 'cells to spare' }}
      </span>
    </p>

    <ol v-if="dayBlocks.length" class="days">
      <li v-for="(day, i) in dayBlocks" :key="i" class="day">
        <span class="day-date">{{ day.date }}</span>
        <span class="day-times">{{ day.start }} → {{ day.end }}</span>
        <span class="day-counts"
          >{{ day.slotCount }} slots
          <template v-if="day.quizSlots !== day.slotCount"> ({{ day.quizSlots }} quiz) </template>
        </span>
      </li>
    </ol>

    <p v-if="editable" class="composer-placeholder">
      Compose cadence — generate slot rows from a single start time and pitch.
      <em>Inline composer ships next.</em>
    </p>
  </section>
</template>

<style scoped>
.skeleton {
  padding: 1.5rem 0 1rem;
  border-top: 2px solid var(--color-text);
  margin-top: 1.5rem;
}

.section-head {
  display: flex;
  align-items: baseline;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 1.25rem;
}

.section-title {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 1.55rem;
  margin: 0;
  letter-spacing: -0.015em;
  color: var(--color-heading);
  flex-shrink: 0;
}

.section-meta {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-faint);
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0 0.5rem;
}

.rule {
  color: var(--color-border);
}

.skeleton-empty {
  font-family: var(--font-display);
  font-style: italic;
  font-size: 1rem;
  line-height: 1.5;
  color: var(--color-text-muted);
  margin: 0 0 1rem;
  max-width: 38rem;
}

.capacity {
  font-family: var(--font-mono);
  font-size: 0.85rem;
  color: var(--color-text);
  margin: 0 0 1.25rem;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0 0.6rem;
  padding: 0.65rem 0;
  border-top: 1px solid var(--color-border-alt);
  border-bottom: 1px solid var(--color-border-alt);
}

.capacity-eq,
.capacity-budget,
.capacity-verdict {
  display: inline-flex;
  align-items: baseline;
  gap: 0.3rem;
}

.capacity-num {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-weight: 500;
  color: var(--color-text);
}

.capacity-num--lead {
  font-size: 1.15rem;
}

.capacity-op {
  color: var(--color-text-faint);
  font-size: 0.78rem;
  text-transform: lowercase;
  letter-spacing: 0.02em;
}

.capacity-sep {
  color: var(--color-border);
  margin: 0 0.1rem;
}

.capacity-budget,
.capacity-verdict {
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-faint);
}

.capacity-budget .capacity-num,
.capacity-verdict .capacity-num {
  font-size: 0.95rem;
}

.capacity-verdict.is-short {
  color: var(--color-invalid, #c00);
}

.capacity-verdict.is-short .capacity-num {
  color: var(--color-invalid, #c00);
}

.capacity-verdict.is-spare {
  color: var(--color-text);
}

.days {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.day {
  display: grid;
  grid-template-columns: minmax(0, 12rem) minmax(0, 10rem) minmax(0, 1fr);
  gap: 1rem;
  align-items: baseline;
  padding: 0.6rem 0;
  border-bottom: 1px dotted var(--color-border-alt);
}

.day:last-child {
  border-bottom: none;
}

.day-date {
  font-family: var(--font-display);
  font-size: 1.05rem;
  font-weight: 600;
  color: var(--color-text);
}

.day-times,
.day-counts {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: 0.85rem;
  color: var(--color-text-muted);
}

.composer-placeholder {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-faint);
  margin: 1rem 0 0;
  padding: 0.55rem 0;
  border-top: 1px dashed var(--color-border);
}

.composer-placeholder em {
  font-style: normal;
  color: var(--color-text-muted);
  text-transform: none;
  letter-spacing: 0.02em;
  margin-left: 0.5rem;
}

@media (max-width: 640px) {
  .day {
    grid-template-columns: 1fr;
    gap: 0.15rem;
  }
}

@media print {
  .composer-placeholder {
    display: none;
  }
}
</style>
