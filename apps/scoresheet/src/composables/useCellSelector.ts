import { ref, computed, type Ref } from 'vue'
import { CellValue, QuestionType, type Column } from '../types/scoresheet'

export interface SelectorOption {
  value: CellValue
  label: string
  cls: string
}

const bonusOptions: SelectorOption[] = [
  { value: CellValue.Bonus, label: 'B', cls: 'opt--bonus' },
  { value: CellValue.MissedBonus, label: 'MB', cls: 'opt--missed-bonus' },
  { value: CellValue.Foul, label: 'F', cls: 'opt--foul' },
  { value: CellValue.Empty, label: '✕', cls: 'opt--clear' },
]

const normalOptions: SelectorOption[] = [
  { value: CellValue.Correct, label: 'C', cls: 'opt--correct' },
  { value: CellValue.Error, label: 'E', cls: 'opt--error' },
  { value: CellValue.Foul, label: 'F', cls: 'opt--foul' },
  { value: CellValue.Empty, label: '✕', cls: 'opt--clear' },
]

export function useCellSelector(
  columns: Ref<Column[]>,
  isBonusForTeam: (teamIdx: number, colIdx: number) => boolean,
  setCell: (teamIdx: number, seatIdx: number, colIdx: number, value: CellValue) => void,
) {
  const selector = ref<{
    teamIdx: number
    seatIdx: number
    colIdx: number
    x: number
    y: number
  } | null>(null)
  const selectorFocusIdx = ref(0)

  /** Map of "teamIdx:seatIdx:colIdx" → <td> element for keyboard-triggered open */
  const cellEls = new Map<string, HTMLElement>()

  function registerCellEl(
    teamIdx: number,
    seatIdx: number,
    colIdx: number,
    el: HTMLElement | null,
  ) {
    const key = `${teamIdx}:${seatIdx}:${colIdx}`
    if (el) cellEls.set(key, el)
    else cellEls.delete(key)
  }

  const selectorOptions = computed<SelectorOption[]>(() => {
    if (!selector.value) return []
    const { teamIdx, colIdx } = selector.value
    const col = columns.value[colIdx]
    if (!col) return []
    if (col.type === QuestionType.B || isBonusForTeam(teamIdx, colIdx)) return bonusOptions
    return normalOptions
  })

  function openAt(teamIdx: number, seatIdx: number, colIdx: number, x: number, y: number) {
    selectorFocusIdx.value = 0
    // Clamp so the popup stays within the viewport (2×2 grid of buttons + padding)
    const isCoarse =
      typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
    const btnSize = isCoarse ? 44 : 32
    const popupW = btnSize * 2 + 8
    const popupH = btnSize * 2 + 8
    const pad = 8
    const cx = Math.max(popupW / 2 + pad, Math.min(x, window.innerWidth - popupW / 2 - pad))
    const cy = Math.max(popupH / 2 + pad, Math.min(y, window.innerHeight - popupH / 2 - pad))
    selector.value = { teamIdx, seatIdx, colIdx, x: cx, y: cy }
  }

  function openFromClick(teamIdx: number, seatIdx: number, colIdx: number, event: MouseEvent) {
    const td = event.currentTarget as HTMLElement
    const rect = td.getBoundingClientRect()
    openAt(teamIdx, seatIdx, colIdx, rect.left + rect.width / 2, rect.top + rect.height / 2)
  }

  function openFromCell(teamIdx: number, seatIdx: number, colIdx: number) {
    const el = cellEls.get(`${teamIdx}:${seatIdx}:${colIdx}`)
    if (!el) return
    const rect = el.getBoundingClientRect()
    openAt(teamIdx, seatIdx, colIdx, rect.left + rect.width / 2, rect.top + rect.height / 2)
  }

  function selectValue(value: CellValue) {
    if (!selector.value) return
    setCell(selector.value.teamIdx, selector.value.seatIdx, selector.value.colIdx, value)
    selector.value = null
  }

  function confirmFocusedOption() {
    const opt = selectorOptions.value[selectorFocusIdx.value]
    if (opt) selectValue(opt.value)
  }

  function close() {
    selector.value = null
  }

  return {
    selector,
    selectorFocusIdx,
    selectorOptions,
    cellEls,
    registerCellEl,
    openFromClick,
    openFromCell,
    selectValue,
    confirmFocusedOption,
    close,
  }
}
