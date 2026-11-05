<script setup lang="ts">
import { divisionColourVar } from '@qzr/ui'
import { computed, ref, shallowRef, watch } from 'vue'
import {
  laneName,
  lineRanges,
  cellMoves,
  isGeneratedElim,
  replaceElims,
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
const emit = defineEmits<{
  change: [mutate: (d: ScheduleDocument) => void]
  /** A hand edit, applied at once like one on the grid: re-placing elims */
  edit: [mutate: (d: ScheduleDocument) => void]
}>()

const message = ref('')

// Re-placing elims: always explicit, saying first how many quizzes will move (FR-034a)
const replacing = ref<string[] | null>(null)
const includePinned = ref(false)
const withElims = computed(() =>
  props.doc.settings.divisions.filter((d) =>
    props.doc.quizzes.some((q) => q.division === d.id && q.phase === 'elim'),
  ),
)
// The preview is of the schedule as it was when the choice opened, so editing meanwhile doesn't
// re-run the generator; confirming re-places what the schedule is then
const shown = shallowRef(props.doc)
watch(replacing, () => (shown.value = props.doc))
const replaceOptions = () => ({
  divisions: replacing.value ?? [],
  includePinned: includePinned.value,
})
const replaced = computed(() =>
  replacing.value ? replaceElims(shown.value, replaceOptions()) : null,
)
const replaceMoves = computed(() => {
  const after = replaced.value
  return after ? cellMoves(shown.value, after) : 0
})
// The pinned elims a re-place would move: those the generator makes, not ones added by hand
const pinnedElims = computed(() => {
  const generated = isGeneratedElim(props.doc)
  return props.doc.quizzes.filter(
    (q) => generated(q) && q.pinned && (replacing.value ?? []).includes(q.division),
  ).length
})
function confirmReplace() {
  const options = replaceOptions()
  emit('edit', (d) => Object.assign(d, { quizzes: replaceElims(d, options).quizzes }))
  replacing.value = null
}

function edit(id: string, mutate: (d: DivisionSettings) => void) {
  emit('change', (doc) => {
    const division = doc.settings.divisions.find((x) => x.id === id)
    if (division) mutate(division)
  })
}

const laneFrom = (d: DivisionSettings, i: number) =>
  1 + d.elims.lanes.slice(0, i).reduce((n, l) => n + l.size, 0)

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

/** The 9-team brackets, named by their opening quizzes, and what sets each apart */
const NINE_BRACKETS: Record<string, { name: string; note: string }> = {
  '9': { name: 'Snake: 1-6-7, 2-5-8, 3-4-9', note: 'rule book B with snake seeds' },
  ruleA: { name: 'Rule book A: 1-2-3, 4-5-6, 7-8-9', note: 'winners move up' },
  ruleB: { name: 'Rule book B: 1-4-9, 2-5-7, 3-6-8', note: 'every team loses twice' },
  ruleC: {
    name: 'Rule book C: 1-4-9, winners next',
    note: 'winners meet next, others work back up',
  },
}
/** Which of them a lane plays; `9b` is an older name for rule book B, kept by saved schedules */
const nineBracket = (l: LaneSettings) => (l.bracket === '9b' ? 'ruleB' : (l.bracket ?? '9'))
const unapplied = (id: string) => props.unapplied.some((u) => u.key === `${id}.elims`)

/** Each division's colour, as the grid ticks its quizzes */
const colourOf = (d: DivisionSettings) => divisionColourVar(props.doc, d.id)
const range = (from: number, to: number) => (from === to ? `${from}` : `${from}–${to}`)
/** Who a lane takes, in words, reading down the ranks */
function takes(d: DivisionSettings, i: number) {
  const last = d.elims.lanes.length - 1
  const size = d.elims.lanes[i]!.size
  return last === 0
    ? 'Everyone'
    : i === 0
      ? `Top ${size}`
      : i === last
        ? 'The rest'
        : `Next ${size}`
}
/** The ranks an intermediate plays, around the line below lane `line` */
const interRange = (d: DivisionSettings, line: number) => lineRanges(d)[line] ?? null
const COUNT = ['', 'Three', 'Six', 'Nine', 'Twelve']
const SHORT = ['', 'X', 'XY', 'XYZ', 'WXYZ']
/** A lane's format and size, in words */
function laneNote(l: LaneSettings) {
  if (l.format === 'roundRobin') {
    const n = l.perTeam ?? 2
    return `${l.size} teams · round robin, ${n} ${n === 1 ? 'quiz' : 'quizzes'} each`
  }
  if (l.size === 9) return `${l.size} teams · bracket, ${NINE_BRACKETS[nineBracket(l)]?.note}`
  return `${l.size} teams · bracket`
}
</script>

<template>
  <div class="elim-section">
    <p v-if="message" class="message" role="status">{{ message }}</p>
    <div
      v-for="d in doc.settings.divisions.filter((x) => x.teams > 0)"
      :key="d.id"
      class="division"
      :data-elims="d.id"
      :style="{ '--qc': colourOf(d) }"
    >
      <div class="ehead">
        <span class="tick" />
        <strong>{{ d.name }}</strong>
        <span class="hint">{{ d.teams }} teams, by prelim rank</span>
        <span v-if="unapplied(d.id)" class="unapplied">Unapplied</span>
      </div>

      <!-- The lanes in proportion, top ranks first -->
      <div class="strip" aria-hidden="true">
        <span
          v-for="(l, i) in d.elims.lanes"
          :key="i"
          :class="`l${Math.min(i, 3)}`"
          :style="{ flex: l.size }"
        />
      </div>

      <!-- Reading down the ranks: who goes where, and what settles each line -->
      <div class="steps">
        <template v-for="(l, i) in d.elims.lanes" :key="i">
          <div class="step" :data-lane="i">
            <span class="rk">{{ range(laneFrom(d, i), laneFrom(d, i) + l.size - 1) }}</span>
            <span class="say">
              {{ takes(d, i) }} →
              <span class="chip" :class="`l${Math.min(i, 3)}`">{{ laneName(d, i) }}</span>
            </span>
            <span class="ctl">
              <span v-if="i < d.elims.lanes.length - 1" class="stepper">
                <button
                  type="button"
                  :aria-label="`${laneName(d, i)} fewer teams`"
                  @click="resize(d, i, -1)"
                >
                  −
                </button>
                <output>{{ l.size }}</output>
                <button
                  type="button"
                  :aria-label="`${laneName(d, i)} more teams`"
                  @click="resize(d, i, 1)"
                >
                  +
                </button>
              </span>
              <button
                v-if="i > 0"
                type="button"
                class="icon"
                :title="`Merge into ${laneName(d, i - 1)}`"
                :aria-label="`Merge ${laneName(d, i)} into the lane above`"
                @click="merge(d, i)"
              >
                ✕
              </button>
            </span>
          </div>

          <template v-if="i < d.elims.lines.length">
            <div v-if="d.elims.lines[i]!.intermediate" class="step inter" :data-line="i">
              <span class="rk">{{ range(interRange(d, i)!.from, interRange(d, i)!.to) }}</span>
              <span class="say">
                {{ COUNT[d.elims.lines[i]!.intermediate!.quizzes] }} around the line ({{
                  d.elims.lines[i]!.intermediate!.above
                }}
                above) play
                <span class="seg" role="group" :aria-label="`Intermediate after ${laneName(d, i)}`">
                  <button
                    v-for="q in [1, 2, 3, 4]"
                    :key="q"
                    type="button"
                    :aria-pressed="d.elims.lines[i]!.intermediate!.quizzes === q"
                    @click="setIntermediate(d, i, q)"
                  >
                    {{ SHORT[q] }}
                  </button>
                </span>
                to
                <span
                  class="seg"
                  role="group"
                  :aria-label="`Intermediate after ${laneName(d, i)} kind`"
                >
                  <button
                    type="button"
                    :aria-pressed="d.elims.lines[i]!.intermediate!.kind === 'rerank'"
                    title="Rerank the teams around the line"
                    @click="edit(d.id, (x) => (x.elims.lines[i]!.intermediate!.kind = 'rerank'))"
                  >
                    rerank
                  </button>
                  <button
                    type="button"
                    :aria-pressed="d.elims.lines[i]!.intermediate!.kind === 'playIn'"
                    title="The winners play in to the lane above"
                    @click="edit(d.id, (x) => (x.elims.lines[i]!.intermediate!.kind = 'playIn'))"
                  >
                    play in
                  </button>
                </span>
              </span>
              <span class="ctl">
                <span class="slide" title="Slide the intermediate across the line">
                  <button
                    type="button"
                    aria-label="Slide the intermediate up"
                    @click="slide(d, i, 1)"
                  >
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
                <button
                  type="button"
                  class="icon"
                  aria-label="Remove the intermediate"
                  title="No intermediate"
                  @click="setIntermediate(d, i, 0)"
                >
                  ✕
                </button>
              </span>
            </div>
            <div v-else class="step gap" :data-line="i">
              <button type="button" class="link" @click="setIntermediate(d, i, 2)">
                + Add an intermediate across this line
              </button>
            </div>
          </template>
        </template>
      </div>

      <button type="button" class="link split" @click="split(d)">
        + Split {{ laneName(d, d.elims.lanes.length - 1) }} into two lanes
      </button>

      <h4>Lanes</h4>
      <div v-for="(l, i) in d.elims.lanes" :key="i" class="lrow">
        <span class="chip" :class="`l${Math.min(i, 3)}`">{{ laneName(d, i) }}</span>
        <span class="hint">{{ laneNote(l) }}</span>
        <span class="lctl">
          <span class="seg" role="group" :aria-label="`${laneName(d, i)} format`">
            <button
              type="button"
              :aria-pressed="l.format === 'bracket'"
              @click="setFormat(d, i, 'bracket')"
            >
              Bracket
            </button>
            <button
              type="button"
              :aria-pressed="l.format === 'roundRobin'"
              @click="setFormat(d, i, 'roundRobin')"
            >
              Round robin
            </button>
          </span>
          <span v-if="l.format === 'roundRobin'" class="stepper" title="Quizzes each">
            <button
              type="button"
              :aria-label="`${laneName(d, i)} fewer quizzes each`"
              :disabled="(l.perTeam ?? 2) <= 1"
              @click="setLane(d, i, { perTeam: (l.perTeam ?? 2) - 1 })"
            >
              −
            </button>
            <output :aria-label="`${laneName(d, i)} quizzes each`">{{ l.perTeam ?? 2 }}</output>
            <button
              type="button"
              :aria-label="`${laneName(d, i)} more quizzes each`"
              :disabled="(l.perTeam ?? 2) >= 3"
              @click="setLane(d, i, { perTeam: (l.perTeam ?? 2) + 1 })"
            >
              +
            </button>
          </span>
          <select
            v-if="l.format === 'bracket' && l.size === 9"
            :value="nineBracket(l)"
            :aria-label="`${laneName(d, i)} bracket`"
            @change="setLane(d, i, { bracket: ($event.target as HTMLSelectElement).value })"
          >
            <option v-for="(b, key) in NINE_BRACKETS" :key="key" :value="key">
              {{ b.name }}
            </option>
          </select>
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
          <select
            v-if="i > 0"
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
        </span>
      </div>
    </div>

    <section v-if="withElims.length > 0" class="card">
      <h4 class="card-title">Re-place elims</h4>
      <p class="hint">Puts elims back where the generator would, around everything else.</p>
      <div class="all">
        <button type="button" @click="replacing = withElims.map((d) => d.id)">
          Re-place all elims
        </button>
        <button
          v-for="d in withElims"
          :key="d.id"
          type="button"
          :style="{ '--qc': colourOf(d) }"
          @click="replacing = [d.id]"
        >
          <span class="tick" />{{ d.name }}
        </button>
      </div>
      <div v-if="replacing" class="choice" role="group" aria-label="Re-place elims">
        <label v-if="pinnedElims > 0" class="check">
          <input v-model="includePinned" type="checkbox" />
          Also re-place the {{ pinnedElims }} pinned (unpins them)
        </label>
        <p class="hint">
          {{ replaceMoves }} {{ replaceMoves === 1 ? 'quiz' : 'quizzes' }} will move.
        </p>
        <span class="all">
          <button type="button" @click="confirmReplace">Re-place</button>
          <button type="button" @click="replacing = null">Cancel</button>
        </span>
      </div>
    </section>
  </div>
</template>

<style scoped>
.elim-section {
  display: grid;
  gap: 1rem;
}

.division {
  --qc: var(--dc-green);

  display: grid;
  gap: 0.6rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--color-border-alt);
}

