<script setup lang="ts">
import { divisionColourVar } from '@qzr/ui'
import { computed, ref, shallowRef, watch } from 'vue'
import {
  cellMoves,
  clearDraw,
  drawDivision,
  lateCounts,
  setTeamCount,
  sortPrelims,
  type ScheduleDocument,
} from '@qzr/shared'

/**
 * Late teams, absent teams, the draw and Sort, together in Prelim settings (FR-040 to FR-042b).
 * Late teams are hidden behind a row that says who is marked.
 */
const props = defineProps<{ doc: ScheduleDocument }>()
// Draws, marks and Sort are edits; only lowering a team count is a settings change
const emit = defineEmits<{
  edit: [mutate: (d: ScheduleDocument) => void]
  change: [mutate: (d: ScheduleDocument) => void]
}>()

const divisions = computed(() => props.doc.settings.divisions.filter((d) => d.teams > 0))
const teamsOf = (id: string, count: number) =>
  Array.from({ length: count }, (_, i) => ({
    i,
    ...(props.doc.draw[id]?.teams[i] ?? { late: false, absent: false }),
  }))
const nameOf = (t: { name?: string; i: number }) => t.name ?? `Team ${t.i + 1}`
/** Each division's colour, as its quizzes carry it on the grid */
const colourOf = (id: string) => divisionColourVar(props.doc, id)
const lateOn = computed(() => lateCounts(props.doc.settings))
const drawn = (id: string) => props.doc.draw[id]?.teams.some((t) => t.letter) ?? false

const showLate = ref(false)
const marked = computed(() =>
  divisions.value.flatMap((d) =>
    teamsOf(d.id, d.teams)
      .filter((t) => t.late)
      .map(nameOf),
  ),
)

function mark(id: string, i: number, key: 'late' | 'absent', on: boolean) {
  emit('edit', (d) => {
    const draw = (d.draw[id] ??= { teams: [], stale: false })
    while (draw.teams.length <= i) draw.teams.push({ late: false, absent: false })
    draw.teams[i]![key] = on
  })
}

function draw(ids: string[]) {
  emit('edit', (d) => {
    for (const id of ids) d.draw[id] = drawDivision(d, id)
  })
}

function clear(ids: string[]) {
  emit('edit', (d) => {
    for (const id of ids) if (d.draw[id]) d.draw[id] = clearDraw(d.draw[id])
  })
}

/** A team that drops out: the admin chooses, every time (FR-042b) */
const droppingOut = ref<{ id: string; i: number } | null>(null)
function lowerCount() {
  const drop = droppingOut.value
  if (!drop) return
  emit('change', (d) => {
    const division = d.settings.divisions.find((x) => x.id === drop.id)
    if (!division) return
    d.draw[drop.id]?.teams.splice(drop.i, 1)
    setTeamCount(d, drop.id, division.teams - 1)
  })
  droppingOut.value = null
}
function markAbsent() {
  const drop = droppingOut.value
  if (drop) mark(drop.id, drop.i, 'absent', true)
  droppingOut.value = null
}

// Sort: always explicit, saying how many quizzes will move first (FR-042a)
const sorting = ref<string[] | null>(null)
const acrossRooms = ref(false)
const includePinned = ref(false)
// The preview is of the schedule as it was when the choice opened, so editing meanwhile doesn't
// re-sort; confirming sorts what the schedule is then
const shown = shallowRef(props.doc)
watch(sorting, () => (shown.value = props.doc))
const sortOptions = () => ({
  divisions: sorting.value ?? [],
  acrossRooms: acrossRooms.value,
  includePinned: includePinned.value,
})
const sorted = computed(() => (sorting.value ? sortPrelims(shown.value, sortOptions()) : null))
const moves = computed(() => {
  const after = sorted.value
  return after ? cellMoves(shown.value, after) : 0
})
const pinnedCount = computed(
  () =>
    props.doc.quizzes.filter(
      (q) => q.phase === 'prelim' && q.pinned && (sorting.value ?? []).includes(q.division),
    ).length,
)
function confirmSort() {
  const options = sortOptions()
  emit('edit', (d) => Object.assign(d, { quizzes: sortPrelims(d, options).quizzes }))
  sorting.value = null
}
</script>

