<script setup lang="ts">
import { useScoresheet } from '@/composables/useScoresheet'
import {
  NORMAL_QUESTIONS,
  AB_QUESTIONS,
  OVERTIME_QUESTIONS,
  ALL_QUESTIONS,
  CellValue,
  QuestionPart,
  questionKey,
  type QuestionColumn,
} from '@/types/scoresheet'

const { sheet, getCell, cycleCell } = useScoresheet()

function cellDisplay(val: CellValue): string {
  switch (val) {
    case CellValue.Correct:
      return 'c'
    case CellValue.Error:
      return 'e'
    case CellValue.Foul:
      return 'f'
    case CellValue.Bonus:
      return 'b'
    case CellValue.MissedBonus:
      return 'mb'
    default:
      return ''
  }
}

function cellClass(val: CellValue): string {
  switch (val) {
    case CellValue.Correct:
      return 'cell-correct'
    case CellValue.Error:
      return 'cell-error'
    case CellValue.Foul:
      return 'cell-foul'
    case CellValue.Bonus:
      return 'cell-bonus'
    case CellValue.MissedBonus:
      return 'cell-missed-bonus'
    default:
      return ''
  }
}

function isABColumn(col: QuestionColumn): boolean {
  return col.part === QuestionPart.A || col.part === QuestionPart.B
}

/** Column header: "1", "16", "A", "B" */
function colNumberLabel(col: QuestionColumn): string {
  if (col.part !== QuestionPart.Normal) return col.part
  return String(col.number)
}

/** Sub-header for A/B rows: show number only on the Normal column */
function colPartLabel(col: QuestionColumn): string {
  if (col.part === QuestionPart.Normal) return ''
  return col.part
}

/**
 * Question section spans:
 * - Normal 1-15: 15 cols
 * - AB 16-20: 5 questions × 3 cols = 15 cols
 * - OT 21-26: 6 questions × 3 cols = 18 cols
 */
</script>

<template>
  <div class="scoresheet-wrapper">
    <!-- Quiz meta header -->
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
        <!-- ═══ Column group header row (sections) ═══ -->
        <thead>
          <tr class="section-header">
            <th class="corner" :colspan="2"><!-- Quizzer label col --></th>
            <th :colspan="NORMAL_QUESTIONS.length" class="section-normal">Questions</th>
            <th :colspan="AB_QUESTIONS.length" class="section-ab">Error Points (16–20)</th>
            <th :colspan="OVERTIME_QUESTIONS.length" class="section-ot">Overtime (21–26)</th>
            <th class="section-total">Total</th>
          </tr>

          <!-- ═══ Question number row ═══ -->
          <tr class="q-number-row">
            <th class="corner" :colspan="2"></th>
            <template v-for="col in ALL_QUESTIONS" :key="questionKey(col)">
              <th
                class="q-header"
                :class="{
                  'ab-col': isABColumn(col),
                  'ot-col': col.number >= 21,
                }"
              >
                {{ colNumberLabel(col) }}
              </th>
            </template>
            <th></th>
          </tr>

          <!-- ═══ A/B sub-header row ═══ -->
          <tr class="ab-subheader-row">
            <th class="corner" :colspan="2"></th>
            <template v-for="col in ALL_QUESTIONS" :key="'ab-' + questionKey(col)">
              <th
                class="q-sub-header"
                :class="{ 'ab-col': isABColumn(col) }"
              >
                {{ colPartLabel(col) }}
              </th>
            </template>
            <th></th>
          </tr>
        </thead>

        <!-- ═══ Per-team blocks ═══ -->
        <tbody
          v-for="(team, tIdx) in sheet.teams"
          :key="team.id"
          class="team-block"
        >
          <!-- Team name row -->
          <tr class="team-header-row">
            <td colspan="2" class="team-name-cell">
              <input
                v-model="team.name"
                class="team-name-input"
                :placeholder="'Team ' + (tIdx + 1)"
              />
              <label class="ontime-label">
                <input type="checkbox" v-model="team.onTime" />
                On Time
              </label>
            </td>
            <!-- Empty question cells for team header -->
            <td
              v-for="col in ALL_QUESTIONS"
              :key="'th-' + questionKey(col)"
              class="team-header-cell"
              :class="{ 'ab-col': isABColumn(col) }"
            ></td>
            <td class="team-header-cell"></td>
          </tr>

          <!-- Quizzer rows -->
          <tr
            v-for="(quizzer, qIdx) in team.quizzers"
            :key="quizzer.id"
            class="quizzer-row"
          >
            <td class="quizzer-num">{{ qIdx + 1 }}</td>
            <td class="quizzer-name-cell">
              <input
                v-model="quizzer.name"
                class="quizzer-name-input"
                :placeholder="'Quizzer ' + (qIdx + 1)"
              />
            </td>
            <td
              v-for="col in ALL_QUESTIONS"
              :key="questionKey(col)"
              class="answer-cell"
              :class="[
                cellClass(getCell(tIdx, qIdx, col)),
                { 'ab-col': isABColumn(col), 'ot-col': col.number >= 21 },
              ]"
              @click="cycleCell(tIdx, qIdx, col)"
            >
              {{ cellDisplay(getCell(tIdx, qIdx, col)) }}
            </td>
            <!-- Score column (placeholder) -->
            <td class="score-cell">
              <template v-if="qIdx === 0">Score</template>
            </td>
          </tr>

          <!-- Running score row -->
          <tr class="score-row">
            <td colspan="2" class="score-label">Score</td>
            <td
              v-for="col in ALL_QUESTIONS"
              :key="'s-' + questionKey(col)"
              class="running-score"
              :class="{ 'ab-col': isABColumn(col) }"
            >
              <!-- TODO: computed running totals -->
            </td>
            <td class="total-score">
              <!-- TODO: total -->
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
/* ── Layout ── */
.scoresheet-wrapper {
  padding: 8px;
  font-family: 'Segoe UI', system-ui, sans-serif;
  font-size: 13px;
}