.division:first-of-type {
  padding-top: 0;
  border-top: 0;
}

.ehead {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem 0.5rem;
}

.ehead strong {
  color: var(--color-heading);
}

.ehead .unapplied {
  margin-left: auto;
}

/* Lane shades: the main lane in the division's colour, each lane below paler */
.l0 {
  background: var(--qc);
  color: var(--color-bg);
}

.l1 {
  background: color-mix(in srgb, var(--qc) 55%, var(--color-bg));
  color: var(--color-heading);
}

.l2 {
  background: color-mix(in srgb, var(--qc) 32%, var(--color-bg));
  color: var(--color-heading);
}

.l3 {
  background: color-mix(in srgb, var(--qc) 16%, var(--color-bg));
  color: var(--color-heading);
}

.strip {
  display: flex;
  gap: 2px;
  height: 8px;
  overflow: hidden;
  border-radius: 4px;
}

.steps {
  display: grid;
  overflow: hidden;
  border: 1px solid var(--color-meta-accent);
  border-radius: 6px;
  background: var(--color-bg);
}

.step {
  display: grid;
  grid-template-columns: 2.6rem minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.5rem;
  padding: 0.45rem 0.5rem 0.45rem 0.6rem;
  border-top: 1px solid var(--color-border-alt);
  font-size: 0.8rem;
}

