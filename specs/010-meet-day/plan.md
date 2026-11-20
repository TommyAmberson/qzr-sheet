# Implementation Plan: Meet day: one page, in tabs

**Branch**: `docs/meet-day-spec` | **Date**: 2026-11-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/010-meet-day/spec.md`

## Summary

A meet's portal pages become one page with five tabs. Schedule shows the published schedule filling
in as quizzes are played; Quizzes is today's results page, listing scheduled quizzes not in yet
beside stored ones; Standings is a division's stats with its steps; Roster and Setup hold what the
meet page holds today, with the stats settings moved into Setup. Elimination and Finals benches name
their team once its source is settled (#16), worked out by one shared resolver from confirmed orders
and counted quizzes, without changing the published schedule.

The approach (research.md): a new `GET /api/meets/:id/day` joins the schedule with the meet's
results and settled benches, cut to the reader and cached briefly for viewers so a page re-reading
every 30 seconds stays cheap on the free plan; a pure `resolveBenches` in `packages/shared` answers
"which team is on this bench" for the API, the portal and the scoresheet; the existing views become
the tabs' contents under one route.

## Technical Context

**Language/Version**: TypeScript 5, Vue 3 (portal, scoresheet), Hono on Cloudflare Workers (API)

**Primary Dependencies**: existing only: Vue Router, Hono, Drizzle over D1, TypeBox; no new package

**Storage**: D1, unchanged: no table or migration. Reads `meet_schedule_versions`, `quiz_results`
and its revisions and kept scores, `division_confirmations`, `meet_stats_settings`

**Testing**: Vitest: shared specs for `resolveBenches`, API route specs for `GET /day`, portal specs
for the tab routing and refresh, scoresheet specs for filling a resolved bench

**Target Platform**: browsers (portal, scoresheet PWA), Tauri (scoresheet), Workers free plan (API)

**Project Type**: web application in a pnpm monorepo (apps/web, apps/scoresheet, packages/api,
packages/shared, packages/ui)

**Performance Goals**: a day response for a three-division meet within the CPU the attention list
uses today (33 to 35 ms on the deployed Worker); one build per meet per 20 seconds for viewers

**Constraints**: Workers free plan (10 ms CPU tolerated in bursts, 50 queries); viewers see nothing
meet stats wouldn't give them (SC-007); no page scrolls sideways at 390 px (SC-005)

**Scale/Scope**: meets of up to about 300 stored quizzes, 6 divisions, 12 rooms; five tabs replacing
six pages

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| #   | Principle                       | Gate                                                                                                                                                                                                                                  | Pass when                                          | Answer                                                                                                                                                                                                 |
| --- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| I   | Offline, always                 | Can an official still score, auto-save, and save/load a quiz with the API down? Can any load path drop scores silently?                                                                                                               | yes, then no                                       | Yes, then no. The scoresheet only gains settled benches when it can reach the API; without it, it opens a scheduled quiz as today, benches blank.                                                      |
| II  | Rulebook is the spec            | Does the feature change scoring, scheduling, auth, roles, or the data model? If so, which doc in `docs/` is amended, and does any new rulebook departure arrive as an opt-in setting documented in `docs/scoring-rules-explained.md`? | doc named, or N/A                                  | Scheduling and roles: `docs/scheduling.md` (bench resolution built), `docs/roles-and-access.md` (tabs, the day response), `docs/architecture.md` (the page). No scoring change, no rulebook departure. |
| III | One pure scoring implementation | Does anything outside `packages/shared/src/scoring/` compute a score, validation, grey-out, visibility, overtime, or placement?                                                                                                       | no                                                 | No. Places come from kept scores; visibility from `viewerHas`; bench resolution is a pure function in `packages/shared/src/schedule/`.                                                                 |
| IV  | Meet data gated per meet        | Does every new or changed API route touching a meet's data check membership, a guest token for that meet, or superuser? Is any new token or session scheme introduced?                                                                | yes, then no                                       | Yes, then no. `GET /day` checks `isViewerOf` before anything, a cached copy included, and is mounted where guest tokens reach it, as the stats routes are.                                             |
| V   | Contract versions               | Does it touch `packages/shared/src/`? If so, which semver level, is it bumped once in this PR, and does it change `FILE_VERSION`?                                                                                                     | level named, or N/A                                | Yes: MINOR (new `resolveBenches`, `MeetDay` types), once in the first PR that touches shared. `FILE_VERSION` unchanged.                                                                                |
| VI  | Validate before merge           | Are scoring and validation changes covered by unit tests in `__tests__/`? Is every D1 schema change shipped as a migration from `db:generate`?                                                                                        | yes, or N/A                                        | Yes for `resolveBenches` and the elimination teams check; no schema change.                                                                                                                            |
| VII | Simplest design that works      | Does every decision or write path the feature adds have one owner in Reuse and Ownership? Does the design add a production export, option, or state that only a test reads, duplicate existing code, or restate a framework default?  | post-design: yes, then no (pre-research: deferred) | Yes, then no: see Reuse and Ownership. The four inline letter lookups fold into the resolver rather than gaining a fifth.                                                                              |
| -   | Technology constraints          | Does it add a package or deployable, a cross-origin production client, or HTML5 drag?                                                                                                                                                 | no, or justified                                   | No.                                                                                                                                                                                                    |

## Project Structure

### Documentation (this feature)

```text
specs/010-meet-day/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── meet-day-api.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
packages/shared/src/
├── schedule/resolve.ts          # new: resolveBenches, the one answer to "which team is on this bench"
├── stats/quizProblems.ts        # scheduledQuizOf checks resolved elimination benches
└── stats/meetDay.ts             # new: MeetDay response types and the viewer cut of a quiz's line

