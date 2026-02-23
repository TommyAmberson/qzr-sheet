<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { CellValue, QuestionType } from '../types/scoresheet'
import { useScoresheet } from '../composables/useScoresheet'
import { validationMessage } from '../scoring/validation'

const {
  columns, quiz, teams, teamQuizzers, cells, noJumps, scoring, setCell, toggleNoJump,
  isBonusForTeam, isGreyedOut, isInvalid, cellValidationMessages, columnHasErrors, columnValidationMessages, quizzerHasErrors, quizzerValidationMessages, teamValidationMessages, isAfterOut, isFouledOnQuestion,
  teamHasErrors, hasAnyErrors, colAnswerValue, noJumpHasConflict,
  visibleColumns, allQuestionsComplete,
  validationErrors,
  placements,
} = useScoresheet()

/** All unique validation messages for the status tooltip */
const allValidationMessages = computed(() => {
  const msgs = new Set<string>()
  for (const codes of validationErrors.value.values()) {
    for (const code of codes) msgs.add(validationMessage(code))
  }
  return [...msgs]
})

/** Active cell selector state */
const selector = ref<{ ti: number; qi: number; ci: number; x: number; y: number } | null>(null)

const bonusOptions = [
  { value: CellValue.Bonus, label: 'B', cls: 'opt--bonus' },
  { value: CellValue.MissedBonus, label: 'MB', cls: 'opt--missed-bonus' },
  { value: CellValue.Foul, label: 'F', cls: 'opt--foul' },
  { value: CellValue.Empty, label: '✕', cls: 'opt--clear' },
]
const normalOptions = [
  { value: CellValue.Correct, label: 'C', cls: 'opt--correct' },
  { value: CellValue.Error, label: 'E', cls: 'opt--error' },
  { value: CellValue.Foul, label: 'F', cls: 'opt--foul' },
  { value: CellValue.Empty, label: '✕', cls: 'opt--clear' },
]

/** Options to show in the selector based on column type and context */
const selectorOptions = computed(() => {
  if (!selector.value) return []
  const { ti, qi, ci } = selector.value
  const col = columns.value[ci]
  if (!col) return []

  // B columns always show bonus options
  if (col.type === QuestionType.B) return bonusOptions

  // Bonus situation (other 2 teams tossed-up) — show B/MB regardless of current value
  if (isBonusForTeam(ti, ci)) return bonusOptions

  return normalOptions
})

function openSelector(ti: number, qi: number, ci: number, event: MouseEvent) {
  const td = event.currentTarget as HTMLElement
  const rect = td.getBoundingClientRect()
  selector.value = {
    ti, qi, ci,
    x: rect.left + rect.width / 2,
    y: rect.bottom + 4,
  }
}

function selectValue(value: CellValue) {
  if (!selector.value) return
  setCell(selector.value.ti, selector.value.qi, selector.value.ci, value)
  selector.value = null
}

function closeSelector() {
  selector.value = null
}

/** Hovered column index for crosshair highlight */
const hoverCol = ref<number | null>(null)


/** Columns actually rendered — entering columns start collapsed, then expand */
const displayColumns = ref(visibleColumns.value.map(vc => ({ ...vc, entering: false })))

const teamColors = ['team--red', 'team--white', 'team--blue']

const cellDisplay: Record<CellValue, string> = {
  [CellValue.Correct]: 'C',
  [CellValue.Error]: 'E',
  [CellValue.Foul]: 'F',
  [CellValue.Bonus]: 'B',
  [CellValue.MissedBonus]: 'MB',
  [CellValue.Empty]: '',
}

const cellClass: Record<CellValue, string> = {
  [CellValue.Correct]: 'cell--correct',
  [CellValue.Error]: 'cell--error',
  [CellValue.Foul]: 'cell--foul',
  [CellValue.Bonus]: 'cell--bonus',
  [CellValue.MissedBonus]: 'cell--missed-bonus',
  [CellValue.Empty]: '',
}

let prevVisibleKeys = new Set(visibleColumns.value.map(({ col }) => col.key))