.step:first-child {
  border-top: 0;
}

.rk {
  color: var(--color-heading);
  font-variant-numeric: tabular-nums;
  font-weight: 650;
}

.say {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem 0.35rem;
  color: var(--color-text-muted);
}

.ctl {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

/* An intermediate settling a line: hatched, as the grid draws events */
.step.inter {
  background: repeating-linear-gradient(
    -45deg,
    transparent 0 6px,
    color-mix(in srgb, var(--qc) 10%, transparent) 6px 12px
  );
}

.step.gap {
  grid-template-columns: 1fr;
  justify-items: center;
  padding: 0.2rem;
  background: var(--color-meta-bg);
}

.chip {
  display: inline-flex;
  align-items: center;
  padding: 0.05rem 0.45rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 650;
  white-space: nowrap;
}

/* Segmented choices, as one control */
.stepper {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--color-meta-accent);
  border-radius: 5px;
}

.elim-section .stepper button,
.elim-section .slide button,
.elim-section button.icon {
  padding: 0 0.4rem;
  border: 0;
  background: none;
  font-size: 0.85rem;
}

.stepper output {
  min-width: 1.6rem;
  color: var(--color-heading);
  font-variant-numeric: tabular-nums;
  font-weight: 650;
  text-align: center;
}

.slide {
  display: inline-grid;
  line-height: 1;
}

.elim-section .slide button {
  font-size: 0.6rem;
}

.elim-section button.icon:hover:not(:disabled) {
  background: var(--color-danger-bg);
  color: var(--color-danger);
}

.split {
  justify-self: start;
}

h4 {
  margin-top: 0.25rem;
}

.lrow {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem 0.5rem;
  padding: 0.4rem 0;
  border-top: 1px dashed var(--color-border-alt);
}

.lrow .hint {
  flex: 1 1 8rem;
}

.lctl {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem 0.6rem;
  flex-basis: 100%;
}

.check {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  color: var(--color-text-muted);
  font-size: 0.8rem;
}
</style>
