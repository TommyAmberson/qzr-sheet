---
description: "Task list for moving qzr under /qzr"
---

# Tasks: Move qzr under /qzr

**Input**: Design documents from `specs/001-qzr-subpath/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/routing.md, quickstart.md

**Tests**: included. The constitution (VI) and CLAUDE.md prefer tests first, and the plan commits to
unit tests for the prefixed mount, the per-request auth base path, the cookie prefix, and the
`qzr-web` script. Write each test task before its implementation task and see it fail.

**Organization**: grouped by user story. Three pull requests:

* **PR 1a, API prefix** (`feat/qzr-api-prefix`): Phase 2, Phase 4 (US2), and the API side of
  Phase 8 (T037, the callbacks part of T040). The API keeps answering at `/api/*`, so it ships on its
  own, and it merges and deploys first: the front ends depend on `/qzr/api/*`.
* **PR 1b, parallel stage** (`feat/qzr-subpath`, stacked on PR 1a): Phases 1, 3, and 5 and the rest
  of Phase 8. Opened once PR 1a is live (`/qzr/api/auth/ok` returns 200). Merging it deploys qzr at
  `/qzr/` beside the frozen root site and ships new app builds.
* **PR 2, switch day** (branch `feat/qzr-switch-day`, off master after PR 1b merges): Phases 6-7 and
  its part of Phase 8. Merged during the verse-vault cutover, never before.

**Release with the change** (CONTRIBUTING.md, constitution 1.1.0 and later): bump each package exactly once per PR,
in the first commit that touches it, with `pnpm bump <pkg> <ver>` and a dated `CHANGELOG.md` section
that includes `### Bundled contract` / `* @qzr/shared@<current> — unchanged`. Later tasks add their
entries to that section.

Bump at whichever commit touches the package first; parallel tasks can change the order, so these
are the usual points:

* PR 1a: `api` 0.11.0 to 0.12.0 at T006.
* PR 1b: `web` to 0.12.0 at T001, `scoresheet` to 0.11.0 at T019. master's unreleased web and
  scoresheet changes ship first in `chore/release-schedule-load` (web 0.11.0, scoresheet 0.10.0),
  so this PR carries only the move.
* PR 2: `web` at T030, `api` at T033.

Run every `pnpm` command from the repo root (CLAUDE.md). Commit after each task or logical group,
with Conventional Commit subjects of at most 50 characters.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: the user story from spec.md (US1-US5)

---

## Phase 1: Setup

**Purpose**: scaffolding for the `qzr-web` Worker inside `apps/web` (plan: no new package)

- [ ] T001 Add `@cloudflare/workers-types` (same version range as `packages/api/package.json`) to `apps/web/package.json` devDependencies and run `pnpm install`
- [ ] T002 Create `apps/web/tsconfig.worker.json` (extends nothing DOM-specific; `include: ["worker/**/*.ts"]`, `types: ["@cloudflare/workers-types"]`, `noEmit`, `module`/`moduleResolution` `ESNext`/`Bundler`, its own `tsBuildInfoFile` under `node_modules/.tmp/`) and add it to the `references` in `apps/web/tsconfig.json` so `pnpm type-check` covers it
- [ ] T003 Create `apps/web/worker/index.ts` exporting a default `{ fetch(request, env) }` handler with an `Env` type `{ ASSETS: Fetcher }` that, for now, returns `env.ASSETS.fetch(request)`
- [ ] T004 Create `apps/web/wrangler.toml`: `name = "qzr-web"`, `main = "worker/index.ts"`, `compatibility_date` = today, `[assets]` with `directory = "./dist"`, `binding = "ASSETS"` (no `not_found_handling`, no `run_worker_first`: assets are served first and the script runs only on a miss), and `[[routes]]` for `pattern = "www.versevault.ca/qzr"` and `pattern = "www.versevault.ca/qzr/*"`, both `zone_name = "versevault.ca"`
- [ ] T005 Make worker tests run in Node rather than jsdom: add `// @vitest-environment node` at the top of each `apps/web/worker/__tests__/*.spec.ts` (note the convention in a comment in the first spec file), and confirm `apps/web/vitest.config.ts` picks up `worker/**/__tests__/*.spec.ts`

