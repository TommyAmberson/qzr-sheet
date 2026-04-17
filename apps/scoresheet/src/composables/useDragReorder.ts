import { ref, type Ref } from 'vue'
import type { Quizzer } from '../types/scoresheet'

export function useDragReorder(
  teamQuizzers: Ref<Quizzer[][]>,
  moveQuizzer: (teamIdx: number, fromSeat: number, toSeat: number) => void,
) {
  const dragState = ref<{ teamIdx: number; seatIdx: number } | null>(null)
  const dropTarget = ref<{ teamIdx: number; seatIdx: number } | null>(null)
  const dropIndicatorWidth = ref('100%')

  const quizzerRowEls = new Map<string, HTMLElement>()

  function registerRowEl(teamIdx: number, seatIdx: number, el: HTMLElement | null) {
    const key = `${teamIdx}:${seatIdx}`
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
    const teamIdx = dragState.value.teamIdx
    const count = teamQuizzers.value[teamIdx]?.length ?? 0

    const firstEl = quizzerRowEls.get(`${teamIdx}:0`)
    const lastEl = quizzerRowEls.get(`${teamIdx}:${count - 1}`)
    if (!firstEl || !lastEl) return
    const teamTop = firstEl.getBoundingClientRect().top
    const teamBottom = lastEl.getBoundingClientRect().bottom

    let found: number | null = null

    if (event.clientY < teamTop) {
      found = 0
    } else if (event.clientY >= teamBottom) {
      found = count - 1
    } else {
      for (let seatIdx = 0; seatIdx < count; seatIdx++) {
        const el = quizzerRowEls.get(`${teamIdx}:${seatIdx}`)
        if (!el) continue
        const rect = el.getBoundingClientRect()
        if (event.clientY >= rect.top && event.clientY < rect.bottom) {
          found = seatIdx
          break
        }
      }
    }

    if (found !== null && found !== dragState.value.seatIdx) {
      dropTarget.value = { teamIdx, seatIdx: found }
    } else {
      dropTarget.value = null
    }
  }

  function onPointerUp() {
    document.removeEventListener('pointermove', onPointerMove)
    document.removeEventListener('pointerup', onPointerUp)
    if (dragState.value && dropTarget.value) {
      moveQuizzer(dragState.value.teamIdx, dragState.value.seatIdx, dropTarget.value.seatIdx)
    }
    dragState.value = null
    dropTarget.value = null
  }

  function onPointerDown(teamIdx: number, seatIdx: number, event: PointerEvent) {
    event.preventDefault()
    // Prevent native drag — crashes on Linux/X11
    window.getSelection()?.removeAllRanges()
    dragState.value = { teamIdx, seatIdx }
    updateIndicatorWidth()
    document.addEventListener('pointermove', onPointerMove)
    document.addEventListener('pointerup', onPointerUp)
  }

  return { dragState, dropTarget, dropIndicatorWidth, registerRowEl, onPointerDown }
}
