<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { CellValue, QuestionCategory, QuestionType } from '../types/scoresheet'
import { useScoresheet } from '../composables/useScoresheet'
import { useCellSelector } from '../composables/useCellSelector'
import { useKeyboardNav } from '../composables/useKeyboardNav'
import { useDragReorder } from '../composables/useDragReorder'
import { useTheme } from '../composables/useTheme'
import { serializeStore, parseQuizFile, serialize, deserialize } from '../persistence/quizFile'
import {
  saveQuizToFile,
  openAnyQuizFile,
  confirmAction,
  exportOdsFile,
  openOtsTemplate,
} from '../persistence/fileIO'
import { fillOts } from '../export/fillOts'
import { readOds } from '../export/readOds'
import { validationMessage } from '../scoring/validation'

const { theme, toggleTheme } = useTheme()

const {
  columns,
  quiz,
  teams,
  teamQuizzers,
  cells,
  noJumps,
  scoring,
  setCell,
  toggleNoJump,
  isEmptySeat,
  isBonusForTeam,
  isGreyedOut,
  isInvalid,
  cellValidationMessages,
  columnHasErrors,
  columnValidationMessages,
  quizzerHasErrors,
  quizzerValidationMessages,
  teamValidationMessages,
  isAfterOut,
  isFouledOnQuestion,
  toggleOnTime,
  teamHasErrors,
  hasAnyErrors,
  colAnswerValue,
  noJumpHasConflict,
  visibleColumns,
  visibleOtRounds,
  allQuestionsComplete,
  validationErrors,
  placements,
  placementPoints,
  setTeamName,
  setQuizzerName,
  moveQuizzer,
  setQuestionType,
  store,
  noJumpMap,
  loadFile,
  resetStore,
  canUndo,
  canRedo,
  isDirty,
  undo,
  redo,
  markSaved,
} = useScoresheet()

/** All unique validation messages for the status tooltip */
const allValidationMessages = computed(() => {
  const msgs = new Set<string>()
  for (const codes of validationErrors.value.values()) {
    for (const code of codes) msgs.add(validationMessage(code))
  }
  return [...msgs]
})

/** Show individual score if the quizzer jumped (correct or error) or fouled out. */
function quizzerScoreLabel(ti: number, qi: number): string | null {
  const q = scoring.value[ti]?.quizzers[qi]
  if (!q) return null
  if (q.correctCount === 0 && q.errorCount === 0 && !q.fouledOut) return null
  return `${q.points}`
}

/**
 * Column indices at which a round-boundary running total should always be shown.
 * Q20 (regulation→OT) and the last question of each OT round (Q23, Q26, …).
 * Only relevant when OT is active.
 */
const boundaryColIndices = computed<Set<number>>(() => {
  const s = new Set<number>()
  if (visibleOtRounds.value === 0) return s
  const boundaryQs = [20]
  for (let r = 0; r < visibleOtRounds.value - 1; r++) {
    boundaryQs.push(23 + r * 3)
  }
  for (const q of boundaryQs) {
    const idx = columns.value.findIndex((c) => c.key === `${q}`)
    if (idx !== -1) s.add(idx)
  }
  return s
})

/** Running total at or before colIdx for a team (walks back to find last non-null). */
function boundaryTotal(ti: number, colIdx: number): number | null {
  const totals = scoring.value[ti]?.runningTotals
  if (!totals) return null
  for (let i = colIdx; i >= 0; i--) {
    if (totals[i] !== null && totals[i] !== undefined) return totals[i]!
  }
  return scoring.value[ti]?.onTimeBonus ?? null
}

/** Columns actually rendered — entering columns start collapsed, then expand */
const displayColumns = ref(visibleColumns.value.map((vc) => ({ ...vc, entering: false })))

let prevVisibleKeys = new Set(visibleColumns.value.map(({ col }) => col.key))

watch(visibleColumns, (curr) => {
  const prev = prevVisibleKeys
  prevVisibleKeys = new Set(curr.map(({ col }) => col.key))

  const enteringKeys = new Set<string>()
  for (const { col } of curr) {
    if (!prev.has(col.key)) enteringKeys.add(col.key)
  }

  displayColumns.value = curr.map((vc) => ({
    ...vc,
    entering: enteringKeys.has(vc.col.key),
  }))

  // Double-rAF: let the collapsed state render before transitioning to natural size
  if (enteringKeys.size > 0) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        displayColumns.value = displayColumns.value.map((dc) => ({ ...dc, entering: false }))
      })
    })
  }
})

const {
  selector,
  selectorFocusIdx,
  selectorOptions,
  registerCellEl,
  openFromClick: openSelectorFromClick,
  openFromCell: openSelectorOnCell,
  selectValue,
  confirmFocusedOption,
  close: closeSelector,
} = useCellSelector(columns, isBonusForTeam, setCell)

const { focusedCell, focusCell, isNoJumpFocus } = useKeyboardNav({
  columns,
  teams,
  teamQuizzers,
  noJumps,
  displayColumns,
  selector,
  selectorFocusIdx,
  selectorOptions,
  openSelectorOnCell,
  confirmFocusedOption,
  closeSelector,
  setCell,
  toggleNoJump,
  isBonusForTeam,
  isAfterOut,
  isFouledOnQuestion,
  undo,
  redo,
})

const { dragState, dropTarget, dropIndicatorWidth, registerRowEl, onPointerDown } = useDragReorder(
  teamQuizzers,
  moveQuizzer,
)

function onCellClick(ti: number, qi: number, ci: number, event: MouseEvent) {
  focusCell(ti, qi, ci)
  openSelectorFromClick(ti, qi, ci, event)
}

function onNoJumpClick(ci: number) {
  focusCell(-1, -1, ci)
  toggleNoJump(ci)
}