**Checkpoint**: `pnpm type-check` and `pnpm test:unit` pass with the empty Worker.

---

## Phase 2: Foundational (blocks US1 and US3)

**Purpose**: the API answers under `/qzr/api/*` with sign-in on a matching base path (research R1, R2)

- [ ] T006 [P] Write failing tests in `packages/api/src/routes/__tests__/qzrPrefix.spec.ts` (copy the env/DB setup from `routeMountOrder.spec.ts`): the same request to `/api/meets` and `/qzr/api/meets` returns the same status and body; `/qzr/api/join/guest` behaves like `/api/join/guest`; `/qzr/does-not-exist` returns 404
- [ ] T007 [P] Write failing tests in `packages/api/src/lib/__tests__/authBasePath.spec.ts` for a pure helper `authBasePathFor(pathname: string): string` that returns `'/qzr/api/auth'` when `pathname` starts with `/qzr/` and `'/api/auth'` otherwise (`/qzr/api/auth/session`, `/api/auth/session`, `/qzrx/api/auth`, `/qzr` cases)
- [ ] T008 In `packages/api/src/lib/auth.ts`, add and export `authBasePathFor`, and change `createAuth(env)` to `createAuth(env, opts?: { basePath?: string })`, passing `basePath: opts?.basePath ?? '/api/auth'` to `betterAuth`. Keep `baseURL: env.API_BASE_URL` (bare origin). Update the `Auth` type export if needed
- [ ] T009 In `packages/api/src/index.ts`, keep CORS and the logger on the outer `app` (registered once), and move `/health`, the auth handler, the session middleware, and all `/api/...` routes onto an inner `const api = new Hono<...>()`, then create the exported `app` and mount `app.route('/qzr', api)` and `app.route('/', api)` (prefixed first). The auth handler becomes `createAuth(c.env, { basePath: authBasePathFor(c.req.path) }).handler(c.req.raw)`; do not rewrite `c.req.raw`. Keep the existing mount-order comment with the routes it explains
- [ ] T010 Add an auth test to `packages/api/src/lib/__tests__/authBasePath.spec.ts`, with `env` built from `createTestDb()` (`packages/api/src/test-db.ts`) and a 32-character test `BETTER_AUTH_SECRET`: `app.request('/qzr/api/auth/ok', {}, env)` and `app.request('/api/auth/ok', {}, env)` both return 200 (Better Auth's health endpoint), proving the router matches each base path on the unmodified URL
- [ ] T011 Add the route `[[routes]] pattern = "www.versevault.ca/qzr/api/*"`, `zone_name = "versevault.ca"` to `packages/api/wrangler.toml`, keeping the existing `/api/*` route, with a comment that `/api/*` is removed on switch day (PR 2)

**Checkpoint**: `pnpm test:unit` passes, including every existing API spec unchanged.

---

## Phase 3: User Story 1 - Use qzr at its new address (Priority: P1) 🎯 MVP

**Goal**: portal at `/qzr/`, scoresheet at `/qzr/scoresheet/`, API calls and sign-in under `/qzr/`,
while the root site keeps working (FR-001 to FR-007).

**Independent Test**: quickstart section 1, then section 2 steps 1-7 after deploy.

### Tests for User Story 1

- [ ] T012 [P] [US1] Write failing tests in `apps/web/worker/__tests__/index.spec.ts` against a fake `ASSETS` (a `fetch` returning 200 for a fixed set of paths, 404 otherwise), per `contracts/routing.md` "Parallel stage": `GET /qzr` gives `308` with `Location: /qzr/` and the query kept; an existing file is passed through; `GET /qzr/scoresheet/anything` on a miss returns the body of `/qzr/scoresheet/index.html` with `200`; `GET /qzr/some/page` on a miss returns `/qzr/index.html` with `200`; `POST` on a miss returns `405`
- [ ] T013 [P] [US1] Write a failing test in `apps/web/src/router/__tests__/notFound.spec.ts`: resolving `/a/b/c/d/e` matches a route named `not-found`, while `/fall-2025`, `/fall-2025/schedule`, and `/roadmap` still match `meet`, `meet-schedule`, and `roadmap`

### Implementation for User Story 1

- [ ] T014 [US1] Implement `apps/web/worker/index.ts` to pass T012: try `env.ASSETS.fetch(request)` first; on 404, redirect bare `/qzr`, return `405` for non-GET/HEAD, and otherwise fetch `/qzr/scoresheet/index.html` for paths under `/qzr/scoresheet/` and `/qzr/index.html` for the rest, returning that body with status `200`
- [ ] T015 [P] [US1] In `apps/web/vite.config.ts` set `base: '/qzr/'`, `build.outDir: 'dist/qzr'` (T020 cleans the parent `dist`), `__API_URL__` to `'/qzr'` in production (dev stays `'http://localhost:8787'`), and `__SCORESHEET_URL__` to `'/qzr/scoresheet/'` in production and `'http://localhost:5173/qzr/scoresheet/'` in dev (the scoresheet dev server uses its build base too)
- [ ] T016 [P] [US1] In `apps/web/index.html` change the favicon `href` to `%BASE_URL%favicon.ico` and add a `favicon.ico` to `apps/web/public/` (copy from `apps/scoresheet/public/favicon.ico`) so it resolves to `/qzr/favicon.ico`
- [ ] T017 [P] [US1] Delete `apps/web/public/_redirects` and `apps/web/public/_routes.json` (Pages-only; the Worker script does the SPA fallback)
- [ ] T018 [US1] In `apps/web/src/router/index.ts` add `{ path: '/:pathMatch(.*)*', name: 'not-found', component: () => import('../views/NotFoundView.vue') }` after the `/:slug` route, and create `apps/web/src/views/NotFoundView.vue` (heading, short message, `RouterLink` home) in the style of `RoadmapView.vue`; T013 passes
- [ ] T019 [P] [US1] In `apps/scoresheet/vite.config.ts`, for the non-Tauri build: `base: '/qzr/scoresheet/'`; VitePWA `scope` and `base` `'/qzr/scoresheet/'`; manifest `id: '/qzr/scoresheet/'`, `start_url` and `scope` `'/qzr/scoresheet/'`; every icon `src` under `/qzr/scoresheet/`; workbox `navigateFallback: '/qzr/scoresheet/index.html'` and `navigateFallbackAllowlist: [/^\/qzr\/scoresheet/]`; `build.outDir: 'dist/qzr/scoresheet'`; web production `__API_URL__` `'/qzr'`. Leave the Tauri `base: '/'` and `outDir: 'dist'` untouched (Tauri API URL is T027)
- [ ] T020 [US1] In root `package.json`, change `build:all` to clean `apps/web/dist`, build both, and copy `apps/scoresheet/dist/qzr/scoresheet` to `apps/web/dist/qzr/scoresheet`; change `deploy` to `pnpm build:all && wrangler deploy --config apps/web/wrangler.toml`. Confirm `pnpm build:all` leaves nothing in `apps/web/dist/` outside `qzr/`
- [ ] T021 [P] [US1] In `apps/scoresheet/index.html` change the favicon and apple-touch-icon `href`s to `%BASE_URL%favicon.ico` and `%BASE_URL%apple-touch-icon-180x180.png`
- [ ] T022 [P] [US1] In `apps/web/src/composables/useAuth.ts` and `apps/scoresheet/src/composables/useAuth.ts`, pass the full auth URL to `createAppAuthClient`: `new URL(`${__API_URL__}/api/auth`, window.location.origin).href` (absolute because Better Auth rejects relative base URLs, and with a path so the client uses it as-is; research R4). No change to `packages/shared`
- [ ] T023 [US1] Grep `apps/web/src` and `apps/scoresheet/src` for remaining root-absolute paths (`'/scoresheet`, `"/scoresheet`, `'/api/` outside `api.ts` endpoint strings, `href="/`, `src="/`) and fix any that bypass `__API_URL__`, `__SCORESHEET_URL__`, or the router base
- [ ] T024 [US1] In `.github/workflows/deploy-web.yml` and `.github/workflows/release-scoresheet.yml`, replace the "Publish to Cloudflare Pages" step with "Deploy qzr-web Worker" running `pnpm dlx wrangler deploy --config apps/web/wrangler.toml` (same env secrets), and update the `build:all` comments to the `dist/qzr/` layout
- [ ] T025 [US1] Run `pnpm build:all`, then `pnpm dlx wrangler dev --config apps/web/wrangler.toml` and `pnpm dev:api`, and walk quickstart section 1 locally (portal, deep-link refresh, scoresheet, email sign-in)

**Checkpoint**: US1 complete locally; deployable as PR 1b's core.

---

## Phase 4: User Story 2 - Sessions in qzr and verse-vault stay independent (Priority: P2)

**Goal**: qzr's session cookie can't clash with verse-vault's (FR-008, research R5).

**Independent Test**: after sign-in, the response sets cookies named with the `qzr` prefix only.

- [ ] T026 [US2] Write a failing test in `packages/api/src/lib/__tests__/cookiePrefix.spec.ts` that an email sign-up or sign-in through `/qzr/api/auth/...` (use the test DB setup from `packages/api/src/test-db.ts`) returns `Set-Cookie` headers whose names start with `qzr.` and none starting with `better-auth.`; then add `cookiePrefix: 'qzr'` to the existing `advanced` block in `createAuth` in `packages/api/src/lib/auth.ts` (cookie "Name: `__Secure-qzr.session_token` (was `__Secure-better-auth.session_token`)", data-model.md)

**Checkpoint**: US2 test passes; nothing else reads the old cookie name (`grep -rn "better-auth\." packages apps`).

---

## Phase 5: User Story 3 - Desktop and Android apps use the new address (Priority: P2)

**Goal**: new app builds call `/qzr/api` (FR-009); old builds degrade cleanly (FR-010).

**Independent Test**: quickstart section 2 step 9 with the new builds.

- [ ] T027 [US3] In `apps/scoresheet/vite.config.ts` set the Tauri production `__API_URL__` to `'https://www.versevault.ca/qzr'`
- [ ] T028 [US3] Read `apps/scoresheet/src/components/SignInWidget.vue` and the connected-feature call sites in `apps/scoresheet/src/api.ts` to confirm what an already-released build shows when its auth or API call fails (error message vs hang); record the answer as a note under "Switch day" in `specs/001-qzr-subpath/quickstart.md`. No code change to released builds is possible; if the current code hangs, raise it with the maintainer as a separate issue (scope discipline)

**Checkpoint**: `TAURI_ENV_PLATFORM=linux pnpm build` output references `https://www.versevault.ca/qzr/api/`.

---

## Phase 6: User Story 4 - Old links keep working (Priority: P3) [PR 2, switch day]

**Goal**: legacy qzr addresses redirect into `/qzr/` (FR-011 to FR-013).

**Independent Test**: quickstart section 3 steps 1 and 4.

- [ ] T029 [US4] Create branch `feat/qzr-switch-day` off master after PR 1b has merged and deployed
- [ ] T030 [US4] Add failing tests to `apps/web/worker/__tests__/index.spec.ts` per `contracts/routing.md` "Switch day": `GET /scoresheet` gives `308` to `/qzr/scoresheet/`; `GET /scoresheet/x?meet=A&quiz=B` gives `308` to `/qzr/scoresheet/x?meet=A&quiz=B`; `GET /roadmap?x=1` gives `308` to `/qzr/roadmap?x=1`
- [ ] T031 [US4] Implement the legacy redirects in `apps/web/worker/index.ts`, handled before the asset lookup for paths outside `/qzr`
- [ ] T032 [US4] Add routes `www.versevault.ca/scoresheet`, `www.versevault.ca/scoresheet/*`, and `www.versevault.ca/roadmap` to `apps/web/wrangler.toml`
- [ ] T033 [US4] Remove the `www.versevault.ca/api/*` route from `packages/api/wrangler.toml` (keep the root mount in `index.ts`: verse-vault forwards old-app data requests through a service binding, research R2) and update the comment

---

## Phase 7: User Story 5 - Installed scoresheet web app moves over (Priority: P3) [PR 2, switch day]

**Goal**: old PWA installs unregister and land on `/qzr/scoresheet/` without losing saved work (FR-014, research R6).

**Independent Test**: quickstart section 3 steps 2 and 3.

- [ ] T034 [US5] Create `apps/web/worker/legacySw.ts` exporting the self-destroying service worker source as a string, per `contracts/routing.md` "Self-destroying service worker": on `install` call `skipWaiting()`; on `activate` delete only caches whose name contains `/scoresheet/` and not `/qzr/scoresheet/`, then `self.registration.unregister()`, then `client.navigate('/qzr/scoresheet/' + new URL(client.url).search)` for each window client. Never touch `localStorage`, IndexedDB, or `/qzr/scoresheet/` caches
- [ ] T035 [US5] Add a failing test to `apps/web/worker/__tests__/index.spec.ts`: `GET /scoresheet/sw.js` returns `200`, `Content-Type: text/javascript`, `Cache-Control: no-cache`, body equal to the `legacySw.ts` export, and is not redirected; then handle it in `apps/web/worker/index.ts` ahead of the `/scoresheet` redirect
- [ ] T036 [US5] Add `apps/web/worker/__tests__/legacySw.spec.ts`: evaluate the source against fake `self`, `caches`, and `clients` objects and assert the cache filter keeps `workbox-precache-v2-https://www.versevault.ca/qzr/scoresheet/` and deletes `workbox-precache-v2-https://www.versevault.ca/scoresheet/`, and that unregister happens before navigate

---

## Phase 8: Polish, docs, release

**Purpose**: docs in the same PR (constitution II), version bumps that trigger deploys, manual steps

### PR 1a and PR 1b

- [ ] T037 [P] Update `docs/auth.md`: OAuth callbacks are `/qzr/api/auth/callback/{github,google}` (plus `/api/auth/...` until switch day), the per-request base path, the `qzr` cookie prefix and why
- [ ] T038 [P] Update `docs/architecture.md` hosting table: `/qzr/` portal and `/qzr/scoresheet/` via the `qzr-web` Worker, `/qzr/api/` via `qzr-api`, root owned by verse-vault after switch day
- [ ] T039 [P] Update URLs in `docs/roles-and-access.md` (`/qzr/scoresheet/?meet=...`, join link) and `README.md` (live app link, deploy section, `wrangler deploy` instead of Pages)
- [ ] T040 [P] Update `CLAUDE.md` (OAuth callbacks gotcha; `pnpm deploy` description) and `.claude/skills/release/SKILL.md` (deploy target)
- [ ] T041 Before opening each of PR 1a and PR 1b, check that each package it releases (1a: `api`; 1b: `web`, `scoresheet`) was bumped exactly once on that branch (`git log <base>.. -- <pkg>/package.json`) and that each dated section covers the whole change: `api` (`/qzr/api` mount, per-request auth base path, `qzr` cookie prefix), `web` (served at `/qzr/` by the `qzr-web` Worker, not-found page), `scoresheet` (served at `/qzr/scoresheet/`, apps call `/qzr/api`)
- [ ] T042 Run `pnpm test:unit`, `pnpm type-check`, `pnpm lint`; then run `/speckit-analyze` before opening the PRs. The PR 1a body says it releases `api` and must deploy before PR 1b merges. The PR 1b body carries the `qzr-web` deployable justification from plan.md Complexity Tracking (constitution, Technology Constraints), says it releases `web` and `scoresheet`, and says it needs PR 1a live
- [ ] T043 MAINTAINER, before merging PR 1b: confirm whether qzr's GitHub sign-in is an OAuth App or a GitHub App, and register the new callbacks (Google: add `https://www.versevault.ca/qzr/api/auth/callback/google`; GitHub OAuth App: set the callback to `https://www.versevault.ca/`; GitHub App: add the `/qzr/...` URL) (research R8). Immediately before merging each of PR 1a and PR 1b, rebase it onto current master and let CI re-run the contract check (constitution 1.1.0: PRs that bump a version are rebased before merge)
- [ ] T044 MAINTAINER, after PR 1b deploys: walk quickstart section 2, publish the desktop and Android release, and tell known app users to update (SC-006)

### PR 2

- [ ] T045 Docs for switch day: `docs/architecture.md`, `docs/auth.md`, `README.md` drop the root `/api` and Pages references; add entries to the dated sections created at T030 (`web`) and T033 (`api`)
- [ ] T046 MAINTAINER, at cutover: rebase PR 2 onto current master and wait for CI, then merge it in the order in `~/notes/url-change/PLAN.md` Phase B, walk quickstart section 3
- [ ] T047 MAINTAINER, weeks later: remove the old OAuth callbacks (narrow GitHub to `/qzr/api/auth/callback/github`), delete the `versevault-www` Pages project

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none
- **Foundational (Phase 2)**: none on Setup (API only); blocks US1 sign-in and US3
- **US1 (Phase 3)**: needs Phase 1 (Worker scaffold) and Phase 2
- **US2 (Phase 4)**: needs Phase 2 (T008 touches the same `createAuth`)
- **US3 (Phase 5)**: needs Phase 2; independent of US1's front-end tasks except T019 (same file as T027: do T027 after T019)
- **US4, US5 (Phases 6-7)**: need PR 1b merged and deployed; T034-T036 depend on T031 for the shared file
- **Polish**: PR 1a items after Phases 2 and 4, PR 1b items after Phases 3 and 5; PR 2 items after Phases 6-7

### Within Each Story

- Test tasks before their implementation tasks, and see them fail
- `apps/web/worker/index.ts` is touched by T003, T014, T031, T035: sequential
- `apps/scoresheet/vite.config.ts` is touched by T019 and T027: sequential
- `packages/api/src/lib/auth.ts` is touched by T008 and T026: sequential

### Parallel Opportunities

- T006 and T007 (separate spec files)
- T012 and T013 (separate spec files)
- T015, T016, T017, T019, T021, T022 (separate files) once T012-T014 are underway
- T037-T040 (separate docs)

## Parallel Example: User Story 1

```text
Task: "T015 apps/web/vite.config.ts base, outDir, __API_URL__, __SCORESHEET_URL__"
Task: "T019 apps/scoresheet/vite.config.ts PWA scope, start_url, id, icons, outDir"
Task: "T021 apps/scoresheet/index.html icon hrefs via %BASE_URL%"
Task: "T022 useAuth.ts in both apps: full auth URL"
```

## Implementation Strategy

### MVP (PR 1a, then PR 1b)

1. Phase 2 and US2 (Phase 4) with their docs: PR 1a. Merge, deploy, confirm `/qzr/api/auth/ok`.
2. Phase 1, US1 (Phase 3), and US3 (Phase 5) with their docs: PR 1b. The new app URL needs to be
   live before switch day, so it ships here.
3. `/speckit-analyze`, open PR 1b. Maintainer registers OAuth callbacks, merges, verifies, releases
   apps.

### Switch day (PR 2)

4. Phases 6-7 on a fresh branch, reviewed ahead of time, merged only as part of the verse-vault
   cutover.

## Notes

- `[P]` tasks = different files, no dependencies
- Keep `tasks.md` checkboxes in the hyphen form; dprint is excluded for this file (CLAUDE.md)
- Scope discipline: anything nearby that looks wrong (for example `/health` being unreachable in
  production) is raised with the maintainer, not fixed here
