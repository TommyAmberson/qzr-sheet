# Quickstart: validating the ODS round trip

How to prove the feature works end to end. Contracts are in [contracts/api.md](./contracts/api.md);
the stored template in [data-model.md](./data-model.md).

## Prerequisites

* A worktree with `pnpm install` run, local D1 migrated (`pnpm --filter @qzr/api db:migrate:local`),
  and `pnpm dev:all` running (portal :5174, scoresheet :5173, API :8787).
* A `Scoresheet.ots`, and a folder of `.ods` sheets from a meet. Real sheets carry real names: keep
  them outside the repository.
* A local meet with divisions, rooms, a roster (a roster CSV for the meet page's import) and a
  published schedule matching those sheets.

## Unit checks

`pnpm test:unit`, `pnpm type-check`, `pnpm lint` all pass. In particular:

* The moved ODS tests pass from `packages/shared`, unchanged apart from imports.
* A sheet with `mb` on an empty seat reads as a no-jump on that question.
* The results route answers `unchanged` for an identical file and adds no revision.
* The roster import of 60 teams succeeds in one call; an import that fails partway leaves no
  churches, teams or quizzers.

## Scenarios

1. **Large roster** (FR-017): import a 44-team roster CSV in one go on the meet page; every team
   appears without a refresh. Import a CSV made to fail (for example a church name over the column
   limit); the page says why, and the roster is as it was.
2. **Template** (FR-013 to FR-015): as admin, upload `Scoresheet.ots` on the meet page; upload a
   plain `.ods` instead and see it refused. In the scoresheet, link a quiz to the meet and export
   ODS: no file dialog. Choose "another template…": the dialog appears.
3. **Backfill** (Story 1, Story 3, SC-001): on the Results page, pick every `.ods` sheet of the
   meet. The review shows each sheet's quiz and room; fix any unmatched one; send. All are stored,
   each for its scheduled room. Time it.
4. **Re-upload** (FR-003a): pick the same folder again and send. Every file is reported unchanged;
   no prompt; no quiz has a second revision. Edit one sheet in LibreOffice and upload it: one
   prompt, with "apply to the rest".
5. **Downloads** (Story 2, SC-004, SC-005): download one quiz as `.ods`, open it in LibreOffice and
   recalculate (Ctrl+Shift+F9): scores match the app. Download the meet as `.json`, upload the
   archive's files to a fresh copy of the meet: standings and stats match the original. A
   15-question quiz offers `.json` only.
6. **Fallback to spreadsheets** (SC-002, FR-013a): as a room's official, download the meet's
   template and start a sheet from it in LibreOffice; upload it once scored.
7. **Statistics agree** (FR-018, from #200): once #200 is in master, accept a quiz with errors as
   scored; the Results page shows it placed, with the places the stats page gives.