watch(visibleColumns, (curr) => {
  const prev = prevVisibleKeys
  prevVisibleKeys = new Set(curr.map(({ col }) => col.key))

  // Detect entering column keys
  const enteringKeys = new Set<string>()
  for (const { col } of curr) {
    if (!prev.has(col.key)) enteringKeys.add(col.key)
  }

  // Build new display list — leaving columns are simply dropped (instant removal)
  displayColumns.value = curr.map(vc => ({
    ...vc,
    entering: enteringKeys.has(vc.col.key),
  }))

  // Entering columns: start collapsed, then expand after the browser paints.
  // Double-rAF ensures the collapsed state is rendered before we transition.
  if (enteringKeys.size > 0) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        displayColumns.value = displayColumns.value.map(dc => ({
          ...dc,
          entering: false,
        }))
      })
    })
  }
})

const headerAnswerClass: Record<CellValue, string> = {
  [CellValue.Correct]: 'col--header-correct',
  [CellValue.Error]: 'col--header-error',
  [CellValue.Foul]: '',
  [CellValue.Bonus]: 'col--header-bonus',
  [CellValue.MissedBonus]: 'col--header-missed-bonus',
  [CellValue.Empty]: '',
}

function headerClass(colIdx: number): string {
  const classes: string[] = []
  const answer = headerAnswerClass[colAnswerValue(colIdx)]
  if (answer) classes.push(answer)
  else if (noJumps.value[colIdx]) classes.push('col--header-no-jump')
  if (columnHasErrors(colIdx)) classes.push('col--header-invalid')
  return classes.join(' ')
}

/** Column CSS class for visual grouping (no animation — that's on the display entry) */
function colGroupClass(colIdx: number): string {
  const col = columns.value[colIdx]
  if (!col) return ''
  const classes: string[] = []
  if (col.isOvertime) classes.push('col--overtime')
  else if (col.isAB && col.isErrorPoints) classes.push('col--ab')
  return classes.join(' ')
}

</script>

