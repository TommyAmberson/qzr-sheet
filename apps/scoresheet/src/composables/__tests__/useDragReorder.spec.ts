import { describe, it, expect, vi, afterEach } from 'vitest'
import { ref } from 'vue'
import { useDragReorder } from '../useDragReorder'
import type { Quizzer } from '../../types/scoresheet'
import { toQuizzerId } from '../../types/indices'

function makeQuizzers(counts: number[]): Quizzer[][] {
  return counts.map((n, teamIdx) =>
    Array.from({ length: n }, (_, seatIdx) => ({
      id: toQuizzerId(teamIdx * 10 + seatIdx),
      teamId: teamIdx,
      name: `Q${seatIdx + 1}`,
      seatOrder: seatIdx,
    })),
  )
}

function makeDrag() {
  const teamQuizzers = ref(makeQuizzers([3, 2]))
  const moveQuizzer = vi.fn()
  const drag = useDragReorder(teamQuizzers, moveQuizzer)
  return { ...drag, teamQuizzers, moveQuizzer }
}

function pointerEvent(type: string, y: number): PointerEvent {
  return new PointerEvent(type, { clientY: y, bubbles: true })
}

afterEach(() => {
  // Clean up any lingering pointer listeners by dispatching a pointerup
  document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
})

describe('useDragReorder — initial state', () => {
  it('dragState is null initially', () => {
    const { dragState } = makeDrag()
    expect(dragState.value).toBeNull()
  })

  it('dropTarget is null initially', () => {
    const { dropTarget } = makeDrag()
    expect(dropTarget.value).toBeNull()
  })

  it('dropIndicatorWidth defaults to 100%', () => {
    const { dropIndicatorWidth } = makeDrag()
    expect(dropIndicatorWidth.value).toBe('100%')
  })
})

describe('useDragReorder — registerRowEl', () => {
  it('registering and unregistering an element does not throw', () => {
    const { registerRowEl } = makeDrag()
    const el = document.createElement('tr')
    expect(() => registerRowEl(0, 1, el)).not.toThrow()
    expect(() => registerRowEl(0, 1, null)).not.toThrow()
  })

  it('unregistered element is not found by onPointerMove (dropTarget stays null)', () => {
    const { dragState, dropTarget, onPointerDown } = makeDrag()
    // No elements registered — onPointerMove cannot find rows
    onPointerDown(0, 0, new PointerEvent('pointerdown'))
    document.dispatchEvent(pointerEvent('pointermove', 50))
    expect(dropTarget.value).toBeNull()
  })
})

describe('useDragReorder — onPointerDown', () => {
  it('sets dragState on pointer down', () => {
    const { dragState, onPointerDown } = makeDrag()
    const event = new PointerEvent('pointerdown', { bubbles: true })
    onPointerDown(0, 1, event)
    expect(dragState.value).toEqual({ teamIdx: 0, seatIdx: 1 })
  })

  it('attaches pointermove and pointerup listeners to document', () => {
    const { onPointerDown } = makeDrag()
    const addSpy = vi.spyOn(document, 'addEventListener')
    const event = new PointerEvent('pointerdown', { bubbles: true })
    onPointerDown(1, 0, event)
    expect(addSpy).toHaveBeenCalledWith('pointermove', expect.any(Function))
    expect(addSpy).toHaveBeenCalledWith('pointerup', expect.any(Function))
    addSpy.mockRestore()
  })
})

describe('useDragReorder — onPointerUp', () => {
  it('calls moveQuizzer when a valid drop target is set', () => {
    const { dragState, dropTarget, onPointerDown, moveQuizzer } = makeDrag()
    const event = new PointerEvent('pointerdown', { bubbles: true })
    onPointerDown(0, 0, event)
    // Manually set a drop target (simulating what onPointerMove would set)
    dropTarget.value = { teamIdx: 0, seatIdx: 2 }
    document.dispatchEvent(pointerEvent('pointerup', 0))
    expect(moveQuizzer).toHaveBeenCalledWith(0, 0, 2)
    expect(dragState.value).toBeNull()
    expect(dropTarget.value).toBeNull()
  })

  it('does not call moveQuizzer when dropTarget is null', () => {
    const { onPointerDown, moveQuizzer } = makeDrag()
    onPointerDown(0, 0, new PointerEvent('pointerdown'))
    document.dispatchEvent(pointerEvent('pointerup', 0))
    expect(moveQuizzer).not.toHaveBeenCalled()
  })

  it('clears dragState and dropTarget on pointer up', () => {
    const { dragState, dropTarget, onPointerDown } = makeDrag()
    onPointerDown(0, 1, new PointerEvent('pointerdown'))
    dropTarget.value = { teamIdx: 0, seatIdx: 0 }
    document.dispatchEvent(pointerEvent('pointerup', 0))
    expect(dragState.value).toBeNull()
    expect(dropTarget.value).toBeNull()
  })

  it('removes document listeners after pointer up', () => {
    const { onPointerDown } = makeDrag()
    const removeSpy = vi.spyOn(document, 'removeEventListener')
    onPointerDown(0, 0, new PointerEvent('pointerdown'))
    document.dispatchEvent(pointerEvent('pointerup', 0))
    expect(removeSpy).toHaveBeenCalledWith('pointermove', expect.any(Function))
    expect(removeSpy).toHaveBeenCalledWith('pointerup', expect.any(Function))
    removeSpy.mockRestore()
  })
})

function mockRowRect(el: HTMLElement, top: number) {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    top,
    bottom: top + 30,
    left: 0,
    right: 200,
    width: 200,
    height: 30,
    x: 0,
    y: top,
    toJSON: () => ({}),
  })
}

describe('useDragReorder — onPointerMove', () => {
  it('sets dropTarget when moving to a lower row', () => {
    const { dropTarget, registerRowEl, onPointerDown } = makeDrag()

    const rows = [0, 1, 2].map((seatIdx) => {
      const el = document.createElement('tr')
      mockRowRect(el, seatIdx * 30)
      registerRowEl(0, seatIdx, el)
      return el
    })

    onPointerDown(0, 0, new PointerEvent('pointerdown'))
    document.dispatchEvent(pointerEvent('pointermove', 65)) // row 2 (y=60–90)
    expect(dropTarget.value).toEqual({ teamIdx: 0, seatIdx: 2 })
    rows.forEach(() => vi.restoreAllMocks())
  })

  it('sets dropTarget when moving to a higher row', () => {
    const { dropTarget, registerRowEl, onPointerDown } = makeDrag()

    const rows = [0, 1, 2].map((seatIdx) => {
      const el = document.createElement('tr')
      mockRowRect(el, seatIdx * 30)
      registerRowEl(0, seatIdx, el)
      return el
    })

    onPointerDown(0, 2, new PointerEvent('pointerdown')) // dragging from row 2
    document.dispatchEvent(pointerEvent('pointermove', 15)) // row 0 (y=0–30)
    expect(dropTarget.value).toEqual({ teamIdx: 0, seatIdx: 0 })
    rows.forEach(() => vi.restoreAllMocks())
  })

  it('sets dropTarget to null when pointer is on the same row as drag source', () => {
    const { dropTarget, registerRowEl, onPointerDown } = makeDrag()

    const el = document.createElement('tr')
    mockRowRect(el, 0)
    registerRowEl(0, 0, el)

    onPointerDown(0, 0, new PointerEvent('pointerdown'))
    document.dispatchEvent(pointerEvent('pointermove', 15)) // still on row 0
    expect(dropTarget.value).toBeNull()
    vi.restoreAllMocks()
  })
})
