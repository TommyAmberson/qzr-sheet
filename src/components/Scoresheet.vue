<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { CellValue, QuestionType } from '../types/scoresheet'
import { useScoresheet } from '../composables/useScoresheet'

const {
  columns, quiz, teams, teamQuizzers, cells, noJumps, scoring, setCell, toggleNoJump,
  isBonusForTeam, isGreyedOut, isInvalid, isAfterOut, isFouledOnQuestion,
  teamHasErrors, hasAnyErrors, colAnswerValue, noJumpHasConflict,
  visibleColumns, allQuestionsComplete,
  validationErrors,
} = useScoresheet()

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
  const col = columns[ci]
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


/** Columns actually rendered — includes departing columns during shrink animation */
const displayColumns = ref(visibleColumns.value.map(vc => ({ ...vc, entering: false, leaving: false })))

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
  const currKeys = new Set(curr.map(({ col }) => col.key))
  const prev = prevVisibleKeys

  // Detect entering column keys
  const enteringKeys = new Set<string>()
  for (const { col } of curr) {
    if (!prev.has(col.key)) enteringKeys.add(col.key)
  }

  // Detect leaving columns — were in prev but not in curr
  const leavingEntries: { col: typeof columns[0]; idx: number }[] = []
  for (const dc of displayColumns.value) {
    if (!currKeys.has(dc.col.key) && prev.has(dc.col.key)) {
      leavingEntries.push({ col: dc.col, idx: dc.idx })
    }
  }

  prevVisibleKeys = currKeys

  // Build new display list: current visible + leaving columns in their original position
  const result = curr.map(vc => ({
    ...vc,
    entering: enteringKeys.has(vc.col.key),
    leaving: false,
  }))
  for (const le of leavingEntries) {
    const insertAt = result.findIndex(r => r.idx > le.idx)
    const entry = { col: le.col, idx: le.idx, entering: false, leaving: true }
    if (insertAt === -1) result.push(entry)
    else result.splice(insertAt, 0, entry)
  }
  displayColumns.value = result

  // Entering columns: start collapsed, then expand on next frame
  if (enteringKeys.size > 0) {
    requestAnimationFrame(() => {
      displayColumns.value = displayColumns.value.map(dc => ({
        ...dc,
        entering: false,
      }))
    })
  }
})

/** Remove a leaving column from displayColumns after its transition ends */
function onColTransitionEnd(event: TransitionEvent, colKey: string) {
  // Only react to max-width transitions to avoid double-firing
  if (event.propertyName !== 'max-width') return
  displayColumns.value = displayColumns.value.filter(dc => !(dc.leaving && dc.col.key === colKey))
}

const headerAnswerClass: Record<CellValue, string> = {
  [CellValue.Correct]: 'col--header-correct',
  [CellValue.Error]: 'col--header-error',
  [CellValue.Foul]: '',
  [CellValue.Bonus]: 'col--header-bonus',
  [CellValue.MissedBonus]: 'col--header-missed-bonus',
  [CellValue.Empty]: '',
}

function headerClass(colIdx: number): string {
  const answer = headerAnswerClass[colAnswerValue(colIdx)]
  if (answer) return answer
  if (noJumps.value[colIdx]) return 'col--header-no-jump'
  return ''
}

