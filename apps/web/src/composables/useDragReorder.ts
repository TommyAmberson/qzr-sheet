import { ref, onUnmounted, getCurrentInstance, type Ref } from 'vue'

export interface DragState {
  itemId: string
  containerId: string
}

export interface DropTarget {
  containerId: string
  beforeItemId: string | null
}

interface Options {
  onDrop: (
    fromContainer: string,
    itemId: string,
    toContainer: string,
    beforeItemId: string | null,
  ) => void
  axis?: Ref<'vertical' | 'horizontal'>
}

const TOUCH_THRESHOLD = 5

export function useDragReorder(options: Options) {
  const dragState = ref<DragState | null>(null)
  const dropTarget = ref<DropTarget | null>(null)

  const containerEls = new Map<string, HTMLElement>()
  // Each item maps to { el, containerId } so we know which container it belongs to
  const itemEls = new Map<string, { el: HTMLElement; containerId: string }>()

  let startX = 0
  let startY = 0
  let activated = false
  let pointerType = ''

  function registerContainer(id: string, el: HTMLElement | null) {
    if (el) containerEls.set(id, el)
    else containerEls.delete(id)
  }

  function registerItem(id: string, containerId: string, el: HTMLElement | null) {
    if (el) itemEls.set(id, { el, containerId })
    else itemEls.delete(id)
  }

  function getAxis(): 'vertical' | 'horizontal' {
    return options.axis?.value ?? 'vertical'
  }

  function findContainerAt(x: number, y: number): string | null {
    for (const [id, el] of containerEls) {
      const rect = el.getBoundingClientRect()
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return id
      }
    }
    return null
  }

  function findInsertPosition(containerId: string, x: number, y: number): string | null {
    const axis = getAxis()
    let bestId: string | null = null

    for (const [id, entry] of itemEls) {
      if (entry.containerId !== containerId) continue
      if (dragState.value && id === dragState.value.itemId) continue
      const rect = entry.el.getBoundingClientRect()

      if (axis === 'vertical') {
        const mid = rect.top + rect.height / 2
        if (y < mid) {
          bestId = id
          break
        }
      } else {
        const mid = rect.left + rect.width / 2
        if (x < mid) {
          bestId = id
          break
        }
      }
    }

    return bestId
  }

  function onPointerMove(event: PointerEvent) {
    if (!activated) {
      const dx = event.clientX - startX
      const dy = event.clientY - startY
      if (pointerType !== 'mouse' && dx * dx + dy * dy < TOUCH_THRESHOLD * TOUCH_THRESHOLD) {
        return
      }
      activated = true
    }

    const containerId = findContainerAt(event.clientX, event.clientY)
    if (containerId === null) {
      dropTarget.value = null
      return
    }

    const beforeItemId = findInsertPosition(containerId, event.clientX, event.clientY)
    dropTarget.value = { containerId, beforeItemId }
  }

  function onPointerUp() {
    document.removeEventListener('pointermove', onPointerMove)
    document.removeEventListener('pointerup', onPointerUp)

    if (activated && dragState.value && dropTarget.value) {
      options.onDrop(
        dragState.value.containerId,
        dragState.value.itemId,
        dropTarget.value.containerId,
        dropTarget.value.beforeItemId,
      )
    }

    dragState.value = null
    dropTarget.value = null
    activated = false
  }

  function onPointerDown(itemId: string, containerId: string, event: PointerEvent) {
    event.preventDefault()
    window.getSelection()?.removeAllRanges()

    startX = event.clientX
    startY = event.clientY
    pointerType = event.pointerType
    activated = pointerType === 'mouse'

    dragState.value = { itemId, containerId }
    dropTarget.value = null

    document.addEventListener('pointermove', onPointerMove)
    document.addEventListener('pointerup', onPointerUp)
  }

  function cleanup() {
    document.removeEventListener('pointermove', onPointerMove)
    document.removeEventListener('pointerup', onPointerUp)
    dragState.value = null
    dropTarget.value = null
    activated = false
  }

  if (getCurrentInstance()) onUnmounted(cleanup)

  return {
    dragState,
    dropTarget,
    registerContainer,
    registerItem,
    onPointerDown,
    cleanup,
  }
}
