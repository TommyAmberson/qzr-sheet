<script setup lang="ts">
import { ref } from 'vue'
import {
  defaultAbove,
  type DivisionSettings,
  type LaneSettings,
  type ScheduleDocument,
  type UnappliedSetting,
} from '@qzr/shared'

/**
 * Each division's elims, lanes first: how many ranks each lane takes, then an intermediate across
 * any line to settle it, then each lane's format, bracket, Finals, label and lettering (FR-027 to
 * FR-034). Changing them rebuilds only unpinned quizzes.
 */
const props = defineProps<{ doc: ScheduleDocument; unapplied: UnappliedSetting[] }>()
const emit = defineEmits<{ change: [mutate: (d: ScheduleDocument) => void] }>()

const message = ref('')

function edit(id: string, mutate: (d: DivisionSettings) => void) {
  emit('change', (doc) => {
    const division = doc.settings.divisions.find((x) => x.id === id)
    if (division) mutate(division)
  })
}

const laneFrom = (d: DivisionSettings, i: number) =>
  1 + d.elims.lanes.slice(0, i).reduce((n, l) => n + l.size, 0)
const laneName = (d: DivisionSettings, i: number) => {
  const label = d.elims.lanes[i]!.label
  if (label.kind === 'own') return label.name
  return label.kind === 'division' || i === 0 ? d.name : `${d.name}${'C'.repeat(i)}`
}

/** Move the line below a lane: the lane under it gives or takes the ranks */
function resize(d: DivisionSettings, i: number, by: number) {
  const lanes = d.elims.lanes
  if (i >= lanes.length - 1) return
  if (lanes[i]!.size + by < 1 || lanes[i + 1]!.size - by < 1) {
    message.value = "There isn't room for that."
    return
  }
  message.value = ''
  edit(d.id, (x) => {
    x.elims.lanes[i]!.size += by
    x.elims.lanes[i + 1]!.size -= by
  })
}

function setLane(d: DivisionSettings, i: number, patch: Partial<LaneSettings>) {
  edit(d.id, (x) => Object.assign(x.elims.lanes[i]!, patch))
}

function setFormat(d: DivisionSettings, i: number, format: LaneSettings['format']) {
  setLane(
    d,
    i,
    format === 'roundRobin' ? { format, perTeam: 2, finals: false } : { format, finals: true },
  )
}

/** Split the last lane in two, the new lane a round robin with no line intermediate */
function split(d: DivisionSettings) {
  const last = d.elims.lanes[d.elims.lanes.length - 1]!
  if (last.size < 2) return
  edit(d.id, (x) => {
    const lower = Math.floor(last.size / 2)
    x.elims.lanes[x.elims.lanes.length - 1]!.size = last.size - lower
    x.elims.lanes.push({
      size: lower,
      format: 'roundRobin',
      perTeam: 2,
      finals: false,
      label: { kind: 'suffix' },
      lettering: 'continue',
    })
    x.elims.lines.push({})
  })
}

/** Merge a lane into the one above, dropping the line between */
function merge(d: DivisionSettings, i: number) {
  edit(d.id, (x) => {
    x.elims.lanes[i - 1]!.size += x.elims.lanes[i]!.size
    x.elims.lanes.splice(i, 1)
    x.elims.lines.splice(i - 1, 1)
  })
}

/** Set a line's intermediate, checking it fits inside the two lanes it settles */
function setIntermediate(d: DivisionSettings, line: number, quizzes: number) {
  if (quizzes === 0) return edit(d.id, (x) => (x.elims.lines[line] = {}))
  const above = defaultAbove(quizzes)
  if (!fits(d, line, quizzes, above)) {
    message.value = `That needs ${above} teams above the line and ${3 * quizzes - above} below. Make those lanes bigger first.`
    return
  }
  message.value = ''
  edit(d.id, (x) => (x.elims.lines[line] = { intermediate: { quizzes, kind: 'rerank', above } }))
}

function fits(d: DivisionSettings, line: number, quizzes: number, above: number) {
  return (
    above >= 1 &&
    above < 3 * quizzes &&
    d.elims.lanes[line]!.size >= above &&
    d.elims.lanes[line + 1]!.size >= 3 * quizzes - above
  )
}

/** Slide an intermediate's window up or down the ranks, keeping a rank on each side */
function slide(d: DivisionSettings, line: number, by: number) {
  const inter = d.elims.lines[line]?.intermediate
  if (!inter || !fits(d, line, inter.quizzes, inter.above + by)) return
  edit(d.id, (x) => (x.elims.lines[line]!.intermediate!.above += by))
}

const NAMES = ['None', 'X · 3 teams', 'XY · 6 teams', 'XYZ · 9 teams', 'WXYZ · 12 teams']
const bracketsFor = (size: number) =>
  size === 9 ? ['9', '9b', 'ruleA', 'ruleB', 'ruleC'] : [String(size)]
const BRACKET_NAMES: Record<string, string> = {
  '9': 'Snake order',
  '9b': 'Bracket B order',
  ruleA: 'Rule book A',
  ruleB: 'Rule book B',
  ruleC: 'Rule book C',
}
const unapplied = (id: string) => props.unapplied.some((u) => u.key === `${id}.elims`)
</script>