/** Hovered column index for crosshair highlight */
const hoverCol = ref<number | null>(null)

const teamColors = ['team--red', 'team--white', 'team--blue']

async function saveFile() {
  const json = serializeStore(store, noJumpMap.value)
  const filename = `D${quiz.value.division}Q${quiz.value.quizNumber}.json`
  const saved = await saveQuizToFile(json, filename)
  if (saved) markSaved()
}

async function openFile() {
  if (isDirty.value && !(await confirmAction('Open a file? Unsaved changes will be lost.'))) return
  const result = await openAnyQuizFile()
  if (!result) return
  try {
    if (result.type === 'ods') {
      const data = deserialize(readOds(result.content))
      loadFile(data)
    } else {
      loadFile(parseQuizFile(result.content))
    }
  } catch (e) {
    alert(`Failed to open file: ${e instanceof Error ? e.message : e}`)
  }
}

async function newQuiz() {
  if (isDirty.value && !(await confirmAction('Start a new quiz? Unsaved changes will be lost.')))
    return
  resetStore()
}

async function exportOds() {
  const otsBytes = await openOtsTemplate()
  if (!otsBytes) return
  const quizFile = serialize({
    quiz: store.quiz,
    teams: store.teams,
    quizzers: store.quizzers,
    answers: store.answers,
    noJumps: noJumpMap.value,
  })
  try {
    const odsBytes = fillOts(otsBytes, quizFile)
    const filename = `D${quiz.value.division}Q${quiz.value.quizNumber}.ods`
    const saved = await exportOdsFile(odsBytes, filename)
    if (saved)
      alert('ODS exported.\n\nOpen in LibreOffice and press Ctrl+Shift+F9 to recalculate formulas.')
  } catch (e) {
    alert(`Failed to export ODS: ${e instanceof Error ? e.message : e}`)
  }
}

defineExpose({ saveFile, openFile, newQuiz, exportOds })

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

function colGroupClass(colIdx: number): string {
  const col = columns.value[colIdx]
  if (!col) return ''

  const classes: string[] = []
  const dc = displayColumns.value
  if (dc[dc.length - 1]?.idx === colIdx) classes.push('col--last')
  if (!col.isOvertime && col.number === 20) classes.push('col--reg-last')

  if (col.isOvertime) {
    if (col.type === QuestionType.Normal && (col.number - 21) % 3 === 0) {
      classes.push(
        col.number === 21 ? 'col--overtime col--ot-start' : 'col--overtime col--ot-round-start',
      )
    } else if (col.type === QuestionType.Normal && (col.number - 20) % 3 === 0) {
      classes.push('col--overtime col--ot-round-end')
    } else {
      classes.push('col--overtime')
    }
  } else if (col.isAB && col.isErrorPoints) {
    classes.push('col--ab')
  }

  return classes.join(' ')
}
</script>