<template>
  <div class="scoresheet-wrapper">
    <div :class="['quiz-meta', { 'quiz-meta--error': hasAnyErrors, 'quiz-meta--complete': allQuestionsComplete && !hasAnyErrors }]">
      <label class="meta-field">
        <span class="meta-label">Division</span>
        <input v-model.number="quiz.division" type="number" min="1" />
      </label>
      <span class="meta-sep">·</span>
      <label class="meta-field">
        <span class="meta-label">Quiz</span>
        <input v-model.number="quiz.quizNumber" type="number" min="1" />
      </label>
      <span class="meta-sep">·</span>
      <label class="meta-field meta-field--toggle">
        <input v-model="quiz.overtime" type="checkbox" />
        <span class="toggle-track"><span class="toggle-thumb"></span></span>
        <span class="meta-label">Overtime</span>
      </label>
      <span class="meta-sep">·</span>
      <span class="meta-field meta-field--status" :title="hasAnyErrors ? allValidationMessages.join('\n') : undefined">
        <span v-if="hasAnyErrors" class="meta-status meta-status--error">⚠</span>
        <span v-else-if="allQuestionsComplete" class="meta-status meta-status--complete">✓</span>
        <span v-else class="meta-status meta-status--pending">○</span>
        <span class="meta-label">{{ hasAnyErrors ? 'Invalid' : allQuestionsComplete ? 'Complete' : 'In Progress' }}</span>
      </span>
    </div>

    <table class="scoresheet">
      <!-- Question header row -->
      <thead>
        <tr>
          <th class="col--name sticky-col"></th>
          <th
            v-for="{ col, idx, entering } in displayColumns"
            :key="col.key"
            :class="['col--question', colGroupClass(idx), headerClass(idx), { 'col--entering': entering, 'col--hover': hoverCol === idx || selector?.ci === idx }]"
            :title="columnHasErrors(idx) ? columnValidationMessages(idx).join('\n') : undefined"
          >
            {{ col.label }}
          </th>
          <th class="col--total col--total-header"></th>
        </tr>
        <tr class="spacer-row">
          <td class="sticky-col"></td>
          <td v-for="{ col, idx, entering } in displayColumns" :key="col.key" :class="['spacer-cell', colGroupClass(idx), { 'col--entering': entering }]"></td>
          <td></td>
        </tr>
      </thead>

      <tbody>
        <template v-for="(team, ti) in teams" :key="team.id">
          <!-- Team header row -->
          <tr :class="['row--team-header', teamColors[ti]]">
            <td class="col--name sticky-col team-name">
              {{ team.name }}
              <span
                class="on-time"
                :class="{ 'on-time--active': team.onTime }"
                @click.stop="team.onTime = !team.onTime"
              >
                <span class="on-time-box">✓</span>
                <span class="on-time-label">on time</span>
              </span>
              <span class="team-stats">
                <span
                  v-if="(scoring[ti]?.uniqueCorrectQuizzers ?? 0) >= 3"
                  class="stat-badge stat-badge--unique"
                  :title="`${scoring[ti]!.uniqueCorrectQuizzers} quizzers jumped (+10 each from 3rd)`"
                >{{ scoring[ti]!.uniqueCorrectQuizzers >= 5 ? '5th' : scoring[ti]!.uniqueCorrectQuizzers >= 4 ? '4th' : '3rd' }}</span>
              </span>
            </td>
            <td
              v-for="{ col, entering } in displayColumns"
              :key="col.key"
              :class="['team-header-spacer', { 'col--entering': entering }]"
            ></td>
            <td class="col--name team-score-label">Score</td>
          </tr>

          <!-- Quizzer rows -->
          <tr
            v-for="(quizzer, qi) in teamQuizzers[ti]"
            :key="quizzer.id"
            :class="[
              'row--quizzer',
              { 'row--quizzed-out': scoring[ti]?.quizzers[qi]?.quizzedOut },
              { 'row--errored-out': scoring[ti]?.quizzers[qi]?.erroredOut && !scoring[ti]?.quizzers[qi]?.fouledOut },
              { 'row--fouled-out': scoring[ti]?.quizzers[qi]?.fouledOut },
            ]"
          >
            <td
              :class="['col--name', 'sticky-col', { 'cell--invalid': quizzerHasErrors(ti, qi), 'col--name--active': selector?.ti === ti && selector?.qi === qi }]"
              :title="quizzerHasErrors(ti, qi) ? quizzerValidationMessages(ti, qi).join('\n') : undefined"
            >
              <span class="quizzer-name">{{ quizzer.name }}</span>
              <span v-if="scoring[ti]?.quizzers[qi]" class="quizzer-stats">
                <span
                  v-if="scoring[ti]!.quizzers[qi]!.quizzedOut"
                  :class="['stat-badge', 'stat-badge--quizout', { 'stat-badge--quizout-bonus': scoring[ti]!.quizzers[qi]!.quizoutBonus }]"
                  :title="scoring[ti]!.quizzers[qi]!.quizoutBonus ? 'Quiz-out with bonus (+10)' : 'Quiz-out'"
                >Q</span>
                <span
                  v-else-if="scoring[ti]!.quizzers[qi]!.erroredOut && !scoring[ti]!.quizzers[qi]!.fouledOut"
                  class="stat-badge stat-badge--errorout"
                  title="Errored out"
                >E</span>
                <span
                  v-else-if="scoring[ti]!.quizzers[qi]!.fouledOut"
                  class="stat-badge stat-badge--foulout"
                  title="Fouled out"
                >F</span>
                <span
                  v-if="scoring[ti]!.quizzers[qi]!.correctCount > 0 && !scoring[ti]!.quizzers[qi]!.quizzedOut"
                  class="stat-count stat-count--correct"
                  :title="`${scoring[ti]!.quizzers[qi]!.correctCount} correct`"
                >{{ scoring[ti]!.quizzers[qi]!.correctCount }}c</span>
                <span
                  v-if="scoring[ti]!.quizzers[qi]!.errorCount > 0 && !(scoring[ti]!.quizzers[qi]!.erroredOut && !scoring[ti]!.quizzers[qi]!.fouledOut)"
                  class="stat-count stat-count--error"
                  :title="`${scoring[ti]!.quizzers[qi]!.errorCount} error(s)`"
                >{{ scoring[ti]!.quizzers[qi]!.errorCount }}e</span>
                <span
                  v-if="scoring[ti]!.quizzers[qi]!.foulCount > 0 && !scoring[ti]!.quizzers[qi]!.fouledOut"
                  class="stat-count stat-count--foul"
                  :title="`${scoring[ti]!.quizzers[qi]!.foulCount} foul(s)`"
                >{{ scoring[ti]!.quizzers[qi]!.foulCount }}f</span>
              </span>
            </td>
            <td
              v-for="{ col, idx, entering } in displayColumns"
              :key="col.key"
              :class="[
                'cell',
                cellClass[cells[ti][qi][idx]],
                colGroupClass(idx),
                { 'cell--greyed': ((isGreyedOut(ti, idx) || noJumps[idx]) && cells[ti][qi][idx] === '') || isAfterOut(ti, qi, idx) || (isFouledOnQuestion(ti, qi, idx) && cells[ti][qi][idx] === '') },
                { 'cell--invalid': isInvalid(ti, qi, idx) },
                { 'col--entering': entering },
                { 'col--hover': hoverCol === idx },
              ]"
              :title="isInvalid(ti, qi, idx) ? cellValidationMessages(ti, qi, idx).join('\n') : undefined"
              @click="openSelector(ti, qi, idx, $event)"
              @mouseenter="hoverCol = idx"
              @mouseleave="hoverCol = null"
            >
              {{ cellDisplay[cells[ti][qi][idx]] }}
            </td>
            <!-- Team total spans quizzer rows only -->
            <td
              v-if="qi === 0"
              :class="['col--total', 'team-total-value', { 'cell--invalid': teamHasErrors(ti) }]"
              :rowspan="teamQuizzers[ti]?.length ?? 5"
              :title="teamHasErrors(ti) ? teamValidationMessages(ti).join('\n') : undefined"
            >
              <span v-if="placements[ti]" class="placement-medal">{{ placements[ti] === 1 ? '🥇' : placements[ti] === 2 ? '🥈' : '🥉' }}</span>
              {{ scoring[ti]?.total ?? 0 }}
            </td>
          </tr>

          <!-- Team running total row -->
          <tr class="row--team-total">
            <td class="col--name sticky-col"></td>
            <td
              v-for="{ col, idx, entering } in displayColumns"
              :key="col.key"
              :class="['cell--total', colGroupClass(idx), { 'col--entering': entering }]"
              style="position: relative;"
            >
              {{ scoring[ti]?.runningTotals[idx] ?? '' }}
              <span
                v-if="scoring[ti]?.uniqueQuizzerBonusCols.has(idx)"
                class="running-total-badge running-total-badge--unique"
              >{{ scoring[ti]!.uniqueQuizzerBonusCols.get(idx) === 3 ? '3rd' : scoring[ti]!.uniqueQuizzerBonusCols.get(idx) === 4 ? '4th' : '5th' }}</span>
              <span
                v-if="scoring[ti]?.quizoutBonusCols.has(idx)"
                class="running-total-badge running-total-badge--quizout"
              >Q</span>
              <span
                v-if="scoring[ti]?.freeErrorCols.has(idx)"
                class="running-total-badge running-total-badge--free-error"
                title="Free error (no deduction)"
              >≈</span>
              <span
                v-if="scoring[ti]?.foulDeductCols.has(idx)"
                class="running-total-badge running-total-badge--foul-deduct"
                title="Foul deduction (-10)"
              >F</span>
            </td>
            <td class="running-total-spacer"></td>
          </tr>

          <!-- Spacer between teams -->
          <tr v-if="ti < teams.length - 1" class="spacer-row">
            <td class="sticky-col"></td>
            <td v-for="{ col, idx, entering } in displayColumns" :key="col.key" :class="['spacer-cell', colGroupClass(idx), { 'col--entering': entering }]"></td>
            <td></td>
          </tr>
        </template>
      </tbody>

      <!-- No-jump row at bottom -->
      <tfoot>
        <tr class="spacer-row">
          <td class="sticky-col"></td>
          <td v-for="{ col, idx, entering } in displayColumns" :key="col.key" :class="['spacer-cell', colGroupClass(idx), { 'col--entering': entering }]"></td>
          <td></td>
        </tr>
        <tr class="row--no-jump">
          <td class="col--name sticky-col no-jump-label">No Jump</td>
          <td
            v-for="{ col, idx, entering } in displayColumns"
            :key="col.key"
            :class="['cell cell--no-jump', colGroupClass(idx), { 'cell--no-jump-active': noJumps[idx], 'cell--invalid': noJumpHasConflict(idx), 'col--entering': entering }]"
            :title="noJumpHasConflict(idx) ? columnValidationMessages(idx).join('\n') : undefined"
            @click="toggleNoJump(idx)"
          >
            {{ noJumps[idx] ? '✗' : '' }}
          </td>
          <td class="col--total no-jump-total"></td>
        </tr>
      </tfoot>
    </table>
    <!-- Cell selector popup -->
    <Teleport to="body">
      <div v-if="selector" class="selector-backdrop" @click="closeSelector">
        <div
          class="selector-popup"
          :style="{ left: selector.x + 'px', top: selector.y + 'px' }"
          @click.stop
        >
          <button
            v-for="opt in selectorOptions"
            :key="opt.label"
            :class="['selector-opt', opt.cls]"
            @click="selectValue(opt.value)"
          >
            {{ opt.label }}
          </button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.scoresheet-wrapper {
  overflow-x: auto;
  width: 100%;
  padding: 1rem;
  box-sizing: border-box;
}

