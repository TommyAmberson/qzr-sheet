<script setup lang="ts">
import { ref, computed } from 'vue'
import {
  Answer,
  buildColumns,
  emptyScoresheet,
  type ColumnDef,
  type ColumnKey,
  type Scoresheet,
  type TeamBlock,
} from '../types/scoresheet'

const ANSWER_CYCLE: Answer[] = [Answer.Empty, Answer.Correct, Answer.Error, Answer.Foul]
const BONUS_CYCLE: Answer[] = [Answer.Empty, Answer.Bonus, Answer.MissedBonus]

const columns = buildColumns()
const sheet = ref<Scoresheet>(emptyScoresheet())

// --- Column grouping helpers for the header ---

/** Questions 1-15 (normal, single column each) */
const normalColumns = computed(() => columns.filter((c) => c.question <= 15))

/** Question 16 columns (base + A + B, not error points) */
const q16Columns = computed(() => columns.filter((c) => c.question === 16))

/** Questions 17-20 "Error Points" (base + A + B each) */
const errorPointColumns = computed(() =>
  columns.filter((c) => c.question >= 17 && c.question <= 20),
)

/** Questions 21-26 "Overtime" (base + A + B each) */
const overtimeColumns = computed(() => columns.filter((c) => c.question >= 21))

function isErrorPoints(col: ColumnDef) {
  return col.question >= 17 && col.question <= 20
}

function isOvertime(col: ColumnDef) {
  return col.question >= 21
}

// --- Cell interaction ---

function cycleAnswer(team: TeamBlock, quizzerIdx: number, key: ColumnKey) {
  const quizzer = team.quizzers[quizzerIdx]
  const current = quizzer.answers[key] ?? Answer.Empty
  const cycle = ANSWER_CYCLE
  const idx = cycle.indexOf(current)
  const next = cycle[(idx + 1) % cycle.length]
  if (next === Answer.Empty) {
    delete quizzer.answers[key]
  } else {
    quizzer.answers[key] = next
  }
}

function rightClickAnswer(event: MouseEvent, team: TeamBlock, quizzerIdx: number, key: ColumnKey) {
  event.preventDefault()
  const quizzer = team.quizzers[quizzerIdx]
  const current = quizzer.answers[key] ?? Answer.Empty
  // Right-click cycles through bonus types
  const cycle = BONUS_CYCLE
  const idx = cycle.indexOf(current)
  const next = cycle[(idx + 1) % cycle.length]
  if (next === Answer.Empty) {
    delete quizzer.answers[key]
  } else {
    quizzer.answers[key] = next
  }
}

// --- Display helpers ---

function cellDisplay(answer: Answer | undefined): string {
  if (!answer || answer === Answer.Empty) return ''
  const map: Record<string, string> = {
    [Answer.Correct]: 'C',
    [Answer.Error]: 'E',
    [Answer.Foul]: 'F',
    [Answer.Bonus]: 'B',
    [Answer.MissedBonus]: 'MB',
  }
  return map[answer] ?? ''
}

function cellClass(answer: Answer | undefined): string {
  if (!answer || answer === Answer.Empty) return ''
  return `cell-${answer}`
}

function teamScore(_team: TeamBlock): number {
  // Placeholder — scoring logic will come later
  return 0
}

function quizzerScore(_team: TeamBlock, _quizzerIdx: number): number {
  return 0
}
</script>