<template>
  <div class="scoresheet-outer">
    <div class="scoresheet-wrapper" :class="{ 'is-dragging': dragState }" @dragstart.prevent>
      <div class="meta-row">
        <div
          :class="[
            'quiz-meta quiz-meta--left',
            {
              'quiz-meta--error': hasAnyErrors,
              'quiz-meta--complete': allQuestionsComplete && !hasAnyErrors,
            },
          ]"
        >
          <label class="meta-field">
            <span class="meta-label">Division</span>
            <input v-model="quiz.division" type="text" placeholder="1" />
          </label>
          <span class="meta-sep">·</span>
          <label class="meta-field">
            <span class="meta-label">Quiz</span>
            <input v-model="quiz.quizNumber" type="text" />
          </label>
          <span class="meta-sep">·</span>
          <div class="meta-field meta-field--undo">
            <button :disabled="!canUndo" title="Undo (Ctrl+Z)" @click="undo">↶</button>
            <button :disabled="!canRedo" title="Redo (Ctrl+Shift+Z)" @click="redo">↷</button>
          </div>
          <span class="meta-sep">·</span>
          <span
            class="meta-field meta-field--status"
            :title="hasAnyErrors ? allValidationMessages.join('\n') : undefined"
          >
            <span v-if="hasAnyErrors" class="meta-status meta-status--error">⚠</span>
            <span v-else-if="allQuestionsComplete" class="meta-status meta-status--complete"
              >✓</span
            >
            <span v-else class="meta-status meta-status--pending">○</span>
            <span class="meta-label">{{
              hasAnyErrors ? 'Invalid' : allQuestionsComplete ? 'Complete' : 'In Progress'
            }}</span>
          </span>
          <div class="meta-field meta-field--file">
            <button title="Save quiz as JSON (Ctrl+S)" @click="saveFile">⤓ Save</button>
            <button title="Open quiz from file (Ctrl+O)" @click="openFile">⤒ Open</button>
            <button title="Export filled ODS spreadsheet" @click="exportOds">⬡ Export</button>
            <button title="New quiz (Ctrl+N)" @click="newQuiz">✦ New</button>
          </div>
        </div>
        <div class="quiz-meta quiz-meta--right">
          <label class="meta-field meta-field--toggle">
            <input v-model="quiz.overtime" type="checkbox" />
            <span class="toggle-track"><span class="toggle-thumb" /></span>
            <span class="meta-label">Overtime</span>
          </label>
          <span class="meta-sep">·</span>
          <button
            class="theme-toggle"
            :title="`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`"
            @click="toggleTheme"
          >
            {{ theme === 'light' ? '🌙' : '☀️' }}
          </button>
        </div>
      </div>

      <table class="scoresheet" :style="{ '--drop-indicator-width': dropIndicatorWidth } as any">
        <!-- Question header row -->
        <thead>
          <tr>
            <th class="col--name sticky-col" />
            <th class="col--ontime-header" />
            <th
              v-for="{ col, idx, entering } in displayColumns"
              :key="col.key"
              :class="[
                'col--question',
                colGroupClass(idx),
                headerClass(idx),
                {
                  'col--entering': entering,
                  'col--hover': !dragState && (hoverCol === idx || selector?.ci === idx),
                  'col--focus': focusedCell?.ci === idx,
                },
              ]"
              :title="columnHasErrors(idx) ? columnValidationMessages(idx).join('\n') : undefined"
            >
              <div class="col-header-inner">
                <span class="col-header-number">{{ col.label }}</span>
                <span v-if="quiz.questionTypes.get(col.key)" class="col-header-type">{{
                  quiz.questionTypes.get(col.key)
                }}</span>
                <span v-else class="col-header-type">&nbsp;</span>
                <select
                  class="question-type-select"
                  :value="quiz.questionTypes.get(col.key) ?? ''"
                  @change="
                    setQuestionType(
                      idx,
                      ($event.target as HTMLSelectElement).value
                        ? (($event.target as HTMLSelectElement).value as QuestionCategory)
                        : null,
                    )
                  "
                >
                  <option value="" />
                  <option v-for="cat in QuestionCategory" :key="cat" :value="cat">{{ cat }}</option>
                </select>
              </div>
            </th>
            <th class="col--total col--total-header" />
          </tr>
        </thead>

        <tbody>
          <template v-for="(team, ti) in teams" :key="team.id">
            <!-- Team header row -->
            <tr :class="['row--team-header', teamColors[ti]]">
              <td class="col--name sticky-col team-name" colspan="2">
                <div class="name-cell-inner">
                  <input
                    class="editable-name editable-name--team"
                    :value="team.name"
                    @input="setTeamName(ti, ($event.target as HTMLInputElement).value)"
                    @focus="($event.target as HTMLInputElement).select()"
                  />
                  <span class="team-stats">
                    <span
                      v-if="(scoring[ti]?.uniqueCorrectQuizzers ?? 0) >= 3"
                      class="stat-badge stat-badge--unique"
                      :title="`${scoring[ti]!.uniqueCorrectQuizzers} quizzers jumped (+10 each from 3rd)`"
                      >{{
                        scoring[ti]!.uniqueCorrectQuizzers >= 5
                          ? '5th'
                          : scoring[ti]!.uniqueCorrectQuizzers >= 4
                            ? '4th'
                            : '3rd'
                      }}</span
                    >
                  </span>
                </div>
              </td>
              <td
                v-for="{ col, idx, entering } in displayColumns"
                :key="col.key"
                :class="['team-header-spacer', colGroupClass(idx), { 'col--entering': entering }]"
              />
              <td class="col--name team-score-label">Score</td>
            </tr>

            <!-- Quizzer rows -->
            <tr
              v-for="(quizzer, qi) in teamQuizzers[ti]"
              :key="quizzer.id"
              :ref="(el: any) => registerRowEl(ti, qi, el as HTMLElement)"
              :class="[
                'row--quizzer',
                { 'row--quizzed-out': scoring[ti]?.quizzers[qi]?.quizzedOut },
                {
                  'row--errored-out':
                    scoring[ti]?.quizzers[qi]?.erroredOut && !scoring[ti]?.quizzers[qi]?.fouledOut,
                },
                { 'row--fouled-out': scoring[ti]?.quizzers[qi]?.fouledOut },
                { 'row--dragging': dragState?.ti === ti && dragState?.qi === qi },
                {
                  'row--drop-above':
                    dropTarget?.ti === ti &&
                    dropTarget?.qi === qi &&
                    !dropTarget?.below &&
                    !(dragState?.ti === ti && dragState?.qi === qi),
                },
                {
                  'row--drop-below':
                    dropTarget?.ti === ti &&
                    dropTarget?.qi === qi &&
                    dropTarget?.below &&
                    !(dragState?.ti === ti && dragState?.qi === qi),
                },
              ]"
            >
              <td
                colspan="2"
                :class="[
                  'col--name',
                  'sticky-col',
                  {
                    'cell--invalid': quizzerHasErrors(ti, qi),
                    'col--name--active': !dragState && selector?.ti === ti && selector?.qi === qi,
                    'col--name--focused':
                      !dragState && focusedCell?.ti === ti && focusedCell?.qi === qi,
                  },
                ]"
                :title="
                  quizzerHasErrors(ti, qi)
                    ? quizzerValidationMessages(ti, qi).join('\n')
                    : undefined
                "
              >
                <div class="name-cell-inner">
                  <span class="drag-handle" @pointerdown="onPointerDown(ti, qi, $event)">⠿</span>
                  <input
                    class="editable-name editable-name--quizzer"
                    :value="quizzer.name"
                    @input="setQuizzerName(ti, qi, ($event.target as HTMLInputElement).value)"
                    @focus="($event.target as HTMLInputElement).select()"
                  />
                  <button
                    v-if="quizzer.name"
                    class="name-clear"
                    title="Clear name (empty seat)"
                    @click.stop="setQuizzerName(ti, qi, '')"
                  >
                    ×
                  </button>
                  <span v-if="scoring[ti]?.quizzers[qi]" class="quizzer-stats">
                    <span
                      v-if="scoring[ti]!.quizzers[qi]!.quizzedOut"
                      :class="[
                        'stat-badge',
                        'stat-badge--quizout',
                        { 'stat-badge--quizout-bonus': scoring[ti]!.quizzers[qi]!.quizoutBonus },
                      ]"
                      :title="
                        scoring[ti]!.quizzers[qi]!.quizoutBonus
                          ? 'Quiz-out with bonus (+10)'
                          : 'Quiz-out'
                      "
                      ><span class="stat-badge__label">Q</span></span
                    >
                    <span
                      v-else-if="
                        scoring[ti]!.quizzers[qi]!.erroredOut &&
                        !scoring[ti]!.quizzers[qi]!.fouledOut
                      "
                      class="stat-badge stat-badge--errorout"
                      title="Errored out"
                      >E</span
                    >
                    <span
                      v-else-if="scoring[ti]!.quizzers[qi]!.fouledOut"
                      class="stat-badge stat-badge--foulout"
                      title="Fouled out"
                      >F</span
                    >
                    <span
                      v-if="
                        scoring[ti]!.quizzers[qi]!.correctCount > 0 &&
                        !scoring[ti]!.quizzers[qi]!.quizzedOut
                      "
                      class="stat-count stat-count--correct"
                      :title="`${scoring[ti]!.quizzers[qi]!.correctCount} correct`"
                      >{{ scoring[ti]!.quizzers[qi]!.correctCount }}c</span
                    >
                    <span
                      v-if="
                        scoring[ti]!.quizzers[qi]!.errorCount > 0 &&
                        !(
                          scoring[ti]!.quizzers[qi]!.erroredOut &&
                          !scoring[ti]!.quizzers[qi]!.fouledOut
                        )
                      "
                      class="stat-count stat-count--error"
                      :title="`${scoring[ti]!.quizzers[qi]!.errorCount} error(s)`"
                      >{{ scoring[ti]!.quizzers[qi]!.errorCount }}e</span
                    >
                    <span
                      v-if="
                        scoring[ti]!.quizzers[qi]!.foulCount > 0 &&
                        !scoring[ti]!.quizzers[qi]!.fouledOut
                      "
                      class="stat-count stat-count--foul"
                      :title="`${scoring[ti]!.quizzers[qi]!.foulCount} foul(s)`"
                      >{{ scoring[ti]!.quizzers[qi]!.foulCount }}f</span
                    >
                    <span
                      v-if="!isEmptySeat(ti, qi) && quizzerScoreLabel(ti, qi) !== null"
                      class="stat-count stat-count--individual"
                      title="Individual score"
                      >{{ quizzerScoreLabel(ti, qi) }}</span
                    >
                  </span>
                </div>
              </td>
              <td
                v-for="{ col, idx, entering } in displayColumns"
                :key="col.key"
                :ref="(el: any) => registerCellEl(ti, qi, idx, el as HTMLElement | null)"
                :class="[
                  'cell',
                  cellClass[cells[ti]?.[qi]?.[idx] ?? CellValue.Empty],
                  colGroupClass(idx),
                  {
                    'cell--greyed':
                      (isEmptySeat(ti, qi) && cells[ti]?.[qi]?.[idx] === '') ||
                      ((isGreyedOut(ti, idx) || noJumps[idx]) && cells[ti]?.[qi]?.[idx] === '') ||
                      isAfterOut(ti, qi, idx) ||
                      (isFouledOnQuestion(ti, qi, idx) && cells[ti]?.[qi]?.[idx] === ''),
                  },
                  { 'cell--invalid': isInvalid(ti, qi, idx) },
                  { 'col--entering': entering },
                  { 'col--hover': !dragState && hoverCol === idx },
                  {
                    'cell--focused':
                      focusedCell?.ti === ti && focusedCell?.qi === qi && focusedCell?.ci === idx,
                  },
                ]"
                :title="
                  isInvalid(ti, qi, idx)
                    ? cellValidationMessages(ti, qi, idx).join('\n')
                    : undefined
                "
                @click="onCellClick(ti, qi, idx, $event)"
                @mouseenter="hoverCol = idx"
                @mouseleave="hoverCol = null"
              >
                {{ cellDisplay[cells[ti]?.[qi]?.[idx] ?? CellValue.Empty] }}
              </td>
              <!-- Team total spans quizzer rows only -->
              <td
                v-if="qi === 0"
                :class="['col--total', 'team-total-value', { 'cell--invalid': teamHasErrors(ti) }]"
                :rowspan="teamQuizzers[ti]?.length ?? 5"
                :title="teamHasErrors(ti) ? teamValidationMessages(ti).join('\n') : undefined"
              >
                <span v-if="placements[ti]" class="placement-medal">{{
                  Math.floor(placements[ti]!) === 1
                    ? '🥇'
                    : Math.floor(placements[ti]!) === 2
                      ? '🥈'
                      : '🥉'
                }}</span>
                {{ scoring[ti]?.total ?? 0 }}
                <span v-if="placementPoints[ti] !== null" class="placement-points">
                  {{ placementPoints[ti] }} pts
                </span>
              </td>
            </tr>

            <!-- Team running total row -->
            <tr class="row--team-total">
              <td class="col--name sticky-col running-total-label">
                <span
                  class="on-time"
                  :class="{ 'on-time--active': team.onTime }"
                  @click.stop="toggleOnTime(ti)"
                >
                  <span class="on-time-box">✓</span>
                  <span class="on-time-label">on time</span>
                </span>
                Score
              </td>
              <td class="cell--total cell--total-ontime" style="position: relative">
                {{ scoring[ti]?.onTimeBonus ?? 0 }}
              </td>
              <td
                v-for="{ col, idx, entering } in displayColumns"
                :key="col.key"
                :class="['cell--total', colGroupClass(idx), { 'col--entering': entering }]"
                style="position: relative"
              >
                {{
                  scoring[ti]?.runningTotals[idx] ??
                  (boundaryColIndices.has(idx) ? boundaryTotal(ti, idx) : '')
                }}
                <span
                  v-if="scoring[ti]?.uniqueQuizzerBonusCols.has(idx)"
                  class="running-total-badge running-total-badge--unique"
                  >{{
                    scoring[ti]!.uniqueQuizzerBonusCols.get(idx) === 3
                      ? '3rd'
                      : scoring[ti]!.uniqueQuizzerBonusCols.get(idx) === 4
                        ? '4th'
                        : '5th'
                  }}</span
                >
                <span
                  v-if="scoring[ti]?.quizoutBonusCols.has(idx)"
                  class="running-total-badge running-total-badge--quizout"
                  >Q</span
                >
                <span
                  v-if="scoring[ti]?.freeErrorCols.has(idx)"
                  class="running-total-badge running-total-badge--free-error"
                  title="Free error (no deduction)"
                  >≈</span
                >
                <span
                  v-if="scoring[ti]?.foulDeductCols.has(idx)"
                  class="running-total-badge running-total-badge--foul-deduct"
                  title="Foul deduction (-10)"
                  >F</span
                >
              </td>
              <td class="running-total-spacer" />
            </tr>

            <!-- Spacer between teams -->
            <tr v-if="ti < teams.length - 1" class="spacer-row spacer-row--team">
              <td class="sticky-col" colspan="2" />
              <td
                v-for="{ col, idx, entering } in displayColumns"
                :key="col.key"
                :class="['spacer-cell', colGroupClass(idx), { 'col--entering': entering }]"
              />
              <td />
            </tr>
          </template>
        </tbody>

        <!-- No-jump row at bottom -->
        <tfoot>
          <tr class="spacer-row">
            <td class="sticky-col" colspan="2" />
            <td
              v-for="{ col, idx, entering } in displayColumns"
              :key="col.key"
              :class="['spacer-cell', colGroupClass(idx), { 'col--entering': entering }]"
            />
            <td />
          </tr>
          <tr class="row--no-jump">
            <td class="col--name sticky-col no-jump-label" colspan="2">No Jump</td>
            <td
              v-for="{ col, idx, entering } in displayColumns"
              :key="col.key"
              :class="[
                'cell cell--no-jump',
                colGroupClass(idx),
                {
                  'cell--no-jump-active': noJumps[idx] && colAnswerValue(idx) === CellValue.Empty,
                  'cell--no-jump-answered': colAnswerValue(idx) !== CellValue.Empty,
                  'cell--invalid': noJumpHasConflict(idx),
                  'col--entering': entering,
                  'cell--focused': isNoJumpFocus() && focusedCell?.ci === idx,
                },
              ]"
              :title="noJumpHasConflict(idx) ? columnValidationMessages(idx).join('\n') : undefined"
              @click="onNoJumpClick(idx)"
              @mouseenter="hoverCol = idx"
              @mouseleave="hoverCol = null"
            >
              {{ noJumps[idx] ? '✗' : '' }}
            </td>
            <td class="col--total no-jump-total" />
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
              v-for="(opt, oi) in selectorOptions"
              :key="opt.label"
              :class="[
                'selector-opt',
                opt.cls,
                { 'selector-opt--focused': oi === selectorFocusIdx },
              ]"
              @click="selectValue(opt.value)"
              @mouseenter="selectorFocusIdx = oi"
            >
              {{ opt.label }}
            </button>
          </div>
        </div>
      </Teleport>
    </div>
  </div>