.quiz-meta {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  margin-bottom: 0.5rem;
  padding: 0.5rem 0.85rem;
  background: var(--color-meta-bg);
  border: 1px solid var(--color-meta-accent);
  border-left: 3px solid var(--color-meta-border);
  border-radius: 6px;
  width: fit-content;
  color: var(--color-text);
  font-family: 'Segoe UI', system-ui, sans-serif;
  font-size: 0.8rem;
  transition: background 0.4s, color 0.4s, border-color 0.4s;
}

.quiz-meta--error {
  background: var(--color-error-light);
  border-color: var(--color-invalid);
  border-left-color: var(--color-invalid);
}
.quiz-meta--error .meta-label {
  color: var(--color-error);
}

.quiz-meta--complete {
  border-left-color: var(--color-accent);
}

.meta-status {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.2rem;
  height: 1.2rem;
  border-radius: 50%;
  font-size: 0.7rem;
  font-weight: 800;
  margin-left: 0.25rem;
  flex-shrink: 0;
  transition: all 0.3s;
}
.meta-status--pending {
  color: var(--color-meta-accent);
  font-size: 1rem;
}
.meta-status--complete {
  background: var(--color-accent);
  color: var(--color-bg);
}
.meta-status--error {
  background: var(--color-invalid);
  color: var(--color-bg);
  border-radius: 3px;
  font-size: 0.8rem;
}