/** Column CSS class for visual grouping (no animation — that's on the display entry) */
function colGroupClass(colIdx: number): string {
  const col = columns[colIdx]
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
    </div>

    <table class="scoresheet">
      <!-- Question header row -->
      <thead>
        <tr>
          <th class="col--name sticky-col"></th>
          <th
            v-for="{ col, idx, entering, leaving } in displayColumns"
            :key="col.key"
            :class="['col--question', colGroupClass(idx), headerClass(idx), { 'col--entering': entering, 'col--leaving': leaving }]"
            @transitionend="leaving ? onColTransitionEnd($event, col.key) : undefined"
          >
            {{ col.label }}
          </th>
          <th class="col--total col--total-header"></th>
        </tr>
        <tr class="spacer-row">
          <td class="sticky-col"></td>
          <td v-for="{ col, idx, entering, leaving } in displayColumns" :key="col.key" :class="['spacer-cell', colGroupClass(idx), { 'col--entering': entering, 'col--leaving': leaving }]"></td>
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
              v-for="{ col, entering, leaving } in displayColumns"
              :key="col.key"
              :class="['team-header-spacer', { 'col--entering': entering, 'col--leaving': leaving }]"
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
            <td class="col--name sticky-col">
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
              v-for="{ col, idx, entering, leaving } in displayColumns"
              :key="col.key"
              :class="[
                'cell',
                cellClass[cells[ti][qi][idx]],
                colGroupClass(idx),
                { 'cell--greyed': ((isGreyedOut(ti, idx) || noJumps[idx]) && cells[ti][qi][idx] === '') || isAfterOut(ti, qi, idx) || (isFouledOnQuestion(ti, qi, idx) && cells[ti][qi][idx] === '') },
                { 'cell--invalid': isInvalid(ti, qi, idx) },
                { 'col--entering': entering, 'col--leaving': leaving },
              ]"
              @click="openSelector(ti, qi, idx, $event)"
            >
              {{ cellDisplay[cells[ti][qi][idx]] }}
            </td>
            <!-- Team total spans quizzer rows only -->
            <td
              v-if="qi === 0"
              :class="['col--total', 'team-total-value', { 'cell--invalid': teamHasErrors(ti) }]"
              :rowspan="teamQuizzers[ti]?.length ?? 5"
            >
              {{ scoring[ti]?.total ?? 0 }}
            </td>
          </tr>

          <!-- Team running total row -->
          <tr class="row--team-total">
            <td class="col--name sticky-col"></td>
            <td
              v-for="{ col, idx, entering, leaving } in displayColumns"
              :key="col.key"
              :class="['cell--total', colGroupClass(idx), { 'col--entering': entering, 'col--leaving': leaving }]"
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
            <td v-for="{ col, idx, entering, leaving } in displayColumns" :key="col.key" :class="['spacer-cell', colGroupClass(idx), { 'col--entering': entering, 'col--leaving': leaving }]"></td>
            <td></td>
          </tr>
        </template>
      </tbody>

      <!-- No-jump row at bottom -->
      <tfoot>
        <tr class="spacer-row">
          <td class="sticky-col"></td>
          <td v-for="{ col, idx, entering, leaving } in displayColumns" :key="col.key" :class="['spacer-cell', colGroupClass(idx), { 'col--entering': entering, 'col--leaving': leaving }]"></td>
          <td></td>
        </tr>
        <tr class="row--no-jump">
          <td class="col--name sticky-col no-jump-label">No Jump</td>
          <td
            v-for="{ col, idx, entering, leaving } in displayColumns"
            :key="col.key"
            :class="['cell cell--no-jump', colGroupClass(idx), { 'cell--no-jump-active': noJumps[idx], 'cell--invalid': noJumpHasConflict(idx), 'col--entering': entering, 'col--leaving': leaving }]"
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
  gap: 0.6rem;
  align-items: center;
  margin-bottom: 0.5rem;
  padding: 0.4rem 0.75rem;
  background: #ffff99;
  border-radius: 6px;
  width: fit-content;
  color: #2d2a1e;
  font-family: 'Segoe UI', system-ui, sans-serif;
  font-size: 0.8rem;
  transition: background 0.4s, color 0.4s;
}

.quiz-meta--error {
  background: #9e3030;
  color: #fee2e2;
}

.quiz-meta--complete {
  background: #15803d;
  color: #dcfce7;
}

.meta-sep {
  color: #b8a030;
  font-size: 1rem;
  user-select: none;
}