packages/api/src/
├── routes/day.ts                # new: GET /api/meets/:id/day, mounted with the stats routes
├── lib/divisionStats.ts         # divisionOf gives the counted places resolveBenches needs
└── lib/quizFacts.ts             # confirmed orders keyed for resolveBenches

packages/ui/src/
├── ScheduleSheet.vue            # optional `marks` prop: status, results, settled teams
└── ScheduleSeat.vue             # shows a settled team and a result line

apps/web/src/
├── router/index.ts              # one /:slug route with tab children; redirects from old paths
├── views/MeetView.vue           # new: the page shell: header, tab bar, division picker, refresh
├── views/meet/ScheduleTab.vue   # from ScheduleView, with marks and the phone list
├── views/meet/QuizzesTab.vue    # from ResultsView, with scheduled quizzes not in yet
├── views/meet/StandingsTab.vue  # from DivisionStatsView, with the division steps
├── views/meet/RosterTab.vue     # the churches section of QuizMeetView
├── views/meet/SetupTab.vue      # the rest of QuizMeetView and StatsSettingsView
├── components/ScheduleList.vue  # new: a division's quizzes by time, for phones
└── composables/useMeetDay.ts    # new: loading GET /day and the 30-second refresh

apps/scoresheet/src/
└── api.ts                       # getScheduledQuiz takes settled benches from GET /day
```

**Structure Decision**: the existing monorepo layout; the five tabs live under a new
`apps/web/src/views/meet/` beside the views they come from, which are then removed.

## Reuse and Ownership

| Decision or write path                              | Owner                                                                                                 | Existing code reused                                                                    |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Which team sits on a bench                          | new `resolveBenches` in `packages/shared/src/schedule/resolve.ts`                                     | the draw (`doc.draw`), `rerankOf` rank numbering, folded names (`foldName`)             |
| Whether a stored quiz counts, and its places        | `divisionStats` in `packages/shared/src/stats/divisionStats.ts`, unchanged                            | kept scores, acceptance, stages                                                         |
| What a reader may see of a quiz, a table or a bench | `viewerHas` and the API's `cutTo`, extended to the day response                                       | `packages/shared/src/stats/settings.ts`, `packages/api/src/routes/stats.ts`             |
| What needs attention                                | `attentionOf` and `GET /stats/attention`, unchanged; the day response carries only the count          | the Quizzes tab keeps calling `GET /stats/attention` for the items                      |
| A scheduled quiz's status on the page               | new `dayQuizStatus` in `packages/shared/src/stats/meetDay.ts`                                         | `QuizResult.status`, the link from `quizFacts`                                          |
| Building the day response under one scoring budget  | new `packages/api/src/routes/day.ts`                                                                  | `statsGround`, `divisionOf`, `REVISIONS_SCORED_PER_REQUEST`, the attention route's loop |
| Caching a viewer's day response                     | `packages/api/src/routes/day.ts`                                                                      | the Workers Cache API (`caches.default`)                                                |
| Which tab and division show                         | the route (`apps/web/src/router/index.ts`): path for the tab, `?division=` for the division           | Vue Router                                                                              |
| Re-reading while open                               | new `useMeetDay` composable                                                                           | `whenPrepared` (503 retry) in `apps/web/src/api.ts`                                     |
| Drawing the schedule with results                   | `ScheduleSheet` and `ScheduleSeat` in `packages/ui`                                                   | their layout, `seatText`                                                                |
| A scheduled quiz's teams in the scoresheet          | `getScheduledQuiz` in `apps/scoresheet/src/api.ts`                                                    | `planLink`, `teamForBlank` in `Scoresheet.vue`                                          |
| A division's steps                                  | `moveDivision` and the steps section, moved from `StatsSettingsView` into a component both tabs mount | `POST /divisions/:division/state`, `whenPrepared`                                       |

**Platform already provides**: Vue Router's redirects and query handling; the browser's
`visibilitychange`; the Workers Cache API on the custom domain; `isViewerOf` for guests and members.

**Releases**: shared MINOR; api MINOR; web MINOR; scoresheet MINOR (settled benches when opening a
scheduled quiz). Release commits last, one per package, versions set when written.

## Delivery

Four pull requests, each leaving the portal working and released:

1. **Benches and the day response** (Stories 1 and 2's data, FR-011, FR-023): `resolveBenches`, the
   elimination teams check, `GET /day` with its cut and cache. Shared, api.
2. **The page and its tabs** (Stories 1 to 4, FR-001 to FR-020, FR-022): `MeetView`, the five tabs,
   the redirects, `marks` on the schedule, the refresh. Web, ui. Waits for #200.
3. **Scoresheet benches** (FR-023): the scoresheet fills settled benches. Scoresheet.
4. **Phone** (Story 5, FR-021): the schedule as a list, the scrolling tab bar and picker. Web.

## Complexity Tracking

None.
