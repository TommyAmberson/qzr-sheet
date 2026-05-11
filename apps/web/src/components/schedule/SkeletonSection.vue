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
  <section class="section">
    <div class="section-header">
      <h3 class="section-title">Skeleton</h3>
      <span class="section-meta">
        {{ rooms.length }} rooms · {{ slots.length }} slots<template v-if="dominantPitch">
          · {{ dominantPitch }}-min pitch</template
        >
      </span>
    </div>

    <p v-if="slots.length === 0" class="empty">
      No slots yet. The composer will generate a chained cadence from a single start time and pitch
      — coming soon.
    </p>

    <p v-else class="capacity" :class="headroom < 0 ? 'is-short' : 'is-spare'">
      <strong>{{ rooms.length }}</strong> rooms × <strong>{{ quizSlotCount }}</strong> quiz slots =
      <strong>{{ capacity }}</strong> cells · budget <strong>{{ quizBudget }}</strong> ·
      <strong>{{ Math.abs(headroom) }}</strong> cells {{ headroom < 0 ? 'short' : 'to spare' }}
    </p>

    <ul v-if="dayBlocks.length" class="days">
      <li v-for="(day, i) in dayBlocks" :key="i" class="day">
        <span class="day-date">{{ day.date }}</span>
        <span class="day-times">{{ day.start }} → {{ day.end }}</span>
        <span class="day-counts">
          {{ day.slotCount }} slots<template v-if="day.quizSlots !== day.slotCount">
            ({{ day.quizSlots }} quiz)</template
          >
        </span>
      </li>
    </ul>

    <p v-if="editable" class="composer-placeholder">
      Compose cadence — generate slot rows from a single start time and pitch.
      <em>Inline composer ships next.</em>
    </p>
  </section>
</template>

<style scoped>
.section {
  margin-bottom: 2rem;
}

.section-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 0.75rem;
}

.section-title {
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-faint);
  margin: 0;
}

.section-meta {
  font-size: 0.75rem;
  color: var(--color-text-faint);
  font-variant-numeric: tabular-nums;
}

.empty {
  font-size: 0.85rem;
  color: var(--color-text-muted);
  margin: 0;
  max-width: 38rem;
  line-height: 1.5;
}

.capacity {
  font-size: 0.85rem;
  color: var(--color-text-muted);
  margin: 0 0 1rem;
  padding: 0.6rem 0.85rem;
  background: var(--color-bg-raised);
  border: 1px solid var(--color-border-alt);
  border-radius: 6px;
  font-variant-numeric: tabular-nums;
  line-height: 1.55;
}

.capacity strong {
  color: var(--color-text);
  font-weight: 600;
}

.capacity.is-short strong:last-of-type {
  color: var(--palette-error);
}

.days {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.day {
  display: grid;
  grid-template-columns: minmax(0, 12rem) minmax(0, 10rem) minmax(0, 1fr);
  gap: 0.75rem;
  align-items: baseline;
  padding: 0.55rem 0.875rem;
  background: var(--color-bg-raised);
  border: 1px solid var(--color-border-alt);
  border-radius: 6px;
}

.day-date {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-text);
}

.day-times,
.day-counts {
  font-size: 0.8rem;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}

.composer-placeholder {
  font-size: 0.78rem;
  color: var(--color-text-faint);
  margin: 1rem 0 0;
  padding-top: 0.85rem;
  border-top: 1px dashed var(--color-border);
}

.composer-placeholder em {
  font-style: normal;
  color: var(--color-text-muted);
  margin-left: 0.5rem;
}

@media (max-width: 640px) {
  .day {
    grid-template-columns: 1fr;
    gap: 0.15rem;
  }
}
</style>
