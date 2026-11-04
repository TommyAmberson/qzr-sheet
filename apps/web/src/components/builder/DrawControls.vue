<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  clearDraw,
  drawDivision,
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
const colourOf = (id: string) =>
  `var(--b-d${(props.doc.settings.divisions.findIndex((d) => d.id === id) % 4) + 1})`
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
const sorted = computed(() =>
  sorting.value
    ? sortPrelims(props.doc, {
        divisions: sorting.value,
        acrossRooms: acrossRooms.value,
        includePinned: includePinned.value,
      })
    : null,
)
const moves = computed(() => {
  const after = sorted.value
  if (!after) return 0
  const before = new Map(props.doc.quizzes.map((q) => [q.id, JSON.stringify(q.cell)]))
  return after.quizzes.filter((q) => before.get(q.id) !== JSON.stringify(q.cell)).length
})
const pinnedCount = computed(
  () =>
    props.doc.quizzes.filter(
      (q) => q.phase === 'prelim' && q.pinned && (sorting.value ?? []).includes(q.division),
    ).length,
)
function confirmSort() {
  const after = sorted.value
  if (after) emit('edit', (d) => Object.assign(d, { quizzes: after.quizzes }))
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
          marked.length === 0
            ? 'None'
            : marked.length > 2
              ? `${marked.length} teams`
              : marked.join(', ')
        }}</span>
      </button>
      <template v-if="showLate">
        <p class="hint">
          Mark teams expected to arrive late. The draw gives them letters that play late, so nothing
          moves. If you learn after the draw, Sort moves their quizzes instead.
        </p>
        <div v-for="d in divisions" :key="d.id" class="teams" :style="{ '--qc': colourOf(d.id) }">
          <strong><span class="tick" />{{ d.name }}</strong>
          <div v-for="t in teamsOf(d.id, d.teams)" :key="t.i" class="team">
            <label>
              <input
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
      <p class="hint">Moves prelims so late teams play late.</p>
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

.card-title {
  margin: 0;
}

/* Late teams' heading opens the list; its summary says who is marked */
.draw-controls .disclose {
  justify-content: space-between;
  padding: 0;
  border: 0;
  background: none;
}

.sum {
  color: var(--color-text-muted);
  font-weight: 500;
}

.tick {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: 0.35rem;
  border-radius: 50%;
  background: var(--qc);
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

.all,
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

.choice {
  display: grid;
  gap: 0.35rem;
  justify-items: start;
  padding: 0.5rem;
  border: 1px solid var(--color-meta-accent);
  border-radius: 6px;
}

.absent {
  font-size: 0.75rem;
  color: var(--color-warn);
}
</style>
