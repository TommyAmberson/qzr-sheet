<script setup lang="ts">
import { computed } from 'vue'
import { CellValue, QuestionType } from '../types/scoresheet'
import { useScoresheet } from '../composables/useScoresheet'

const { columns, teams, cells, noJumps, quizMeta, scoring, cycleCell, toggleNoJump, columnGroups } = useScoresheet()

/**
 * Determine which cells are greyed out.
 * Returns a Set of "teamIdx:colIdx" keys that should be disabled.
 */
const greyedOut = computed(() => {
  const disabled = new Set<string>()
  const teamCount = teams.value.length

  // Helper: does any quizzer on any team have a specific value at a column?
  function anyTeamHasValue(colIdx: number, value: CellValue): boolean {
    for (let ti = 0; ti < teamCount; ti++) {
      for (const row of cells.value[ti]!) {
        if (row[colIdx] === value) return true
      }
    }
    return false
  }

  // Helper: does any quizzer on a specific team have a value at a column?
  function teamHasValue(teamIdx: number, colIdx: number, value: CellValue): boolean {
    for (const row of cells.value[teamIdx]!) {
      if (row[colIdx] === value) return true
    }
    return false
  }

  // Helper: does any quizzer on a specific team have an answer (not foul) at a column?
  function teamHasAnswer(teamIdx: number, colIdx: number): boolean {
    for (const row of cells.value[teamIdx]!) {
      const v = row[colIdx]
      if (v !== CellValue.Empty && v !== CellValue.Foul) return true
    }
    return false
  }

  // Helper: does any quizzer on a specific team have a foul at a column?
  function teamHasFoul(teamIdx: number, colIdx: number): boolean {
    for (const row of cells.value[teamIdx]!) {
      if (row[colIdx] === CellValue.Foul) return true
    }
    return false
  }

  // Helper: does any team have an answer (C/E/B/MB, not foul) at a column?
  function anyTeamHasAnswer(colIdx: number): boolean {
    for (let ti = 0; ti < teamCount; ti++) {
      if (teamHasAnswer(ti, colIdx)) return true
    }
    return false
  }

  // Helper: grey out all teams at a column
  function greyAllTeams(colIdx: number) {
    for (let ti = 0; ti < teamCount; ti++) {
      disabled.add(`${ti}:${colIdx}`)
    }
  }

  // Build a map from column key to column index for quick lookup
  const keyToIdx = new Map<string, number>()
  columns.forEach((col, i) => keyToIdx.set(col.key, i))

  for (let ci = 0; ci < columns.length; ci++) {
    const col = columns[ci]!

    // 1. If a question has an answer (C/E/B/MB), it's done — grey out all teams
    //    on that column. Fouls don't count (question is re-asked).
    if (anyTeamHasAnswer(ci)) {
      greyAllTeams(ci)
    }

    // 2. If a base question (Normal) was answered (C/E/B/MB), grey out A and B
    if (col.type === QuestionType.Normal && col.isAB) {
      if (anyTeamHasAnswer(ci)) {
        const aIdx = keyToIdx.get(`${col.number}A`)
        const bIdx = keyToIdx.get(`${col.number}B`)
        if (aIdx !== undefined) greyAllTeams(aIdx)
        if (bIdx !== undefined) greyAllTeams(bIdx)
      }
    }

    // 3. If an A question was answered (C/E/B/MB), grey out B
    if (col.type === QuestionType.A) {
      if (anyTeamHasAnswer(ci)) {
        const bIdx = keyToIdx.get(`${col.number}B`)
        if (bIdx !== undefined) greyAllTeams(bIdx)
      }
    }

    // 4. Fouls: no greying — question is re-asked, any quizzer can still jump

    // 5. Toss-up: if a team had an error on this column, grey out the
    //    NEXT question column for that team
    for (let ti = 0; ti < teamCount; ti++) {
      if (teamHasValue(ti, ci, CellValue.Error)) {
        // Find the next question column
        let nextColIdx: number | undefined

        if (col.isAB) {
          // For A/B-eligible questions:
          // Error on Normal → next is A of same number
          // Error on A → next is B of same number
          // Error on B → next numbered question's Normal
          if (col.type === QuestionType.Normal) {
            nextColIdx = keyToIdx.get(`${col.number}A`)
          } else if (col.type === QuestionType.A) {
            nextColIdx = keyToIdx.get(`${col.number}B`)
          } else {
            // B — find next numbered question
            nextColIdx = keyToIdx.get(`${col.number + 1}`)
          }
        } else {
          // Normal questions (1-15): next is just the next number
          nextColIdx = keyToIdx.get(`${col.number + 1}`)
        }

        if (nextColIdx !== undefined) {
          disabled.add(`${ti}:${nextColIdx}`)
        }
      }
    }
  }

  return disabled
})

/** Check if a cell should be greyed out */
function isGreyedOut(teamIdx: number, colIdx: number): boolean {
  return greyedOut.value.has(`${teamIdx}:${colIdx}`)
}