</template>

<style scoped>
.scoresheet-outer {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.scoresheet-wrapper {
  overflow: auto;
  flex: 1;
  min-height: 0;
  padding: 1rem;
  box-sizing: border-box;
  touch-action: pan-x pan-y;
  -webkit-overflow-scrolling: touch;
}

.meta-row {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
  min-width: max-content;
}

.quiz-meta {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  padding: 0.5rem 0.85rem;
  background: var(--color-meta-bg);
  border: 1px solid var(--color-meta-accent);
  border-left: 3px solid var(--color-meta-border);
  border-radius: 6px;
  color: var(--color-text);
  font-family: 'Segoe UI', system-ui, sans-serif;
  font-size: 0.8rem;
  transition:
    background 0.4s,
    color 0.4s,
    border-color 0.4s;
}

.quiz-meta--error {
  background: var(--color-error-alt);
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

.meta-field input[type='text'] {
  width: 3rem;
  padding: 0.2rem 0.3rem;
  border: 1px solid var(--color-meta-accent);
  border-radius: 4px;
  font-size: 0.8rem;
  font-weight: 600;
  text-align: center;
  background: var(--color-bg);
  color: var(--color-text);
}
.meta-field input[type='text']:focus {
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

/* Undo/redo buttons */
.meta-field--undo {
  display: inline-flex;
  gap: 0.15rem;
}
.meta-field--undo button {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-text-muted);
  font-size: 1rem;
  line-height: 1;
  padding: 0.1rem 0.25rem;
  border-radius: 4px;
  transition: color 0.15s;
}
.meta-field--undo button:not(:disabled):hover {
  color: var(--color-text);
}
.meta-field--undo button:disabled {
  opacity: 0.3;
  cursor: default;
}

/* File action buttons (save, open, new) */
.meta-field--file {
  display: inline-flex;
  gap: 0.35rem;
}
.meta-field--file button {
  background: none;
  border: 1px solid var(--color-meta-accent);
  cursor: pointer;
  color: var(--color-text-muted);
  font-size: 0.75rem;
  font-weight: 600;
  line-height: 1;
  padding: 0.3rem 0.5rem;
  border-radius: 4px;
  transition:
    color 0.15s,
    border-color 0.15s,
    background 0.15s;
}
.meta-field--file button:hover {
  color: var(--color-text);
  border-color: var(--color-text-faint);
  background: var(--color-border-alt);
}

/* Theme toggle */
.theme-toggle {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 1rem;
  line-height: 1;
  padding: 0.1rem 0.25rem;
  border-radius: 4px;
  transition: opacity 0.15s;
  opacity: 0.6;
}
.theme-toggle:hover {
  opacity: 1;
}

.scoresheet {
  border-collapse: separate;
  border-spacing: 0;
  font-family: 'Segoe UI', system-ui, sans-serif;
  font-size: 0.8rem;
  white-space: nowrap;
  width: 100%;
  table-layout: auto;
}

.scoresheet th,
.scoresheet td {
  border-right: 1px solid var(--color-border);
  border-bottom: 1px solid var(--color-border);
  padding: 0.25rem 0.4rem;
  text-align: center;
  min-width: 2rem;
  height: 1.8rem;
  background: var(--color-bg);
}

/* Left and top outer edges */
.scoresheet tr th:first-child,
.scoresheet tr td:first-child {
  border-left: 1px solid var(--color-border);
}
.scoresheet thead tr:first-child th,
.scoresheet tbody tr:first-child td {
  border-top: 1px solid var(--color-border);
}

/* Sticky first column — above sticky header row */
.sticky-col {
  position: sticky;
  left: 0;
  z-index: 3;
  background: var(--color-bg);
  box-shadow: 1px 0 0 var(--color-border);
}

/* Sticky header row — below sticky column */
thead tr th {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--color-bg-warm);
  box-shadow: 0 1px 0 var(--color-border);
}

/* Top-left corner: sticky on both axes — highest z-index, fully invisible */
thead tr th.sticky-col {
  z-index: 4;
  background: transparent !important;
  box-shadow: none;
  border: none !important;
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
  background: var(--color-border-alt);
}
.col--total-header {
  background: transparent !important;
  border-right: none !important;
  border-bottom: none !important;
  border-top: none !important;
  box-shadow: none !important;
}

/* Column group shading */

/* Spacer row — half-height transparent gap */
.spacer-row td {
  height: 0.35rem;
  padding: 0 !important;
  border: none !important;
  background: transparent !important;
}
.spacer-row--team td {
  height: 1rem;
}
.spacer-row .spacer-cell {
  border-right: 1px solid var(--color-border-alt) !important;
}
.spacer-row td:nth-child(2) {
  border-left: 1px solid var(--color-border-alt) !important;
}
.spacer-row .sticky-col {
  box-shadow: none;
}

/* Question header row — empty name cell blends with background */
/* Question number label inside header cell */
.scoresheet .col--question {
  font-weight: 700;
  background: var(--color-bg-warm);
  color: var(--color-text);
  font-size: 0.75rem;
}
.col--question.col--ab {
  box-shadow:
    0 1px 0 var(--color-border),
    inset 0 2px 0 var(--color-ab-border);
}
.col--question.col--overtime {
  box-shadow:
    0 1px 0 var(--color-border),
    inset 0 2px 0 var(--color-ot-border);
}

/* Dotted boundary borders on light-border rows.
 * Use box-shadow for left edge (avoids doubling with border-separate)
 * and border-right for right edge. */
.col--question.col--ot-start,
.col--question.col--ot-round-start {
  border-left: none !important;
}
.spacer-cell.col--ot-start,
.spacer-cell.col--ot-round-start,
.team-header-spacer.col--ot-start,
.team-header-spacer.col--ot-round-start,
.row--team-total .col--ot-start,
.row--team-total .col--ot-round-start,
.row--team-total .cell--total.col--ot-start,
.row--team-total .cell--total.col--ot-round-start {
  border-left: none !important;
  box-shadow: none !important;
}

/* Question header colours based on answer */
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
  color: var(--palette-no-jump) !important;
}
.col--header-no-jump .col-header-number {
  text-decoration: line-through;
}
.col--header-no-jump .col-header-type {
  text-decoration: none;
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
  border-top: none !important;
  border-left: none !important;
  border-right: 1px solid var(--color-border-alt) !important;
  border-bottom: 1px solid var(--color-border) !important;
}
.team-score-label {
  background: transparent !important;
  color: var(--color-text);
  font-weight: 800;
  font-size: 1rem;
  text-align: center !important;
  border-top: none !important;
  border-right: none !important;
  border-bottom: 1px solid var(--color-border) !important;
}
.running-total-spacer {
  background: transparent !important;
  border: none !important;
}
.row--team-header .team-name {
  font-weight: 700;
  font-size: 0.85rem;
  background: var(--color-text-muted);
  color: var(--color-bg-warm);
  text-align: left;
  padding-left: 0.5rem;
  border-radius: 4px;
  border-top: none !important;
  border-left: none !important;
  border-right: none !important;
  border-bottom: 1px solid var(--color-border) !important;
}
.row--team-header .team-name .name-cell-inner::before {
  content: '';
  display: block;
  width: 0.85rem;
  height: 0.85rem;
  border-radius: 3px;
  margin-right: 0.4rem;
  flex-shrink: 0;
  border: 1px solid var(--color-text-faint);
}
.row--team-header.team--red .team-name .name-cell-inner::before {
  background: var(--color-team-red);
}
.row--team-header.team--white .team-name .name-cell-inner::before {
  background: var(--color-team-white);
}
.row--team-header.team--blue .team-name .name-cell-inner::before {
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
  border-left: none !important;
  border-right: 1px solid var(--color-border-alt) !important;
}
.row--team-total .sticky-col {
  background: transparent;
  box-shadow: none;
}
.team-total-value {
  font-size: 2.5rem;
  vertical-align: middle;
  position: relative;
  border-top: none !important;
}

