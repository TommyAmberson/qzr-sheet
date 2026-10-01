# Implementation Plan: Move qzr under /qzr

**Branch**: `feat/qzr-subpath` | **Date**: 2026-10-01 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/001-qzr-subpath/spec.md`

## Summary

Serve all of qzr under `www.versevault.ca/qzr/` so verse-vault can take the root. The API answers at
both `/api/*` and `/qzr/api/*` (one Hono app mounted twice), and Better Auth picks its base path per
request so each entrance gets matching OAuth callbacks. The portal and scoresheet build with `/qzr/`
bases into one asset tree, served by a new `qzr-web` Worker with Workers Static Assets at `/qzr/*`,
alongside the frozen root site. qzr's session cookie gets its own prefix to stop clashing with
verse-vault. On switch day `qzr-api` drops its public `/api/*` route and `qzr-web` takes over
`/scoresheet*` and `/roadmap` with redirects and a self-destroying service worker for old installs.

## Technical Context

**Language/Version**: TypeScript 5, Node `>=22.12.0` for builds; Cloudflare Workers runtime

**Primary Dependencies**: Vue 3, Vite 7, vite-plugin-pwa 1, Hono 4, Better Auth 1.5.6, Wrangler 4,
Tauri 2

**Storage**: D1 (unchanged); browser `localStorage` (unchanged, per origin)

**Testing**: Vitest (`pnpm test:unit`), `pnpm type-check`, `pnpm lint`; manual checks in
[quickstart.md](quickstart.md)

**Target Platform**: Cloudflare Workers + Workers Static Assets; browsers (PWA); Tauri desktop and
Android

**Project Type**: web app (portal + PWA) with a Workers API and native wrappers

**Performance Goals**: no change; one extra redirect hop for legacy addresses only

**Constraints**: scoresheet stays fully usable offline through the move (constitution I); portal,
scoresheet, and API stay on one origin (technology constraints); the root site and old app installs
keep working until switch day

**Scale/Scope**: small user base (meet officials, coaches); ~25 source files, 2 workflows, 5 docs

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| #   | Principle                       | Gate                                                                                                                                                                                                                                  | Pass when           | Answer                                                                                                                                                                                             |
| --- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I   | Offline, always                 | Can an official still score, auto-save, and save/load a quiz with the API down? Can any load path drop scores silently?                                                                                                               | yes, then no        | Yes, then no. Scoring code is untouched. Old installs keep their cached copy offline; the self-destroying worker only runs online and never touches `localStorage` or the new scope's caches (R6). |
| II  | Rulebook is the spec            | Does the feature change scoring, scheduling, auth, roles, or the data model? If so, which doc in `docs/` is amended, and does any new rulebook departure arrive as an opt-in setting documented in `docs/scoring-rules-explained.md`? | doc named, or N/A   | Auth addresses and cookie name change: `docs/auth.md` amended. `docs/roles-and-access.md` URLs and `docs/architecture.md` hosting table updated in the same PR. No scoring change.                 |
| III | One pure scoring implementation | Does anything outside `apps/scoresheet/src/scoring/` (or `packages/shared`, once moved) compute a score, validation, grey-out, visibility, overtime, or placement?                                                                    | no                  | No.                                                                                                                                                                                                |
| IV  | Meet data gated per meet        | Does every new or changed API route touching a meet's data check membership, a guest token for that meet, or superuser? Is any new token or session scheme introduced?                                                                | yes, then no        | Yes (same handlers, same middleware, mounted at a second prefix), then no (cookie renamed, scheme unchanged).                                                                                      |
| V   | Contract versions               | Does it touch `packages/shared/src/`? If so, which semver level, is the bump in the same commit, and does it change `FILE_VERSION`?                                                                                                   | level named, or N/A | N/A. Prefixes are passed in by the apps; `apiClient` and `authClient` are unchanged (R4).                                                                                                          |
| VI  | Validate before merge           | Are scoring and validation changes covered by unit tests in `__tests__/`? Is every D1 schema change shipped as a migration from `db:generate`?                                                                                        | yes, or N/A         | N/A for scoring and schema. New routing logic (prefixed mount, auth basePath, `qzr-web` script, self-destroying worker) gets unit tests.                                                           |
| -   | Technology constraints          | Does it add a package or deployable, a cross-origin production client, or HTML5 drag?                                                                                                                                                 | no, or justified    | Adds one deployable (`qzr-web` Worker), replacing the `versevault-www` Pages project. Justified below. No new package (it lives in `apps/web/worker/`), no cross-origin client, no drag.           |

Post-design re-check: unchanged after Phase 1. All gates pass; the one deployable is justified in
Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/001-qzr-subpath/
├── spec.md
├── plan.md              # this file
├── research.md          # R1-R9 decisions
├── data-model.md        # address map, auth base path, cookie, PWA identity
├── quickstart.md        # local, parallel-stage, and switch-day checks
├── contracts/
│   └── routing.md       # public routing contract
├── checklists/
│   └── requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
packages/api/
├── wrangler.toml                 # + route www.versevault.ca/qzr/api/*; switch day: drop /api/*
└── src/
    ├── index.ts                  # inner `api` app mounted at '/qzr' and '/'; auth basePath per request
    ├── lib/auth.ts               # createAuth(env, { basePath }); advanced.cookiePrefix 'qzr'
    └── routes/__tests__/         # + prefix-mount and auth-basePath tests

apps/web/
├── vite.config.ts                # base '/qzr/', outDir 'dist/qzr', __API_URL__ '/qzr', __SCORESHEET_URL__
├── index.html                    # favicon via %BASE_URL%
├── public/_redirects, _routes.json   # removed (Pages-only)
├── src/router/index.ts           # + not-found catch-all for unknown deep paths
├── src/composables/useAuth.ts    # full auth URL incl. /qzr/api/auth
├── wrangler.toml                 # NEW: qzr-web Worker, assets dir ./dist, routes /qzr, /qzr/*
└── worker/
    ├── index.ts                  # NEW: SPA fallback, /qzr redirect; switch day: legacy redirects + sw.js
    ├── legacySw.ts               # NEW: self-destroying service worker source (switch day)
    └── __tests__/                # NEW

apps/scoresheet/
├── vite.config.ts                # base/scope/start_url/id/icons/navigateFallback/outDir; Tauri API URL
├── index.html                    # icon links via %BASE_URL%
└── src/composables/useAuth.ts    # full auth URL

package.json                      # build:all copies into apps/web/dist/qzr/scoresheet; deploy script
.github/workflows/
├── deploy-web.yml                # wrangler deploy (qzr-web) instead of pages deploy
└── release-scoresheet.yml        # same

docs/auth.md, docs/architecture.md, docs/roles-and-access.md, README.md, CLAUDE.md,
.claude/skills/release/SKILL.md   # new addresses, cookie prefix, hosting
```

**Structure Decision**: no new workspace package. The `qzr-web` Worker's config and script live in
`apps/web` because it serves `apps/web/dist` (which also carries the scoresheet build) and deploys
with the `web` and `scoresheet` releases.

### Delivery stages

1. **API prefix (`feat/qzr-api-prefix`)**: the `qzr-api` changes (prefixed mount, per-request auth
   base path, cookie prefix) and their docs. The API keeps answering at `/api/*`, so this is safe on
   its own; it merges and deploys first because the front ends depend on `/qzr/api/*`.
2. **Parallel stage (`feat/qzr-subpath`, after the API is live)**: everything else except the
   switch-day items. Deploying it puts qzr live at `/qzr/` while `versevault-www` keeps serving the
   root, frozen. Then: register OAuth callbacks (R8) before the deploy, verify with quickstart
   section 2, release desktop and Android builds with the new API URL.
3. **Switch day (a further small PR, merged during the verse-vault cutover)**: drop `qzr-api`'s
   `/api/*` route; add `qzr-web` routes and code for `/scoresheet*`, `/roadmap`, and the
   self-destroying worker; docs. Ordered with the verse-vault steps in `~/notes/url-change/PLAN.md`.
4. **Cleanup (weeks later)**: remove old OAuth callbacks, delete the `versevault-www` Pages project.

## Complexity Tracking

| Violation                        | Why Needed                                                                                                        | Simpler Alternative Rejected Because                                                                                                                                                                                                         |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New deployable: `qzr-web` Worker | Pages binds to whole hostnames only, and the root hostname goes to verse-vault; qzr needs to be served at a path. | A Pages project at `/qzr/` still needs a proxy Worker (two deployables). Serving assets from `qzr-api` couples web releases to API deploys and D1 migrations. Replaces `versevault-www`, so the deployable count is unchanged after cleanup. |
