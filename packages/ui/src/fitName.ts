import type { Directive } from 'vue'

/** A name in two lengths: the full one where it fits, the short one where it doesn't */
export interface FitName {
  full: string
  short: string
}

/**
 * A team's name split before its number, `Grace` and ` 2`, so the number stays in sight when the
 * line cuts the name short. A name with no number at its end is all head.
 */
export function nameAndNumber(name: string): { head: string; number: string } {
  const match = /^(.*?)(\s+\d+[A-Za-z]?)$/.exec(name)
  // One space before the number, whatever was typed there
  return match ? { head: match[1]!, number: ` ${match[2]!.trim()}` } : { head: name, number: '' }
}

/** Write a name into its element: its head, which an ellipsis may cut, then its number, never cut */
function write(el: HTMLElement, name: string) {
  const { head, number } = nameAndNumber(name)
  const headEl = document.createElement('span')
  headEl.className = 'fit-name-head'
  headEl.textContent = head
  if (!number) return el.replaceChildren(headEl)
  const numberEl = document.createElement('span')
  numberEl.className = 'fit-name-number'
  numberEl.textContent = number
  el.replaceChildren(headEl, numberEl)
}

/** The part of a written name an ellipsis cuts, so the part to measure */
const headOf = (el: HTMLElement) => (el.firstElementChild as HTMLElement | null) ?? el

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
  for (const el of els) write(el, values.get(el)?.full ?? '')
  const tooLong = els.filter((el) => overflows(headOf(el)))
  for (const el of tooLong) {
    const name = values.get(el)
    if (name?.short) write(el, name.short)
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
 * names would resize it and switch them back. An ellipsis still cuts a short name too long, but only
 * its name: a number at its end, which tells a church's teams apart, stays in sight.
 */
export const vFitName: Directive<HTMLElement, FitName> = {
  mounted(el, { value }) {
    values.set(el, value)
    // Shown at once, so the line is never blank while it waits to be measured
    write(el, value.full)
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
    write(el, value.full)
    schedule(el)
  },
  unmounted(el) {
    observers.get(el)?.disconnect()
    observers.delete(el)
    values.delete(el)
    pending.delete(el)
  },
}