/* Boundary border rules — must come after all row-specific overrides */
/* Question header: solid ot-border colour on all boundaries */
.col--question.col--last,
.col--question.col--reg-last,
.col--question.col--ot-round-end {
  border-right: 2px solid var(--color-ot-border) !important;
}
/* Spacer/team-header/running-total: dotted plain border */
.spacer-cell.col--last,
.team-header-spacer.col--last,
.row--team-total .col--last,
.row--team-total .cell--total.col--last,
.spacer-cell.col--reg-last,
.team-header-spacer.col--reg-last,
.row--team-total .col--reg-last,
.row--team-total .cell--total.col--reg-last,
.spacer-cell.col--ot-round-end,
.team-header-spacer.col--ot-round-end,
.row--team-total .col--ot-round-end,
.row--team-total .cell--total.col--ot-round-end {
  border-right: 2px dotted var(--color-border) !important;
}
/* Answer/no-jump cells: same as normal cell borders */
.cell.col--last,
.cell.col--reg-last,
.cell.col--ot-round-end {
  border-right: 1px solid var(--color-border) !important;
}

.placement-medal {
  position: absolute;
  top: 0.15rem;
  right: 0.2rem;
  font-size: 1.1rem;
  line-height: 1;
}

/* Placement points */
.placement-points {
  display: block;
  font-size: 0.7rem;
  font-weight: 700;
  font-style: normal;
  color: var(--color-text-muted);
  line-height: 1;
  margin-top: 0.2rem;
}

