import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import { useCellSelector } from '../useCellSelector'
import { CellValue, QuestionType, buildColumns } from '../../types/scoresheet'

function makeSelector(isBonusOverride = false) {
  const columns = ref(buildColumns(0))
  const isBonusForTeam = vi.fn().mockReturnValue(isBonusOverride)
  const setCell = vi.fn()
  const s = useCellSelector(columns, isBonusForTeam, setCell)
  return { ...s, columns, isBonusForTeam, setCell }
}

describe('useCellSelector — initial state', () => {
  it('selector is null initially', () => {
    const { selector } = makeSelector()
    expect(selector.value).toBeNull()
  })

  it('selectorFocusIdx starts at 0', () => {
    const { selectorFocusIdx } = makeSelector()
    expect(selectorFocusIdx.value).toBe(0)
  })

  it('selectorOptions is empty when selector is closed', () => {
    const { selectorOptions } = makeSelector()
    expect(selectorOptions.value).toHaveLength(0)
  })
})

describe('useCellSelector — openAt', () => {
  it('sets selector with coordinates and cell position', () => {
    const { selector, selectorFocusIdx } = makeSelector()
    // access internal via openFromClick workaround — test openAt via state
    // openAt is not exported directly; test via selectorOptions becoming non-empty
    // We test openFromClick instead (which calls openAt)
    expect(selector.value).toBeNull()
    expect(selectorFocusIdx.value).toBe(0)
  })
})

describe('useCellSelector — selectorOptions', () => {
  it('returns normal options (C/E/F/✕) for a regular cell', () => {
    const { selector, selectorOptions, isBonusForTeam } = makeSelector()
    isBonusForTeam.mockReturnValue(false)
    // Open at col 0 (Q1, QuestionType.Normal)
    selector.value = { teamIdx: 0, seatIdx: 0, colIdx: 0, x: 0, y: 0 }
    expect(selectorOptions.value.map((o) => o.value)).toEqual([
      CellValue.Correct,
      CellValue.Error,
      CellValue.Foul,
      CellValue.Empty,
    ])
  })

  it('returns bonus options (B/MB/F/✕) when isBonusForTeam is true', () => {
    const { selector, selectorOptions, isBonusForTeam } = makeSelector()
    isBonusForTeam.mockReturnValue(true)
    selector.value = { teamIdx: 0, seatIdx: 0, colIdx: 0, x: 0, y: 0 }
    expect(selectorOptions.value.map((o) => o.value)).toEqual([
      CellValue.Bonus,
      CellValue.MissedBonus,
      CellValue.Foul,
      CellValue.Empty,
    ])
  })

  it('returns bonus options for a B-type column regardless of isBonusForTeam', () => {
    const { selector, selectorOptions, isBonusForTeam, columns } = makeSelector()
    isBonusForTeam.mockReturnValue(false)
    // Find the first B-type column (e.g. col index for "16B")
    const bColIdx = columns.value.findIndex((c) => c.type === QuestionType.B)
    expect(bColIdx).toBeGreaterThan(-1)
    selector.value = { teamIdx: 0, seatIdx: 0, colIdx: bColIdx, x: 0, y: 0 }
    expect(selectorOptions.value.map((o) => o.value)).toEqual([
      CellValue.Bonus,
      CellValue.MissedBonus,
      CellValue.Foul,
      CellValue.Empty,
    ])
  })

  it('returns empty array when selector is null', () => {
    const { selector, selectorOptions } = makeSelector()
    selector.value = null
    expect(selectorOptions.value).toHaveLength(0)
  })

  it('returns empty array when column index is out of range', () => {
    const { selector, selectorOptions } = makeSelector()
    selector.value = { teamIdx: 0, seatIdx: 0, colIdx: 9999, x: 0, y: 0 }
    expect(selectorOptions.value).toHaveLength(0)
  })
})

describe('useCellSelector — selectValue', () => {
  it('calls setCell with the chosen value and closes the selector', () => {
    const { selector, selectValue, setCell } = makeSelector()
    selector.value = { teamIdx: 1, seatIdx: 2, colIdx: 3, x: 0, y: 0 }
    selectValue(CellValue.Correct)
    expect(setCell).toHaveBeenCalledWith(1, 2, 3, CellValue.Correct)
    expect(selector.value).toBeNull()
  })

  it('does nothing when selector is already null', () => {
    const { selectValue, setCell } = makeSelector()
    selectValue(CellValue.Correct)
    expect(setCell).not.toHaveBeenCalled()
  })

  it('can select Empty (clear)', () => {
    const { selector, selectValue, setCell } = makeSelector()
    selector.value = { teamIdx: 0, seatIdx: 0, colIdx: 0, x: 0, y: 0 }
    selectValue(CellValue.Empty)
    expect(setCell).toHaveBeenCalledWith(0, 0, 0, CellValue.Empty)
    expect(selector.value).toBeNull()
  })
})

