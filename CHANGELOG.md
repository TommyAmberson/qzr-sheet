# qzr — what's new

A short, user-oriented overview of recent scoresheet releases. For the full per-component change
history with technical detail, see the dedicated changelogs at the bottom of this page.

## Recent highlights

### Guest viewer access — share a meet with anyone

Coaches, parents, and spectators can now follow a live meet without an account. Share a viewer URL
(`?meet=<viewerCode>`) and they see the live results — schedule, teams, scores — but can't edit
anything. Multiple guest meets are kept side-by-side so it's safe to follow more than one tournament
at a time.

### Schedule editor — draft and save

Drafting a meet schedule no longer hits the server on every keystroke. Build out slots, quizzes,
seats, prelim assignments, and team lateness locally; Populate / Roll Teams / Sort by Lateness run
instantly with no network round-trips; commit the whole draft with one **Save**. **Discard** reverts
everything to the last saved state.

### Roster and meet management

Coaches can manage their church's roster from a portal that mirrors the scoresheet's draft/save
pattern. Admins set up meets, divisions, official codes, and viewer codes; the dashboard
consolidates everything from membership management to roster CSV import/export.

### Tutorial

A guided walkthrough covers team setup, scoring (correct / error / foul / bonus / multi-bonus),
toss-ups, no-jumps, timeouts, substitutions, A/B sub-questions, and overtime. Start it from the `?`
help button — your current quiz is snapshotted and restored when the tutorial finishes.

### Mobile and offline

Full PWA install on any browser plus a signed Android APK. Sticky running totals, touch-friendly tap
targets, and the scoresheet keeps working offline (auto-save to localStorage, restored on startup).
Dark and light themes throughout.

### Native desktop builds

Tauri builds for Linux, Windows, and macOS, available as draft GitHub releases on each scoresheet
version bump.

## Per-component changelogs

Detailed engineering history with date stamps, motivations, and migration notes:

* **[apps/scoresheet/CHANGELOG.md](apps/scoresheet/CHANGELOG.md)** — the live scoring tool (Tauri
  desktop, Android APK, browser PWA). The historical record of scoresheet features — every release
  prior to 0.9.2 was a unified monorepo tag, so this file also captures the matching
  portal/API/infra work for those releases.
* **[apps/web/CHANGELOG.md](apps/web/CHANGELOG.md)** — the web portal (coach roster management,
  admin dashboard) at `www.versevault.ca`.
* **[packages/api/CHANGELOG.md](packages/api/CHANGELOG.md)** — the API (Hono + D1 on Cloudflare
  Workers).
* **[packages/shared/CHANGELOG.md](packages/shared/CHANGELOG.md)** — the shared contract package
  (QuizFile schema, role enums, shared API types). A bump here ripples through every consumer; see
  CLAUDE.md "Contract package versioning" for the discipline.
