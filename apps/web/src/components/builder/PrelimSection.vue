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

const SOURCE_NAMES: Record<string, string> = { ruleBook: 'Rule book', noRematches: 'No rematches' }
</script>

<template>
  <div class="prelim-section">
    <label class="field">
      Quizzes per team
      <select
        :value="String(doc.settings.quizzesPerTeam)"
        aria-label="Quizzes per team"
        @change="
          emit(
            'change',
            (d) =>
              (d.settings.quizzesPerTeam = Number(($event.target as HTMLSelectElement).value) as
                | 3
                | 6),
          )
        "
      >
        <option value="3">3</option>
        <option value="6">6</option>
      </select>
    </label>
    <p v-if="was('quizzesPerTeam')" class="unapplied">
      Unapplied · grid uses {{ was('quizzesPerTeam') }}
    </p>

    <label class="field">
      <span>
        Prelim draw
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
      <select
        :value="doc.settings.prelimDraw"
        aria-label="Prelim draw"
        @change="
          emit(
            'change',
            (d) =>
              (d.settings.prelimDraw = ($event.target as HTMLSelectElement).value as
                | 'ruleBook'
                | 'noRematches'),
          )
        "
      >
        <option value="ruleBook">Rule book</option>
        <option value="noRematches">No rematches</option>
      </select>
    </label>
    <p v-if="was('prelimDraw')" class="unapplied">
      Unapplied · grid uses {{ SOURCE_NAMES[was('prelimDraw')!] }}
    </p>
    <p v-if="showInfo" class="info-box">
      Every team plays the same number of prelim quizzes against different opponents, whichever you
      pick. <strong>Rule book</strong> uses the official tables for 4 to 21 teams; the rule book has
      no tables over 21 teams, so larger divisions use the rotating draw, and its 8-team table has
      one pair of teams meeting twice. <strong>No rematches</strong> uses the rotating draw from 7
      teams, so no two teams meet twice. The draw gives teams their letters at random, so neither
      favours a team.
    </p>
    <DrawControls :doc="doc" @change="(m) => emit('change', m)" @edit="(m) => emit('edit', m)" />
  </div>
</template>

<style scoped>
.prelim-section {
  display: grid;
  gap: 0.5rem;
}

.field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.info {
  font: inherit;
  font-size: 0.75rem;
  width: 1.2rem;
  height: 1.2rem;
  border-radius: 50%;
  border: 1px solid currentColor;
  background: none;
  cursor: pointer;
}

.info-box {
  font-size: 0.85rem;
  margin: 0;
}

.unapplied {
  margin: 0;
  font-size: 0.8rem;
  color: var(--color-warn, #a60);
}
</style>