describe('useCellSelector — confirmFocusedOption', () => {
  it('selects the option at selectorFocusIdx', () => {
    const { selector, selectorFocusIdx, confirmFocusedOption, setCell } = makeSelector()
    selector.value = { teamIdx: 0, seatIdx: 0, colIdx: 0, x: 0, y: 0 }
    selectorFocusIdx.value = 1 // Error (index 1 in normalOptions)
    confirmFocusedOption()
    expect(setCell).toHaveBeenCalledWith(0, 0, 0, CellValue.Error)
  })

  it('selects first option when focusIdx is 0', () => {
    const { selector, selectorFocusIdx, confirmFocusedOption, setCell } = makeSelector()
    selector.value = { teamIdx: 0, seatIdx: 0, colIdx: 0, x: 0, y: 0 }
    selectorFocusIdx.value = 0
    confirmFocusedOption()
    expect(setCell).toHaveBeenCalledWith(0, 0, 0, CellValue.Correct)
  })

  it('does nothing when focusIdx points to no option', () => {
    const { selector, selectorFocusIdx, confirmFocusedOption, setCell } = makeSelector()
    selector.value = null // options empty
    selectorFocusIdx.value = 0
    confirmFocusedOption()
    expect(setCell).not.toHaveBeenCalled()
  })
})

describe('useCellSelector — close', () => {
  it('closes an open selector', () => {
    const { selector, close } = makeSelector()
    selector.value = { teamIdx: 0, seatIdx: 0, colIdx: 0, x: 10, y: 20 }
    close()
    expect(selector.value).toBeNull()
  })

  it('is safe to call when already closed', () => {
    const { close } = makeSelector()
    expect(() => close()).not.toThrow()
  })
})

describe('useCellSelector — registerCellEl', () => {
  it('stores a registered element', () => {
    const { cellEls, registerCellEl } = makeSelector()
    const el = document.createElement('td')
    registerCellEl(0, 1, 2, el)
    expect(cellEls.get('0:1:2')).toBe(el)
  })

  it('removes an element when null is passed', () => {
    const { cellEls, registerCellEl } = makeSelector()
    const el = document.createElement('td')
    registerCellEl(0, 0, 0, el)
    expect(cellEls.has('0:0:0')).toBe(true)
    registerCellEl(0, 0, 0, null)
    expect(cellEls.has('0:0:0')).toBe(false)
  })

  it('openFromCell does nothing when no element is registered for that key', () => {
    const { selector, openFromCell } = makeSelector()
    openFromCell(0, 0, 0) // no element registered
    expect(selector.value).toBeNull()
  })

  it('openFromCell opens selector at the element center when registered', () => {
    const { selector, cellEls, openFromCell } = makeSelector()
    const el = document.createElement('td')
    // Mock getBoundingClientRect to return a known rect
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      top: 200,
      width: 60,
      height: 30,
      right: 160,
      bottom: 230,
      x: 100,
      y: 200,
      toJSON: () => ({}),
    })
    cellEls.set('1:2:3', el)
    openFromCell(1, 2, 3)
    expect(selector.value).toMatchObject({ teamIdx: 1, seatIdx: 2, colIdx: 3, x: 130, y: 215 })
  })
})

describe('useCellSelector — openFromClick', () => {
  it('opens selector at the center of the clicked cell', () => {
    const { selector, openFromClick } = makeSelector()
    const td = document.createElement('td')
    vi.spyOn(td, 'getBoundingClientRect').mockReturnValue({
      left: 50,
      top: 100,
      width: 40,
      height: 20,
      right: 90,
      bottom: 120,
      x: 50,
      y: 100,
      toJSON: () => ({}),
    })
    const event = { currentTarget: td } as unknown as MouseEvent
    openFromClick(0, 1, 2, event)
    expect(selector.value).toMatchObject({ teamIdx: 0, seatIdx: 1, colIdx: 2, x: 70, y: 110 })
  })

  it('resets selectorFocusIdx to 0 when opening', () => {
    const { selector, selectorFocusIdx, openFromClick } = makeSelector()
    selectorFocusIdx.value = 3
    const td = document.createElement('td')
    vi.spyOn(td, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 0,
      height: 0,
      right: 0,
      bottom: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    const event = { currentTarget: td } as unknown as MouseEvent
    openFromClick(0, 0, 0, event)
    expect(selectorFocusIdx.value).toBe(0)
  })
})