.meta-field {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.meta-label {
  font-size: 0.75rem;
  font-weight: 500;
  color: #5c5630;
}

.meta-field input[type='number'] {
  width: 2.5rem;
  padding: 0.15rem 0.3rem;
  border: 1px solid #bbb060;
  border-radius: 4px;
  font-size: 0.8rem;
  text-align: center;
  background: #fff;
  color: #2d2a1e;
}
.meta-field input[type='number']:focus {
  outline: 1px solid #3b82f6;
  outline-offset: 0;
  border-color: #3b82f6;
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
  background: #bbb060;
  border-radius: 999px;
  position: relative;
  transition: background 0.2s;
}
.meta-field--toggle input:checked + .toggle-track {
  background: #3b82f6;
}
.toggle-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: calc(1rem - 4px);
  height: calc(1rem - 4px);
  background: #fff;
  border-radius: 50%;
  transition: transform 0.2s;
}
.meta-field--toggle input:checked + .toggle-track .toggle-thumb {
  transform: translateX(calc(1.75rem - 1rem));
}
.meta-field--toggle .meta-label {
  font-size: 0.75rem;
  color: #5c5630;
}
.meta-field--toggle input:checked ~ .meta-label {
  color: #2d2a1e;
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
  border: 1px solid #a09a85;
  padding: 0.25rem 0.4rem;
  text-align: center;
  min-width: 2rem;
  height: 1.8rem;
  background: #fff;
}


/* Sticky first column */
.sticky-col {
  position: sticky;
  left: 0;
  z-index: 2;
  background: #fff;
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
  background: #ddd8c4;
}
.col--total-header {
  background: transparent !important;
  border: none !important;
}

/* Column group shading */
.col--ab {
  background-color: #fefce811;
}

.col--overtime {
  background-color: #fdf2f811;
}

/* Spacer row — half-height transparent gap */
.spacer-row td {
  height: 0.5rem;
  padding: 0 !important;
  border: none !important;
  background: transparent !important;
}
.spacer-row .spacer-cell {
  border-left: 1px solid #e0ddd4 !important;
  border-right: 1px solid #e0ddd4 !important;
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
  color: #2d2a1e;
  font-size: 0.75rem;
  border: none;
  border-top: 1px solid #e0ddd4;
  border-left: 1px solid #e0ddd4;
  border-right: 1px solid #e0ddd4;
}
.col--question.col--ab {
  border-top: 2px solid #854d0e;
}
.col--question.col--overtime {
  border-top: 2px solid #9d174d;
}

/* Question header colours based on answer */
.col--header-correct {
  color: #15803d !important;
}
.col--header-error {
  color: #9e3030 !important;
}
.col--header-bonus {
  color: #2a7a8a !important;
}
.col--header-missed-bonus {
  color: #8a8070 !important;
}
.col--header-no-jump {
  color: #a8a290 !important;
  text-decoration: line-through;
}

/* Team header row */
.row--team-header {
  background: transparent;
  color: #f5f5f0;
}
.team-header-spacer {
  background: transparent !important;
  border: none !important;
  border-left: 1px solid #e0ddd4 !important;
  border-right: 1px solid #e0ddd4 !important;
}
.team-score-label {
  background: transparent !important;
  color: #2d2a1e;
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
  background: #2d2a1e;
  color: #f5f5f0;
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
  border: 1px solid #78716c;
}
.row--team-header.team--red .team-name::before {
  background: #9e3030;
}
.row--team-header.team--white .team-name::before {
  background: #f5f5f0;
}
.row--team-header.team--blue .team-name::before {
  background: #2563eb;
}

/* Quizzer rows */
.row--quizzer:hover {
  background: #f5f3ed;
}