const visibleColumns = computed(() =>
  columns.map((col, i) => ({ col, idx: i })).filter(({ col }) => !col.isOvertime || quizMeta.value.overtime),
)

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

/** Column CSS class for visual grouping */
function colGroupClass(colIdx: number): string {
  const col = columns[colIdx]
  if (!col) return ''
  if (col.isOvertime) return 'col--overtime'
  if (col.isAB && col.isErrorPoints) return 'col--ab'
  return ''
}

</script>

<template>
  <div class="scoresheet-wrapper">
    <div class="quiz-meta">
      <label class="meta-field">
        <span class="meta-label">Division</span>
        <input v-model.number="quizMeta.division" type="number" min="1" />
      </label>
      <label class="meta-field">
        <span class="meta-label">Quiz #</span>
        <input v-model.number="quizMeta.quizNumber" type="number" min="1" />
      </label>
      <label class="meta-field meta-field--toggle">
        <input v-model="quizMeta.overtime" type="checkbox" />
        <span class="toggle-track"><span class="toggle-thumb"></span></span>
        <span class="meta-label">Overtime</span>
      </label>
    </div>

    <table class="scoresheet">
      <!-- Question header row -->
      <thead>
        <tr>
          <th class="col--name sticky-col">Question</th>
          <th
            v-for="{ col, idx } in visibleColumns"
            :key="col.key"
            :class="['col--question', colGroupClass(idx)]"
          >
            {{ col.label }}
          </th>
          <th class="col--total">Total</th>
        </tr>
      </thead>

      <tbody>
        <template v-for="(team, ti) in teams" :key="team.id">
          <!-- Team header row -->
          <tr :class="['row--team-header', teamColors[ti]]">
            <td
              class="col--name sticky-col team-name"
              :colspan="visibleColumns.length + 2"
            >
              {{ team.name }}
              <span
                class="on-time"
                :class="{ 'on-time--active': team.onTime }"
                @click.stop="team.onTime = !team.onTime"
              >
                <span class="on-time-box">✓</span>
                <span class="on-time-label">on time</span>
              </span>
            </td>
          </tr>

          <!-- Quizzer rows -->
          <tr
            v-for="(quizzer, qi) in team.quizzers"
            :key="quizzer.id"
            class="row--quizzer"
          >
            <td class="col--name sticky-col">{{ quizzer.name }}</td>
            <td
              v-for="{ col, idx } in visibleColumns"
              :key="col.key"
              :class="[
                'cell',
                cellClass[cells[ti][qi][idx]],
                colGroupClass(idx),
                { 'cell--greyed': isGreyedOut(ti, idx) && cells[ti][qi][idx] === '' },
              ]"
              @click="cycleCell(ti, qi, idx)"
            >
              {{ cellDisplay[cells[ti][qi][idx]] }}
            </td>
            <!-- Team total spans all quizzer rows + running total row -->
            <td
              v-if="qi === 0"
              class="col--total team-total-value"
              :rowspan="team.quizzers.length + 1"
            >
              {{ scoring[ti]?.total ?? 0 }}
            </td>
          </tr>

          <!-- Team running total row -->
          <tr class="row--team-total">
            <td class="col--name sticky-col">Running Total</td>
            <td
              v-for="{ col, idx } in visibleColumns"
              :key="col.key"
              :class="['cell--total', colGroupClass(idx)]"
            >
              {{ scoring[ti]?.runningTotals[idx] ?? '' }}
            </td>
            <!-- total cell already covered by rowspan above -->
          </tr>
        </template>
      </tbody>

      <!-- No-jump row at bottom -->
      <tfoot>
        <tr class="row--no-jump">
          <td class="col--name sticky-col">No Jump</td>
          <td
            v-for="{ col, idx } in visibleColumns"
            :key="col.key"
            :class="['cell cell--no-jump', colGroupClass(idx), { 'cell--no-jump-active': noJumps[idx] }]"
            @click="toggleNoJump(idx)"
          >
            {{ noJumps[idx] ? '✗' : '' }}
          </td>
          <td class="col--total"></td>
        </tr>
      </tfoot>
    </table>
  </div>
</template>

<style scoped>
.scoresheet-wrapper {
  overflow-x: auto;
  max-width: 100vw;
  padding: 1rem;
}

.quiz-meta {
  display: flex;
  gap: 1.25rem;
  align-items: flex-end;
  margin-bottom: 0.75rem;
  padding: 0.6rem 0.75rem;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  width: fit-content;
}

