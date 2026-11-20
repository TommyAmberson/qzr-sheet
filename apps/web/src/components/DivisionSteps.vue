<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  ApiError,
  DIVISION_STATES,
  divisionTitle,
  sameDivision,
  type DivisionStateValue,
  type MeetPhase,
} from '@qzr/shared'
import { formatWhen } from '@qzr/ui'

import { getDivisionStates, setDivisionState, setMeetPhase, type DivisionState } from '../api'
import { nextMove, previousState, stepNames } from '../stats'

/**
 * Each division's steps through the day (FR-019a), the current one marked, with the control that
 * confirms the next and the one that takes the last back, their warnings in the page, and once
 * every division is done the offer to move the meet to review. The Standings tab shows one
 * division's, the Setup tab's stats section every division's (FR-018, FR-019).
 */
const props = withDefaults(
  defineProps<{
    meetId: number
    slug: string
    phase: MeetPhase
    /** Only this division's steps; null for every division */
    division?: string | null
    /** Read the divisions again whenever it moves: the meet page's beat; without it, read once */
    beat?: number
  }>(),
  { division: null },
)
const emit = defineEmits<{
  /** A division moved, so the stats around it may have changed */
  moved: []
  /** The meet moved to review */
  phase: []
  /** Each division's state as just read, for a page that shows more of them */
  read: [divisions: DivisionState[]]
}>()

const divisions = ref<DivisionState[]>([])
const busy = ref(false)
const error = ref('')

/** A warning shown in the page before a move goes ahead, never as a browser dialog */
const ask = ref<{
  division: string
  text: string
  names: string[]
  yes: string
  go: () => Promise<void>
} | null>(null)
/** Every division finished: offer to move the meet to review, which it never does on its own */
const offerReview = ref(false)

const shown = computed(() =>
  divisions.value.filter(
    (d) => props.division === null || sameDivision(d.division, props.division),
  ),
)
/** Each division with the control that confirms its next step, if it has one */
const rows = computed(() => shown.value.map((d) => ({ d, move: nextMove(d.state, d.stages) })))
const done = computed(() => props.phase === 'done')
/** Divisions move only while the meet is live or in review */
const canMove = computed(() => props.phase === 'live' || props.phase === 'review')

async function reloadDivisions() {
  divisions.value = (await getDivisionStates(props.meetId)).divisionStates
  emit('read', divisions.value)
}

// Read on opening, then again on the page's beat where there is one
watch(
  () => [props.meetId, props.beat],
  () => {
    if (busy.value) return
    reloadDivisions().catch((e: Error) => (error.value = e.message))
  },
  { immediate: true },
)

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

/** The quizzes a 409 names, from its body */
function namesIn(e: unknown, key: 'missing' | 'affected'): string[] | null {
  if (!(e instanceof ApiError) || e.status !== 409) return null
  const listed = (e.body as Record<string, { name: string }[] | undefined> | undefined)?.[key]
  return listed ? listed.map((quiz) => quiz.name) : null
}
/** Confirm a division's next step: one move, or two for "Start Finals" */
function forward(d: DivisionState, confirm = false) {
  const move = nextMove(d.state, d.stages)
  if (!move) return
  const meetId = props.meetId
  void run(async () => {
    ask.value = null
    for (const to of move.to) {
      // The second move of two may already be made, if the first warned and was retried
      if (DIVISION_STATES.indexOf(to) <= DIVISION_STATES.indexOf(d.state)) continue
      try {
        await setDivisionState(meetId, d.division, to, confirm)
      } catch (e) {
        // An earlier move may have been made, so the rows show where the division is now
        await reloadDivisions().catch(() => {})
        const missing = namesIn(e, 'missing')
        if (!missing) throw e
        ask.value = {
          division: d.division,
          text: 'Not every scheduled quiz is stored and counting:',
          names: missing,
          yes: `${move.label} anyway`,
          go: async () => forward(divisions.value.find((x) => x.division === d.division)!, true),
        }
        return
      }
    }
    await reloadDivisions()
    emit('moved')
    if (move.to.includes('division_done') && props.phase === 'live') {
      offerReview.value = divisions.value.every((x) => x.state === 'division_done')
    }
  })
}

