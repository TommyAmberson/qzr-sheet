<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import {
  ApiError,
  MOMENTS,
  PlacementFormula,
  STAGES,
  viewerHas,
  type ShownFrom,
  type StatsSettings,
} from '@qzr/shared'

import { formatWhen } from '@qzr/ui'

import DivisionSteps from './DivisionSteps.vue'
import { useMeetPage } from '../meetPage'
import {
  getStatsSettings,
  saveStatsSettings,
  setQuizzesToMeetFormula,
  type DivisionState,
  type StatsSettingsRead,
} from '../api'
import {
  MOMENT_WORDS,
  THING_NAMES,
  momentsFor,
  rightNow,
  viewerChanges,
  type ViewerThing,
} from '../stats'

/**
 * A meet's stats settings, in one place (FR-023c): each division's steps through the day, what
 * viewers see and from when, and how the meet scores and ranks
 */
const { slug, meet, reloadMeet, beat, refresh } = useMeetPage()
const route = useRoute()

const divisions = ref<DivisionState[]>([])
const saved = ref<StatsSettings | null>(null)
const draft = ref<StatsSettings | null>(null)
const changed = ref<{ by: string; at: string } | undefined>()
/** Stored quizzes whose own way of scoring level teams isn't the meet's */
const otherFormula = ref(0)
const loading = ref(true)
const busy = ref(false)
const error = ref('')

const phase = computed(() => meet.value?.phase ?? 'registration')
const done = computed(() => phase.value === 'done')
const dirty = computed(() => JSON.stringify(saved.value) !== JSON.stringify(draft.value))
/** Quizzes are set to the saved way of scoring level teams, so not while another is chosen */
const levelTeamsUnsaved = computed(() => saved.value?.levelTeams !== draft.value?.levelTeams)
const changes = computed(() =>
  saved.value && draft.value
    ? viewerChanges(saved.value, draft.value, divisions.value, phase.value)
    : [],
)

async function load() {
  const id = meet.value?.id
  if (id === undefined) return
  loading.value = true
  error.value = ''
  try {
    // The division states come from the steps below, which read them
    took(await getStatsSettings(id))
  } catch (e) {
    error.value =
      e instanceof ApiError && e.status === 403
        ? "Only the meet's admins can change its stats settings."
        : (e as Error).message
  } finally {
    loading.value = false
    // Asked for by address, the stats section is scrolled to once it is there
    if (route.hash === '#stats') {
      void nextTick(() => document.getElementById('stats')?.scrollIntoView({ block: 'start' }))
    }
  }
}

watch(() => meet.value?.id, load, { immediate: true })

/** Take the settings as the API answers them */
function took(read: StatsSettingsRead) {
  saved.value = read.settings
  draft.value = structuredClone(read.settings)
  changed.value = read.changed
  otherFormula.value = read.otherFormula ?? 0
}

/** Run an action, keeping its error in the page */
async function run(action: () => Promise<void>) {
  busy.value = true
  error.value = ''
  try {
    await action()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}

function save() {
  if (!meet.value || !draft.value) return
  const [meetId, settings] = [meet.value.id, draft.value]
  void run(async () => {
    took(await saveStatsSettings(meetId, settings))
  })
}

function discard() {
  if (saved.value) draft.value = structuredClone(saved.value)
}

function setToMatch() {
  if (!meet.value) return
  const meetId = meet.value.id
  void run(async () => {
    await setQuizzesToMeetFormula(meetId)
    otherFormula.value = (await getStatsSettings(meetId)).otherFormula ?? 0
  })
}

/** What each division's viewers have of a thing right now, by the saved settings */
function nowFor(thing: ViewerThing): { division: string; has: string }[] {
  if (!saved.value) return []
  const settings = saved.value
  return divisions.value.map((d) => ({
    division: d.division,
    has: rightNow(viewerHas(settings, d.state, phase.value), thing),
  }))
}

/** How quizzer standings update means something only before the eliminations are in */
const updateMatters = computed(() => {
  const from = draft.value?.quizzers.from
  return (
    from !== undefined &&
    from !== 'never' &&
    MOMENTS.indexOf(from) < MOMENTS.indexOf('eliminationsIn')
  )
})

const QUIZZER_MOMENTS: ShownFrom[] = [...MOMENTS, 'never']

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)
</script>