.meta-field--status .meta-label {
  text-transform: none;
  letter-spacing: normal;
}
.meta-status--complete + .meta-label {
  color: var(--color-accent);
}
.meta-status--error + .meta-label {
  color: var(--color-invalid);
}

.meta-sep {
  color: var(--color-meta-accent);
  font-size: 0.9rem;
  user-select: none;
}

.meta-field {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.meta-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.meta-field input[type='number'] {
  width: 2.5rem;
  padding: 0.2rem 0.3rem;
  border: 1px solid var(--color-meta-accent);
  border-radius: 4px;
  font-size: 0.8rem;
  font-weight: 600;
  text-align: center;
  background: var(--color-bg);
  color: var(--color-text);
}
.meta-field input[type='number']:focus {
  outline: 1px solid var(--color-accent);
  outline-offset: 0;
  border-color: var(--color-accent);
}

/* Toggle switch */
.meta-field--toggle {
  gap: 0.35rem;
  cursor: pointer;
}
.meta-field--toggle input[type='checkbox'] {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}
.toggle-track {
  display: inline-block;
  width: 1.75rem;
  height: 1rem;
  background: var(--color-meta-accent);
  border-radius: 999px;
  position: relative;
  transition: background 0.2s;
}
.meta-field--toggle input:checked + .toggle-track {
  background: var(--color-accent);
}
.toggle-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: calc(1rem - 4px);
  height: calc(1rem - 4px);
  background: var(--color-bg);
  border-radius: 50%;
  transition: transform 0.2s;
}
.meta-field--toggle input:checked + .toggle-track .toggle-thumb {
  transform: translateX(calc(1.75rem - 1rem));
}
.meta-field--toggle .meta-label {
  font-size: 0.75rem;
  color: var(--color-text-muted);
}
.meta-field--toggle input:checked ~ .meta-label {
  color: var(--color-text);
  font-weight: 600;
}

