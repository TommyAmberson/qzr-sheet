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
  isBonusForTeam: (ti: number, ci: number) => boolean,
  setCell: (ti: number, qi: number, ci: number, value: CellValue) => void,
) {
  const selector = ref<{ ti: number; qi: number; ci: number; x: number; y: number } | null>(null)
  const selectorFocusIdx = ref(0)

  /** Map of "ti:qi:ci" → <td> element for keyboard-triggered open */
  const cellEls = new Map<string, HTMLElement>()

  function registerCellEl(ti: number, qi: number, ci: number, el: HTMLElement | null) {
    const key = `${ti}:${qi}:${ci}`
    if (el) cellEls.set(key, el)
    else cellEls.delete(key)
  }

  const selectorOptions = computed<SelectorOption[]>(() => {
    if (!selector.value) return []
    const { ti, ci } = selector.value
    const col = columns.value[ci]
    if (!col) return []
    if (col.type === QuestionType.B || isBonusForTeam(ti, ci)) return bonusOptions
    return normalOptions
  })

  function openAt(ti: number, qi: number, ci: number, x: number, y: number) {
    selectorFocusIdx.value = 0
    selector.value = { ti, qi, ci, x, y }
  }

  function openFromClick(ti: number, qi: number, ci: number, event: MouseEvent) {
    const td = event.currentTarget as HTMLElement
    const rect = td.getBoundingClientRect()
    openAt(ti, qi, ci, rect.left + rect.width / 2, rect.top + rect.height / 2)
  }

  function openFromCell(ti: number, qi: number, ci: number) {
    const el = cellEls.get(`${ti}:${qi}:${ci}`)
    if (!el) return
    const rect = el.getBoundingClientRect()
    openAt(ti, qi, ci, rect.left + rect.width / 2, rect.top + rect.height / 2)
  }

  function selectValue(value: CellValue) {
    if (!selector.value) return
    setCell(selector.value.ti, selector.value.qi, selector.value.ci, value)
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
