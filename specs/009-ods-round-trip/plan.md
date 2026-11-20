# Implementation Plan: ODS round trip for meet results

**Branch**: `feat/import-results` | **Date**: 2026-11-19 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/009-ods-round-trip/spec.md`

## Summary

Let a meet move between LibreOffice ODS sheets and the app in either direction, partway through. The
scoresheet's ODS reader and writer move to `packages/shared` so both apps share them. The shared
upload (portal and scoresheet) accepts `.ods`, shows each file matched to its scheduled quiz and
room before sending, and skips files identical to what the meet holds. The portal downloads stored
quizzes as `.ods` or `.json`, singly or as an archive, built in the browser from the existing
results list; a room falling back to spreadsheets starts from the meet's template. A meet admin
uploads the scoring template once, stored in D1; the portal and the linked scoresheet fill it. The
roster import, which failed on a real meet, becomes one chunked transaction. The other defect that
import hit, accepted quizzes shown as not placed, is fixed by #200 (R9).

## Technical Context

**Language/Version**: TypeScript ~5.9, Node >=22.12

**Primary Dependencies**: Vue 3, Hono, Drizzle (D1), fflate (moves into `@qzr/shared`), TypeBox

**Storage**: Cloudflare D1; one new table for the meet's template (blob, ~100 KB)

**Testing**: Vitest (`pnpm test:unit`), with the API's D1 test database

**Target Platform**: Cloudflare Workers (API), browsers (portal, scoresheet PWA), Tauri 2
(scoresheet desktop and Android)

**Project Type**: pnpm monorepo web application (two Vue apps, shared packages, Worker API)

**Performance Goals**: a 75-quiz backfill sent in one upload (SC-001); every request within the
Worker's per-request CPU budget, so no request does more than one quiz's work

**Constraints**: scoresheet export works offline through the file picker (Principle I); D1's bound
parameter cap (`D1_MAX_PARAMS`) on every insert; D1 value limit 2 MB for the template

**Scale/Scope**: meets of 40 to 60 teams, 300 quizzers, about 150 quizzes

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| #   | Principle                       | Gate                                                                               | Pass when                 | Answer                                                                                                                                                                                                                                         |
| --- | ------------------------------- | ---------------------------------------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I   | Offline, always                 | Score, auto-save, save/load with the API down? Silent score loss on any load path? | yes, then no              | Yes: scoring is untouched; export falls back to the template picker with no link or network (R11). No: `.ods` reading is the scoresheet's existing reader, moved; the empty-seat `mb` becomes a no-jump rather than being dropped.             |
| II  | Rulebook is the spec            | Changes scoring, scheduling, auth, roles, data model?                              | doc named, or N/A         | Data model and roles: `docs/data-model.md` (template table) and `docs/roles-and-access.md` (template access, downloads) amended. `docs/ods-format.md` and `docs/architecture.md` updated for the move and the template. No rulebook departure. |
| III | One pure scoring implementation | Anything outside `scoring/` computes placement etc.?                               | no                        | No. This feature computes no placement; R9's fix is #200's.                                                                                                                                                                                    |
| IV  | Meet data gated per meet        | New or changed routes check membership/guest/superuser? New token scheme?          | yes, then no              | Yes: template routes check admin, official (account or guest token), or full-roster reader for the meet (contracts/api.md). No new token scheme.                                                                                               |
| V   | Contract versions               | Touches `packages/shared/src/`? Level? `FILE_VERSION`?                             | level named, or N/A       | Yes, MINOR: new ODS module, upload matching helpers, the empty-seat reading rule. `FILE_VERSION` unchanged: the `QuizFile` format is untouched.                                                                                                |
| VI  | Validate before merge           | Scoring/validation changes unit-tested? Migration from `db:generate`?              | yes, or N/A               | Yes: reader rule, unchanged detection, roster import size and atomicity, and the ODS round trip each get a test. The template table's migration comes from `db:generate`.                                                                      |
| VII | Simplest design that works      | One owner per decision? Test-only exports, duplicates, restated defaults?          | post-design: yes, then no | Yes, see Reuse and Ownership. No: downloads reuse the results list instead of new endpoints; `HEAD` comes from Hono's `GET`; uploads reuse the results `POST`.                                                                                 |
| -   | Technology constraints          | New package/deployable, cross-origin client, HTML5 drag?                           | no, or justified          | No. `fflate` moves from the scoresheet into `@qzr/shared`; no new package or binding.                                                                                                                                                          |

Post-design re-check: unchanged; all gates pass.

## Project Structure

### Documentation (this feature)

```text
specs/009-ods-round-trip/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── api.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
packages/shared/src/
├── ods/                       # moved from apps/scoresheet/src/export/ (readOds, fillOts, odsXml)
│   └── __tests__/
└── index.ts                   # exports the ODS module
packages/ui/src/
└── sendQuizzes.ts             # upload: .ods reading, batch review, unchanged, apply-to-rest
packages/api/src/
├── db/schema.ts               # meet template table
├── migrations/                # generated
├── routes/results.ts          # unchanged answer on POST
├── routes/churches.ts         # roster import as one chunked batch
└── routes/                    # template routes (file chosen at implementation)
apps/web/src/
├── views/ResultsView.vue      # downloads, upload review
├── views/ResultView.vue       # downloads of a quiz and its revisions
└── views/QuizMeetView.vue     # template upload; roster reload after any import
apps/scoresheet/src/
├── components/Scoresheet.vue  # export from the meet's template, "another template…"
└── persistence/fileIO.ts      # template picker stays as the fallback
docs/
├── data-model.md, roles-and-access.md, ods-format.md, architecture.md
```

**Structure Decision**: No new package. Shared logic goes where both apps already reach it:
`packages/shared` for pure file code, `packages/ui` for the upload, which the scoresheet's submit
already shares parts of.

## Reuse and Ownership

| Decision or write path                                    | Owner                                                                       | Existing code reused                                                                                 |
| --------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Reading a sheet into a quiz (incl. empty-seat `mb`)       | `readOds`, moved to `packages/shared/src/ods/`                              | `readOds`, `odsXml`, shared scoring rules it already calls                                           |
| Filling the template with a quiz                          | `fillOts`, moved to `packages/shared/src/ods/`                              | `fillOts`, `odsSupportsFormat`, `ODS_TWENTY_ONLY`                                                    |
| Whether an uploaded file is a scoring template            | the ODS module's sheet lookup, called by the template route                 | `readOds`'s Quiz sheet extraction                                                                    |
| Storing and serving the meet's template                   | new: template routes in `packages/api/src/routes/`, table in `db/schema.ts` | `isAdminOrSuperuser`, `officialRoomsOf`/`isOfficialOfRoom`, roster read rule in `lib/permissions.ts` |
| Storing an uploaded quiz, rooms, phase, linking           | `results.post('/:id/results')`                                              | unchanged route; `upload: true`, `roomId`, `scheduleQuizId`                                          |
| Whether a sent file is unchanged                          | `results.post('/:id/results')`, before `alreadySubmitted`                   | `newestRevision`/`revisionFile`, the restore path's "already current" comparison                     |
| Matching a file to its scheduled quiz                     | the upload in `packages/ui/src/sendQuizzes.ts`                              | `resultKey`, `resultName`, `scheduleQuizMeta`                                                        |
| Asking about an already-stored quiz, applying to the rest | `askAlreadySubmitted` in `sendQuizzes.ts`                                   | `askAlreadySubmitted`, `existingQuizOf`, `chooseRoom`                                                |
| Download file names                                       | the scoresheet's file stem, moved where both apps reach it                  | `fileStem` in `Scoresheet.vue`, `quizName`                                                           |
| Building archives                                         | the portal's download code in `apps/web/src/`                               | `fflate` `zipSync`, the results list from `GET /api/meets/:id/results`                               |
| Roster import writes                                      | `churches.post('/meets/:meetId/roster/import')`                             | `asOne`, `chunksOf`, `batchCreateQuizzers`                                                           |
| Roster reload after an import                             | `handleRosterFile` in `QuizMeetView.vue`                                    | `load()`                                                                                             |
| Export ODS in the scoresheet                              | `exportOds` in `Scoresheet.vue`                                             | `openOtsTemplate` (fallback), the meet session's API client                                          |

**Platform already provides**: D1 batches are transactions (`asOne`); Hono answers `HEAD` from a
`GET` route; the browser's file input gives `File.arrayBuffer()`; `fflate` zips synchronously in the
browser.

**Releases**: shared MINOR, then api MINOR (new routes and migration), web MINOR, scoresheet MINOR,
each naming the bundled shared version.

## Complexity Tracking

None.
