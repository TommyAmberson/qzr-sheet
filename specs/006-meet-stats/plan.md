# Implementation Plan: Meet stats

**Branch**: `feat/stats-management` | **Date**: 2026-11-14 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/006-meet-stats/spec.md`

## Summary

A meet's stats in the portal: quizzer standings beside the prelim standings, a stage for each stored
quiz so it counts for the right tables, accepting a quiz that is in error, a page that viewers are
shown piece by piece as the admin confirms each division's steps, per-meet settings, and results
management as its own page. The settings page was tried as a clickable [mockup](./mockup.html)
first.

The technical approach (see [research.md](./research.md)):

* The API computes a division's stats from the stored quizzes with pure functions in
  `packages/shared`, and sends each caller only what they may see (R1, R11). The portal stops
  ranking from fetched quiz files.
* Shared gains quizzer lines and quizzer standings read from the existing `scoreTeam` (R7), a
  tie-break order on the existing standings, placement points worked out when stats are read, the
  re-rank (R8), a scheduled quiz's stage and the match between a quiz and a scheduled quiz (R3, R4),
  the settings schema (R10), and the one function that says what a viewer has (R11).
* The API gains five tables (R2, R5, R9, R10, R12, [data-model.md](./data-model.md)), the stats
  routes, and changes to the results and division-state routes
  ([contract](./contracts/stats-api.md)). Nothing existing is altered: the counting records are read
  as a fallback (R3).
* The portal gains a stats page per division with print styles, a stats settings page, and a results
  management page with a list of what needs attention; the scoresheet sends its schedule link with a
  submission, takes the meet's way of scoring level teams (R15), and matches team names through the
  comparison it shares with the server.
* A stored quiz's problems are of three kinds (scoring, roster, schedule), each found by shared code
  and each keeping the quiz out until fixed or accepted (R16).
* The numbers are proved against a past meet through name-scrubbed fixtures (R14).

## Technical Context

**Language/Version**: TypeScript 5 on Node >=22.12.0; Vue 3.

**Primary Dependencies**: Hono and Drizzle (API), TypeBox (shared), Vite. No new dependency.

**Storage**: Cloudflare D1: five new tables, no existing table altered
([data-model.md](./data-model.md)). Scoresheet `localStorage`: the existing meet session, whose
`quizId` is now sent.

**Testing**: Vitest in each package. Shared: unit specs plus the reference-meet fixtures (R14). API:
the in-memory D1 in `src/test-db.ts`, which needs the new tables' DDL by hand. Portal: view logic
kept in plain modules so it is tested without mounting.

**Target Platform**: Browser (portal), browser PWA and Tauri (scoresheet), Cloudflare Workers (API).

**Project Type**: pnpm monorepo: two web apps, a Workers API, a shared contract package.

**Performance Goals**: A division's stats in one request within the free Workers plan's 10 ms of
CPU. Scoring the reference meet's 74 quizzes was measured at about 20 ms on a laptop, about 12 ms
for its largest division, so each revision is scored once, when saved, and a stats request only
ranks (R2). SC-003: standings can be shown within a minute of the last quiz arriving.

**Constraints**: The scoresheet works offline (principle I). One origin for portal, scoresheet and
API. Nothing reaches a viewer before its moment by any route (SC-005), so filtering is server-side.
No real names in the repository (R14). `qzr-api` runs on the free Workers plan: 10 ms of CPU and 50
database queries per request (R2).

**Scale/Scope**: A weekend meet: about 75 quizzes of about 2 KB, 3 divisions, about 40 teams and 150
quizzers. Eight user stories, of which three are P1.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| #   | Principle                       | Gate                                                                                                                                                                                                                                  | Pass when                                          | Answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I   | Offline, always                 | Can an official still score, auto-save, and save/load a quiz with the API down? Can any load path drop scores silently?                                                                                                               | yes, then no                                       | **Yes, then no.** The scoresheet's two changes read state it already holds: it sends `scheduleQuizId` only when linked, and takes the meet's formula only when it has reached the meet (R15). With the API down a sheet scores by its own setting and a failed submit changes nothing. No load path changes.                                                                                                                                                                                                                                                                                             |
| II  | Rulebook is the spec            | Does the feature change scoring, scheduling, auth, roles, or the data model? If so, which doc in `docs/` is amended, and does any new rulebook departure arrive as an opt-in setting documented in `docs/scoring-rules-explained.md`? | doc named, or N/A                                  | **Roles, scheduling and the data model change; no scoring rule does.** Amend `docs/roles-and-access.md` (what viewers, coaches and officials see of results and standings, by phase and division state), `docs/scheduling.md` (the `finals` division state, what each move confirms), `docs/data-model.md` (new tables). `docs/scoring-rules-explained.md` gains, as rules not in the rulebook: the average's divisor, ranking averages by errors, shared places, the second tie-break order (an opt-in meet setting, rulebook order the default). `docs/architecture.md` for stats computed in the API. |
| III | One pure scoring implementation | Does anything outside `packages/shared/src/scoring/` compute a score, validation, grey-out, visibility, overtime, or placement?                                                                                                       | no                                                 | **No.** Quizzer lines are read from `scoreTeam`; standings, the re-rank, placement points and placing an accepted quiz are in shared. The API and portal call shared and compute nothing (R1, R7, R8).                                                                                                                                                                                                                                                                                                                                                                                                   |
| IV  | Meet data gated per meet        | Does every new or changed API route touching a meet's data check membership, a guest token for that meet, or superuser? Is any new token or session scheme introduced?                                                                | yes, then no                                       | **Yes, then no.** Reads require `isViewerOf` and are cut to what the caller may see before the response is built; writes require admin, or for a link the quiz's room official ([contract](./contracts/stats-api.md)). Guest tokens as they are.                                                                                                                                                                                                                                                                                                                                                         |
| V   | Contract versions               | Does it touch `packages/shared/src/`? If so, which semver level, is it bumped once in this PR, and does it change `FILE_VERSION`?                                                                                                     | level named, or N/A                                | **Yes, MINOR in each PR that touches it.** Everything is additive: new exports, options with defaults, one more division state. `FILE_VERSION` unchanged: the schedule link is not in the file (R4).                                                                                                                                                                                                                                                                                                                                                                                                     |
| VI  | Validate before merge           | Are scoring and validation changes covered by unit tests in `__tests__/`? Is every D1 schema change shipped as a migration from `db:generate`?                                                                                        | yes, or N/A                                        | **Yes.** Shared specs for every new function, including the reference-meet fixtures; route specs for every new and changed route. The five tables arrive through `db:generate`; no data is migrated by hand (R3).                                                                                                                                                                                                                                                                                                                                                                                        |
| VII | Simplest design that works      | Does every decision or write path the feature adds have one owner in Reuse and Ownership? Does the design add a production export, option, or state that only a test reads, duplicate existing code, or restate a framework default?  | post-design: yes, then no (pre-research: deferred) | **Yes, then no.** See Reuse and Ownership. The portal's own ranking (`countedQuizzes`) and the counting toggle are removed rather than kept beside their replacements. One log table serves four kinds of decision (R5).                                                                                                                                                                                                                                                                                                                                                                                 |
| -   | Technology constraints          | Does it add a package or deployable, a cross-origin production client, or HTML5 drag?                                                                                                                                                 | no, or justified                                   | **No.** Existing packages only; the download is CSV made in the browser; print is the browser's.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

Post-design re-check: unchanged after Phase 1.

## Project Structure

### Documentation (this feature)

```text
specs/006-meet-stats/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── mockup.html          # the stats settings page, clickable
├── contracts/
│   └── stats-api.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
packages/shared/src/
├── phases.ts                       # the finals division state
├── scoring/standings.ts            # tie-break order; finalists on request; the re-rank
├── scoring/                        # new: quizzer lines and quizzer standings
├── scoring/__tests__/fixtures/     # the reference meet, names made up
├── stats/                          # new: settings schema, stages and moments, a scheduled quiz's
│                                   #   stage, quiz-to-schedule match, what a viewer has, a
│                                   #   division's stats, the response types
└── results.ts                      # the fold used for matching