/** Take a division's last step back, withdrawing the order it confirmed */
function back(d: DivisionState, confirm = false) {
  const to = previousState(d.state)
  if (!to) return
  const meetId = props.meetId
  void run(async () => {
    ask.value = null
    offerReview.value = false
    try {
      await setDivisionState(meetId, d.division, to, confirm)
    } catch (e) {
      const affected = namesIn(e, 'affected')
      if (!affected) throw e
      ask.value = {
        division: d.division,
        text:
          'These quizzes were seated from the order you are withdrawing and may no longer be valid. ' +
          'They stay stored, flagged until you keep each one or set it to not counted:',
        names: affected,
        yes: 'Take back anyway',
        go: async () => back(d, true),
      }
      return
    }
    await reloadDivisions()
    emit('moved')
  })
}

function moveMeetToReview() {
  void run(async () => {
    await setMeetPhase(props.meetId, 'review')
    offerReview.value = false
    emit('phase')
  })
}

function stepClass(d: DivisionState, state: DivisionStateValue) {
  const [at, step] = [DIVISION_STATES.indexOf(d.state), DIVISION_STATES.indexOf(state)]
  return step < at ? 'step step--past' : step === at ? 'step step--here' : 'step'
}
</script>

<template>
  <div class="division-steps">
    <p v-if="error" class="state-msg state-msg--error">{{ error }}</p>
    <p v-if="!canMove && !done" class="state-msg">
      Divisions move through their steps once the meet is live.
    </p>
    <p v-if="shown.length === 0" class="state-msg">The meet has no divisions yet.</p>
    <div v-for="{ d, move } in rows" :key="d.division" class="division">
      <div class="division-head">
        <strong>{{ divisionTitle(d.division) }}</strong>
        <router-link
          class="as-viewer"
          :to="{
            name: 'meet-standings',
            params: { slug },
            query: { division: d.division, as: 'viewer' },
          }"
        >
          Preview as viewer
        </router-link>
      </div>
      <ol class="steps">
        <li v-for="state in DIVISION_STATES" :key="state" :class="stepClass(d, state)">
          {{ stepNames(d.stages)[state] }}
        </li>
      </ol>
      <p v-if="move" class="readiness">
        <template v-if="d.ready">Ready: {{ move.label }}.</template>
        <template v-else-if="d.missing.length">
          Waiting for {{ d.missing.map((quiz) => quiz.name).join(', ') }}.
        </template>
      </p>
      <p v-if="d.confirmed.prelims" class="note">
        Prelim order confirmed by {{ d.confirmed.prelims.by }},
        {{ formatWhen(d.confirmed.prelims.at) }}.
      </p>
      <p v-if="d.confirmed.rerank" class="note">
        Re-rank confirmed by {{ d.confirmed.rerank.by }}, {{ formatWhen(d.confirmed.rerank.at) }}.
      </p>
      <div v-if="canMove" class="actions">
        <button v-if="move" class="btn btn--primary btn--sm" :disabled="busy" @click="forward(d)">
          {{ move.label }}
        </button>
        <button
          v-if="previousState(d.state)"
          class="btn btn--secondary btn--sm"
          :disabled="busy"
          @click="back(d)"
        >
          Take back
        </button>
      </div>
      <div v-if="ask?.division === d.division" class="ask" role="alert">
        <p>{{ ask.text }}</p>
        <ul>
          <li v-for="name in ask.names" :key="name">{{ name }}</li>
        </ul>
        <div class="actions">
          <button class="btn btn--primary btn--sm" :disabled="busy" @click="ask.go()">
            {{ ask.yes }}
          </button>
          <button class="btn btn--secondary btn--sm" @click="ask = null">Cancel</button>
        </div>
      </div>
    </div>
    <div v-if="offerReview" class="ask" role="status">
      <p>Every division is finished. Move the meet to review?</p>
      <div class="actions">
        <button class="btn btn--primary btn--sm" :disabled="busy" @click="moveMeetToReview">
          Move to review
        </button>
        <button class="btn btn--secondary btn--sm" @click="offerReview = false">Not now</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.state-msg,
.division {
  padding: 0.75rem 0;
  border-bottom: 1px solid var(--color-border);
}

.division-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
}

.as-viewer {
  font-size: 0.8rem;
}

.steps {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  list-style: none;
  padding: 0;
  margin: 0.5rem 0;
}

.step {
  padding: 0.1rem 0.55rem;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  font-size: 0.75rem;
  color: var(--color-text-faint);
}

.step--past {
  color: var(--color-text-muted);
}

.step--here {
  border-color: var(--color-accent);
  color: var(--color-heading);
  font-weight: 600;
}

.readiness,
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

.ask {
  margin-top: 0.6rem;
  padding: 0.6rem 0.75rem;
  border: 1px solid var(--palette-error);
  border-radius: 6px;
  font-size: 0.85rem;
}

.ask ul {
  margin: 0.3rem 0 0;
  padding-left: 1.1rem;
}
</style>