<template>
  <div class="elim-section">
    <p v-if="message" class="message" role="status">{{ message }}</p>
    <div
      v-for="d in doc.settings.divisions.filter((x) => x.teams > 0)"
      :key="d.id"
      class="division"
      :data-elims="d.id"
    >
      <h4>
        {{ d.name }} <span class="hint">{{ d.teams }} teams, by prelim rank</span>
        <span v-if="unapplied(d.id)" class="unapplied">Unapplied</span>
      </h4>
      <template v-for="(l, i) in d.elims.lanes" :key="i">
        <div class="lane" :data-lane="i">
          <div class="lane-head">
            <strong
              >{{ laneFrom(d, i) }}–{{ laneFrom(d, i) + l.size - 1 }} → {{ laneName(d, i) }}</strong
            >
            <span v-if="i < d.elims.lanes.length - 1" class="stepper">
              <button
                type="button"
                :aria-label="`${laneName(d, i)} fewer teams`"
                @click="resize(d, i, -1)"
              >
                −
              </button>
              {{ l.size }}
              <button
                type="button"
                :aria-label="`${laneName(d, i)} more teams`"
                @click="resize(d, i, 1)"
              >
                +
              </button>
            </span>
            <button v-if="i > 0" type="button" class="link" @click="merge(d, i)">Merge up</button>
          </div>
          <div class="lane-controls">
            <label>
              <select
                :value="l.format"
                :aria-label="`${laneName(d, i)} format`"
                @change="
                  setFormat(
                    d,
                    i,
                    ($event.target as HTMLSelectElement).value as LaneSettings['format'],
                  )
                "
              >
                <option value="bracket">Bracket</option>
                <option value="roundRobin">Round robin</option>
              </select>
            </label>
            <label v-if="l.format === 'bracket' && l.size === 9">
              <select
                :value="l.bracket ?? '9'"
                :aria-label="`${laneName(d, i)} bracket`"
                @change="setLane(d, i, { bracket: ($event.target as HTMLSelectElement).value })"
              >
                <option v-for="b in bracketsFor(l.size)" :key="b" :value="b">
                  {{ BRACKET_NAMES[b] ?? b }}
                </option>
              </select>
            </label>
            <label v-if="l.format === 'roundRobin'">
              Each plays
              <select
                :value="String(l.perTeam ?? 2)"
                :aria-label="`${laneName(d, i)} quizzes each`"
                @change="
                  setLane(d, i, { perTeam: Number(($event.target as HTMLSelectElement).value) })
                "
              >
                <option v-for="n in [1, 2, 3]" :key="n" :value="String(n)">{{ n }}</option>
              </select>
            </label>
            <label
              class="check"
              :title="
                l.format === 'roundRobin'
                  ? 'Add a Finals: the top 3 in points across the round robin'
                  : 'Call the deciding quiz Finals; off, it is named as the lane’s next letter'
              "
            >
              <input
                type="checkbox"
                :checked="l.finals"
                :aria-label="`${laneName(d, i)} Finals`"
                @change="setLane(d, i, { finals: ($event.target as HTMLInputElement).checked })"
              />
              Finals
            </label>
            <label v-if="i > 0">
              <select
                :value="l.lettering"
                :aria-label="`${laneName(d, i)} lettering`"
                @change="
                  setLane(d, i, {
                    lettering: ($event.target as HTMLSelectElement).value as 'continue' | 'restart',
                  })
                "
              >
                <option value="continue">Letters continue</option>
                <option value="restart">Letters restart at A</option>
              </select>
            </label>
          </div>
        </div>
        <div v-if="i < d.elims.lines.length" class="line" :data-line="i">
          <select
            :value="String(d.elims.lines[i]!.intermediate?.quizzes ?? 0)"
            :aria-label="`Intermediate after ${laneName(d, i)}`"
            @change="setIntermediate(d, i, Number(($event.target as HTMLSelectElement).value))"
          >
            <option v-for="(n, q) in NAMES" :key="q" :value="String(q)">{{ n }}</option>
          </select>
          <template v-if="d.elims.lines[i]!.intermediate">
            <select
              :value="d.elims.lines[i]!.intermediate!.kind"
              :aria-label="`Intermediate after ${laneName(d, i)} kind`"
              @change="
                edit(
                  d.id,
                  (x) =>
                    (x.elims.lines[i]!.intermediate!.kind = ($event.target as HTMLSelectElement)
                      .value as 'rerank' | 'playIn'),
                )
              "
            >
              <option value="rerank">Rerank</option>
              <option value="playIn">Play-in</option>
            </select>
            <span class="slide">
              {{ d.elims.lines[i]!.intermediate!.above }} above
              <button type="button" aria-label="Slide the intermediate up" @click="slide(d, i, 1)">
                ▲
              </button>
              <button
                type="button"
                aria-label="Slide the intermediate down"
                @click="slide(d, i, -1)"
              >
                ▼
              </button>
            </span>
          </template>
        </div>
      </template>
      <button type="button" class="link" @click="split(d)">
        Split {{ laneName(d, d.elims.lanes.length - 1) }} into two lanes
      </button>
    </div>
  </div>
</template>

<style scoped>
.elim-section {
  display: grid;
  gap: 0.75rem;
}

h4 {
  margin: 0;
}

.hint {
  font-weight: normal;
  font-size: 0.8rem;
  color: var(--color-text-muted, #666);
}

.lane {
  border: 1px solid var(--color-border, #ddd);
  border-radius: 8px;
  padding: 0.5rem;
  display: grid;
  gap: 0.25rem;
}

.lane-head,
.lane-controls,
.line {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}

.line {
  padding: 0.25rem 0.5rem;
  background: var(--color-bg-warm, #faf7f2);
}

.link,
.stepper button,
.slide button {
  font: inherit;
  background: none;
  border: none;
  cursor: pointer;
}

.link {
  color: var(--color-accent, #36c);
}

.field {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.field input {
  width: 5rem;
}

.info {
  font: inherit;
  font-size: 0.75rem;
  border-radius: 50%;
  border: 1px solid currentColor;
  background: none;
}

.message,
.unapplied {
  margin: 0;
  font-size: 0.8rem;
  color: var(--color-warn, #a60);
}

.info-box {
  font-size: 0.85rem;
  margin: 0;
}
</style>