.meta-bar {
  display: flex;
  gap: 16px;
  margin-bottom: 8px;
  align-items: center;
}

.meta-input {
  width: 48px;
  margin-left: 4px;
  text-align: center;
}

.table-scroll {
  overflow-x: auto;
}

/* ── Table ── */
.scoresheet {
  border-collapse: collapse;
  white-space: nowrap;
}

.scoresheet th,
.scoresheet td {
  border: 1px solid #999;
  padding: 2px 4px;
  text-align: center;
  min-width: 28px;
  height: 26px;
}

/* Corner / label columns */
.corner {
  background: #e8e8e8;
}

/* ── Section headers ── */
.section-header th {
  font-weight: 600;
  padding: 4px 6px;
}

.section-normal {
  background: #dbeafe;
}

.section-ab {
  background: #fef3c7;
}

.section-ot {
  background: #ede9fe;
}

.section-total {
  background: #e8e8e8;
}

/* ── Question headers ── */
.q-header,
.q-sub-header {
  font-weight: 600;
  font-size: 12px;
  background: #f5f5f5;
}

.ab-col {
  background: #fffbeb;
}

.ot-col {
  background: #f5f3ff;
}

.ab-subheader-row .q-sub-header {
  font-size: 11px;
  color: #888;
  height: 20px;
}

/* ── Team blocks ── */
.team-block {
  border-top: 3px solid #333;
}

.team-header-row {
  background: #f0f0f0;
}

.team-name-cell {
  text-align: left;
  padding: 4px 6px;
  display: flex;
  align-items: center;
  gap: 12px;
  border: none;
}

.team-name-input {
  font-weight: 600;
  font-size: 13px;
  border: 1px solid transparent;
  background: transparent;
  width: 160px;
  padding: 2px 4px;
}

.team-name-input:hover,
.team-name-input:focus {
  border-color: #aaa;
  background: #fff;
}

.team-header-cell {
  background: #f0f0f0;
}

.ontime-label {
  font-size: 11px;
  color: #666;
  display: flex;
  align-items: center;
  gap: 3px;
}

/* ── Quizzer rows ── */
.quizzer-num {
  width: 24px;
  font-weight: 600;
  color: #666;
  background: #f9f9f9;
}

.quizzer-name-cell {
  text-align: left;
  min-width: 140px;
}

.quizzer-name-input {
  border: 1px solid transparent;
  background: transparent;
  width: 100%;
  padding: 2px 4px;
  font-size: 13px;
}

.quizzer-name-input:hover,
.quizzer-name-input:focus {
  border-color: #aaa;
  background: #fff;
}

/* ── Answer cells ── */
.answer-cell {
  cursor: pointer;
  user-select: none;
  font-weight: 700;
  font-size: 12px;
  transition: background 0.1s;
}

.answer-cell:hover {
  background: #e0e7ff;
}

.cell-correct {
  background: #bbf7d0 !important;
  color: #166534;
}

.cell-error {
  background: #fecaca !important;
  color: #991b1b;
}

.cell-foul {
  background: #fed7aa !important;
  color: #9a3412;
}

.cell-bonus {
  background: #bfdbfe !important;
  color: #1e40af;
}

.cell-missed-bonus {
  background: #e9d5ff !important;
  color: #6b21a8;
}

/* ── Score rows ── */
.score-row {
  background: #f9fafb;
  font-weight: 600;
}

.score-label {
  text-align: right;
  padding-right: 8px;
}

.score-cell {
  font-size: 11px;
  color: #666;
  font-weight: 600;
}

.running-score {
  font-size: 12px;
}

.total-score {
  font-weight: 700;
  font-size: 14px;
  background: #f0f0f0;
}
</style>