<template>
  <div class="stats-settings">
    <p v-if="loading" class="state-msg">Loading…</p>
    <p v-else-if="error && !meet" class="state-msg state-msg--error">{{ error }}</p>

    <template v-else-if="meet && draft">
      <h3 class="section-title">Stats</h3>
      <p v-if="error" class="state-msg state-msg--error">{{ error }}</p>
      <p v-if="done" class="locked">
        <strong>The meet is done.</strong> Settings are locked; reopen it for review to change them.
      </p>

      <!-- Each division's steps through the day (FR-019a) -->
      <section class="block">
        <h3 class="section-title">Divisions</h3>
        <DivisionSteps
          :meet-id="meet.id"
          :slug="slug"
          :phase="phase"
          :beat="beat"
          @read="divisions = $event"
          @moved="refresh('catchUp')"
          @phase="reloadMeet"
        />
      </section>

      <!-- What viewers see, and from when (FR-018) -->
      <section class="block">
        <h3 class="section-title">What viewers see</h3>
        <p class="hint">Coaches and officials see what viewers see. Admins see everything.</p>
        <div class="lines">
          <div v-for="stage in STAGES" :key="stage" class="line">
            <div class="line-say">
              <span class="thing">{{ capitalized(THING_NAMES[stage]) }}</span>
              show
              <select
                v-model="draft.results[stage].from"
                :disabled="done"
                :aria-label="`${THING_NAMES[stage]}: when`"
              >
                <option v-for="moment in momentsFor(stage)" :key="moment" :value="moment">
                  {{ MOMENT_WORDS[moment] }}
                </option>
              </select>
              <select
                v-if="draft.results[stage].from !== 'never'"
                v-model="draft.results[stage].level"
                :disabled="done"
                :aria-label="`${THING_NAMES[stage]}: how much`"
              >
                <option value="places">places only</option>
                <option value="scores">places and scores</option>
              </select>
            </div>
            <div class="now">
              <span v-for="now in nowFor(stage)" :key="now.division" class="chip">
                {{ now.division }}: {{ now.has }}
              </span>
            </div>
          </div>

          <div class="line">
            <div class="line-say">
              <span class="thing">Prelim standings and the re-rank</span>
              shown, locked in, once you confirm them: they are what seeds the next quizzes.
              <label class="check">
                <input v-model="draft.prelimStandingsLive" type="checkbox" :disabled="done" />
                Live preview: also show them before that, changing as quizzes come in
              </label>
            </div>
            <div class="now">
              <span v-for="now in nowFor('prelimStandings')" :key="now.division" class="chip">
                {{ now.division }}: {{ now.has }}
              </span>
            </div>
          </div>

          <div class="line">
            <div class="line-say">
              <span class="thing">Quizzer standings</span>
              show
              <select
                v-model="draft.quizzers.from"
                :disabled="done"
                aria-label="Quizzer standings: when"
              >
                <option v-for="moment in QUIZZER_MOMENTS" :key="moment" :value="moment">
                  {{ MOMENT_WORDS[moment] }}
                </option>
              </select>
              <template v-if="updateMatters">
                , updated
                <select
                  v-model="draft.quizzers.update"
                  :disabled="done"
                  aria-label="Quizzer standings: how they update"
                >
                  <option value="live">after every quiz</option>
                  <option value="byStage">only when you confirm a step</option>
                </select>
              </template>
            </div>
            <div class="now">
              <span v-for="now in nowFor('quizzers')" :key="now.division" class="chip">
                {{ now.division }}: {{ now.has }}
              </span>
            </div>
          </div>
        </div>
      </section>

      <!-- How the meet scores and ranks (FR-023, FR-023a, FR-023d) -->
      <section class="block">
        <h3 class="section-title">Scoring</h3>
        <fieldset class="choice" :disabled="done">
          <legend>Ties between teams</legend>
          <label>
            <input v-model="draft.tieBreaks" type="radio" value="rulebook" />
            Head-to-head, then total points, then fewest errors <span class="note">rulebook</span>
          </label>
          <label>
            <input v-model="draft.tieBreaks" type="radio" value="pointsThenErrors" />
            Total points, then fewest errors
          </label>
        </fieldset>
        <fieldset class="choice" :disabled="done">
          <legend>Teams level in a quiz</legend>
          <label>
            <input v-model="draft.levelTeams" type="radio" :value="PlacementFormula.Rules" />
            Each gets the points of the place they share <span class="note">rulebook</span>
          </label>
          <label>
            <input v-model="draft.levelTeams" type="radio" :value="PlacementFormula.Legacy" />
            Reduced points for a shared place
          </label>
        </fieldset>
        <fieldset class="choice" :disabled="done">
          <legend>Overtime</legend>
          <label>
            <input v-model="draft.prelimsWithoutOvertime" type="checkbox" />
            Prelims and intermediates are played without overtime: a tie stands, and overtime played
            in one is an error
          </label>
        </fieldset>
        <p v-if="otherFormula > 0" class="other-formula">
          {{ otherFormula }} {{ otherFormula === 1 ? 'quiz was' : 'quizzes were' }} scored the other
          way on their device, so their scoresheets show other placement points than the tables.
          <button
            class="btn btn--secondary btn--sm"
            :disabled="busy || done || levelTeamsUnsaved"
            :title="levelTeamsUnsaved ? 'Save the way level teams are scored first' : undefined"
            @click="setToMatch"
          >
            Set them to match
          </button>
        </p>
      </section>

      <!-- Saved, not instant: what viewers will newly see and stop seeing (FR-023c) -->
      <div class="save-bar">
        <template v-if="dirty">
          <div v-if="changes.length" class="changes">
            <strong>On save, straight away:</strong>
            <ul>
              <li v-for="line in changes" :key="line">{{ line }}</li>
            </ul>
          </div>
          <p v-else class="note">
            Unsaved changes. Nothing changes for viewers right now; it will at a later step.
          </p>
        </template>
        <p v-else-if="changed" class="note">
          Saved. Last changed by {{ changed.by }}, {{ formatWhen(changed.at) }}.
        </p>
        <div class="actions">
          <button class="btn btn--secondary btn--sm" :disabled="!dirty || busy" @click="discard">
            Discard
          </button>
          <button class="btn btn--primary btn--sm" :disabled="!dirty || busy || done" @click="save">
            Save
          </button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.state-msg,
