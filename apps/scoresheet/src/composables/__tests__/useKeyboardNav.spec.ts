import { describe, it, expect, vi, afterEach } from 'vitest'
import { ref, defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { useKeyboardNav } from '../useKeyboardNav'
import { CellValue, buildColumns } from '../../types/scoresheet'
import type { SelectorOption } from '../useCellSelector'

// Helper to mount a minimal component that calls useKeyboardNav,
// giving the composable a proper lifecycle context (onMounted/onUnmounted).
function mountNav() {
  const deps = {
    columns: ref(buildColumns(0)),
    teams: ref([
      { id: 1, name: 'T1', onTime: true, seatOrder: 0, quizId: 1 },
      { id: 2, name: 'T2', onTime: true, seatOrder: 1, quizId: 1 },
    ]),
    teamQuizzers: ref([
      [
        { id: 1, teamId: 1, name: 'Q1', seatOrder: 0 },
        { id: 2, teamId: 1, name: 'Q2', seatOrder: 1 },
      ],
      [
        { id: 3, teamId: 2, name: 'Q3', seatOrder: 0 },
        { id: 4, teamId: 2, name: 'Q4', seatOrder: 1 },
      ],
    ]),
    noJumps: ref([false, false, false]),
    // Three display columns: indices 0, 1, 2
    displayColumns: ref([{ idx: 0 }, { idx: 1 }, { idx: 2 }]),
    selector: ref<{ ti: number; qi: number; ci: number } | null>(null),
    selectorFocusIdx: ref(0),
    selectorOptions: ref<SelectorOption[]>([]),
    openSelectorOnCell: vi.fn(),
    confirmFocusedOption: vi.fn(),
    closeSelector: vi.fn(),
    setCell: vi.fn(),
    toggleNoJump: vi.fn(),
    isBonusForTeam: vi.fn().mockReturnValue(false),
    isAfterOut: vi.fn().mockReturnValue(false),
    isFouledOnQuestion: vi.fn().mockReturnValue(false),
    undo: vi.fn(),
    redo: vi.fn(),
  }

  let nav!: ReturnType<typeof useKeyboardNav>
  const wrapper = mount(
    defineComponent({
      setup() {
        nav = useKeyboardNav(deps)
        return () => null
      },
    }),
  )

  return { nav, deps, wrapper }
}

function key(k: string, opts: KeyboardEventInit = {}) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...opts }))
}

afterEach(() => {
  // Unmount cleans up the keydown listener via onUnmounted
  // Handled per-test by calling wrapper.unmount() where needed
})

describe('useKeyboardNav — initial state', () => {
  it('focusedCell is null initially', () => {
    const { nav, wrapper } = mountNav()
    expect(nav.focusedCell.value).toBeNull()
    wrapper.unmount()
  })

  it('keyboardMode is false initially', () => {
    const { nav, wrapper } = mountNav()
    expect(nav.keyboardMode.value).toBe(false)
    wrapper.unmount()
  })
})

describe('useKeyboardNav — focusCell', () => {
  it('focusCell sets the focused cell', () => {
    const { nav, wrapper } = mountNav()
    nav.focusCell(0, 1, 2)
    expect(nav.focusedCell.value).toEqual({ ti: 0, qi: 1, ci: 2 })
    wrapper.unmount()
  })

  it('isNoJumpFocus returns false for a normal cell', () => {
    const { nav, wrapper } = mountNav()
    nav.focusCell(0, 0, 0)
    expect(nav.isNoJumpFocus()).toBe(false)
    wrapper.unmount()
  })

  it('isNoJumpFocus returns true when ti === -1', () => {
    const { nav, wrapper } = mountNav()
    nav.focusCell(-1, -1, 0)
    expect(nav.isNoJumpFocus()).toBe(true)
    wrapper.unmount()
  })
})

describe('useKeyboardNav — arrow keys with no focus', () => {
  it('ArrowDown focuses top-left cell when nothing is focused', () => {
    const { nav, wrapper } = mountNav()
    key('ArrowDown')
    expect(nav.focusedCell.value).toEqual({ ti: 0, qi: 0, ci: 0 })
    wrapper.unmount()
  })

  it('ArrowUp focuses top-left cell when nothing is focused', () => {
    const { nav, wrapper } = mountNav()
    key('ArrowUp')
    expect(nav.focusedCell.value).toEqual({ ti: 0, qi: 0, ci: 0 })
    wrapper.unmount()
  })
})

