import { ref, type Ref } from 'vue'
import type { Quizzer } from '../types/scoresheet'

export function useDragReorder(
  teamQuizzers: Ref<Quizzer[][]>,
  moveQuizzer: (teamIdx: number, fromSeat: number, toSeat: number) => void,
) {
  const dragState = ref<{ ti: number; qi: number } | null>(null)
  const dropTarget = ref<{ ti: number; qi: number } | null>(null)
  const dropIndicatorWidth = ref('100%')

  const quizzerRowEls = new Map<string, HTMLElement>()

  function registerRowEl(ti: number, qi: number, el: HTMLElement | null) {
    const key = `${ti}:${qi}`
    if (el) quizzerRowEls.set(key, el)
    else quizzerRowEls.delete(key)
  }

  function updateIndicatorWidth() {
    const firstRow = quizzerRowEls.values().next().value as HTMLElement | undefined
    if (!firstRow) return
    const nameCell = firstRow.querySelector('.col--name') as HTMLElement | null
    const allCells = firstRow.querySelectorAll('.cell')
    const lastCell = allCells[allCells.length - 1] as HTMLElement | undefined
    if (!nameCell || !lastCell) return
    const nameRect = nameCell.getBoundingClientRect()
    const lastRect = lastCell.getBoundingClientRect()
    dropIndicatorWidth.value = `${lastRect.right - nameRect.left}px`
  }

  function onPointerMove(event: PointerEvent) {
    if (!dragState.value) return
    const ti = dragState.value.ti
    const count = teamQuizzers.value[ti]?.length ?? 0

    const firstEl = quizzerRowEls.get(`${ti}:0`)
    const lastEl = quizzerRowEls.get(`${ti}:${count - 1}`)
    if (!firstEl || !lastEl) return
    const teamTop = firstEl.getBoundingClientRect().top
    const teamBottom = lastEl.getBoundingClientRect().bottom

    let found: number | null = null

    if (event.clientY < teamTop) {
      found = 0
    } else if (event.clientY >= teamBottom) {
      found = count - 1
    } else {
      for (let qi = 0; qi < count; qi++) {
        const el = quizzerRowEls.get(`${ti}:${qi}`)
        if (!el) continue
        const rect = el.getBoundingClientRect()
        if (event.clientY >= rect.top && event.clientY < rect.bottom) {
          found = qi
          break
        }
      }
    }

    if (found !== null && found !== dragState.value.qi) {
      dropTarget.value = { ti, qi: found }
    } else {
      dropTarget.value = null
    }
  }

  function onPointerUp() {
    document.removeEventListener('pointermove', onPointerMove)
    document.removeEventListener('pointerup', onPointerUp)
    if (dragState.value && dropTarget.value) {
      moveQuizzer(dragState.value.ti, dragState.value.qi, dropTarget.value.qi)
    }
    dragState.value = null
    dropTarget.value = null
  }

  function onPointerDown(ti: number, qi: number, event: PointerEvent) {
    event.preventDefault()
    // Prevent native drag — crashes on Linux/X11
    window.getSelection()?.removeAllRanges()
    dragState.value = { ti, qi }
    updateIndicatorWidth()
    document.addEventListener('pointermove', onPointerMove)
    document.addEventListener('pointerup', onPointerUp)
  }

  return { dragState, dropTarget, dropIndicatorWidth, registerRowEl, onPointerDown }
}
