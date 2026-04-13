import { ref, onMounted, onUnmounted, type Ref } from 'vue'
import { CellValue, QuestionType, type Column, type Team, type Quizzer } from '../types/scoresheet'
import type { SelectorOption } from './useCellSelector'

interface KeyboardNavDeps {
  columns: Ref<Column[]>
  teams: Ref<Team[]>
  teamQuizzers: Ref<Quizzer[][]>
  noJumps: Ref<boolean[]>
  displayColumns: Ref<{ idx: number }[]>
  // Selector state — keyboard nav reads and drives these
  selector: Ref<{ teamIdx: number; seatIdx: number; colIdx: number } | null>
  selectorFocusIdx: Ref<number>
  selectorOptions: Ref<SelectorOption[]>
  openSelectorOnCell: (teamIdx: number, seatIdx: number, colIdx: number) => void
  confirmFocusedOption: () => void
  closeSelector: () => void
  // Actions
  setCell: (teamIdx: number, seatIdx: number, colIdx: number, value: CellValue) => void
  toggleNoJump: (colIdx: number) => void
  isBonusForTeam: (teamIdx: number, colIdx: number) => boolean
  isAfterOut: (teamIdx: number, seatIdx: number, colIdx: number) => boolean
  isFouledOnQuestion: (teamIdx: number, seatIdx: number, colIdx: number) => boolean
  undo: () => void
  redo: () => void
}

const letterMap: Partial<Record<string, CellValue>> = {
  c: CellValue.Correct,
  e: CellValue.Error,
  f: CellValue.Foul,
  b: CellValue.Bonus,
  m: CellValue.MissedBonus,
}

const SELECTOR_COLS = 2

