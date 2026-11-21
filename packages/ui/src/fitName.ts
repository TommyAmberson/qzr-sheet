import type { Directive } from 'vue'

/** A name in two lengths: the full one where it fits, the short one where it doesn't */
export interface FitName {
  full: string
  short: string
}

const values = new WeakMap<HTMLElement, FitName>()
const observers = new WeakMap<HTMLElement, ResizeObserver>()
const pending = new Set<HTMLElement>()
let frame = 0

/**
 * Fit every waiting element in one frame: all full names written, then all measured, then the
 * short ones written, so a sheet of them lays out twice rather than once per name
 */
function fitPending() {
  frame = 0
  const els = [...pending].filter((el) => el.isConnected)
  pending.clear()
  for (const el of els) el.textContent = values.get(el)?.full ?? ''
  const tooLong = els.filter(overflows)
  for (const el of tooLong) {
    const name = values.get(el)
    if (name?.short) el.textContent = name.short
  }
}

/**
 * Whether the element's text is wider than the element. Measured to the fraction of a pixel, since
 * `scrollWidth` and `clientWidth` round: text half a pixel too wide passes them yet still ends in an
 * ellipsis
 */
function overflows(el: HTMLElement): boolean {
  if (el.scrollWidth > el.clientWidth) return true
  const range = document.createRange()
  range.selectNodeContents(el)
  // A test DOM lays nothing out, so it measures no range
  const text = range.getBoundingClientRect?.().width ?? 0
  return text > el.getBoundingClientRect().width
}

function schedule(el: HTMLElement) {
  pending.add(el)
  frame ||= requestAnimationFrame(fitPending)
}

/**
 * `v-fit-name="{ full, short }"`: the element's text is the full name when it fits and the short
 * one when it doesn't, checked again whenever the element resizes. The element must hold no other
 * children, and its width must not follow its text (say, `contain: inline-size`), or switching
 * names would resize it and switch them back. An ellipsis still cuts a short name too long.
 */
export const vFitName: Directive<HTMLElement, FitName> = {
  mounted(el, { value }) {
    values.set(el, value)
    // Shown at once, so the line is never blank while it waits to be measured
    el.textContent = value.full
    schedule(el)
    // Without one (as in a test DOM), the name is fitted once and not again on resizing
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => schedule(el))
    observer.observe(el)
    observers.set(el, observer)
  },
  updated(el, { value, oldValue }) {
    values.set(el, value)
    if (value.full === oldValue?.full && value.short === oldValue?.short) return
    // The new name at once, as on mounting, never the old one for a frame
    el.textContent = value.full
    schedule(el)
  },
  unmounted(el) {
    observers.get(el)?.disconnect()
    observers.delete(el)
    values.delete(el)
    pending.delete(el)
  },
}
