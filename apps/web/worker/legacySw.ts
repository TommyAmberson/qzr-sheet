/**
 * Served at `/scoresheet/sw.js`, where the scoresheet PWA was installed before
 * qzr moved under `/qzr/`. Browsers check an installed worker for updates at
 * its original URL and won't follow a redirect for it, so without this the old
 * install would keep serving its cached app shell forever.
 *
 * It removes only the old install's caches (Cache Storage is shared across the
 * origin, so the new `/qzr/scoresheet/` caches must survive), unregisters, and
 * moves open windows to the new address. Saved scoresheets live in
 * localStorage, which it never touches. Offline launches keep using the old
 * cached copy; this runs on the next online update check.
 */
export const legacyServiceWorker = `self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await self.caches.keys()
      const stale = names.filter((n) => n.includes('/scoresheet/') && !n.includes('/qzr/scoresheet/'))
      await Promise.all(stale.map((n) => self.caches.delete(n)))
      await self.registration.unregister()
      const windows = await self.clients.matchAll({ type: 'window' })
      for (const client of windows) {
        client.navigate('/qzr/scoresheet/' + new URL(client.url).search)
      }
    })(),
  )
})
`