packages/api/src/
├── db/schema.ts                    # five new tables
├── test-db.ts                      # their DDL
├── routes/stats.ts                 # new: stats, attention, settings, dismissals
├── routes/results.ts               # link on submit; stage, link, acceptance, keep, formula; list fields
└── routes/phase.ts                 # finals; readiness; confirmations and withdrawals

apps/web/src/
├── router/index.ts                 # stats, stats settings; results stays the management page
├── views/                          # new: division stats (with print styles), stats settings
├── views/ResultsView.vue           # management: filters, needs attention, stages, links, acceptance
├── results.ts                      # ranking removed; name edits stay
├── stats.ts                        # new: the settings form's before-and-after, CSV rows
└── api.ts                          # the new calls

apps/scoresheet/src/
├── api.ts                          # scheduleQuizId on submit
├── composables/useSubmitToMeet.ts  # passes the session's quizId
└── composables/useMeetSession.ts   # the meet's way of scoring level teams; team names matched
                                    #   through shared

docs/  roles-and-access.md, scheduling.md, data-model.md, scoring-rules-explained.md, architecture.md
specs/003-practice-meet-results/spec.md   # the lines this feature replaces
```

**Structure Decision**: No new package. Everything computed lives in `packages/shared`, in
`scoring/` where it scores and in a new `stats/` where it decides what counts and who sees it;
storage, authorisation and filtering in the API; pages in the portal. The settings page is its own
view, not a section of `QuizMeetView.vue`, which is already 1,959 lines.

## Reuse and Ownership

| Decision or write path                                          | Owner                                                                                                                                                                                                           | Existing code reused                                                                                              |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| A quizzer's points, errors, jumps and types in one quiz         | Shared, `scoring/` (new module), reading `scoreTeam`'s per-quizzer result                                                                                                                                       | `scoreTeam`, `buildCellGrid`, `inSeatOrder`, the quiz's `questionTypes`                                           |
| Quizzer standings: totals, average, places, the two lists       | Shared, the same new module                                                                                                                                                                                     | `foldName` and the most-used-spelling tally in `standings.ts`                                                     |
| Prelim standings and their tie-breaks                           | `divisionStandings` in `scoring/standings.ts`, taking the tie-break order                                                                                                                                       | The existing chain; the second order is the chain without its first step                                          |
| The re-rank after an intermediate                               | `scoring/standings.ts`, beside the standings                                                                                                                                                                    | The same tally and tie-break chain                                                                                |
| Placement points for teams level in a quiz                      | Shared `stats/`, the division's stats function: from each team's kept place and score, with the meet's formula, when stats are read (R2, R8)                                                                    | `computePlacementPoints` and both existing tables                                                                 |
| Placing a quiz accepted as scored                               | The same function: the kept place by score counts for a quiz in error only while it is accepted (R6)                                                                                                            | The scores and places `scoreTeam` and scoring one revision already give                                           |
| A stored quiz's stage                                           | Shared `stats/`: one function from admin choice, link and counting record (R3)                                                                                                                                  | `ScheduleQuiz.phase`, `line` and `deciding`                                                                       |
| A stored quiz's link: explicit, else by its name                | `linkOf` in `packages/api/src/lib/quizFacts.ts`, worked out when read (R4)                                                                                                                                      | `resultKey`, `resultName`, `scheduleQuizMeta`                                                                     |
| What a viewer has of each thing, and the state of standings     | Shared `stats/`: one function (R11), called by the API's filter and the settings page                                                                                                                           | `MEET_PHASES`, `DIVISION_STATES`                                                                                  |
| What scoring makes of one stored revision, and keeping it       | Shared `stats/`: one function from a quiz file to its scored facts; `routes/results.ts` writes the row where a revision is added, `routes/stats.ts` fills a missing one (R2)                                    | `deserialize`, `quizOutcome`'s pass, `scoreTeam`, `addRevisions`                                                  |
| A division's stats from its scored revisions                    | Shared `stats/`: one function the API calls                                                                                                                                                                     | Everything above                                                                                                  |
| What needs attention                                            | The same function's warnings, collected across divisions by `routes/stats.ts`                                                                                                                                   | `standings.ts`'s `unequalQuizCounts` and `lookAlike`                                                              |
| Whether a name is one of a division's roster teams              | Shared `stats/`: the name comparison moved from the scoresheet, used by the scoresheet's link, by a division's stats to key matched teams, and by the attention list (R12)                                      | `teamNamed` and `looseName` in `apps/scoresheet/src/composables/useMeetSession.ts`, `foldName`, `teamDisplayName` |
| A quiz's roster errors                                          | Shared `stats/`: one function from a quiz's names and its division's teams and rosters, called where a quiz is read (results list, a division's stats, the attention list) and callable by the scoresheet (R16) | The comparison above, `foldName`, `editDistance`                                                                  |
| A quiz's scoring errors, listed                                 | `assessQuiz`, whose list scoring one revision keeps (R2, R16)                                                                                                                                                   | `assessQuiz`, `validationMessage`                                                                                 |
| Cutting a response to its caller                                | `routes/stats.ts`, with the shared function, before the response is built                                                                                                                                       | `isViewerOf`, `isAdminOrSuperuser`, `officialRoomsOf`                                                             |
| The meet's stats settings                                       | `routes/stats.ts` and `meet_stats_settings`; validated by the shared schema                                                                                                                                     | `jsonBody`, the append-only pattern of `meet_schedule_versions`                                                   |
| Stage, link, acceptance and "kept" on a stored quiz             | `routes/results.ts`, one helper writing `quiz_result_changes`                                                                                                                                                   | `quizAccess`, `refusedByPhase`, `adminSaver` and `roomSaverFor`, `inChunks`                                       |
| Recording an explicit link (sheet or hand)                      | `linkTo` in `packages/api/src/lib/quizFacts.ts`, refusing a scheduled quiz another explicit link holds                                                                                                          | `recordChanges`                                                                                                   |
| Setting quizzes to the meet's formula                           | `routes/results.ts`, as ordinary `edited` revisions                                                                                                                                                             | `addRevisions`, `deserialize` and `serialize`                                                                     |
| A division's state, readiness, confirmations and withdrawals    | `routes/phase.ts`, the existing state route                                                                                                                                                                     | `validateTransition`, `division_states`                                                                           |
| Merging quizzer names                                           | `editQuizFile` and `mergeEdits` in `apps/web/src/results.ts`                                                                                                                                                    | Both exist; `editQuizFile` already takes quizzer names                                                            |
| The division stats page, and its printed form                   | A new view in `apps/web`, with print styles                                                                                                                                                                     | `meetAccess`, the portal's table styles                                                                           |
| The settings page: division steps, one line per thing, the save | A new view, with the before-and-after in `apps/web/src/stats.ts` from the shared function                                                                                                                       | The layout proved in [mockup.html](./mockup.html)                                                                 |
| The download                                                    | `apps/web/src/stats.ts`: CSV rows from the admin's stats response                                                                                                                                               | Nothing to reuse; no dependency added                                                                             |
| The schedule link on a submission                               | `submitResult` in `apps/scoresheet/src/api.ts`, from the meet session's `quizId`                                                                                                                                | `useMeetSession`'s `quizId`, set by `applyLoadedQuiz`                                                             |
| The meet's formula in a linked sheet                            | `useMeetSession`, where a meet is linked or a quiz loaded                                                                                                                                                       | The quiz store's `placementFormula`                                                                               |

**Platform already provides**: TypeBox validates the settings document and strips unknown fields; D1
cascades meet-scoped rows on meet delete; the state column is text, so a new division state needs no
migration (as `review` did not); the browser prints a page under `@media print` and saves a `Blob`
as a file; same-origin cookies and guest tokens authenticate both apps.

**Releases**: shared MINOR in each PR that changes it; api MINOR (routes, tables); web MINOR (stats,
settings and management pages); scoresheet MINOR (sends the link, takes the meet's formula). Each
consumer names its bundled shared version. Version numbers are set when each bump commit is written.
The work is too large for one pull request; a workable order is shared scoring with the fixtures,
then stages, links and acceptance with results management, then division steps, settings and the
filtered stats routes, then the stats page, then the scoresheet. `/speckit-tasks` settles it.

## Complexity Tracking

| Departure                                                                                     | Why                                                                                                         | Simpler alternative rejected because                                                                                                                                         |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `quiz_result_count_changes` stays, read but never written (principle VII)                     | Quizzes counted before this feature must become prelims, and their counting records are part of the history | Rewriting them as stage rows needs a hand-written data migration, which the constitution forbids; dropping the table cascades on D1 (as in #107).                            |
| A scored row is kept for each stored revision, though the spec calls every table derived (R2) | The free Workers plan allows 10 ms of CPU a request, and scoring a division on every read takes more        | Scoring on each read needs the paid plan. The row holds only what a revision's own content determines, keyed by the shared version, so no edit or setting can make it stale. |
