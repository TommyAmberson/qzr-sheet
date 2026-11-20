import { ref } from 'vue'
import type { ChoiceDialog } from '@qzr/ui'

// Chrome, Firefox and Safari each word a failed dynamic import their own way, and Vite throws its own
// error first when the page's stylesheet is the file that's missing
const IMPORT_FAILED =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/

const RELOAD_KEY = 'qzr:stale-build-reload'

/** The portal's stale-build dialog, mounted by App.vue */
export const staleBuildDialog = ref<InstanceType<typeof ChoiceDialog> | null>(null)

/** Whether a route's lazy chunk failed to load, as it does once a deploy has replaced it */
export function isFailedImport(error: unknown): boolean {
  return error instanceof Error && IMPORT_FAILED.test(error.message)
}

// Set once this page has started reloading, so a second failure meanwhile doesn't ask over it
let reloading = false

/**
 * Whether a reload was already spent since a page last loaded, so any failure now asks instead of
 * looping, however long the reload took. Without session storage there is no record, so it never
 * reloads unasked.
 */
function reloadSpent(): boolean {
  try {
    return sessionStorage.getItem(RELOAD_KEY) !== null
  } catch {
    return true
  }
}

// Every reload counts, one chosen with Try again included
function reload(href: string, navigate: (href: string) => void): void {
  reloading = true
  try {
    sessionStorage.setItem(RELOAD_KEY, '1')
  } catch {
    // Nothing to record in; reloadSpent() asks every time then
  }
  navigate(href)
}

/** A page loaded, so the build works again: a later failure, after another deploy, reloads */
export function pageLoaded(): void {
  try {
    sessionStorage.removeItem(RELOAD_KEY)
  } catch {
    // Nothing was recorded either
  }
}

/**
 * Recover a navigation whose page failed to load. A tab opened before a deploy still asks for the
 * old build's chunks, which are gone; loading `href` afresh brings the new build. Offline, or once
 * that reload has happened and a page still fails, reloading won't help, so ask before trying.
 */
export async function recoverFromStaleBuild(
  href: string,
  navigate: (href: string) => void = (to) => window.location.assign(to),
): Promise<void> {
  if (reloading) return
  // Offline, a reload would only swap the portal for the browser's error page
  if (navigator.onLine && !reloadSpent()) return reload(href, navigate)
  const retry = await staleBuildDialog.value?.ask(
    "This page didn't load",
    'Part of qzr failed to download. Check your connection, then try again.',
    [
      { label: 'Close', value: null },
      { label: 'Try again', value: true, primary: true },
    ],
  )
  if (!retry) return
  // Still offline: ask again rather than load the browser's error page
  if (!navigator.onLine) return recoverFromStaleBuild(href, navigate)
  reload(href, navigate)
}
