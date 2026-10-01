/**
 * Whether the current quiz was opened from a newer scoresheet's file. Persisted so the "may be
 * scored wrong" warning survives a reload instead of letting the quiz look trustworthy.
 */
const KEY = 'qzr-sheet:opened-from-newer-file'

export function readOpenedFromNewerFile(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function writeOpenedFromNewerFile(value: boolean): void {
  try {
    if (value) localStorage.setItem(KEY, '1')
    else localStorage.removeItem(KEY)
  } catch {
    // localStorage unavailable — the warning just won't survive a reload
  }
}
