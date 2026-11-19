// jsdom has neither IndexedDB nor Web Locks, which the quiz records store needs
import 'fake-indexeddb/auto'
import { afterEach, beforeEach } from 'vitest'
import { installWebLocks } from '../persistence/__tests__/webLocks'

beforeEach(() => {
  installWebLocks()
  sessionStorage.clear()
})

afterEach(async () => {
  // Each test starts with an empty database; an open connection closes itself when asked to
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase('qzr-sheet')
    // Blocked only until the open connection hears of it and closes
    request.onsuccess = request.onerror = () => resolve()
  })
})
