import { ref, watch } from 'vue'

/**
 * Whether the rows after an edited row move with it (FR-016), on unless the director turns it off.
 * It's a habit of how someone edits rather than part of a schedule, so this browser remembers it.
 */

const KEY = 'qzr-builder-follow-rows'

function remembered(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off'
  } catch {
    return true
  }
}

export const followRows = ref(remembered())

watch(followRows, (on) => {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off')
  } catch {
    // Storage blocked: the choice lasts until the page closes
  }
})