/* On-time tick */
.on-time {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  cursor: pointer;
  vertical-align: middle;
  padding: 0.15rem 0.4rem 0.15rem 0.25rem;
  border-radius: 4px;
  transition: background 0.15s;
}
.on-time:hover {
  background: var(--color-border-alt);
}
.on-time-box {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1rem;
  height: 1rem;
  border-radius: 3px;
  font-size: 0.65rem;
  border: 1.5px solid var(--color-text-faint);
  color: transparent;
  background: var(--color-bg);
  transition: all 0.15s;
}
.on-time--active .on-time-box {
  background: var(--color-text);
  border-color: var(--color-text);
  color: var(--color-bg);
}
.on-time-label {
  font-size: 0.65rem;
  font-weight: 600;
  color: var(--color-text-faint);
  text-transform: lowercase;
  transition: color 0.15s;
}
.on-time--active .on-time-label {
  color: var(--color-text-muted);
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
  background: var(--color-no-jump-alt) !important;
  color: var(--color-no-jump) !important;
  font-size: 0.9rem;
  opacity: 1;
}
.cell--no-jump-answered {
  background: repeating-linear-gradient(
    -45deg,
    var(--color-grey-stripe-a),
    var(--color-grey-stripe-a) 3px,
    var(--color-grey-stripe-b) 3px,
    var(--color-grey-stripe-b) 6px
  ) !important;
  opacity: 0.6;
  cursor: default;
}
.cell--no-jump-answered:hover {
  outline: none;
}