export function useKeyboardNav(deps: KeyboardNavDeps) {
  const {
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
  } = deps

  const focusedCell = ref<{ teamIdx: number; seatIdx: number; colIdx: number } | null>(null)
  const keyboardMode = ref(false)
  let keyboardModeTimer: ReturnType<typeof setTimeout> | null = null

  function activateKeyboardMode() {
    keyboardMode.value = true
    if (keyboardModeTimer !== null) clearTimeout(keyboardModeTimer)
    keyboardModeTimer = setTimeout(() => {
      keyboardMode.value = false
      keyboardModeTimer = null
    }, 30_000)
  }

  function deactivateKeyboardMode() {
    if (keyboardModeTimer !== null) {
      clearTimeout(keyboardModeTimer)
      keyboardModeTimer = null
    }
    keyboardMode.value = false
  }

  function focusCell(teamIdx: number, seatIdx: number, colIdx: number) {
    focusedCell.value = { teamIdx, seatIdx, colIdx }
  }

  function isNoJumpFocus(): boolean {
    return focusedCell.value?.teamIdx === -1
  }

  function isCellNavigable(teamIdx: number, seatIdx: number, colIdx: number): boolean {
    return !isAfterOut(teamIdx, seatIdx, colIdx) && !isFouledOnQuestion(teamIdx, seatIdx, colIdx)
  }

  function allRows(): { teamIdx: number; seatIdx: number }[] {
    const rows: { teamIdx: number; seatIdx: number }[] = []
    for (let t = 0; t < teams.value.length; t++) {
      const count = teamQuizzers.value[t]?.length ?? 0
      for (let s = 0; s < count; s++) rows.push({ teamIdx: t, seatIdx: s })
    }
    rows.push({ teamIdx: -1, seatIdx: -1 }) // no-jump row
    return rows
  }

  function moveFocus(dRow: number, dCol: number) {
    const f = focusedCell.value
    if (!f) return
    const cols = displayColumns.value

    if (dCol !== 0) {
      const curPos = cols.findIndex((c) => c.idx === f.colIdx)
      if (curPos === -1) return
      const nextPos = curPos + dCol
      if (nextPos >= 0 && nextPos < cols.length) focusCell(f.teamIdx, f.seatIdx, cols[nextPos]!.idx)
    }

    if (dRow !== 0) {
      const rows = allRows()
      const curRowIdx = rows.findIndex((r) => r.teamIdx === f.teamIdx && r.seatIdx === f.seatIdx)
      if (curRowIdx === -1) return
      const nextRowIdx = curRowIdx + dRow
      if (nextRowIdx >= 0 && nextRowIdx < rows.length) {
        const row = rows[nextRowIdx]!
        focusCell(row.teamIdx, row.seatIdx, f.colIdx)
      }
    }
  }

  function allowedValues(teamIdx: number, colIdx: number): CellValue[] {
    const col = columns.value[colIdx]
    const isBonus = col?.type === QuestionType.B || isBonusForTeam(teamIdx, colIdx)
    return isBonus
      ? [CellValue.Bonus, CellValue.MissedBonus, CellValue.Foul, CellValue.Empty]
      : [CellValue.Correct, CellValue.Error, CellValue.Foul, CellValue.Empty]
  }

  function onKeydown(event: KeyboardEvent) {
    activateKeyboardMode()
    // Undo/redo — always handled first, before input guard
    if ((event.ctrlKey || event.metaKey) && (event.key === 'z' || event.key === 'Z')) {
      event.preventDefault()
      if (event.shiftKey) redo()
      else undo()
      return
    }
    if ((event.ctrlKey || event.metaKey) && event.key === 'y') {
      event.preventDefault()
      redo()
      return
    }

    // Let text inputs handle their own keys
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLSelectElement ||
      event.target instanceof HTMLTextAreaElement
    )
      return

    const f = focusedCell.value

    if (event.key === 'Escape') {
      event.preventDefault()
      if (selector.value) {
        closeSelector()
        return
      }
      focusedCell.value = null
      return
    }

    // --- Selector open ---
    if (selector.value) {
      const opts = selectorOptions.value
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        selectorFocusIdx.value = Math.min(selectorFocusIdx.value + 1, opts.length - 1)
        return
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        selectorFocusIdx.value = Math.max(selectorFocusIdx.value - 1, 0)
        return
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        selectorFocusIdx.value = Math.min(selectorFocusIdx.value + SELECTOR_COLS, opts.length - 1)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        selectorFocusIdx.value = Math.max(selectorFocusIdx.value - SELECTOR_COLS, 0)
        return
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        confirmFocusedOption()
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        if (f) setCell(f.teamIdx, f.seatIdx, f.colIdx, CellValue.Empty)
        closeSelector()
        return
      }
      const letterVal = letterMap[event.key.toLowerCase()]
      if (letterVal !== undefined && f) {
        event.preventDefault()
        const allowed = allowedValues(f.teamIdx, f.colIdx)
        if (allowed.includes(letterVal)) {
          setCell(f.teamIdx, f.seatIdx, f.colIdx, letterVal)
          closeSelector()
        }
        return
      }
      // Consume all other keys while selector is open
      return
    }

    // --- Selector closed ---

    // Arrow keys: focus top-left if nothing focused yet
    if (!f && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault()
      const firstCol = displayColumns.value[0]
      if (firstCol) focusCell(0, 0, firstCol.idx)
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      moveFocus(-1, 0)
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      moveFocus(1, 0)
      return
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      moveFocus(0, -1)
      return
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      moveFocus(0, 1)
      return
    }

    if (!f) return

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (isNoJumpFocus()) {
        toggleNoJump(f.colIdx)
        return
      }
      openSelectorOnCell(f.teamIdx, f.seatIdx, f.colIdx)
      return
    }

    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      if (isNoJumpFocus()) {
        if (noJumps.value[f.colIdx]) toggleNoJump(f.colIdx)
      } else {
        setCell(f.teamIdx, f.seatIdx, f.colIdx, CellValue.Empty)
      }
      return
    }

    if (event.key === 'x' || event.key === 'X') {
      event.preventDefault()
      toggleNoJump(f.colIdx)
      return
    }

    if (!isNoJumpFocus()) {
      const value = letterMap[event.key.toLowerCase()]
      if (value !== undefined && isCellNavigable(f.teamIdx, f.seatIdx, f.colIdx)) {
        event.preventDefault()
        const allowed = allowedValues(f.teamIdx, f.colIdx)
        if (allowed.includes(value)) setCell(f.teamIdx, f.seatIdx, f.colIdx, value)
      }
    }
  }

  onMounted(() => document.addEventListener('keydown', onKeydown))
  onUnmounted(() => {
    document.removeEventListener('keydown', onKeydown)
    if (keyboardModeTimer !== null) clearTimeout(keyboardModeTimer)
  })

  return { focusedCell, focusCell, isNoJumpFocus, keyboardMode, deactivateKeyboardMode }
}
