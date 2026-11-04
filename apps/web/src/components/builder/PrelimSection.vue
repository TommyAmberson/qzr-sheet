<script setup lang="ts">
import { ref } from 'vue'
import type { ScheduleDocument, UnappliedSetting } from '@qzr/shared'

import DrawControls from './DrawControls.vue'

const props = defineProps<{ doc: ScheduleDocument; unapplied: UnappliedSetting[] }>()
const emit = defineEmits<{
  change: [mutate: (d: ScheduleDocument) => void]
  edit: [mutate: (d: ScheduleDocument) => void]
}>()

const was = (key: string) => props.unapplied.find((u) => u.key === key)?.applied
const showInfo = ref(false)

type PrelimDraw = ScheduleDocument['settings']['prelimDraw']
const SOURCE_NAMES: Record<PrelimDraw, string> = {
  ruleBook: 'Rule book',
  noRematches: 'No rematches',
}
</script>

<template>
  <div class="prelim-section">
    <section class="card">
      <h4 class="card-title">Prelims</h4>
      <div class="field">
        Quizzes per team
        <span class="seg" role="group" aria-label="Quizzes per team">
          <button
            v-for="n in [3, 6] as const"
            :key="n"
            type="button"
            :aria-pressed="doc.settings.quizzesPerTeam === n"
            @click="emit('change', (d) => (d.settings.quizzesPerTeam = n))"
          >
            {{ n }}
          </button>
        </span>
      </div>
      <p v-if="was('quizzesPerTeam')" class="unapplied">
        Unapplied · grid uses {{ was('quizzesPerTeam') }}
      </p>

      <div class="field stack">
        <span>
          Draw from
          <button
            type="button"
            class="info"
            aria-label="About the prelim draw"
            :aria-expanded="showInfo"
            @click="showInfo = !showInfo"
          >
            i
          </button>
        </span>
        <span class="seg" role="group" aria-label="Prelim draw">
          <button
            v-for="(name, key) in SOURCE_NAMES"
            :key="key"
            type="button"
            :aria-pressed="doc.settings.prelimDraw === key"
            @click="emit('change', (d) => (d.settings.prelimDraw = key))"
          >
            {{ name }}
          </button>
        </span>
      </div>
      <p v-if="was('prelimDraw')" class="unapplied">
        Unapplied · grid uses {{ SOURCE_NAMES[was('prelimDraw') as PrelimDraw] }}
      </p>
      <p v-if="showInfo" class="info-box">
        Every team plays the same number of prelim quizzes against different opponents, whichever
        you pick. <strong>Rule book</strong> uses the official tables for 4 to 21 teams; the rule
        book has no tables over 21 teams, so larger divisions use the rotating draw, and its 8-team
        table has one pair of teams meeting twice. <strong>No rematches</strong> uses the rotating
        draw from 7 teams, so no two teams meet twice. The draw gives teams their letters at random,
        so neither favours a team.
      </p>
    </section>
    <DrawControls :doc="doc" @change="(m) => emit('change', m)" @edit="(m) => emit('edit', m)" />
  </div>
</template>

<style scoped>
.prelim-section {
  display: grid;
  gap: 0.6rem;
}

.field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

/* A choice too wide to share its label's line sits under it, full width */
.stack {
  flex-direction: column;
  align-items: stretch;
  gap: 0.3rem;
}

.stack .seg button {
  flex: 1;
  white-space: nowrap;
}

.info {
  width: 1.2rem;
  height: 1.2rem;
  margin-left: 0.2rem;
  padding: 0;
  border-radius: 50%;
  font-size: 0.7rem;
}

.info-box {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 0.8rem;
}
</style>
