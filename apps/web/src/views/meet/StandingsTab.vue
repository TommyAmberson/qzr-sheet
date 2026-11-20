<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ApiError, divisionTitle, type DivisionStats } from '@qzr/shared'

import { getDivisionStats, keepQuiz } from '../../api'
import DivisionSteps from '../../components/DivisionSteps.vue'
import StandingState from '../../components/StandingState.vue'
import { useMeetPage } from '../../meetPage'
import { saveFile } from '../../downloads'
import {
  STAGE_LABELS,
  TIE_BREAKS,
  flagText,
  placeLabel,
  problemText,
  quizzerCount,
  statsCsv,
  warningText,
} from '../../stats'

/**
 * The Standings tab (FR-017, FR-018): one division's stats for every member of the meet, signed in
 * or a guest, as far as the meet's settings give them; an admin sees everything, with the
 * division's steps, and may look as a viewer. Every division picked shows the first.
 */
const route = useRoute()
const page = useMeetPage()
const { slug, meet, isAdmin, beat, statsHidden } = page
/** The division shown: the one picked, or the meet's first */
const division = computed(() => page.division.value ?? meet.value?.divisions[0] ?? null)

/** An admin looking at the page as its viewers see it (FR-023c) */
const asViewer = computed(() => route.query.as === 'viewer')
/** Whether this reader is shown warnings, so is one of the meet's admins */
const admin = computed(() => stats.value?.warnings !== undefined)
/** Each bracket's first three from its one decided Finals */
const medals = computed(
  () => stats.value?.results.find((stage) => stage.stage === 'finals')?.medals ?? [],
)

const stats = ref<DivisionStats | null>(null)
const loading = ref(true)
const error = ref('')

/** The steps moved the meet on: the page shows its new phase and reads the meet again */
function movedPhase() {
  void page.reloadMeet()
  void page.refresh()
}

/** The newest load; one for a division the page has since left must not show */
let loads = 0

async function load() {
  const current = ++loads
  const meetId = meet.value?.id
  if (meetId === undefined || division.value === null) {
    loading.value = false
    return
  }
  // A re-read on the page's beat keeps the tables in view while it runs
  if (!stats.value) loading.value = true
  error.value = ''
  try {
    const read = await getDivisionStats(meetId, division.value, asViewer.value)
    if (current !== loads) return
    stats.value = read
  } catch (e) {
    if (current !== loads) return
    error.value =
      e instanceof ApiError && e.status === 403
        ? "Only the meet's members can see its stats."
        : e instanceof ApiError && e.status === 503
          ? 'The stats are still being prepared. Try again in a moment.'
          : (e as Error).message
  } finally {
    if (current === loads) loading.value = false
  }
}

// Read on opening and for another division or the viewer's view, then kept current on the beat
watch(
  () => [meet.value?.id, division.value, asViewer.value],
  () => {
    stats.value = null
    void load()
  },
  { immediate: true },
)
watch(beat, () => void load())

/** The rows opened to show the quizzes behind their totals (FR-027), by table and name */
const opened = ref(new Set<string>())
function toggle(key: string) {
  const next = new Set(opened.value)
  if (!next.delete(key)) next.add(key)
  opened.value = next
}

/** Correct answers by question type, as "INT 2, FTV 1" */
const typesText = (types: Record<string, number>) =>
  Object.entries(types)
    .filter(([, n]) => n > 0)
    .map(([type, n]) => `${type} ${n}`)
    .join(', ')

/** The files of the statistician's workbook, made here from the admin's stats (FR-028) */
const FILES = [
  { key: 'teams', label: 'Teams by quiz' },
  { key: 'quizzers', label: 'Quizzers by quiz' },
  { key: 'standings', label: 'Standings' },
] as const

/** Save one of a division's stats files */
function download(key: (typeof FILES)[number]['key']) {
  if (!stats.value || !meet.value) return
  // A byte-order mark tells a spreadsheet the file is UTF-8, so accented names open as written
  const name = `${meet.value.name} ${divisionTitle(stats.value.division)} ${key}.csv`
  saveFile(`\ufeff${statsCsv(stats.value)[key]}`, name, 'text/csv')
}

