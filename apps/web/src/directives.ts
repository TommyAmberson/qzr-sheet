import type { Directive } from 'vue'

/**
 * `v-focus`: focus an element as it appears, so typing can start without a click. On a component
 * whose root wraps its input, such as `DivisionInput`, the first field inside takes the focus.
 * `v-focus="false"` leaves it alone, for a field that should only take focus when it's added.
 */
export const vFocus: Directive<HTMLElement, boolean | undefined> = {
  mounted(el, { value }) {
    if (value === false) return
    const field = el.matches('input, textarea, select')
      ? el
      : el.querySelector<HTMLElement>('input, textarea, select')
    ;(field ?? el).focus()
  },
}