.scoresheet {
  border-collapse: collapse;
  font-family: 'Segoe UI', system-ui, sans-serif;
  font-size: 0.8rem;
  white-space: nowrap;
  width: 100%;
  table-layout: auto;
}

.scoresheet th,
.scoresheet td {
  border: 1px solid var(--color-border);
  padding: 0.25rem 0.4rem;
  text-align: center;
  min-width: 2rem;
  height: 1.8rem;
  background: var(--color-bg);
}


/* Sticky first column */
.sticky-col {
  position: sticky;
  left: 0;
  z-index: 2;
  background: var(--color-bg);
}

.scoresheet .col--name {
  text-align: left;
  min-width: 7rem;
  max-width: 10rem;
  font-weight: 500;
}

.col--total {
  min-width: 3rem;
  font-weight: 600;
  background: var(--color-border-light);
}
.col--total-header {
  background: transparent !important;
  border: none !important;
}

/* Column group shading */

/* Spacer row — half-height transparent gap */
.spacer-row td {
  height: 0.5rem;
  padding: 0 !important;
  border: none !important;
  background: transparent !important;
}
.spacer-row .spacer-cell {
  border-left: 1px solid var(--color-border-light) !important;
  border-right: 1px solid var(--color-border-light) !important;
}

/* Question header row — empty name cell blends with background */
thead .col--name {
  background: transparent !important;
  border: none !important;
}

/* Question header */
.scoresheet .col--question {
  font-weight: 700;
  background: transparent;
  color: var(--color-text);
  font-size: 0.75rem;
  border: none;
  border-top: 1px solid var(--color-border-light);
  border-left: 1px solid var(--color-border-light);
  border-right: 1px solid var(--color-border-light);
}
.col--question.col--ab {
  border-top: 2px solid var(--color-ab-border);
}
.col--question.col--overtime {
  border-top: 2px solid var(--color-ot-border);
}

/* Question header colours based on answer */
.col--header-correct {
  color: var(--color-correct) !important;
}
.col--header-error {
  color: var(--color-error) !important;
}
.col--header-bonus {
  color: var(--color-bonus) !important;
}
.col--header-missed-bonus {
  color: var(--color-missed-bonus) !important;
}
.col--header-no-jump {
  color: var(--color-no-jump) !important;
  text-decoration: line-through;
}
.col--header-invalid {
  outline: 2px solid var(--color-invalid);
  outline-offset: -2px;
  animation: pulse-invalid 1.5s ease-in-out infinite;
}

/* Team header row */
.row--team-header {
  background: transparent;
  color: var(--color-team-white);
}
.team-header-spacer {
  background: transparent !important;
  border: none !important;
  border-left: 1px solid var(--color-border-light) !important;
  border-right: 1px solid var(--color-border-light) !important;
}
.team-score-label {
  background: transparent !important;
  color: var(--color-text);
  font-weight: 800;
  font-size: 1rem;
  text-align: center !important;
  border: none !important;
}
.running-total-spacer {
  background: transparent !important;
  border: none !important;
}
.row--team-header .team-name {
  font-weight: 700;
  font-size: 0.85rem;
  background: var(--color-text);
  color: var(--color-team-white);
  text-align: left;
  padding-left: 0.5rem;
  border-radius: 4px;
  border: none !important;
}
.row--team-header .team-name::before {
  content: '';
  display: inline-block;
  width: 0.85rem;
  height: 0.85rem;
  border-radius: 3px;
  margin-right: 0.4rem;
  vertical-align: middle;
  border: 1px solid var(--color-text-faint);
}
.row--team-header.team--red .team-name::before {
  background: var(--color-team-red);
}
.row--team-header.team--white .team-name::before {
  background: var(--color-team-white);
}
.row--team-header.team--blue .team-name::before {
  background: var(--color-team-blue);
}