/** Keep a quiz seated from a withdrawn order as it is, clearing its flag */
async function keep(resultId: number) {
  if (!meet.value) return
  try {
    await keepQuiz(meet.value.id, resultId)
    await load()
  } catch (e) {
    error.value = (e as Error).message
  }
}
</script>

<template>
  <div class="standings-tab">
    <p v-if="division === null" class="state-msg">The meet has no divisions yet.</p>
    <p v-else-if="statsHidden" class="state-msg">
      Nothing to see yet: results and standings show once the meet is under way.
    </p>
    <p v-else-if="loading" class="state-msg">Loading…</p>
    <p v-else-if="error" class="state-msg state-msg--error">{{ error }}</p>

    <template v-else-if="meet && stats">
      <!-- The steps head an admin's division with its name -->
      <h3 v-if="!isAdmin || asViewer" class="division-title">
        {{ divisionTitle(stats.division) }}
      </h3>
      <p v-if="asViewer" class="viewer-note no-print">
        Previewing as a viewer.
        <router-link :to="{ query: { ...route.query, as: undefined } }">See everything</router-link>
      </p>

      <!-- The division's steps through the day, for its admins (FR-018) -->
      <DivisionSteps
        v-if="isAdmin && !asViewer"
        class="no-print"
        :meet-id="meet.id"
        :slug="slug"
        :phase="meet.phase ?? 'registration'"
        :division="stats.division"
        :beat="beat"
        @moved="load"
        @phase="movedPhase"
      />

      <p v-if="admin" class="downloads no-print">
        Download:
        <button
          v-for="file in FILES"
          :key="file.key"
          class="btn btn--secondary btn--sm"
          @click="download(file.key)"
        >
          {{ file.label }}
        </button>
      </p>

      <ul v-if="stats.warnings?.length" class="warnings no-print">
        <li v-for="(warning, i) in stats.warnings" :key="i">{{ warningText(warning) }}</li>
      </ul>

      <!-- The Finals' first three, first, as the statistician's report has them -->
      <section v-if="medals.length" class="block">
        <h3 class="section-title">Finals</h3>
        <ol v-for="bracket in medals" :key="String(bracket.consolation)" class="medals">
          <li v-for="(team, i) in bracket.teams" :key="team">
            <span class="note"
              >{{ bracket.consolation ? 'Consolation ' : '' }}{{ placeLabel(i + 1) }}</span
            >
            {{ team }}
          </li>
        </ol>
      </section>

      <section v-if="!stats.prelimStandings" class="block">
        <h3 class="section-title">Prelim standings</h3>
        <p class="state-msg">Not shown yet: the meet's settings show it later in the day.</p>
      </section>
      <section v-else class="block">
        <h3 class="section-title">
          Prelim standings
          <StandingState :state="stats.prelimStandings.state" />
        </h3>
        <p v-if="stats.prelimStandings.confirmed" class="note no-print">
          Confirmed by {{ stats.prelimStandings.confirmed.by }}, in the elimination draw.
        </p>
        <p v-if="stats.prelimStandings.teams.length === 0" class="state-msg">
          No prelim counts yet. Count quizzes on the results page to see the standings.
        </p>
        <div v-else class="table-scroll">
          <table class="stats-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Team</th>
                <th title="Placement points">Points</th>
                <th>Quizzes</th>
                <th class="no-print">Tie-break</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="team in stats.prelimStandings.teams" :key="team.name">
                <tr>
                  <td>{{ team.tied ? `T${team.rank}` : team.rank }}</td>
                  <td class="name">
                    <button
                      v-if="team.lines.length"
                      class="open-name"
                      :aria-expanded="opened.has(`prelim|${team.name}`)"
                      @click="toggle(`prelim|${team.name}`)"
                    >
                      {{ team.name }}
                    </button>
                    <template v-else>{{ team.name }}</template>
                    <span v-if="team.finalist" class="finalist">Final</span>
                  </td>
                  <td>{{ team.placementPoints }}</td>
                  <td>{{ team.quizzes }}</td>
                  <td class="no-print">
                    {{
                      team.tied ? 'still tied' : team.decidedBy ? TIE_BREAKS[team.decidedBy] : ''
                    }}
                  </td>
                </tr>
                <tr v-if="opened.has(`prelim|${team.name}`)" class="lines no-print">
                  <td :colspan="5">
                    <table class="lines-table">
                      <thead>
                        <tr>
                          <th>Quiz</th>
                          <th>Stage</th>
                          <th>Place</th>
                          <th>Score</th>
                          <th title="Placement points">Points</th>
                          <th>Errors</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="line in team.lines" :key="line.quiz">
                          <td class="name">{{ line.quiz }}</td>
                          <td>{{ STAGE_LABELS[line.stage] }}</td>
                          <td>{{ line.place === null ? '' : placeLabel(line.place) }}</td>
                          <td>{{ line.score ?? '' }}</td>
                          <td>{{ line.placementPoints ?? '' }}</td>
                          <td>{{ line.errors ?? '' }}</td>
                        </tr>
                      </tbody>
                    </table>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </section>

      <section v-if="stats.prelimStandings?.current" class="block no-print">
        <h3 class="section-title">Prelim standings as they stand now</h3>
        <p class="note">
          A prelim has changed since the order was confirmed. The confirmed order stands; this is
          the current one.
        </p>
        <div class="table-scroll">
          <table class="stats-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Team</th>
                <th title="Placement points">Points</th>
                <th>Quizzes</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="team in stats.prelimStandings.current" :key="team.name">
                <td>{{ team.tied ? `T${team.rank}` : team.rank }}</td>
                <td class="name">{{ team.name }}</td>
                <td>{{ team.placementPoints }}</td>
                <td>{{ team.quizzes }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section v-if="stats.rerank" class="block">
        <h3 class="section-title">
          After the intermediates
          <StandingState :state="stats.rerank.state" />
        </h3>
        <div class="table-scroll">
          <table class="stats-table">
            <thead>
              <tr>
                <th>New rank</th>
                <th>Team</th>
                <th title="Prelim placement points plus the intermediate's">Points</th>
                <th>Quizzes</th>
                <th class="no-print">Tie-break</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="team in stats.rerank.teams" :key="team.name">
                <tr>
                  <td>{{ team.rank }}</td>
                  <td class="name">
                    <button
                      v-if="team.lines.length"
                      class="open-name"
                      :aria-expanded="opened.has(`rerank|${team.name}`)"
                      @click="toggle(`rerank|${team.name}`)"
                    >
                      {{ team.name }}
                    </button>
                    <template v-else>{{ team.name }}</template>
                  </td>
                  <td>{{ team.placementPoints }}</td>
                  <td>{{ team.quizzes }}</td>
                  <td class="no-print">
                    {{
                      team.tied ? 'still tied' : team.decidedBy ? TIE_BREAKS[team.decidedBy] : ''
                    }}
                  </td>
                </tr>
                <tr v-if="opened.has(`rerank|${team.name}`)" class="lines no-print">
                  <td :colspan="5">
                    <table class="lines-table">
                      <thead>
                        <tr>
                          <th>Quiz</th>
                          <th>Stage</th>
                          <th>Place</th>
                          <th>Score</th>
                          <th title="Placement points">Points</th>
                          <th>Errors</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="line in team.lines" :key="line.quiz">
                          <td class="name">{{ line.quiz }}</td>
                          <td>{{ STAGE_LABELS[line.stage] }}</td>
                          <td>{{ line.place === null ? '' : placeLabel(line.place) }}</td>
                          <td>{{ line.score ?? '' }}</td>
                          <td>{{ line.placementPoints ?? '' }}</td>
                          <td>{{ line.errors ?? '' }}</td>
                        </tr>
                      </tbody>
                    </table>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </section>

      <section v-if="!stats.quizzers" class="block">
        <h3 class="section-title">Quizzer standings</h3>
        <p class="state-msg">Not shown yet: the meet's settings show it later in the day.</p>
      </section>
      <section v-else class="block">
        <h3 class="section-title">
          Quizzer standings
          <StandingState :state="stats.quizzers.state" />
        </h3>
        <p v-if="stats.quizzers.lists.length === 0" class="state-msg">
          No quiz counts for quizzers yet.
        </p>
        <template v-for="list in stats.quizzers.lists" :key="String(list.consolation)">
          <h4 v-if="list.consolation" class="list-title">Consolation</h4>
          <div class="table-scroll">
            <table class="stats-table">
              <thead>
                <!-- Place, name and the average it ranks by first, so a phone shows them -->
                <tr>
                  <th>Place</th>
                  <th>Quizzer</th>
                  <th>Average</th>
                  <th>Team</th>
                  <th>Errors</th>
                  <th>Jumps</th>
                  <th class="no-print" title="Total points">Points</th>
                  <th class="no-print" title="Quizzes the team played">Quizzes</th>
                  <th class="no-print"></th>
                </tr>
              </thead>
              <tbody>
                <!-- A quizzer with no jumps is left off the printed list, and still counted -->
                <template v-for="quizzer in list.quizzers" :key="`${quizzer.team}|${quizzer.name}`">
                  <tr :class="{ 'no-jumps': quizzer.jumps === 0 }">
                    <td>{{ quizzer.place }}</td>
                    <td class="name">
                      <button
                        v-if="quizzer.lines.length"
                        class="open-name"
                        :aria-expanded="opened.has(`q|${quizzer.team}|${quizzer.name}`)"
                        @click="toggle(`q|${quizzer.team}|${quizzer.name}`)"
                      >
                        {{ quizzer.name }}
                      </button>
                      <template v-else>{{ quizzer.name }}</template>
                    </td>
                    <td>{{ quizzer.average.toFixed(2) }}</td>
                    <td class="name">{{ quizzer.team }}</td>
                    <td>{{ quizzer.errors }}</td>
                    <td>{{ quizzer.jumps }}</td>
                    <td class="no-print">{{ quizzer.points }}</td>
                    <td class="no-print">{{ quizzer.quizzes }}</td>
                    <td class="flags no-print">
                      <span v-for="(flag, i) in quizzer.flags" :key="i">{{ flagText(flag) }}</span>
                    </td>
                  </tr>
                  <tr v-if="opened.has(`q|${quizzer.team}|${quizzer.name}`)" class="lines no-print">
                    <td colspan="9">
                      <table class="lines-table">
                        <thead>
                          <tr>
                            <th>Quiz</th>
                            <th>Points</th>
                            <th>Errors</th>
                            <th>Jumps</th>
                            <th>Correct by type</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr v-for="line in quizzer.lines" :key="line.quiz">
                            <td class="name">{{ line.quiz }}</td>
                            <td>{{ line.points }}</td>
                            <td>{{ line.errors }}</td>
                            <td>{{ line.jumps }}</td>
                            <td class="name">{{ typesText(line.types) }}</td>
                          </tr>
                        </tbody>
                      </table>
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
          <p class="count">{{ quizzerCount(stats.division, list) }}</p>
        </template>
      </section>

      <!-- The quizzes are on screen only: the printed report is the standings -->
      <p v-if="stats.results.length === 0" class="state-msg no-print">
        No quiz results to show yet.
      </p>
      <section v-for="stage in stats.results" :key="stage.stage" class="block no-print">
        <h3 class="section-title">{{ STAGE_LABELS[stage.stage] }} quizzes</h3>
        <div class="table-scroll">
          <table class="stats-table">
            <thead>
              <tr>
                <th>Quiz</th>
                <th>Teams</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="quiz in stage.quizzes" :key="quiz.id ?? quiz.name">
                <td class="cell-quiz">
                  <router-link
                    v-if="quiz.id !== undefined"
                    :to="{ name: 'meet-result', params: { slug, resultId: quiz.id } }"
                  >
                    {{ quiz.name }}
                  </router-link>
                  <template v-else>{{ quiz.name }}</template>
                </td>
                <td class="name">
                  <ul class="teams">
                    <li v-for="team in quiz.teams" :key="team.name">
                      {{ team.name }}
                      <strong v-if="team.score !== undefined">{{ team.score }}</strong>
                      <span v-if="team.place !== undefined" class="note">
                        {{ placeLabel(team.place, team.tiedWith) }}
                      </span>
                    </li>
                    <li v-if="quiz.status === 'underReview'" class="note">under review</li>
                    <li v-if="quiz.status === 'accepted'" class="note">accepted as scored</li>
                    <li v-if="quiz.incompleteTypes" class="note">question types incomplete</li>
                    <li v-if="quiz.withdrawnOrder" class="problem">
                      Seated from an order since withdrawn.
                      <button
                        v-if="admin && quiz.id !== undefined"
                        class="keep"
                        @click="keep(quiz.id)"
                      >
                        Keep as it is
                      </button>
                    </li>
                    <li v-for="(problem, i) in quiz.problems ?? []" :key="i" class="problem">
                      {{ problemText(problem) }}
                    </li>
                  </ul>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.division-title {
  margin-bottom: 0.75rem;
  color: var(--color-heading);
  font-size: 1rem;
  font-weight: 700;
}

.state-msg {
  font-size: 0.875rem;
  color: var(--color-text-faint);
}

.state-msg--error {
  color: var(--palette-error);
}

.block {
  margin-bottom: 2rem;
}

.section-title {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--color-heading);
  margin-bottom: 0.5rem;
}