/* Team total row */
.row--team-total {
  background: transparent;
  font-weight: 600;
  font-size: 0.75rem;
  font-style: italic;
  color: #57534e;
}
.row--team-total td {
  background: transparent !important;
  border: none !important;
}
.row--team-total .cell--total {
  border-left: 1px solid #e0ddd4 !important;
  border-right: 1px solid #e0ddd4 !important;
}
.row--team-total .sticky-col {
  background: transparent;
}
.team-total-value {
  font-size: 2.5rem;
  vertical-align: middle;
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
  border: 1px solid #78716c;
  color: transparent;
  transition: all 0.15s;
}
.on-time--active .on-time-box {
  color: #fff;
  border-color: #a8a290;
}
.on-time-label {
  font-size: 0.65rem;
  font-weight: 400;
  color: #a8a290;
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
  color: #57534e;
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
  color: #57534e;
  font-weight: 700;
}
.cell--no-jump:hover {
  outline: 2px solid #78716c;
  outline-offset: -2px;
}
.cell--no-jump-active {
  background: repeating-linear-gradient(
    -45deg,
    #e8e4d4,
    #e8e4d4 3px,
    #d5d0be 3px,
    #d5d0be 6px
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
  outline: 2px solid #3b82f6;
  outline-offset: -2px;
}

.cell--correct {
  color: #fff;
  background-color: #15803d !important;
}
.cell--error {
  color: #fff;
  background-color: #9e3030 !important;
}
.cell--foul {
  color: #fff;
  background-color: #b86e30 !important;
}
.cell--bonus {
  color: #fff;
  background-color: #2a7a8a !important;
}
.cell--missed-bonus {
  color: #fff;
  background-color: #8a8070 !important;
}

/* Column enter/leave transitions — driven by class toggle, not keyframes.
 * col--entering = initial collapsed state (added on insert, removed next frame)
 * col--leaving  = collapsed target state (added when column departs, removed on transitionend)
 */
.col--entering,
.col--leaving {
  max-width: 0 !important;
  min-width: 0 !important;
  padding-left: 0 !important;
  padding-right: 0 !important;
  border-left-width: 0 !important;
  border-right-width: 0 !important;
  border-color: transparent !important;
  overflow: hidden;
  opacity: 0;
}
.col--leaving {
  pointer-events: none;
}

/* Shared transition for column enter/leave animation + cell background */
.scoresheet th,
.scoresheet td {
  transition: max-width 0.3s ease, min-width 0.3s ease, padding 0.3s ease,
              border-width 0.3s ease, border-color 0.3s ease, opacity 0.3s ease,
              background-color 0.1s;
}

.cell--greyed {
  background: repeating-linear-gradient(
    -45deg,
    #e8e4d4,
    #e8e4d4 3px,
    #d5d0be 3px,
    #d5d0be 6px
  ) !important;
  cursor: default;
  opacity: 0.6;
}
.cell--greyed:hover {
  outline: none;
}

.cell--invalid {
  outline: 2px solid #ef4444;
  outline-offset: -2px;
  animation: pulse-invalid 1.5s ease-in-out infinite;
}
@keyframes pulse-invalid {
  0%, 100% { outline-color: #ef4444; }
  50% { outline-color: #fca5a5; }
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
  color: #fff;
  pointer-events: none;
}
.running-total-badge--unique {
  background: #15803d;
}
.running-total-badge--quizout {
  background: #15803d;
}
.running-total-badge--free-error {
  background: #f0e8e0;
  color: #9e3030;
}
.running-total-badge--foul-deduct {
  background: #b86e30;
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
  color: #fff;
}
.stat-badge--quizout {
  background: #15803d;
}
.stat-badge--quizout-bonus {
  background: #15803d;
  box-shadow: 0 0 0 2px #dcfce7;
}
.stat-badge--errorout {
  background: #9e3030;
}
.stat-badge--foulout {
  background: #b86e30;
}
.stat-badge--unique {
  background: #15803d;
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
  color: #15803d;
  background: #dcfce7;
}
.stat-count--error {
  color: #9e3030;
  background: #fee2e2;
}
.stat-count--foul {
  color: #b86e30;
  background: #fef3c7;
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
  background: #fff;
  border: 1px solid #cbd5e1;
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
  background: #f8fafc;
}
.selector-opt:hover {
  transform: scale(1.1);
}

.opt--correct {
  color: #15803d;
}
.opt--correct:hover {
  background: #15803d;
  color: #fff;
}
.opt--error {
  color: #9e3030;
}
.opt--error:hover {
  background: #9e3030;
  color: #fff;
}
.opt--foul {
  color: #b86e30;
}
.opt--foul:hover {
  background: #b86e30;
  color: #fff;
}
.opt--bonus {
  color: #2a7a8a;
}
.opt--bonus:hover {
  background: #2a7a8a;
  color: #fff;
}
.opt--missed-bonus {
  color: #8a8070;
}
.opt--missed-bonus:hover {
  background: #8a8070;
  color: #fff;
}
.opt--clear {
  color: #94a3b8;
}
.opt--clear:hover {
  background: #e2e8f0;
}
</style>
