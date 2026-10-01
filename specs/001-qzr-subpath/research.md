# Research: Move qzr under /qzr

Inputs: [spec.md](spec.md), and a read-only survey of every root-path assumption in the repo (portal
Vite config and router, scoresheet PWA config, API client and auth client construction, the worker's
routes and Better Auth config, Pages files, CI, tests). Library behaviour below was read from the
installed sources: `better-auth@1.5.6`, `hono@4`, `vite-plugin-pwa@1`.

## R1. How Better Auth learns the `/qzr/api/auth` path

**Decision**: keep `baseURL` as the bare origin (`API_BASE_URL`, unchanged) and pass `basePath` per
request: `/qzr/api/auth` when the request arrived under `/qzr/`, otherwise `/api/auth`. `createAuth`
gains a `basePath` argument; the auth handler in `src/index.ts` takes it from the route that matched
(Hono's `routePath`), so the mount is the only place the prefix is written.

**Rationale**:

* `utils/url.mjs` `withPath(url, path)`: if `baseURL` already has a path it is used as-is and
  `basePath` is ignored; if it is a bare origin, `basePath` (default `/api/auth`) is appended. The
  result is `ctx.baseURL`.
* `api/index.mjs:153`: the router's match prefix is `new URL(ctx.baseURL).pathname`, and OAuth
  `redirect_uri`s are built from `ctx.baseURL`. So `basePath: '/qzr/api/auth'` makes Better Auth
  match `/qzr/api/auth/*` on the unmodified request URL and send providers back to
  `/qzr/api/auth/callback/{github,google}`.
* `createAuth(env)` is already constructed per request, so choosing `basePath` per request costs
  nothing. During the parallel stage the old root site and old app installs keep signing in through
  `/api/auth`, and `/qzr/` signs in through `/qzr/api/auth`, each with matching callback URLs.
* `getSession({ headers })` (session middleware) reads only the cookie, so it needs no `basePath`.

**Alternatives considered**:

* `baseURL: 'https://www.versevault.ca/qzr/api/auth'` (path in baseURL): works, but fixes one prefix
  for every request, so the root site and old apps lose sign-in during the parallel stage.
* Rewriting the request URL to strip `/qzr` before Better Auth sees it: callback URLs would then
  point at `/api/auth/...`, which belongs to verse-vault after switch day.

## R2. Serving the API at both `/api/*` and `/qzr/api/*`

**Decision**: build the existing routes on an inner Hono app and mount it twice on the exported
`app`: `app.route('/qzr', api)` and `app.route('/', api)`. Add the worker route
`www.versevault.ca/qzr/api/*`; keep `www.versevault.ca/api/*` until switch day.

**Rationale**: Hono's `route()` copies the sub-app's routes and middleware under the prefix and does
not rewrite `c.req.raw`, so Better Auth still sees the real URL (R1). The ~230
`app.request('/api/...')` calls in the API tests keep working through the root mount. After switch
day the root mount stays: verse-vault's router forwards old-app data requests to `qzr-api` through a
service binding with the unprefixed path (spec FR-015), so the worker must still answer `/api/...`
even with no public route.

**Alternatives considered**:

* `new Hono().basePath('/qzr')`: breaks every API test and the forwarded unprefixed requests.
* Stripping the prefix in a `fetch` wrapper: hides the real path from Better Auth (see R1).

## R3. Hosting the portal and scoresheet at `/qzr/`

**Decision**: a new Worker `qzr-web` (config and script in `apps/web/wrangler.toml` and
`apps/web/worker/`, no new package) with Workers Static Assets, directory `apps/web/dist`, routes
`www.versevault.ca/qzr` and `www.versevault.ca/qzr/*`. The build lays files out at their public
paths (`dist/qzr/...`, `dist/qzr/scoresheet/...`). A small script handles what the asset layer
cannot: SPA fallback to `/qzr/index.html` or `/qzr/scoresheet/index.html`, and bare `/qzr` to
`/qzr/`. On switch day the same Worker gains the legacy routes (R6). The `versevault-www` Pages
project keeps serving the root, frozen at its last deploy, until switch day, then is retired.

**Rationale**:

* Pages can only be bound to a whole hostname, never a path, so a Pages project at `/qzr/` would
  still need a proxy Worker in front of it: two new things to run instead of one.
* Workers Static Assets serves a file when the full request path matches one, so a route on a path
  prefix works if the files sit at their public paths. The built-in SPA fallback serves the root
  `/index.html`, which does not exist here, so the fallback lives in the script, run only on a miss
  (asset-first is the default).
* Cloudflare now steers new projects to Workers Static Assets over Pages. The existing CI token
  already deploys a Worker with zone routes (`qzr-api`), so no new permission is needed.
* This revises the "new `qzr-sheet` Pages project" choice in the notes: the goal (a separate deploy
  target so `/qzr/` goes live beside the root) is the same, with one deployable instead of two.

**Alternatives considered**:

* New Pages project plus a proxy Worker at `/qzr/*`: two deployables, an extra hop.
* Serving assets from `qzr-api` itself: couples web and scoresheet releases to API deploys, which
  apply D1 migrations first.

## R4. Prefix configuration in the two front ends

**Decision**:

* Portal: Vite `base: '/qzr/'`, `outDir: 'dist/qzr'`; `__API_URL__` is `'/qzr'` in production
  (`'http://localhost:8787'` in dev, which works because the API answers at its root mount);
  `__SCORESHEET_URL__` is `'/qzr/scoresheet/'`; the favicon link uses Vite's `%BASE_URL%`.
* Scoresheet (web build): `base`, PWA `scope`, `start_url`, icon `src`s, `navigateFallback` and its
  allowlist all move to `/qzr/scoresheet/`; manifest gains `id: '/qzr/scoresheet/'`;
  `outDir: 'dist/qzr/scoresheet'`; `__API_URL__` is `'/qzr'`; `index.html` icon links use
  `%BASE_URL%`.
* Scoresheet (Tauri build): `base` stays `/`; `__API_URL__` becomes
  `'https://www.versevault.ca/qzr'`.
* Auth clients in both apps: pass the full auth URL (`<api base resolved against origin>/api/auth`)
  to `createAppAuthClient`. In the client, `getBaseURL` uses a `baseURL` that has a path as-is, so
  no `basePath` option and no change to `packages/shared` are needed.
* Root `build:all` copies the scoresheet into `apps/web/dist/qzr/scoresheet`.

**Rationale**: every API path in both apps is `${__API_URL__}/api/...`, so prefixing `__API_URL__`
moves all of them at once without touching `packages/shared` (no contract bump). Vite rewrites
`%BASE_URL%` in `index.html`, so the hardcoded icon paths stop breaking on base changes.

## R5. Cookie clash with verse-vault

**Decision**: set `advanced.cookiePrefix: 'qzr'` in `createAuth`. Cookies become
`__Secure-qzr.session_token` and friends.

**Rationale**: `cookies/index.mjs` builds names as `<__Secure->` + `cookiePrefix` +
`.session_token`, default prefix `better-auth`. verse-vault uses the default on the same host with
path `/`, so today each app overwrites the other's session. The cost is one forced sign-in for qzr
users, including on the frozen root site, because the same worker serves its `/api/auth`.

## R6. Old installed scoresheet web apps (switch day)

**Decision**: on switch day, add routes `/scoresheet` and `/scoresheet/*` to `qzr-web`. The script
answers `/scoresheet/sw.js` with a self-destroying service worker, and 308-redirects every other
`/scoresheet...` path to `/qzr/scoresheet...` with the query string kept. `/roadmap` gets a route
and a 308 to `/qzr/roadmap`.

The replacement service worker:

* `install`: `skipWaiting()`.
* `activate`: delete only caches whose name contains the old scope (`/scoresheet/`) and not
  `/qzr/scoresheet/` (Workbox names precaches after the registration scope, and Cache Storage is
  shared across the origin, so deleting everything would wipe the new app's offline copy); then
  `registration.unregister()`; then navigate open window clients to `/qzr/scoresheet/` plus their
  query string.

**Rationale**: browsers check an installed worker's script for updates at its original URL and do
not follow redirects for it, so a redirect alone would leave old installs serving the stale app
forever. The default `generateSW` filename is `sw.js` and the old config does not override it.
Offline launches keep using the cached copy (constitution I), and the swap happens on the next
online load. Saved scoresheets live in `localStorage` (`qzr-sheet:current`), which is per origin, so
the new app sees them.

## R7. Meet-slug links and unknown paths

**Decision**: qzr does not redirect meet slugs itself; verse-vault's catch-all sends unknown root
paths to `/qzr/<path>` (dependency, spec FR-013). qzr adds a portal catch-all route for paths deeper
than its known shapes so they render a not-found page instead of a blank screen. Unknown single
slugs are treated as meets: they ask for sign-in, as meet links do today, then `QuizMeetView` shows
its own "meet not found" state.

## R8. OAuth provider registration

**Decision**: before the parallel stage goes live, register the new callbacks:

* Google (qzr client): add `https://www.versevault.ca/qzr/api/auth/callback/google` next to the
  existing one. Google allows many redirect URIs.
* GitHub: qzr uses an OAuth App for production (a separate one serves local dev). OAuth Apps now
  take several callback URLs, so add `https://www.versevault.ca/qzr/api/auth/callback/github` next
  to the existing one rather than widening the callback to the whole host. Remove the root
  `/api/auth/callback/github` entry after switch day.

## R9. CI and deploy

**Decision**: `deploy-web.yml` and `release-scoresheet.yml` keep running `pnpm build:all`, then run
`wrangler deploy` for `qzr-web` instead of `wrangler pages deploy ... versevault-www`.
`deploy-api.yml` is unchanged; the extra route comes from `wrangler.toml`. `qzr-web` has no version
of its own: it is the hosting for the `web` and `scoresheet` releases and deploys with either.

## Resolved unknowns

No `NEEDS CLARIFICATION` items remain. qzr's GitHub sign-in turned out to be an OAuth App (R8); both
new callbacks were registered on 2026-10-01.
