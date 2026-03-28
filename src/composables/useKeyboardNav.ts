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
  selector: Ref<{ ti: number; qi: number; ci: number } | null>
  selectorFocusIdx: Ref<number>
  selectorOptions: Ref<SelectorOption[]>
  openSelectorOnCell: (ti: number, qi: number, ci: number) => void
  confirmFocusedOption: () => void
  closeSelector: () => void
  // Actions
  setCell: (ti: number, qi: number, ci: number, value: CellValue) => void
  toggleNoJump: (ci: number) => void
  isBonusForTeam: (ti: number, ci: number) => boolean
  isAfterOut: (ti: number, qi: number, ci: number) => boolean
  isFouledOnQuestion: (ti: number, qi: number, ci: number) => boolean
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

  const focusedCell = ref<{ ti: number; qi: number; ci: number } | null>(null)

  function focusCell(ti: number, qi: number, ci: number) {
    focusedCell.value = { ti, qi, ci }
  }

  function isNoJumpFocus(): boolean {
    return focusedCell.value?.ti === -1
  }

  function isCellNavigable(ti: number, qi: number, ci: number): boolean {
    return !isAfterOut(ti, qi, ci) && !isFouledOnQuestion(ti, qi, ci)
  }

  function allRows(): { ti: number; qi: number }[] {
    const rows: { ti: number; qi: number }[] = []
    for (let ti = 0; ti < teams.value.length; ti++) {
      const count = teamQuizzers.value[ti]?.length ?? 0
      for (let qi = 0; qi < count; qi++) rows.push({ ti, qi })
    }
    rows.push({ ti: -1, qi: -1 }) // no-jump row
    return rows
  }

  function moveFocus(dqi: number, dci: number) {
    const f = focusedCell.value
    if (!f) return
    const cols = displayColumns.value

    if (dci !== 0) {
      const curPos = cols.findIndex((c) => c.idx === f.ci)
      if (curPos === -1) return
      const nextPos = curPos + dci
      if (nextPos >= 0 && nextPos < cols.length) focusCell(f.ti, f.qi, cols[nextPos]!.idx)
    }

    if (dqi !== 0) {
      const rows = allRows()
      const curRowIdx = rows.findIndex((r) => r.ti === f.ti && r.qi === f.qi)
      if (curRowIdx === -1) return
      const nextRowIdx = curRowIdx + dqi
      if (nextRowIdx >= 0 && nextRowIdx < rows.length) {
        const row = rows[nextRowIdx]!
        focusCell(row.ti, row.qi, f.ci)
      }
    }
  }

  function allowedValues(ti: number, ci: number): CellValue[] {
    const col = columns.value[ci]
    const isBonus = col?.type === QuestionType.B || isBonusForTeam(ti, ci)
    return isBonus
      ? [CellValue.Bonus, CellValue.MissedBonus, CellValue.Foul, CellValue.Empty]
      : [CellValue.Correct, CellValue.Error, CellValue.Foul, CellValue.Empty]
  }

  function onKeydown(event: KeyboardEvent) {
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
        if (f) setCell(f.ti, f.qi, f.ci, CellValue.Empty)
        closeSelector()
        return
      }
      const letterVal = letterMap[event.key.toLowerCase()]
      if (letterVal !== undefined && f) {
        event.preventDefault()
        const allowed = allowedValues(f.ti, f.ci)
        if (allowed.includes(letterVal)) {
          setCell(f.ti, f.qi, f.ci, letterVal)
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
        toggleNoJump(f.ci)
        return
      }
      openSelectorOnCell(f.ti, f.qi, f.ci)
      return
    }

    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      if (isNoJumpFocus()) {
        if (noJumps.value[f.ci]) toggleNoJump(f.ci)
      } else {
        setCell(f.ti, f.qi, f.ci, CellValue.Empty)
      }
      return
    }

    if (event.key === 'x' || event.key === 'X') {
      event.preventDefault()
      toggleNoJump(f.ci)
      return
    }

    if (!isNoJumpFocus()) {
      const value = letterMap[event.key.toLowerCase()]
      if (value !== undefined && isCellNavigable(f.ti, f.qi, f.ci)) {
        event.preventDefault()
        const allowed = allowedValues(f.ti, f.ci)
        if (allowed.includes(value)) setCell(f.ti, f.qi, f.ci, value)
      }
    }
  }

  onMounted(() => document.addEventListener('keydown', onKeydown))
  onUnmounted(() => document.removeEventListener('keydown', onKeydown))

  return { focusedCell, focusCell, isNoJumpFocus }
}
