# Research: ODS round trip for meet results

Decisions taken while planning [spec.md](./spec.md). Each names what was chosen, why, and what was
set aside.

## R1. Where the ODS reader and writer live

**Decision**: Move `readOds.ts`, `fillOts.ts` and `odsXml.ts` from `apps/scoresheet/src/export/` to
`packages/shared/src/ods/`, with their tests, and add `fflate` to `@qzr/shared`'s dependencies. The
scoresheet, the shared upload in `packages/ui`, and the portal import them from `@qzr/shared`.

**Rationale**: FR-002 needs one reader for both apps, and the portal can't import from the
scoresheet app. The files are already pure (bytes in, `QuizFile` out, and back), so they belong with
the `QuizFile` codec. `packages/ui` already depends on `@qzr/shared`.

**Alternatives**: `packages/ui` (it holds the upload, but the reader is not UI and the API may want
it later); a copy in the portal (Principle III/VII forbid twins).

## R2. Where the meet's template is stored

**Decision**: A new D1 table holding one template per meet as a blob, with its file name and who
uploaded it when. Served and replaced through the API (contracts/api.md). No R2 bucket.

**Rationale**: A `Scoresheet.ots` is about 100 KB (the FBC 2024 sheets made from it are 95 KB each),
well under D1's 2 MB value limit. A separate table keeps the blob out of every meet query. Adding an
R2 binding would be a new resource to provision, deploy and back up for one file per meet.

**Alternatives**: a column on `quiz_meets` (every meet read would carry it); R2 (a new binding);
bundling the template (the user chose per-meet upload; the template is the sister organization's).

## R3. Checking an uploaded template

**Decision**: The API stores a template only if it unzips and its `content.xml` has the `Quiz` sheet
that `fillOts` patches; anything else is refused with a message. The check reuses the reader's own
sheet lookup.

**Rationale**: A wrong file uploaded as the template would make every later `.ods` download fail;
refusing it at upload names the problem where it was made.

**Alternatives**: no check (failures surface far from their cause).

## R4. Downloads are built in the browser

**Decision**: Every download (one quiz, or a meet or division in bulk) is built client-side: the
portal already has the stored quizzes from `GET /api/meets/:id/results` (each row carries its
current `quizFile`), fetches the meet's template once, fills it with `fillOts`, and zips with
`fflate`. No new download endpoints.

**Rationale**: Reuses the existing list and its access rule, which FR-008 asks for ("anyone who may
view a stored quiz": admins, and officials for their rooms). Filling and zipping 75 sheets in the
Worker would spend CPU the free plan doesn't have: an ordinary request has been measured at 19 ms
against a 10 ms budget.

**Alternatives**: server-built archives (CPU, and a second access rule to keep in step).

## R5. Uploads stay one `POST` per quiz

**Decision**: The browser reads each `.ods` with `readOds`, then sends it through the existing
`POST /api/meets/:id/results` with `upload: true`, the matched `scheduleQuizId`, and, for an admin,
the scheduled quiz's `roomId` (FR-007). The request body is unchanged.

**Rationale**: The route already does storing, phase rules, rooms, linking and the "already
submitted" answer. One request per quiz keeps each within the Worker's CPU budget.

**Alternatives**: a batch endpoint (one long request, a second write path for results).

## R6. Identical re-uploads

**Decision**: When a sent file is identical to the quiz's current revision, the `POST` answers that
it is unchanged and adds nothing, whatever `onExisting` says. Identity is decided by the API, on the
canonical JSON of the two files. The upload reports such files as unchanged and doesn't ask about
them; for changed ones, the batch's first "already stored" question offers to apply its answer to
the rest (FR-003a).

**Rationale**: Only the API holds the current revision, including a restored one; the route already
compares files for restores ("adds nothing when that content is already current").

**Alternatives**: comparing in the browser (would need every current file fetched first, and would
miss a revision saved in between).

## R7. Matching a sheet to its scheduled quiz

**Decision**: Before sending, the upload shows each file's quiz name (`resultKey` of its division,
consolation flag and number) beside the published schedule's quiz of the same key
(`scheduleQuizMeta`/`resultName`) and that quiz's room. Unmatched files get a picker of the
schedule's quizzes, or stay unlinked; two files with the same key are flagged. Picking a scheduled
quiz rewrites the file's division, consolation and number to that quiz's, which is how the 2024
replay matched its sheets by hand. The review lives in `packages/ui` with the rest of the upload.

**Rationale**: Real archive names are unreliable, but the sheet's own header usually is; the
schedule's key is already how the API links a quiz by name.

**Alternatives**: parsing file names (the FBC run showed they can't be trusted).

## R8. A bonus marked on an empty seat

**Decision**: In `readOds`, an `mb` on a seat with no quizzer becomes a no-jump on that question's
column, with a comment that allowing `mb` on an empty seat directly is a later option.

**Rationale**: The user's decision (spec Clarifications). The reader already reads a no-jump next to
two errors as a bonus to an empty seat, so the empty-seat `mb` lands on the same representation.

## R9. Accepted quizzes shown as not placed

**Decision**: Not built here. The papercuts pull request (#200) places an accepted quiz on the
Results page by its scores (`scoreStoredQuiz`), as the stats do. Sharing the stats' own helper, so
teams level in an unplayed overtime share their place on both pages, is #199.

**Rationale**: The fix landed on another branch first; repeating it here would conflict.

**Alternatives**: the stats' `placedAsTheyStand` from this branch (now #199's job).

## R10. Roster import in one transaction

**Decision**: `POST /api/meets/:meetId/roster/import` builds all its inserts (churches, teams,
quizzer identities, roster rows) as statements chunked under D1's bound-parameter cap (`chunksOf`)
and runs them in one `asOne` batch, so they all apply or none do. Rows that need ids from earlier
rows in the batch find them by sub-select on their natural keys, as the results route does for a new
quiz's first revision. A refusal answers with a message the meet page shows; the page reloads the
roster after every attempt (FR-017).

**Rationale**: Today's import creates churches, then fails on one oversized team insert, leaving
churches with no teams. A D1 batch is a transaction; chunking alone would fix the size and not the
half-done import.

**Alternatives**: compensating deletes on failure (not atomic if the Worker dies mid-way); asking
admins to import in parts (what the FBC run had to do).

## R11. The scoresheet's export uses the meet's template

**Decision**: When the scoresheet's quiz is linked to a meet and the meet has a template, Export ODS
fills it without asking; the menu also offers "another template…", which is today's file picker.
With no template, no link, or no network, export falls back to the picker (Principle I).

**Rationale**: FR-015. The picker stays the offline path.

## R12. File names

**Decision**: Downloaded files are named with the scoresheet's own file stem (`quizName` with the
space before `Q` dropped, so `D1Q3`, `D2cQb`), which already includes the division and consolation.
The stem moves from `Scoresheet.vue` to where both apps reach it.

**Rationale**: FR-010; officials already know these names from the scoresheet's own saves.

## R13. Load

**Decision**: Nothing new runs per request beyond what a scoresheet submission already costs: a
75-quiz upload is 75 ordinary `POST`s. CPU and D1 queries per request on a full meet are measured
separately, once a full meet can be loaded; this feature provides the means.
