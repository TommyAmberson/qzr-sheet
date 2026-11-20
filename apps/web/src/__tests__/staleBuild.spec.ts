import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

type StaleBuild = typeof import('../staleBuild')

const ask = vi.fn()
let page: StaleBuild

// The module as a freshly loaded page has it; session storage survives, as across a reload
async function loadPage() {
  vi.resetModules()
  page = await import('../staleBuild')
  page.staleBuildDialog.value = { ask } as never
}

beforeEach(async () => {
  sessionStorage.clear()
  ask.mockReset()
  await loadPage()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('isFailedImport', () => {
  it("knows each browser's wording of a failed dynamic import, and Vite's for a stylesheet", () => {
    for (const message of [
      'Failed to fetch dynamically imported module: https://x/assets/A.js',
      'error loading dynamically imported module: https://x/assets/A.js',
      'Importing a module script failed.',
      'Unable to preload CSS for /qzr/assets/A.css',
    ])
      expect(page.isFailedImport(new TypeError(message))).toBe(true)
  })

  it('leaves other errors to the router', () => {
    expect(page.isFailedImport(new Error('Network error'))).toBe(false)
    expect(page.isFailedImport('Failed to fetch dynamically imported module')).toBe(false)
  })
})

describe('recoverFromStaleBuild', () => {
  it('reloads onto the page the navigation was heading for', async () => {
    const navigate = vi.fn()
    await page.recoverFromStaleBuild('/qzr/fbc-2024', navigate)
    expect(navigate).toHaveBeenCalledWith('/qzr/fbc-2024')
    expect(ask).not.toHaveBeenCalled()
  })

  it('ignores another failure while the page is already reloading', async () => {
    const navigate = vi.fn()
    await page.recoverFromStaleBuild('/qzr/fbc-2024', navigate)
    await page.recoverFromStaleBuild('/qzr/fbc-2024', navigate)
    expect(navigate).toHaveBeenCalledOnce()
    expect(ask).not.toHaveBeenCalled()
  })

  it('asks instead of reloading again when the reload did not help', async () => {
    const navigate = vi.fn()
    await page.recoverFromStaleBuild('/qzr/fbc-2024', navigate)
    await loadPage()

    ask.mockResolvedValue(null)
    await page.recoverFromStaleBuild('/qzr/fbc-2024', navigate)
    expect(ask).toHaveBeenCalledOnce()
    expect(navigate).toHaveBeenCalledOnce()
  })

  it('asks, rather than reloading, for another page that fails before any loads', async () => {
    const navigate = vi.fn()
    await page.recoverFromStaleBuild('/qzr/fbc-2024', navigate)
    await loadPage()

    ask.mockResolvedValue(null)
    await page.recoverFromStaleBuild('/qzr/fbc-2024/stats', navigate)
    expect(ask).toHaveBeenCalledOnce()
    expect(navigate).toHaveBeenCalledOnce()
  })

  it('tries again when asked to', async () => {
    const navigate = vi.fn()
    await page.recoverFromStaleBuild('/qzr/fbc-2024', navigate)
    await loadPage()

    ask.mockResolvedValue(true)
    await page.recoverFromStaleBuild('/qzr/fbc-2024', navigate)
    expect(navigate).toHaveBeenLastCalledWith('/qzr/fbc-2024')
    expect(navigate).toHaveBeenCalledTimes(2)
  })

  it('reloads again once a page has loaded, as after a later deploy', async () => {
    const navigate = vi.fn()
    await page.recoverFromStaleBuild('/qzr/fbc-2024', navigate)
    await loadPage()
    page.pageLoaded()
    await page.recoverFromStaleBuild('/qzr/fbc-2024', navigate)
    expect(navigate).toHaveBeenCalledTimes(2)
    expect(ask).not.toHaveBeenCalled()
  })

  it('counts a reload chosen with Try again, so the next failure asks', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValueOnce(false)
    const navigate = vi.fn()
    ask.mockResolvedValue(true)
    await page.recoverFromStaleBuild('/qzr/fbc-2024', navigate)
    expect(navigate).toHaveBeenCalledOnce()
    await loadPage()

    ask.mockResolvedValue(null)
    await page.recoverFromStaleBuild('/qzr/fbc-2024', navigate)
    expect(ask).toHaveBeenCalledTimes(2)
    expect(navigate).toHaveBeenCalledOnce()
  })

  it('asks instead of reloading while offline, and again until back online', async () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const navigate = vi.fn()
    // Try again while still offline, then once back online
    ask.mockResolvedValueOnce(true).mockImplementationOnce(async () => {
      onLine.mockReturnValue(true)
      return true
    })
    await page.recoverFromStaleBuild('/qzr/fbc-2024', navigate)
    expect(ask).toHaveBeenCalledTimes(2)
    expect(navigate).toHaveBeenCalledOnce()
  })
})
