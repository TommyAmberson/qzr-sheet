<script setup lang="ts">
import { ref, computed } from 'vue'
import { AgGridVue } from 'ag-grid-vue3'
import { AllCommunityModule, ModuleRegistry, themeQuartz } from 'ag-grid-community'
import type { ColDef, CellClassParams } from 'ag-grid-community'
import { getQuestionDefs, QUESTION_FIELDS } from '@/types/scoresheet'
import type { GridRow, CellValue, TeamBlock } from '@/types/scoresheet'

ModuleRegistry.registerModules([AllCommunityModule])

const myTheme = themeQuartz.withParams({
  spacing: 2,
  headerTextColor: '#1a1a2e',
  headerBackgroundColor: '#e8e8f0',
  headerFontSize: 12,
  headerFontWeight: 700,
  cellFontSize: 13,
  borderColor: '#c0c0d0',
  rowBorder: true,
})

// ── Demo data matching CSV ──────────────────────────────────────────

const teams = ref<TeamBlock[]>([
  {
    teamName: 'GMC 1',
    onTime: true,
    timeouts: [],
    quizzers: [
      { seat: 1, name: '' },
      {
        seat: 2,
        name: 'Seth Teichroeb',
        q9: 'e',
        q16: 'c',
        q20: 'e',
      },
      {
        seat: 3,
        name: 'Alesha Grimes',
        q6: 'e',
        q14: 'c',
        q19: 'c',
      },
      {
        seat: 4,
        name: 'Erin Grimes',
        q1: 'c',
        q2: 'e',
        q4: 'c',
        q8: 'c',
        q12: 'c',
      },
      { seat: 5, name: '' },
    ],
  },
  {
    teamName: 'Heritage 2',
    onTime: true,
    timeouts: [1, 2],
    quizzers: [
      { seat: 1, name: 'Rebekah McLellan', q12: 'mb' },
      { seat: 2, name: 'Grace Mile', q20: 'mb' },
      { seat: 3, name: 'Natalie Quong', q13: 'c' },
      { seat: 4, name: 'Hannah Johnson', q18: 'e' },
      { seat: 5, name: '' },
    ],
  },
  {
    teamName: 'Silver Heights 1',
    onTime: true,
    timeouts: [1],
    quizzers: [
      {
        seat: 1,
        name: 'Bethany Gadd',
        q5: 'c',
        q7: 'c',
        q10: 'e',
        q15: 'e',
        q18: 'c',
        q20: 'e',
      },
      { seat: 2, name: 'Luke Cey', q17: 'c' },
      { seat: 3, name: 'Hanna Cey', q3: 'c' },
      { seat: 4, name: '' },
      { seat: 5, name: '' },
    ],
  },
])

// ── Build flat rows for AG Grid ────────────────────────────────────

const rowData = computed<GridRow[]>(() => {
  const rows: GridRow[] = []

  for (let t = 0; t < teams.value.length; t++) {
    const team = teams.value[t]

    // Team header row
    const teamHeaderRow: GridRow = {
      rowType: 'teamHeader',
      label: team.teamName,
      teamIndex: t,
    }
    rows.push(teamHeaderRow)

    // Quizzer rows
    for (const qz of team.quizzers) {
      const row: GridRow = {
        rowType: 'quizzer',
        label: qz.name,
        teamIndex: t,
        seat: qz.seat,
      }
      for (const field of QUESTION_FIELDS) {
        row[field] = (qz[field] as CellValue) ?? ''
      }
      rows.push(row)
    }

    // Running score row
    const scoreRow: GridRow = {
      rowType: 'teamScore',
      label: 'Score',
      teamIndex: t,
    }
    rows.push(scoreRow)
  }

  return rows
})

// ── Column definitions ─────────────────────────────────────────────

const questionDefs = getQuestionDefs()