describe('useKeyboardNav — arrow navigation with focus', () => {
  it('ArrowDown moves to the next quizzer row', () => {
    const { nav, wrapper } = mountNav()
    nav.focusCell(0, 0, 0)
    key('ArrowDown')
    expect(nav.focusedCell.value).toEqual({ ti: 0, qi: 1, ci: 0 })
    wrapper.unmount()
  })

  it('ArrowDown moves to next team when at last quizzer in team', () => {
    const { nav, wrapper } = mountNav()
    nav.focusCell(0, 1, 0) // last quizzer of team 0
    key('ArrowDown')
    expect(nav.focusedCell.value).toEqual({ ti: 1, qi: 0, ci: 0 })
    wrapper.unmount()
  })

  it('ArrowUp moves to the previous quizzer row', () => {
    const { nav, wrapper } = mountNav()
    nav.focusCell(0, 1, 0)
    key('ArrowUp')
    expect(nav.focusedCell.value).toEqual({ ti: 0, qi: 0, ci: 0 })
    wrapper.unmount()
  })

  it('ArrowRight moves to the next display column', () => {
    const { nav, wrapper } = mountNav()
    nav.focusCell(0, 0, 0)
    key('ArrowRight')
    expect(nav.focusedCell.value).toEqual({ ti: 0, qi: 0, ci: 1 })
    wrapper.unmount()
  })

  it('ArrowLeft moves to the previous display column', () => {
    const { nav, wrapper } = mountNav()
    nav.focusCell(0, 0, 1)
    key('ArrowLeft')
    expect(nav.focusedCell.value).toEqual({ ti: 0, qi: 0, ci: 0 })
    wrapper.unmount()
  })

  it('ArrowLeft does not go before first column', () => {
    const { nav, wrapper } = mountNav()
    nav.focusCell(0, 0, 0)
    key('ArrowLeft')
    expect(nav.focusedCell.value).toEqual({ ti: 0, qi: 0, ci: 0 })
    wrapper.unmount()
  })

  it('ArrowRight does not go past last display column', () => {
    const { nav, wrapper } = mountNav()
    nav.focusCell(0, 0, 2) // last display column index
    key('ArrowRight')
    expect(nav.focusedCell.value).toEqual({ ti: 0, qi: 0, ci: 2 })
    wrapper.unmount()
  })

  it('ArrowUp from top row does not move', () => {
    const { nav, wrapper } = mountNav()
    nav.focusCell(0, 0, 1)
    key('ArrowUp')
    expect(nav.focusedCell.value).toEqual({ ti: 0, qi: 0, ci: 1 })
    wrapper.unmount()
  })
})

describe('useKeyboardNav — Escape', () => {
  it('Escape clears focus when selector is closed', () => {
    const { nav, wrapper } = mountNav()
    nav.focusCell(0, 0, 0)
    key('Escape')
    expect(nav.focusedCell.value).toBeNull()
    wrapper.unmount()
  })

  it('Escape calls closeSelector when selector is open', () => {
    const { nav, deps, wrapper } = mountNav()
    nav.focusCell(0, 0, 0)
    deps.selector.value = { ti: 0, qi: 0, ci: 0 }
    key('Escape')
    expect(deps.closeSelector).toHaveBeenCalled()
    wrapper.unmount()
  })
})

describe('useKeyboardNav — Enter/Space', () => {
  it('Enter opens selector on focused cell', () => {
    const { nav, deps, wrapper } = mountNav()
    nav.focusCell(0, 0, 0)
    key('Enter')
    expect(deps.openSelectorOnCell).toHaveBeenCalledWith(0, 0, 0)
    wrapper.unmount()
  })

  it('Space opens selector on focused cell', () => {
    const { nav, deps, wrapper } = mountNav()
    nav.focusCell(0, 1, 2)
    key(' ')
    expect(deps.openSelectorOnCell).toHaveBeenCalledWith(0, 1, 2)
    wrapper.unmount()
  })

  it('Enter toggles no-jump when focused on no-jump row', () => {
    const { nav, deps, wrapper } = mountNav()
    nav.focusCell(-1, -1, 0)
    key('Enter')
    expect(deps.toggleNoJump).toHaveBeenCalledWith(0)
    wrapper.unmount()
  })
})