/* Team total row */
.row--team-total {
  background: transparent;
  font-weight: 600;
  font-size: 0.75rem;
  font-style: italic;
  color: var(--color-text-muted);
}
.row--team-total td {
  background: transparent !important;
  border: none !important;
}
.row--team-total .cell--total {
  border-left: 1px solid var(--color-border-light) !important;
  border-right: 1px solid var(--color-border-light) !important;
}
.row--team-total .sticky-col {
  background: transparent;
}
.team-total-value {
  font-size: 2.5rem;
  vertical-align: middle;
  position: relative;
}

/* Placement medal */
.placement-medal {
  position: absolute;
  top: 0.15rem;
  right: 0.2rem;
  font-size: 1.1rem;
  line-height: 1;
}

/* On-time tick */
.on-time {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  margin-left: 0.75rem;
  cursor: pointer;
  vertical-align: middle;
}
.on-time-box {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 0.9rem;
  height: 0.9rem;
  border-radius: 2px;
  font-size: 0.65rem;
  border: 1px solid var(--color-text-faint);
  color: transparent;
  transition: all 0.15s;
}
.on-time--active .on-time-box {
  color: var(--color-bg);
  border-color: var(--color-no-jump);
}
.on-time-label {
  font-size: 0.65rem;
  font-weight: 400;
  color: var(--color-no-jump);
  text-transform: lowercase;
}

/* No-jump row */
.row--no-jump {
  border-top: none;
}
.row--no-jump .sticky-col {
  background: transparent !important;
  border: none !important;
}
.no-jump-label {
  font-weight: 600;
  color: var(--color-text-muted);
  font-size: 0.75rem;
  text-align: right !important;
}
.no-jump-total {
  background: transparent !important;
  border: none !important;
}
.cell--no-jump {
  cursor: pointer;
  user-select: none;
  color: var(--color-text-muted);
  font-weight: 700;
}
.cell--no-jump:hover {
  outline: 2px solid var(--color-text-faint);
  outline-offset: -2px;
}
.cell--no-jump-active {
  background: repeating-linear-gradient(
    -45deg,
    var(--color-grey-stripe-a),
    var(--color-grey-stripe-a) 3px,
    var(--color-grey-stripe-b) 3px,
    var(--color-grey-stripe-b) 6px
  ) !important;
  opacity: 0.6;
}

/* Cell values */
.cell {
  cursor: pointer;
  user-select: none;
  font-weight: 700;
}
.cell:hover {
  outline: 2px solid var(--color-accent);
  outline-offset: -2px;
}

/* Crosshair highlight — quizzer name + question header only */
.row--quizzer:hover > .col--name,
.col--name--active {
  outline: 2px solid var(--color-border);
  outline-offset: -2px;
}
.col--question.col--hover {
  outline: 2px solid var(--color-border);
  outline-offset: -2px;
}

.cell--correct {
  color: var(--color-bg);
  background-color: var(--color-correct) !important;
}
.cell--error {
  color: var(--color-bg);
  background-color: var(--color-error) !important;
}
.cell--foul {
  color: var(--color-bg);
  background-color: var(--color-foul) !important;
}
.cell--bonus {
  color: var(--color-bg);
  background-color: var(--color-bonus) !important;
}
.cell--missed-bonus {
  color: var(--color-bg);
  background-color: var(--color-missed-bonus) !important;
}

/* Column enter transition — col--entering is the collapsed initial state,
 * removed on the next frame so the cell transitions to its natural size.
 * Leaving columns are removed from the DOM instantly (no leave animation).
 */
.col--entering {
  width: 0 !important;
  max-width: 0 !important;
  min-width: 0 !important;
  padding: 0 !important;
  border: none !important;
  overflow: hidden;
  opacity: 0;
  font-size: 0 !important;
  line-height: 0 !important;
}

/* Shared transition for column enter/leave animation + cell background */
.scoresheet th,
.scoresheet td {
  transition: width 0.3s ease, max-width 0.3s ease, min-width 0.3s ease,
              padding 0.3s ease, opacity 0.3s ease, border 0.3s ease,
              font-size 0.3s ease, line-height 0.3s ease, background-color 0.1s;
}