<template>
  <div class="draw-controls">
    <section class="card">
      <button
        type="button"
        class="disclose"
        :aria-expanded="showLate"
        @click="showLate = !showLate"
      >
        <span class="card-title">Late teams</span>
        <span class="sum">{{
          !lateOn
            ? 'Off'
            : marked.length === 0
              ? 'None'
              : marked.length > 2
                ? `${marked.length} teams`
                : marked.join(', ')
        }}</span>
      </button>
      <!-- Whether lateness counts at all: off, late marks change nothing (FR-042a) -->
      <label class="switch-row">
        Late teams play late
        <input
          type="checkbox"
          role="switch"
          :checked="lateOn"
          aria-label="Late teams play late"
          @change="
            emit(
              'change',
              (d) => (d.settings.lateTeams = ($event.target as HTMLInputElement).checked),
            )
          "
        />
      </label>
      <template v-if="showLate">
        <p v-if="lateOn" class="hint">
          Mark teams expected to arrive late. The draw gives them letters that play late, and the
          grid keeps their quizzes late.
        </p>
        <div v-for="d in divisions" :key="d.id" class="teams" :style="{ '--qc': colourOf(d.id) }">
          <strong><span class="tick" />{{ d.name }}</strong>
          <div v-for="t in teamsOf(d.id, d.teams)" :key="t.i" class="team">
            <label>
              <input
                v-if="lateOn"
                type="checkbox"
                :checked="t.late"
                :aria-label="`${d.name} ${nameOf(t)} late`"
                @change="mark(d.id, t.i, 'late', ($event.target as HTMLInputElement).checked)"
              />
              {{ t.letter ? `${t.letter} · ` : '' }}{{ nameOf(t) }}
            </label>
            <span v-if="t.absent" class="absent">Absent</span>
            <button
              v-if="t.absent"
              type="button"
              class="link"
              @click="mark(d.id, t.i, 'absent', false)"
            >
              Back
            </button>
            <button
              v-else
              type="button"
              class="link"
              :aria-label="`${d.name} ${nameOf(t)} dropped out`"
              @click="droppingOut = { id: d.id, i: t.i }"
            >
              Dropped out
            </button>
          </div>
        </div>
      </template>
      <div v-if="droppingOut" class="choice" role="group" aria-label="A team dropped out">
        <p>
          Lower the division's team count (its prelims are rebuilt and the draw redone), or mark the
          team absent (nothing moves; its quizzes run with two teams)?
        </p>
        <button type="button" @click="lowerCount">Lower the count</button>
        <button type="button" @click="markAbsent">Mark absent</button>
        <button type="button" @click="droppingOut = null">Cancel</button>
      </div>
    </section>

    <section class="card">
      <h4 class="card-title">Draw</h4>
      <p class="hint">Decides which team is which letter. It never moves a quiz.</p>
      <ul class="rows">
        <li
          v-for="d in divisions"
          :key="d.id"
          class="draw-row"
          :data-draw="d.id"
          :style="{ '--qc': colourOf(d.id) }"
        >
          <span class="tick" />
          <strong>{{ d.name }}</strong>
          <span class="state" :class="{ stale: doc.draw[d.id]?.stale, done: drawn(d.id) }">{{
            doc.draw[d.id]?.stale ? 'Draw again' : drawn(d.id) ? 'Drawn' : 'Not drawn'
          }}</span>
          <span class="acts">
            <button type="button" @click="draw([d.id])">
              {{ drawn(d.id) ? 'Redraw' : 'Draw' }}
            </button>
            <button v-if="drawn(d.id)" type="button" @click="clear([d.id])">Clear</button>
          </span>
        </li>
      </ul>
      <div class="all">
        <button type="button" @click="draw(divisions.map((d) => d.id))">
          {{ divisions.some((d) => drawn(d.id)) ? 'Redraw all' : 'Draw all' }}
        </button>
        <button
          v-if="divisions.some((d) => drawn(d.id))"
          type="button"
          @click="clear(divisions.map((d) => d.id))"
        >
          Clear all
        </button>
      </div>
    </section>

    <section class="card">
      <h4 class="card-title">Sort prelims</h4>
      <p class="hint">
        Puts prelims back in quiz order, as after moving them by hand{{
          lateOn ? ', with late teams playing late' : ''
        }}.
      </p>
      <div class="all">
        <button type="button" @click="sorting = divisions.map((d) => d.id)">
          Sort all prelims
        </button>
        <button
          v-for="d in divisions"
          :key="d.id"
          type="button"
          :style="{ '--qc': colourOf(d.id) }"
          @click="sorting = [d.id]"
        >
          <span class="tick" />{{ d.name }}
        </button>
      </div>
      <div v-if="sorting" class="choice" role="group" aria-label="Sort prelims">
        <label
          ><input v-model="acrossRooms" type="checkbox" aria-label="Sort across rooms" /> Sort
          across rooms</label
        >
        <label v-if="pinnedCount > 0">
          <input v-model="includePinned" type="checkbox" /> Also sort the {{ pinnedCount }} pinned
          (unpins them)
        </label>
        <p class="moves">{{ moves }} {{ moves === 1 ? 'quiz' : 'quizzes' }} will move.</p>
        <button type="button" @click="confirmSort">Sort</button>
        <button type="button" @click="sorting = null">Cancel</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.draw-controls {
  display: grid;
  gap: 0.6rem;
}

/* Late teams' heading opens the list; its summary says who is marked */
.draw-controls .disclose {
  justify-content: space-between;
  padding: 0;
  border: 0;
  background: none;
}

.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.sum {
  color: var(--color-text-muted);
  font-weight: 500;
}

.rows {
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
}

.draw-row {
  display: flex;
  align-items: center;
  padding: 0.25rem 0;
  border-top: 1px dashed var(--color-border-alt);
}

.draw-row:first-child {
  border-top: 0;
}

.draw-row strong,
.teams strong {
  color: var(--color-heading);
}

.state {
  margin-left: 0.4rem;
  color: var(--color-text-faint);
  font-size: 0.75rem;
}

.state.done {
  color: var(--color-text-muted);
}

.state.stale {
  color: var(--color-warn);
  font-weight: 600;
}

.acts {
  display: inline-flex;
  gap: 0.25rem;
  margin-left: auto;
}

.team {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.3rem 0.5rem;
}

.teams {
  display: grid;
  gap: 0.15rem;
}

.hint,
.moves {
  margin: 0;
  font-size: 0.8rem;
  color: var(--color-text-muted);
}

.absent {
  font-size: 0.75rem;
  color: var(--color-warn);
}
</style>
