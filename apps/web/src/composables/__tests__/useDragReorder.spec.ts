import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'
import { useDragReorder } from '../useDragReorder'

// Mock for direct onPointerDown calls (needs preventDefault)
function mockPointerDown(x: number, y: number, pointerType = 'mouse'): PointerEvent {
  return {
    type: 'pointerdown',
    clientX: x,
    clientY: y,
    pointerType,
    preventDefault: vi.fn(),
  } as unknown as PointerEvent
}

// Real event for document.dispatchEvent
function pointerMove(x: number, y: number): PointerEvent {
  return new PointerEvent('pointermove', { clientX: x, clientY: y })
}

function pointerUp(): PointerEvent {
  return new PointerEvent('pointerup')
}

// Create a fake element with a fixed bounding rect
function fakeEl(left: number, top: number, width: number, height: number): HTMLElement {
  return {
    getBoundingClientRect: () => ({
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
      x: left,
      y: top,
      toJSON: () => {},
    }),
  } as unknown as HTMLElement
}

describe('useDragReorder', () => {
  let onDrop: ReturnType<typeof vi.fn>

  beforeEach(() => {
    onDrop = vi.fn()
    // Mock window.getSelection
    vi.spyOn(window, 'getSelection').mockReturnValue({
      removeAllRanges: vi.fn(),
    } as unknown as Selection)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sets dragState on pointerdown', () => {
    const { onPointerDown, dragState, cleanup } = useDragReorder({ onDrop })
    const event = mockPointerDown(50, 50)
    onPointerDown('q1', 'team1', event)
    expect(dragState.value).toEqual({ itemId: 'q1', containerId: 'team1' })
    expect(event.preventDefault).toHaveBeenCalled()
    cleanup()
  })

  it('activates immediately for mouse', () => {
    const { onPointerDown, dropTarget, registerContainer, registerItem, cleanup } = useDragReorder({
      onDrop,
    })

    const containerEl = fakeEl(0, 0, 200, 400)
    const itemEl = fakeEl(0, 0, 200, 40)
    registerContainer('team1', containerEl)
    registerItem('q1', 'team1', itemEl)

    onPointerDown('q1', 'team1', mockPointerDown(50, 20, 'mouse'))

    document.dispatchEvent(pointerMove(51, 21))
    expect(dropTarget.value).not.toBeNull()
    cleanup()
  })

  it('requires 5px threshold for touch before activating', () => {
    const { onPointerDown, dropTarget, registerContainer, registerItem, cleanup } = useDragReorder({
      onDrop,
    })

    const containerEl = fakeEl(0, 0, 200, 400)
    const itemEl = fakeEl(0, 0, 200, 40)
    registerContainer('team1', containerEl)
    registerItem('q1', 'team1', itemEl)

    onPointerDown('q1', 'team1', mockPointerDown(50, 50, 'touch'))

    // Small move — below threshold
    document.dispatchEvent(pointerMove(52, 52))
    expect(dropTarget.value).toBeNull()

    // Large move — above threshold
    document.dispatchEvent(pointerMove(56, 56))
    expect(dropTarget.value).not.toBeNull()
    cleanup()
  })

  it('calls onDrop with correct args on pointerup', () => {
    const { onPointerDown, registerContainer, registerItem, cleanup } = useDragReorder({ onDrop })

    const containerEl = fakeEl(0, 0, 200, 400)
    const item1El = fakeEl(0, 0, 200, 40)
    const item2El = fakeEl(0, 40, 200, 40)
    registerContainer('team1', containerEl)
    registerItem('q1', 'team1', item1El)
    registerItem('q2', 'team1', item2El)

    onPointerDown('q2', 'team1', mockPointerDown(50, 60, 'mouse'))
    document.dispatchEvent(pointerMove(50, 10))
    document.dispatchEvent(pointerUp())

    expect(onDrop).toHaveBeenCalledWith('team1', 'q2', 'team1', 'q1')
    cleanup()
  })

  it('supports cross-container moves', () => {
    const { onPointerDown, registerContainer, registerItem, cleanup } = useDragReorder({ onDrop })

    const container1 = fakeEl(0, 0, 200, 200)
    const container2 = fakeEl(210, 0, 200, 200)
    const item1 = fakeEl(0, 0, 200, 40)
    const item2 = fakeEl(210, 0, 200, 40)
    registerContainer('team1', container1)
    registerContainer('team2', container2)
    registerItem('q1', 'team1', item1)
    registerItem('q2', 'team2', item2)

    onPointerDown('q1', 'team1', mockPointerDown(50, 20, 'mouse'))
    // Move to team2, above q2's midpoint (y=20) so insert-before triggers
    document.dispatchEvent(pointerMove(310, 10))
    document.dispatchEvent(pointerUp())

    expect(onDrop).toHaveBeenCalledWith('team1', 'q1', 'team2', 'q2')
    cleanup()
  })

  it('appends when pointer is below all items (beforeItemId = null)', () => {
    const { onPointerDown, registerContainer, registerItem, dropTarget, cleanup } = useDragReorder({
      onDrop,
    })

    const containerEl = fakeEl(0, 0, 200, 400)
    const item1El = fakeEl(0, 0, 200, 40)
    registerContainer('team1', containerEl)
    registerItem('q1', 'team1', item1El)

    onPointerDown('q1', 'team1', mockPointerDown(50, 20, 'mouse'))
    document.dispatchEvent(pointerMove(50, 300))

    expect(dropTarget.value).toEqual({ containerId: 'team1', beforeItemId: null })
    cleanup()
  })

  it('clears state on pointerup without valid drop target', () => {
    const { onPointerDown, dragState, dropTarget, cleanup } = useDragReorder({ onDrop })

    onPointerDown('q1', 'team1', mockPointerDown(50, 50, 'mouse'))
    document.dispatchEvent(pointerUp())

    expect(dragState.value).toBeNull()
    expect(dropTarget.value).toBeNull()
    expect(onDrop).not.toHaveBeenCalled()
    cleanup()
  })

  it('supports horizontal axis for team reorder', () => {
    const axis = ref<'vertical' | 'horizontal'>('horizontal')
    const { onPointerDown, registerContainer, registerItem, dropTarget, cleanup } = useDragReorder({
      onDrop,
      axis,
    })

    const containerEl = fakeEl(0, 0, 800, 200)
    const team1El = fakeEl(0, 0, 200, 200)
    const team2El = fakeEl(210, 0, 200, 200)
    registerContainer('grid', containerEl)
    registerItem('t1', 'grid', team1El)
    registerItem('t2', 'grid', team2El)

    onPointerDown('t2', 'grid', mockPointerDown(310, 100, 'mouse'))
    document.dispatchEvent(pointerMove(50, 100))

    expect(dropTarget.value).toEqual({ containerId: 'grid', beforeItemId: 't1' })
    cleanup()
  })

  it('unregisters elements when null is passed', () => {
    const { registerContainer, onPointerDown, dropTarget, cleanup } = useDragReorder({
      onDrop,
    })

    const containerEl = fakeEl(0, 0, 200, 200)
    registerContainer('team1', containerEl)
    registerContainer('team1', null)

    onPointerDown('q1', 'team1', mockPointerDown(50, 50, 'mouse'))
    document.dispatchEvent(pointerMove(50, 50))
    expect(dropTarget.value).toBeNull()
    cleanup()
  })
})