.cell--greyed {
  background: repeating-linear-gradient(
    -45deg,
    var(--color-grey-stripe-a),
    var(--color-grey-stripe-a) 3px,
    var(--color-grey-stripe-b) 3px,
    var(--color-grey-stripe-b) 6px
  ) !important;
  cursor: default;
  opacity: 0.6;
}
.cell--greyed:hover {
  outline: none;
}

.cell--invalid {
  outline: 2px solid var(--color-invalid);
  outline-offset: -2px;
  animation: pulse-invalid 1.5s ease-in-out infinite;
}
@keyframes pulse-invalid {
  0%, 100% { outline-color: var(--color-invalid); }
  50% { outline-color: var(--color-invalid-light); }
}

/* Running total badges */
.running-total-badge {
  position: absolute;
  top: 0;
  right: 0;
  font-size: 0.6rem;
  font-weight: 700;
  padding: 0.05rem 0.2rem;
  border-radius: 3px;
  line-height: 1.3;
  color: var(--color-bg);
  pointer-events: none;
}
.running-total-badge--unique {
  background: var(--color-correct);
}
.running-total-badge--quizout {
  background: var(--color-correct);
}
.running-total-badge--free-error {
  background: var(--color-bg-warm);
  color: var(--color-error);
}
.running-total-badge--foul-deduct {
  background: var(--color-foul);
  right: auto;
  left: 0;
}

/* Team status indicators */
.team-stats {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  float: right;
}

/* Quizzer status indicators */
.quizzer-name {
  margin-right: 0.25rem;
}
.quizzer-stats {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  margin-left: auto;
  float: right;
}

/* Out badges (Q, E, F) */
.stat-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.1rem;
  height: 1.1rem;
  border-radius: 50%;
  font-size: 0.6rem;
  font-weight: 800;
  line-height: 1;
  color: var(--color-bg);
}
.stat-badge--quizout {
  background: var(--color-correct);
}
.stat-badge--quizout-bonus {
  background: var(--color-correct);
  box-shadow: 0 0 0 2px var(--color-correct-light);
}
.stat-badge--errorout {
  background: var(--color-error);
}
.stat-badge--foulout {
  background: var(--color-foul);
}
.stat-badge--unique {
  background: var(--color-correct);
  border-radius: 4px;
  width: auto;
  padding: 0 0.3rem;
  font-size: 0.55rem;
}

/* Running count chips (1c, 2e, 1f) */
.stat-count {
  font-size: 0.6rem;
  font-weight: 700;
  padding: 0.05rem 0.25rem;
  border-radius: 3px;
  line-height: 1.2;
}
.stat-count--correct {
  color: var(--color-correct);
  background: var(--color-correct-light);
}
.stat-count--error {
  color: var(--color-error);
  background: var(--color-error-light);
}
.stat-count--foul {
  color: var(--color-foul);
  background: var(--color-foul-light);
}


</style>

<style>
/* Cell selector popup (unscoped for Teleport) */
.selector-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
}

.selector-popup {
  position: fixed;
  transform: translateX(-50%);
  display: flex;
  gap: 2px;
  padding: 3px;
  background: var(--color-bg);
  border: 1px solid var(--color-border-light);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 101;
}

.selector-opt {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 1.8rem;
  border: none;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.1s;
  background: var(--color-bg);
}
.selector-opt:hover {
  transform: scale(1.1);
}

.opt--correct {
  color: var(--color-correct);
}
.opt--correct:hover {
  background: var(--color-correct);
  color: var(--color-bg);
}
.opt--error {
  color: var(--color-error);
}
.opt--error:hover {
  background: var(--color-error);
  color: var(--color-bg);
}
.opt--foul {
  color: var(--color-foul);
}
.opt--foul:hover {
  background: var(--color-foul);
  color: var(--color-bg);
}
.opt--bonus {
  color: var(--color-bonus);
}
.opt--bonus:hover {
  background: var(--color-bonus);
  color: var(--color-bg);
}
.opt--missed-bonus {
  color: var(--color-missed-bonus);
}
.opt--missed-bonus:hover {
  background: var(--color-missed-bonus);
  color: var(--color-bg);
}
.opt--clear {
  color: var(--color-no-jump);
}
.opt--clear:hover {
  background: var(--color-border-light);
}
</style>