/* A wide table scrolls inside its own box, never the page */
.table-scroll {
  overflow-x: auto;
}

.stats-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
}

.stats-table th,
.stats-table td {
  text-align: left;
  padding: 0.4rem 0.5rem;
  border-bottom: 1px solid var(--color-border);
  vertical-align: top;
}

.stats-table th {
  color: var(--color-text-faint);
  font-weight: 600;
}

.cell-quiz {
  white-space: nowrap;
  font-weight: 600;
}

.teams {
  list-style: none;
  padding: 0;
  margin: 0;
}

/* Vue drops the line break between a team's score and its place, so space them here */
.teams li > .note {
  margin-left: 0.3rem;
}

/* A name that opens the quizzes behind its totals */
.open-name {
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
  text-decoration: underline dotted;
  text-underline-offset: 0.2em;
}

.open-name[aria-expanded='true'] {
  font-weight: 600;
}

.lines > td {
  background: var(--color-bg-raised);
  padding: 0.25rem 0.5rem 0.5rem 1.5rem;
}

.lines-table {
  border-collapse: collapse;
  font-size: 0.75rem;
}

.lines-table th,
.lines-table td {
  text-align: left;
  padding: 0.2rem 0.6rem 0.2rem 0;
}

.lines-table th {
  color: var(--color-text-faint);
  font-weight: 600;
}