/* Question header inner — number + type stacked, select covers entire cell */
.col-header-inner {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0;
}
.col-header-number {
  line-height: 1.2;
  pointer-events: none;
}
.col-header-type {
  font-size: 0.6rem;
  font-weight: 700;
  color: inherit;
  opacity: 0.7;
  line-height: 1;
  margin-top: 0.15rem;
  pointer-events: none;
}
.question-type-select {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
  border: none;
  background: transparent;
  font-size: 0.75rem;
  appearance: none;
  -webkit-appearance: none;
}
.question-type-select option {
  background: var(--color-bg);
  color: var(--color-text);
  text-align: center;
}

/* Cell values */
.cell {
  cursor: pointer;
  user-select: none;
  font-weight: 700;
  outline-offset: -2px;
}
.cell:focus {
  outline: none;
}
.cell:hover {
  outline: 2px solid var(--color-border);
  outline-offset: -2px;
}

/* Crosshair highlight — quizzer name + question header only */
.row--quizzer:hover > .col--name,
.col--name--active {
  outline: 2px solid var(--color-border);
  outline-offset: -2px;
}
.is-dragging .row--quizzer:hover > .col--name {
  outline: none;
}
.col--question.col--hover {
  outline: 2px solid var(--color-border);
  outline-offset: -2px;
}

/* Sticky quizzer name cell needs explicit border-top so it shows
 * through the sticky layer above the team-header's border-bottom */
.row--quizzer > .col--name {
  border-top: 1px solid var(--color-border);
}

/* Focus — blue always overrides grey hover */
.cell.cell--focused {
  outline: 2px solid var(--color-accent);
  outline-offset: -2px;
}
.row--quizzer > .col--name.col--name--focused {
  outline: 2px solid var(--color-accent);
  outline-offset: -2px;
}
.col--question.col--focus {
  outline: 2px solid var(--color-accent);
  outline-offset: -2px;
}

.cell--correct {
  color: var(--color-correct-alt);
  background-color: var(--color-correct) !important;
}
.cell--error {
  color: var(--color-error-alt);
  background-color: var(--color-error) !important;
}
.cell--foul {
  color: var(--color-foul-alt);
  background-color: var(--color-foul) !important;
}
.cell--bonus {
  color: var(--color-bonus-alt);
  background-color: var(--color-bonus) !important;
}
.cell--missed-bonus {
  color: var(--color-missed-bonus-alt);
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
  transition:
    width 0.3s ease,
    max-width 0.3s ease,
    min-width 0.3s ease,
    padding 0.3s ease,
    opacity 0.3s ease,
    border 0.3s ease,
    font-size 0.3s ease,
    line-height 0.3s ease,
    background-color 0.1s;
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
}
.cell--greyed:hover {
  outline: none;
}
.cell.cell--greyed.cell--focused {
  outline: 2px solid var(--color-accent);
  outline-offset: -2px;
}

.cell--invalid {
  outline: 2px solid var(--color-invalid);
  outline-offset: -2px;
  animation: pulse-invalid 1.5s ease-in-out infinite;
}
@keyframes pulse-invalid {
  0%,
  100% {
    outline-color: var(--color-invalid);
  }
  50% {
    outline-color: var(--color-invalid-alt);
  }
}

/* Running total badges */
/* On-time bonus column */
.running-total-label {
  font-weight: 600 !important;
  font-style: normal !important;
  color: var(--color-text-muted);
  font-size: 0.75rem;
  text-align: right !important;
  padding-right: 0.6rem !important;
  position: relative;
}
.running-total-label .on-time {
  position: absolute;
  left: 0.4rem;
  top: 50%;
  transform: translateY(-50%);
}