describe('useKeyboardNav — Delete/Backspace', () => {
  it('Delete clears the focused cell', () => {
    const { nav, deps, wrapper } = mountNav()
    nav.focusCell(0, 0, 0)
    key('Delete')
    expect(deps.setCell).toHaveBeenCalledWith(0, 0, 0, CellValue.Empty)
    wrapper.unmount()
  })

  it('Backspace clears the focused cell', () => {
    const { nav, deps, wrapper } = mountNav()
    nav.focusCell(1, 0, 1)
    key('Backspace')
    expect(deps.setCell).toHaveBeenCalledWith(1, 0, 1, CellValue.Empty)
    wrapper.unmount()
  })

  it('Delete on no-jump row toggles no-jump if currently set', () => {
    const { nav, deps, wrapper } = mountNav()
    deps.noJumps.value = [true, false, false]
    nav.focusCell(-1, -1, 0)
    key('Delete')
    expect(deps.toggleNoJump).toHaveBeenCalledWith(0)
    wrapper.unmount()
  })

  it('Delete on no-jump row does nothing if no-jump is not set', () => {
    const { nav, deps, wrapper } = mountNav()
    deps.noJumps.value = [false, false, false]
    nav.focusCell(-1, -1, 0)
    key('Delete')
    expect(deps.toggleNoJump).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})

describe('useKeyboardNav — letter shortcuts', () => {
  it("'c' sets correct on focused normal cell", () => {
    const { nav, deps, wrapper } = mountNav()
    nav.focusCell(0, 0, 0)
    key('c')
    expect(deps.setCell).toHaveBeenCalledWith(0, 0, 0, CellValue.Correct)
    wrapper.unmount()
  })

  it("'e' sets error on focused normal cell", () => {
    const { nav, deps, wrapper } = mountNav()
    nav.focusCell(0, 0, 0)
    key('e')
    expect(deps.setCell).toHaveBeenCalledWith(0, 0, 0, CellValue.Error)
    wrapper.unmount()
  })

  it("'f' sets foul on focused normal cell", () => {
    const { nav, deps, wrapper } = mountNav()
    nav.focusCell(0, 0, 0)
    key('f')
    expect(deps.setCell).toHaveBeenCalledWith(0, 0, 0, CellValue.Foul)
    wrapper.unmount()
  })

  it("'b' is not valid on a normal (non-bonus) cell", () => {
    const { nav, deps, wrapper } = mountNav()
    deps.isBonusForTeam.mockReturnValue(false)
    nav.focusCell(0, 0, 0)
    key('b')
    expect(deps.setCell).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('letter shortcuts do nothing when cell is after-out', () => {
    const { nav, deps, wrapper } = mountNav()
    deps.isAfterOut.mockReturnValue(true)
    nav.focusCell(0, 0, 0)
    key('c')
    expect(deps.setCell).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})

describe('useKeyboardNav — x key (no-jump toggle)', () => {
  it("'x' toggles no-jump on focused column", () => {
    const { nav, deps, wrapper } = mountNav()
    nav.focusCell(0, 0, 1)
    key('x')
    expect(deps.toggleNoJump).toHaveBeenCalledWith(1)
    wrapper.unmount()
  })

  it("'X' (shift) also toggles no-jump", () => {
    const { nav, deps, wrapper } = mountNav()
    nav.focusCell(0, 0, 0)
    key('X')
    expect(deps.toggleNoJump).toHaveBeenCalledWith(0)
    wrapper.unmount()
  })
})

describe('useKeyboardNav — undo/redo', () => {
  it('Ctrl+Z calls undo', () => {
    const { deps, wrapper } = mountNav()
    key('z', { ctrlKey: true })
    expect(deps.undo).toHaveBeenCalled()
    wrapper.unmount()
  })

  it('Ctrl+Shift+Z calls redo', () => {
    const { deps, wrapper } = mountNav()
    key('z', { ctrlKey: true, shiftKey: true })
    expect(deps.redo).toHaveBeenCalled()
    wrapper.unmount()
  })

  it('Ctrl+Y calls redo', () => {
    const { deps, wrapper } = mountNav()
    key('y', { ctrlKey: true })
    expect(deps.redo).toHaveBeenCalled()
    wrapper.unmount()
  })
})

describe('useKeyboardNav — selector open navigation', () => {
  it('ArrowRight increments selectorFocusIdx when selector is open', () => {
    const { nav, deps, wrapper } = mountNav()
    nav.focusCell(0, 0, 0)
    deps.selector.value = { ti: 0, qi: 0, ci: 0 }
    deps.selectorOptions.value = [
      { label: 'A', value: CellValue.Correct, cls: '' },
      { label: 'B', value: CellValue.Error, cls: '' },
    ]
    deps.selectorFocusIdx.value = 0
    key('ArrowRight')
    expect(deps.selectorFocusIdx.value).toBe(1)
    wrapper.unmount()
  })

  it('ArrowLeft decrements selectorFocusIdx but not below 0', () => {
    const { nav, deps, wrapper } = mountNav()
    nav.focusCell(0, 0, 0)
    deps.selector.value = { ti: 0, qi: 0, ci: 0 }
    deps.selectorOptions.value = [
      { label: 'A', value: CellValue.Correct, cls: '' },
      { label: 'B', value: CellValue.Error, cls: '' },
    ]
    deps.selectorFocusIdx.value = 0
    key('ArrowLeft')
    expect(deps.selectorFocusIdx.value).toBe(0)
    wrapper.unmount()
  })

  it('Enter confirms focused option when selector is open', () => {
    const { nav, deps, wrapper } = mountNav()
    nav.focusCell(0, 0, 0)
    deps.selector.value = { ti: 0, qi: 0, ci: 0 }
    key('Enter')
    expect(deps.confirmFocusedOption).toHaveBeenCalled()
    wrapper.unmount()
  })
})

describe('useKeyboardNav — keyboard mode', () => {
  it('any key press activates keyboard mode', () => {
    const { nav, wrapper } = mountNav()
    key('ArrowDown')
    expect(nav.keyboardMode.value).toBe(true)
    wrapper.unmount()
  })

  it('deactivateKeyboardMode turns keyboard mode off', () => {
    const { nav, wrapper } = mountNav()
    key('ArrowDown') // activates
    nav.deactivateKeyboardMode()
    expect(nav.keyboardMode.value).toBe(false)
    wrapper.unmount()
  })
})