.downloads {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
  margin: 0 0 1rem;
}

.finalist {
  margin-left: 0.4rem;
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--color-accent);
}

.warnings {
  margin: 0 0 1.5rem;
  padding-left: 1.1rem;
  font-size: 0.8rem;
  color: var(--palette-error);
}

.medals {
  list-style: none;
  padding: 0;
  margin: 0 0 0.75rem;
  font-size: 0.9rem;
  font-weight: 600;
}

.medals .note {
  display: inline-block;
  min-width: 3rem;
  font-weight: 400;
}

.list-title {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-heading);
  margin: 1rem 0 0.4rem;
}

.flags {
  color: var(--palette-error);
}

.flags span + span::before {
  content: '; ';
}

.note {
  color: var(--color-text-faint);
  font-style: italic;
}

.problem {
  color: var(--palette-error);
}

.count {
  margin: 0.4rem 0 0;
  font-size: 0.8rem;
  color: var(--color-text-muted);
}

/* A table's figures stay on one line, so a narrow screen wraps names, not figures */
.stats-table td:not(.name) {
  white-space: nowrap;
}

/*
 * Printed, the page is the statistician's report for one division: the Finals' first three, the
 * standings, and the quizzers with their averages, errors and jumps and how many there were.
 * Quizzers with no jumps are left off the list and still counted (FR-025, FR-026).
 */
@media print {
  .no-jumps {
    display: none !important;
  }

  .table-scroll {
    overflow: visible;
  }

  .stats-table {
    font-size: 9pt;
  }

  .stats-table tr {
    break-inside: avoid;
  }

  /* A heading stays with what it heads, never alone at the foot of a page */
  .section-title,
  .list-title {
    break-after: avoid;
  }

  .block {
    margin-bottom: 1rem;
  }
}

.viewer-note {
  margin: -0.75rem 0 1.25rem;
  font-size: 0.8rem;
  color: var(--color-text-muted);
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
}

.btn--sm {
  padding: 0.25rem 0.6rem;
  font-size: 0.75rem;
}

.btn--secondary {
  background: transparent;
  color: var(--color-text-muted);
  border-color: var(--color-border);
}

.btn--secondary:hover {
  border-color: var(--color-text-muted);
  color: var(--color-text);
}

.keep {
  margin-left: 0.4rem;
  font: inherit;
  font-size: 0.75rem;
}
</style>