.meta-field {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.meta-label {
  font-size: 0.7rem;
  font-weight: 600;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.meta-field input[type='number'] {
  width: 4rem;
  padding: 0.3rem 0.4rem;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  font-size: 0.85rem;
  text-align: center;
  background: #fff;
}
.meta-field input[type='number']:focus {
  outline: 2px solid #3b82f6;
  outline-offset: -1px;
  border-color: #3b82f6;
}

/* Toggle switch */
.meta-field--toggle {
  flex-direction: row;
  align-items: center;
  gap: 0.4rem;
  cursor: pointer;
  padding-bottom: 0.15rem;
}
.meta-field--toggle input[type='checkbox'] {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}
.toggle-track {
  display: inline-block;
  width: 2rem;
  height: 1.1rem;
  background: #cbd5e1;
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
  width: calc(1.1rem - 4px);
  height: calc(1.1rem - 4px);
  background: #fff;
  border-radius: 50%;
  transition: transform 0.2s;
}
.meta-field--toggle input:checked + .toggle-track .toggle-thumb {
  transform: translateX(calc(2rem - 1.1rem));
}
.meta-field--toggle .meta-label {
  font-size: 0.75rem;
  text-transform: none;
  color: #475569;
}

.scoresheet {
  border-collapse: collapse;
  font-family: 'Segoe UI', system-ui, sans-serif;
  font-size: 0.8rem;
  white-space: nowrap;
}

.scoresheet th,
.scoresheet td {
  border: 1px solid #94a3b8;
  padding: 0.25rem 0.4rem;
  text-align: center;
  min-width: 2rem;
  height: 1.8rem;
}

/* Sticky first column */
.sticky-col {
  position: sticky;
  left: 0;
  z-index: 2;
  background: #f8fafc;
}

.col--name {
  text-align: left;
  min-width: 7rem;
  max-width: 10rem;
  font-weight: 500;
}

.col--total {
  min-width: 3rem;
  font-weight: 600;
  background: #f1f5f9;
}

/* Column group shading */
.col--ab {
  background-color: #fefce8aa;
}

.col--overtime {
  background-color: #fdf2f8aa;
}

/* Question header */
.col--question {
  font-weight: 700;
  background: #e2e8f0;
  font-size: 0.75rem;
}
.col--question.col--ab {
  background: #fef9c3;
}
.col--question.col--overtime {
  background: #fce7f3;
}

/* Team header row */
.row--team-header {
  background: #334155;
  color: #f8fafc;
}
.row--team-header .team-name {
  font-weight: 700;
  font-size: 0.85rem;
  background: #334155;
  color: #f8fafc;
  text-align: left;
  padding-left: 0.5rem;
}
.row--team-header .team-name::before {
  content: '';
  display: inline-block;
  width: 0.85rem;
  height: 0.85rem;
  border-radius: 3px;
  margin-right: 0.4rem;
  vertical-align: middle;
  border: 1px solid #94a3b8;
}
.row--team-header.team--red .team-name::before {
  background: #dc2626;
}
.row--team-header.team--white .team-name::before {
  background: #f1f5f9;
}
.row--team-header.team--blue .team-name::before {
  background: #2563eb;
}

/* Quizzer rows */
.row--quizzer:hover {
  background: #f1f5f9;
}

/* Team total row */
.row--team-total {
  background: #e2e8f0;
  font-weight: 600;
}
.row--team-total .sticky-col {
  background: #e2e8f0;
}
.row--team-total .cell--total.col--ab {
  background: #fef9c322;
}
.row--team-total .cell--total.col--overtime {
  background: #fce7f322;
}
.team-total-value {
  font-size: 0.9rem;
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
  border: 1px solid #64748b;
  color: transparent;
  transition: all 0.15s;
}
.on-time--active .on-time-box {
  color: #cbd5e1;
  border-color: #94a3b8;
}
.on-time-label {
  font-size: 0.65rem;
  font-weight: 400;
  color: #94a3b8;
  text-transform: lowercase;
}

/* No-jump row */
.row--no-jump {
  background: #f8fafc;
}
.row--no-jump .sticky-col {
  background: #f8fafc;
  font-weight: 600;
  color: #64748b;
}
.cell--no-jump {
  cursor: pointer;
  user-select: none;
  color: #94a3b8;
  font-weight: 700;
}
.cell--no-jump:hover {
  outline: 2px solid #3b82f6;
  outline-offset: -2px;
}
.cell--no-jump-active {
  color: #dc2626;
  background-color: #fee2e2 !important;
}

/* Cell values */
.cell {
  cursor: pointer;
  user-select: none;
  transition: background-color 0.1s;
  font-weight: 700;
}
.cell:hover {
  outline: 2px solid #3b82f6;
  outline-offset: -2px;
}

.cell--correct {
  color: #16a34a;
  background-color: #dcfce7 !important;
}
.cell--error {
  color: #dc2626;
  background-color: #fee2e2 !important;
}
.cell--foul {
  color: #ea580c;
  background-color: #ffedd5 !important;
}
.cell--bonus {
  color: #2563eb;
  background-color: #dbeafe !important;
}
.cell--missed-bonus {
  color: #ea580c;
  background-color: #ffedd5 !important;
}

.cell--greyed {
  background-color: #e2e8f0 !important;
  cursor: default;
  opacity: 0.5;
}
.cell--greyed:hover {
  outline: none;
}
</style>