.col--ontime-header {
  background: var(--color-bg-warm) !important;
  border-top: none !important;
  border-bottom: none !important;
  box-shadow: 0 1px 0 var(--color-border);
}
.cell--total-ontime {
  border-left: 1px solid var(--color-border-alt) !important;
  border-right: 1px solid var(--color-border-alt) !important;
}

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
  margin-left: auto;
  flex-shrink: 0;
}

/* Name cell inner wrapper — flex container inside table cell */
.name-cell-inner {
  display: flex;
  align-items: center;
  width: 100%;
}

/* Drag handle */
.drag-handle {
  cursor: grab;
  color: var(--color-text-faint);
  font-size: 0.75rem;
  line-height: 1;
  padding: 0.1rem;
  margin-right: 0.2rem;
  border-radius: 3px;
  flex-shrink: 0;
  user-select: none;
  touch-action: none;
  opacity: 0;
  transition:
    opacity 0.15s,
    color 0.15s;
}
.row--quizzer:hover .drag-handle,
.row--dragging .drag-handle,
.drag-handle:focus {
  opacity: 1;
}
.drag-handle:hover {
  color: var(--color-text-muted);
  background: var(--color-border-alt);
}
.drag-handle:active {
  cursor: grabbing;
}

/* Drag-and-drop row states */
.row--dragging > td {
  opacity: 0.4;
}
.row--drop-above > .col--name,
.row--drop-below > .col--name {
  position: relative;
}
.row--drop-above > .col--name::after,
.row--drop-below > .col--name::after {
  content: '';
  position: absolute;
  left: 0;
  width: var(--drop-indicator-width, 100%);
  height: 2px;
  background: var(--color-accent);
  pointer-events: none;
  z-index: 3;
}
.row--drop-above > .col--name::after {
  top: -1px;
}
.row--drop-below > .col--name::after {
  bottom: -1px;
}

/* Editable name inputs */
.editable-name {
  border: none;
  background: transparent;
  font-family: inherit;
  color: inherit;
  padding: 0;
  margin: 0;
  outline: none;
  width: 100%;
  min-width: 0;
  flex: 1;
  height: 100%;
}
.editable-name:focus {
  border-bottom: 1.5px solid var(--color-accent);
}
.editable-name--team {
  font-weight: 700;
  font-size: 0.85rem;
}
.editable-name--quizzer {
  font-weight: 500;
  font-size: 0.8rem;
}

/* Clear name button */
.name-clear {
  display: none;
  align-items: center;
  justify-content: center;
  border: none;
  background: none;
  color: var(--color-text-faint);
  font-size: 0.7rem;
  line-height: 1;
  width: 1rem;
  height: 1rem;
  border-radius: 50%;
  cursor: pointer;
  flex-shrink: 0;
  padding: 0;
  margin-left: 0.1rem;
}
.name-cell-inner:hover .name-clear {
  display: inline-flex;
}
.name-clear:hover {
  background: var(--color-border-alt);
  color: var(--color-error);
}

/* Quizzer status indicators */
.quizzer-stats {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  margin-left: auto;
  flex-shrink: 0;
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
}
.stat-badge--quizout {
  background: var(--color-correct);
  color: var(--color-badge-circle-correct);
}
.stat-badge--quizout-bonus {
  background: var(--color-correct);
  color: var(--color-badge-circle-correct);
  border-radius: 3px;
  transform: rotate(45deg);
}
.stat-badge--quizout-bonus .stat-badge__label {
  transform: rotate(-45deg);
  display: inline-block;
}
.stat-badge--errorout {
  background: var(--color-error);
  color: var(--color-badge-circle-error);
}
.stat-badge--foulout {
  background: var(--color-foul);
  color: var(--color-badge-circle-foul);
}
.stat-badge--unique {
  background: var(--color-correct);
  color: var(--color-badge-circle-correct);
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
  color: var(--color-badge-correct-text);
  background: var(--color-badge-correct-bg);
}
.stat-count--error {
  color: var(--color-badge-error-text);
  background: var(--color-badge-error-bg);
}
.stat-count--foul {
  color: var(--color-badge-foul-text);
  background: var(--color-badge-foul-bg);
}
.stat-count--individual {
  color: var(--color-text-faint);
  background: var(--color-border-alt);
  margin-left: auto;
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
  transform: translate(-50%, -50%);
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2px;
  padding: 3px;
  background: var(--color-bg);
  border: 1px solid var(--color-border-alt);
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
.selector-opt:hover,
.selector-opt--focused {
  transform: scale(1.1);
}

.opt--correct {
  color: var(--color-correct);
}
.opt--correct:hover,
.opt--correct.selector-opt--focused {
  background: var(--color-correct);
  color: var(--color-bg);
}
.opt--error {
  color: var(--color-error);
}
.opt--error:hover,
.opt--error.selector-opt--focused {
  background: var(--color-error);
  color: var(--color-bg);
}
.opt--foul {
  color: var(--color-foul);
}
.opt--foul:hover,
.opt--foul.selector-opt--focused {
  background: var(--color-foul);
  color: var(--color-bg);
}
.opt--bonus {
  color: var(--color-bonus);
}
.opt--bonus:hover,
.opt--bonus.selector-opt--focused {
  background: var(--color-bonus);
  color: var(--color-bg);
}
.opt--missed-bonus {
  color: var(--color-missed-bonus);
}
.opt--missed-bonus:hover,
.opt--missed-bonus.selector-opt--focused {
  background: var(--color-missed-bonus);
  color: var(--color-bg);
}
.opt--clear {
  color: var(--color-text);
}
.opt--clear:hover,
.opt--clear.selector-opt--focused {
  background: var(--color-border-alt);
}
</style>
