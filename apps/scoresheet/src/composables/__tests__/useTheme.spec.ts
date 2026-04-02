import { describe, it, expect, beforeEach } from 'vitest'
import { useTheme } from '../useTheme'

// useTheme has module-level singleton state (theme ref + watcher).
// We reset localStorage and restore a known theme state between tests.
beforeEach(() => {
  localStorage.clear()
  // Ensure theme is 'light' before each test by reading current state and
  // toggling to light if needed. This makes tests order-independent.
  const { theme, toggleTheme } = useTheme()
  if (theme.value !== 'light') toggleTheme()
})

describe('useTheme — toggleTheme', () => {
  it('starts at light (default when nothing in storage)', () => {
    const { theme } = useTheme()
    expect(theme.value).toBe('light')
  })

  it('toggles from light to dark', () => {
    const { theme, toggleTheme } = useTheme()
    toggleTheme()
    expect(theme.value).toBe('dark')
  })

  it('toggles from dark back to light', () => {
    const { theme, toggleTheme } = useTheme()
    toggleTheme() // light → dark
    toggleTheme() // dark → light
    expect(theme.value).toBe('light')
  })

  it('multiple callers see the same shared theme ref', () => {
    const a = useTheme()
    const b = useTheme()
    a.toggleTheme()
    expect(b.theme.value).toBe('dark')
  })
})

describe('useTheme — localStorage persistence', () => {
  it('persists dark to localStorage after toggle', async () => {
    const { toggleTheme } = useTheme()
    toggleTheme()
    // Watcher is async (flush: pre); nextTick lets it run
    await Promise.resolve()
    expect(localStorage.getItem('qzr-theme')).toBe('dark')
  })

  it('persists light to localStorage after toggling back', async () => {
    const { toggleTheme } = useTheme()
    toggleTheme() // → dark
    toggleTheme() // → light
    await Promise.resolve()
    expect(localStorage.getItem('qzr-theme')).toBe('light')
  })
})

describe('useTheme — data-theme attribute', () => {
  it('document has data-theme=light initially', () => {
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('document has data-theme=dark after toggle', async () => {
    const { toggleTheme } = useTheme()
    toggleTheme()
    await Promise.resolve()
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('document has data-theme=light after toggling back', async () => {
    const { toggleTheme } = useTheme()
    toggleTheme()
    toggleTheme()
    await Promise.resolve()
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })
})
