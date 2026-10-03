# Research: Practice meet results

Decisions taken while planning [spec.md](./spec.md). Each records what was chosen, why, and what was
rejected. Facts about the current code come from reading it on 2026-10-02 (master at `84e22ec`).

## R1. Where standings are computed from stored quizzes

* **Decision**: Move the scoring the portal needs into `packages/shared`, and compute each quiz's
  outcome and the division standings there, called by the portal.
* **Rationale**: Constitution III says the first consumer outside the scoresheet that needs a
  scoring result moves the function into `packages/shared` rather than copying it. The portal needs
  each stored quiz's team scores, places, placement points and error counts. Computing from the
  stored file means a quick-form edit, a merge or a restore can never leave a stale number behind,
  and uploaded files need no scoresheet to be counted. The stats calculator (#8) needs the same move
  later.
* **Alternatives considered**: The scoresheet sends a per-team summary with each save, and the
  portal only ranks. Smaller now, but uploads would have to go through the scoresheet one file at a
  time (changing Story 3), it bends principle III, and #8 hits the same wall. Rejected by the user
  in favour of the move.

## R2. What moves, and what changes on the way

* **Decision**: Move `apps/scoresheet/src/scoring/` (all eight modules), `types/scoresheet.ts`,
  `types/indices.ts`, and the pure parts of `persistence/quizFile.ts` (parsing, version checks,
  `deserialize`, `serialize`) into `packages/shared`, with their tests. `serializeStore` stays in
  the scoresheet because it reads the store. The move is behaviour-neutral and lands first, on its
  own.
* **Rationale**: `types/scoresheet.ts` and `scoring/quizRules.ts` import each other, so scoring
  cannot move without the types. `deserialize` is the only way from a `QuizFile` to columns and
  answers. The API needs parsing to validate uploads and submissions (R6).
* **Two pieces leave Vue code** so that the scoresheet and the portal share one owner each:
  * Building `cells[team][seat][col]` from a quiz's teams, quizzers and answers. Today it lives in
    `quizStore.cellGrid` and is repeated by hand in `export/fillOts.ts`. Both will call the shared
    one.
  * Deciding whether a quiz can be placed, and its placements and placement points. Today the gate
    (regulation complete, no validation errors, no timeout errors) and the timeout checks are
    written inline in `useScoresheet.ts`. The composable will derive its `placements` and
    `placementPoints` from the shared function, so a quiz the scoresheet won't place is never placed
    by the portal either.
* **Alternatives considered**: Moving only the subset needed for scores and placements (about 1,460
  lines). Rejected: the placement gate needs validation, validation needs grey-out and column
  visibility, so the subset is nearly everything, and a partial move leaves scoring split across two
  packages.

## R3. Testing `packages/shared`

* **Decision**: Give `packages/shared` a vitest setup and a `test:unit` script, and add it to the
  root `test:unit` run. The moved specs move with their code.
* **Rationale**: Principle VI requires scoring to stay unit-tested; shared has no test runner today.

## R4. Identifying the official's room

* **Decision**: Official guest tokens carry the room's id as a new claim, set at join. A signed-in
  official names the room on submit, checked against their official memberships. A submission
  without a usable room (a token from before this change) is refused with "rejoin with your room
  code".
* **Rationale**: The token carries only `meetId`, `role`, and the room name as `label`, which isn't
  unique. Principle IV forbids new token schemes, not new claims in the existing one. Tokens last 24
  hours, so old ones age out within a day.
* **Alternatives considered**: Looking the room up by label (ambiguous); trusting a room id sent by
  the client without a claim (any official of the meet could submit as any room).

## R5. Storage shape

* **Decision**: Three new tables and one optional list (see [data-model.md](./data-model.md)): a
  stored quiz per result, an append-only revision per save holding either the full quiz file or a
  reference to the earlier revision it restores, an append-only counting record per count or
  uncount, and the meet's team names. The stored quiz keeps its counted flag; its current revision
  is the newest revision row, so nothing can fall out of step with the revisions.
* **Rationale**: FR-005 and FR-013 require every save and every count change kept with who and when.
  Append-only rows make "never discarded" structural. Files are 10 to 50 KB of JSON, one bound
  parameter each, well inside D1's statement limits.
* **Alternatives considered**: One table with a JSON history array (rewrites grow, no per-version
  rows to restore from); storing diffs (a diff view is a follow-up); copying a file forward to
  restore it (duplicates content); a selected-revision field on the stored quiz (restoring would
  then leave no revision behind, needing a second log beside the history, and the current revision
  would stop being the newest) or a "held back" flag on revisions (the same split between current
  and newest).

## R6. Validating quiz files on the server

* **Decision**: The API validates every submitted, edited or uploaded file with the shared parser:
  schema, known format, and not newer than the bundled `FILE_VERSION`. A newer file is refused with
  the scoresheet's own "saved by a newer version" message. A file is stored only if it needs no
  conversion to read: `Value.Parse` converts loosely typed values (a number sent as a string), so
  storing also checks the parsed file strictly, and the stored file is exactly what the scoresheet
  reads.
* **Rationale**: Stored files must be ones the portal can score (Story 3, scenario 3). The API has
  no validator today; the shared parser already does this for the scoresheet.

## R7. Who saved a revision, and how

* **Decision**: The API derives both from the caller, never from the request: an admin's save is
  `edited` (or `uploaded`, `merged`, `restored` from those actions), an official's is `submitted`,
  recorded with the room.
* **Rationale**: One owner for the paper trail's "who and how", and the client can't misreport it.
  Admins don't submit new quizzes from the scoresheet; they upload, so `uploaded` always means a
  file from the portal.

## R8. Which stored quiz a submission belongs to

* **Decision**: A quiz not tied to the schedule is identified by its name: division, consolation and
  quiz number, folded for case and spaces, unique within the meet. Submitting a name the meet
  already has, from any room, is answered with that quiz's current revision; the scoresheet asks the
  official whether to skip it, save it as the new current revision, or save it but keep the current
  revision, and sends it again with that choice. New quiz keeps the meet link and clears only the
  quiz's teams; Unlink meet still disconnects.
* **Rationale**: Officials know a quiz by its name ("D1 Q3"), and the name travels with the quiz
  into every copy of it, so New quiz, Ctrl+N, opening a file, loading from the schedule, retrying a
  lost response and uploading a backup all land on the right stored quiz with nothing for the
  scoresheet to remember. An earlier design had the scoresheet remember the stored quiz's id; every
  way of replacing the sheet then had to forget it, and review found several that didn't, each
  saving one quiz over another. New quiz used to clear the whole session, which unlinked the meet
  after every quiz. The session's `quizId` is a different thing, the scheduled quiz it was loaded
  from, which schedule linkage (#16) will use to identify scheduled quizzes.
* **Deferred**: Storing that scheduled quiz id on a stored quiz belongs to #16; practice meets have
  no schedule, so this feature stores none.

## R9. Opening a stored quiz in the scoresheet

* **Decision**: The portal links to the scoresheet with the meet and stored quiz in the query, as
  the schedule view already does for scheduled quizzes. The scoresheet fetches the current revision
  with the admin's cookie (same origin), asks before replacing unsaved work, loads it, and offers
  "Save to meet". Viewing an older revision in full opens that revision the same way; saving it
  creates a new revision.
* **Rationale**: Reuses the existing deep link handling and the editor; the portal gets no answer
  editor (Story 4).

## R10. Merging team names

* **Decision**: The portal applies a merge as one quick-form style edit per affected quiz, each
  saved as a `merged` revision. Not atomic across quizzes; a failure part-way leaves the rest
  unrenamed, still flagged, and running the merge again finishes it.
* **Rationale**: One owner for editing names in a quiz file (the portal's edit path) instead of a
  second, server-side rewrite. Meets are small, so a handful of requests is fine.
* **Alternatives considered**: A server endpoint rewriting every file in one batch (atomic, but a
  second writer of the same edit).

## R11. "Differ only slightly"

* **Decision**: After case and space folding (FR-015), two names in a division are flagged when
  their edit distance is at most 1, or at most 2 when both are at least 6 characters long, unless
  they differ only in their trailing number.
* **Rationale**: Catches single typos ("Calgry 1") and transpositions in longer names. The
  trailing-number exception keeps "Calgary 1" and "Calgary 2", two real teams from one church, from
  being flagged.

## R12. Quizzes that can't be placed

* **Decision**: A counted quiz the shared placement gate won't place (questions unanswered, or
  validation errors, typically from an uploaded file) adds no placement points, doesn't count as one
  of its teams' quizzes, and produces a warning naming it, so one problem gives one warning rather
  than also an unequal-counts warning.
* **Rationale**: Submission already refuses validation errors (FR-002), but uploads and stale copies
  can still carry them. The standings must not guess.

## R13. Uploading files

* **Decision**: A plain file picker accepting several `.json` files; each file is sent as its own
  upload and reported individually. No drag and drop.
* **Rationale**: The constitution forbids the HTML5 drag API (it crashes Tauri on Linux/X11), and
  the portal's roster CSV import already uses the same hidden-input pattern.

## R14. Delivery

* **Decision**: Several pull requests in story order: the shared move; submission and the results
  list (Story 1); standings (Story 2); upload, edits, history and restore (Stories 3 and 4); merge
  and the team list (Stories 5 and 6). The user approves each PR before it is opened.
* **Rationale**: The move alone touches about 70 import sites and must be reviewed as a pure
  refactor; each later PR is one story's behaviour.