.hint {
  font-size: 0.85rem;
  color: var(--color-text-faint);
}

.state-msg--error {
  color: var(--palette-error);
}

.locked {
  font-size: 0.85rem;
  margin-bottom: 1rem;
}

.block {
  margin-bottom: 2rem;
}

.section-title {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--color-heading);
  margin-bottom: 0.6rem;
}

.note {
  font-size: 0.8rem;
  color: var(--color-text-muted);
  margin: 0.2rem 0;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.lines {
  display: grid;
  gap: 0.75rem;
}

.line {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
  gap: 0.75rem;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--color-border);
  font-size: 0.85rem;
}

@media (max-width: 40rem) {
  .line {
    grid-template-columns: minmax(0, 1fr);
  }
}

.thing {
  font-weight: 600;
  margin-right: 0.25rem;
}

.check {
  display: block;
  margin-top: 0.35rem;
}

.now {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  align-content: flex-start;
}

.chip {
  padding: 0.05rem 0.45rem;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  font-size: 0.72rem;
  color: var(--color-text-muted);
}

.choice {
  border: none;
  padding: 0;
  margin: 0 0 0.9rem;
  font-size: 0.85rem;
}

.choice legend {
  font-weight: 600;
  margin-bottom: 0.25rem;
}

.choice label {
  display: block;
  margin: 0.2rem 0;
}

.other-formula {
  font-size: 0.85rem;
}

.save-bar {
  position: sticky;
  bottom: 0;
  padding: 0.75rem 0;
  background: var(--color-bg);
  border-top: 1px solid var(--color-border);
  font-size: 0.85rem;
}

.changes ul {
  margin: 0.3rem 0 0;
  padding-left: 1.1rem;
}

.btn {
  display: inline-flex;
  align-items: center;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
  font-family: inherit;
  white-space: nowrap;
  transition:
    background 0.15s,
    color 0.15s,
    border-color 0.15s;
}

.btn--sm {
  padding: 0.25rem 0.6rem;
  font-size: 0.75rem;
}

.btn--primary {
  background: var(--color-accent);
  color: var(--color-bg);
  border-color: var(--color-accent);
}

.btn--primary:hover:not(:disabled) {
  background: var(--color-accent-hover);
  border-color: var(--color-accent-hover);
}

.btn--secondary {
  background: transparent;
  color: var(--color-text-muted);
  border-color: var(--color-border);
}

.btn--secondary:hover:not(:disabled) {
  border-color: var(--color-text-muted);
  color: var(--color-text);
}

.btn:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