<template>
  <div class="scoresheet-wrapper">
    <!-- Quiz meta bar -->
    <div class="meta-bar">
      <label>
        Div
        <input v-model.number="sheet.meta.division" type="number" min="1" class="meta-input" />
      </label>
      <label>
        Quiz
        <input v-model.number="sheet.meta.quizNumber" type="number" min="1" class="meta-input" />
      </label>
    </div>

    <div class="table-scroll">
      <table class="scoresheet">
        <!-- ======= HEADER ======= -->
        <thead>
          <!-- Row 1: Section headers -->
          <tr class="header-sections">
            <th rowspan="2" colspan="2" class="section-header section-hidden"></th>
            <th :colspan="normalColumns.length + q16Columns.length" class="section-header"></th>
            <th :colspan="errorPointColumns.length" class="section-header section-error-points">
              Error Points
            </th>
            <th :colspan="overtimeColumns.length" class="section-header section-overtime">
              Overtime
            </th>
            <th rowspan="2" class="col-score">Score</th>
          </tr>
          <!-- Row 2: Individual column labels -->
          <tr class="header-numbers">
            <th
              v-for="col in columns"
              :key="col.key"
              class="col-q"
              :class="{
                'col-ab': !!col.part,
                'col-error-points': isErrorPoints(col),
                'col-overtime': isOvertime(col),
              }"
            >
              {{ col.label }}
            </th>
          </tr>
        </thead>

        <!-- ======= TEAM BLOCKS ======= -->
        <tbody v-for="(team, tIdx) in sheet.teams" :key="tIdx" class="team-block">
          <!-- Team name row -->
          <tr class="team-header-row">
            <td></td>
            <td class="team-name-cell">
              <input
                v-model="team.teamName"
                type="text"
                class="team-name-input"
                :placeholder="`Team ${tIdx + 1}`"
              />
            </td>
            <td v-for="col in columns" :key="col.key"></td>
            <td></td>
          </tr>

          <!-- Quizzer rows -->
          <tr v-for="(qzr, qIdx) in team.quizzers" :key="qIdx" class="quizzer-row">
            <td class="col-seat">{{ qzr.seat }}</td>
            <td class="col-name">
              <input
                v-model="qzr.name"
                type="text"
                class="quizzer-name-input"
                placeholder="Quizzer name"
              />
            </td>
            <td
              v-for="col in columns"
              :key="col.key"
              class="answer-cell"
              :class="[
                cellClass(qzr.answers[col.key]),
                {
                  'col-error-points': isErrorPoints(col),
                  'col-overtime': isOvertime(col),
                  'col-ab': !!col.part,
                },
              ]"
              @click="cycleAnswer(team, qIdx, col.key)"
              @contextmenu="rightClickAnswer($event, team, qIdx, col.key)"
            >
              {{ cellDisplay(qzr.answers[col.key]) }}
            </td>
            <td class="col-score score-value">{{ quizzerScore(team, qIdx) }}</td>
          </tr>

          <!-- Running score row -->
          <tr class="score-row">
            <td></td>
            <td class="score-label">Score</td>
            <td
              v-for="col in columns"
              :key="col.key"
              class="running-score-cell"
              :class="{
                'col-error-points': isErrorPoints(col),
                'col-overtime': isOvertime(col),
              }"
            >
              <!-- Running totals will go here -->
            </td>
            <td class="col-score total-score">{{ teamScore(team) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
/* ---- Layout ---- */
.scoresheet-wrapper {
  padding: 8px;
  font-family: 'Segoe UI', system-ui, sans-serif;
  font-size: 13px;
}

.meta-bar {
  display: flex;
  gap: 16px;
  margin-bottom: 8px;
  font-weight: 600;
}

.meta-input {
  width: 48px;
  margin-left: 4px;
  text-align: center;
}

.table-scroll {
  overflow-x: auto;
}

/* ---- Table ---- */
.scoresheet {
  border-collapse: collapse;
  table-layout: fixed;
  white-space: nowrap;
}

.scoresheet th,
.scoresheet td {
  border: 1px solid #999;
  padding: 2px 4px;
  text-align: center;
  height: 26px;
}

/* ---- Header ---- */
.header-sections th {
  background: #e2e8f0;
  font-weight: 700;
  position: sticky;
  top: 0;
  z-index: 2;
}

.section-header {
  font-weight: 700;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.section-hidden {
  border-style: hidden;
  background: transparent;
}

.section-error-points {
  background: #fefcbf;
}

.section-overtime {
  background: #ebf8ff;
}

.header-numbers th {
  background: #e2e8f0;
  font-weight: 700;
}

.col-q {
  width: 32px;
}

.col-ab {
  font-size: 11px;
  font-style: italic;
  color: #555;
}

/* ---- Columns ---- */
.col-seat {
  width: 24px;
  color: #718096;
  font-weight: 600;
}

.col-name {
  min-width: 140px;
  text-align: left;
}

.col-score {
  min-width: 48px;
  font-weight: 700;
  background: #fefcbf;
}

.col-error-points {
  background: #fffbeb;
}

.col-overtime {
  background: #ebf8ff;
}

/* ---- Team block ---- */
.team-block + .team-block {
  border-top: 3px solid #2d3748;
}

.team-header-row td {
  border-left: none;
  border-right: none;
  border-top: 1px solid #999;
  border-bottom: 1px solid #999;
  background: transparent;
}

.team-name-cell {
  text-align: left;
  font-weight: 700;
}

.team-name-input {
  border: none;
  background: transparent;
  font-weight: 700;
  font-size: 13px;
  width: 100%;
  padding: 2px;
}

/* ---- Quizzer rows ---- */
.quizzer-name-input {
  border: none;
  background: transparent;
  font-size: 13px;
  width: 100%;
  padding: 2px;
}

.answer-cell {
  cursor: pointer;
  user-select: none;
  font-weight: 700;
  transition: background-color 0.1s;
}

.answer-cell:hover {
  background: #edf2f7;
}

/* Cell type colours */
.cell-c {
  background: #c6f6d5;
  color: #276749;
}

.cell-e {
  background: #fed7d7;
  color: #9b2c2c;
}

.cell-f {
  background: #fefcbf;
  color: #975a16;
}

.cell-b {
  background: #bee3f8;
  color: #2a4365;
}

.cell-mb {
  background: #e9d8fd;
  color: #553c9a;
}

/* ---- Score rows ---- */
.score-row {
  background: #edf2f7;
  font-weight: 600;
}

.score-label {
  text-align: left;
  font-style: italic;
}

.score-value {
  font-weight: 600;
}

.total-score {
  font-size: 15px;
  font-weight: 800;
}

.running-score-cell {
  font-size: 11px;
  color: #4a5568;
}
</style>