const columnDefs = computed<ColDef<GridRow>[]>(() => {
  const cols: ColDef<GridRow>[] = []

  // Seat # column
  cols.push({
    field: 'seat',
    headerName: '#',
    width: 30,
    pinned: 'left',
    suppressMovable: true,
    cellClass: (params: CellClassParams<GridRow>) => {
      return getRowTypeClass(params.data)
    },
    valueFormatter: (params) => {
      if (params.data?.rowType === 'quizzer' && params.data.seat) {
        return String(params.data.seat)
      }
      return ''
    },
  })

  // Name / Team column
  cols.push({
    field: 'label',
    headerName: 'Team / Quizzer',
    width: 160,
    pinned: 'left',
    suppressMovable: true,
    editable: (params) =>
      params.data?.rowType === 'quizzer' || params.data?.rowType === 'teamHeader',
    cellClass: (params: CellClassParams<GridRow>) => {
      return getRowTypeClass(params.data)
    },
  })

  // Question columns
  for (const qDef of questionDefs) {
    cols.push({
      field: qDef.field,
      headerName: qDef.headerName,
      width: 38,
      suppressMovable: true,
      editable: (params) => params.data?.rowType === 'quizzer',
      cellClass: (params: CellClassParams<GridRow>) => {
        const classes = getRowTypeClass(params.data)
        const val = params.value as CellValue
        if (val === 'c') classes.push('cell-correct')
        else if (val === 'e') classes.push('cell-error')
        else if (val === 'f') classes.push('cell-foul')
        else if (val === 'b') classes.push('cell-bonus')
        else if (val === 'mb') classes.push('cell-missed-bonus')
        if (qDef.region === 'overtime') classes.push('col-overtime')
        else if (qDef.region === 'ab') classes.push('col-ab')
        return classes
      },
      headerClass: () => {
        if (qDef.region === 'overtime') return 'header-overtime'
        if (qDef.region === 'ab') return 'header-ab'
        return ''
      },
    })
  }

  // Total score column
  cols.push({
    field: 'total',
    headerName: 'Tot',
    width: 55,
    pinned: 'right',
    suppressMovable: true,
    cellClass: (params: CellClassParams<GridRow>) => {
      const classes = getRowTypeClass(params.data)
      classes.push('col-total')
      return classes
    },
    valueGetter: (params) => {
      // Only show total on quizzer score row for now
      if (params.data?.rowType === 'teamScore') {
        return '' // TODO: calculate
      }
      return ''
    },
  })

  return cols
})

function getRowTypeClass(data: GridRow | undefined): string[] {
  if (!data) return []
  switch (data.rowType) {
    case 'teamHeader':
      return ['row-team-header']
    case 'teamScore':
      return ['row-team-score']
    case 'quizzer':
      return [`row-team-${data.teamIndex}`]
    default:
      return []
  }
}

// ── Grid options ───────────────────────────────────────────────────

const getRowHeight = (params: { data: GridRow }) => {
  if (params.data.rowType === 'teamHeader') return 28
  if (params.data.rowType === 'teamScore') return 24
  return 26
}

const getRowId = (params: { data: GridRow }) => {
  if (params.data.rowType === 'teamHeader') return `team-${params.data.teamIndex}`
  if (params.data.rowType === 'teamScore') return `score-${params.data.teamIndex}`
  return `qz-${params.data.teamIndex}-${params.data.seat}`
}
</script>

<template>
  <div class="scoresheet-container">
    <div class="quiz-header">
      <span class="quiz-title">Div 1 — Quiz 1</span>
    </div>
    <AgGridVue
      class="scoresheet-grid"
      :theme="myTheme"
      :rowData="rowData"
      :columnDefs="columnDefs"
      :getRowHeight="getRowHeight"
      :getRowId="getRowId"
      :suppressCellFocus="false"
      :singleClickEdit="true"
      :stopEditingWhenCellsLoseFocus="true"
      :headerHeight="28"
    />
  </div>
</template>

<style>
/* ── Layout ────────────────────────────────────────────────────────── */
.scoresheet-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
  padding: 8px;
  box-sizing: border-box;
  background: #f4f4f8;
}

.quiz-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 6px 12px;
  background: #1a1a2e;
  color: #eee;
  border-radius: 6px 6px 0 0;
  font-size: 15px;
}

.quiz-title {
  font-weight: 700;
}

.scoresheet-grid {
  flex: 1;
  width: 100%;
}

/* ── Row-type styles ───────────────────────────────────────────────── */
.row-team-header {
  background-color: #2c2c54 !important;
  color: #fff !important;
  font-weight: 700 !important;
  font-size: 13px !important;
}

.row-team-score {
  background-color: #dcdce6 !important;
  font-weight: 600 !important;
  font-style: italic;
}

.row-team-0 {
  background-color: #fef9ef !important;
}
.row-team-1 {
  background-color: #eff6fe !important;
}
.row-team-2 {
  background-color: #effef2 !important;
}

/* ── Cell value styles ─────────────────────────────────────────────── */
.cell-correct {
  color: #16a34a !important;
  font-weight: 700 !important;
  text-align: center !important;
}
.cell-error {
  color: #dc2626 !important;
  font-weight: 700 !important;
  text-align: center !important;
}
.cell-foul {
  color: #d97706 !important;
  font-weight: 700 !important;
  text-align: center !important;
}
.cell-bonus {
  color: #2563eb !important;
  font-weight: 700 !important;
  text-align: center !important;
}
.cell-missed-bonus {
  color: #9333ea !important;
  font-weight: 700 !important;
  text-align: center !important;
}

/* ── Column region tints ───────────────────────────────────────────── */
.header-ab {
  background-color: #fde68a !important;
}
.header-overtime {
  background-color: #fca5a5 !important;
}
.col-ab {
  border-left-color: #f59e0b !important;
}
.col-overtime {
  border-left-color: #ef4444 !important;
}
.col-total {
  font-weight: 700 !important;
  text-align: right !important;
}
</style>
