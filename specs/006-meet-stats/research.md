# Research: Meet stats

Decisions taken while planning [spec.md](./spec.md). Each records what was chosen, why, and what was
rejected. Facts about the current code come from reading it on 2026-11-14 (master at `48b716c`).

## R1. Where stats are computed

* **Decision**: The API computes a division's stats from the stored quizzes, with pure functions in
  `packages/shared`, and answers each caller with only what that caller may see. The portal no
  longer ranks from quiz files it has fetched.
* **Rationale**: Today `apps/web/src/results.ts` deserializes every stored quiz in the browser and
  ranks there, which works because only admins and room officials are ever sent quiz files. Viewers
  must not get a full scoresheet (FR-021), and nothing may reach a viewer before its moment "in the
  page or by any other route" (FR-018, SC-005), so the filtering has to happen before the response
  leaves the server. Principle III already has the API import scoring from shared rather than copy
  it. One computation for every reader also means the admin's page and the viewer's page cannot
  disagree.
* **Alternatives considered**: Keep computing in the browser for admins and add a second, filtered
  path for viewers: two owners for one ranking. Store each quiz's derived lines when it is saved:
  the spec keeps quizzer lines and standings derived, never stored, so that an edit, a restore or a
  settings change can never leave a stale number.

## R2. Fitting the free Workers plan: each revision is scored once

* **Decision**: A stored revision is scored once and the result kept in a table of its own, keyed by
  the revision and by the `@qzr/shared` version that scored it. A stats request reads those rows and
  does only the ranking. A revision is scored when it is saved; one whose row is missing or was
  scored by an older shared version is scored when stats are next read, a few per request, and a
  request that still lacks some answers 503 with `Retry-After`, which the portal follows.
* **Rationale**: `qzr-api` runs on Cloudflare's free Workers plan (the maintainer, 2026-11-14),
  which allows 10 ms of CPU per request, with some tolerance for an occasional overrun and
  termination when it is hit consistently (Cloudflare's Workers limits page, read the same day).
  Measured on the reference meet with a throwaway script: parsing and scoring all 74 stored quizzes
  with `deserialize` and `quizOutcome` takes about 20 ms on a laptop, 0.27 ms a quiz, so about 12 ms
  for its largest division of about 45 quizzes. That is over the limit before anything else in the
  request runs, on every load of the page. One quiz is well within it.
* **Why this keeps the tables derived**: a revision's content never changes, so its scored row can
  only be stale when the scoring code changes, and the shared version in the key covers that
  (principle V bumps it for every observable change). Everything a setting or a later decision can
  change is applied when stats are read, from the scored facts: placement points from place and
  score under the meet's formula, tie-breaks, stages, acceptance, what a viewer has. So an edit, a
  restore or a settings change still cannot leave a stale number, which is what the spec's "derived,
  never stored" is for.
* **What a scored row holds**: the quiz's name and whether it is a consolation quiz; per team its
  name, score, score before overtime, errors and place by score; what is wrong with the quiz (every
  validation error with its team, seat, question and code, and the unanswered questions; R16); per
  listed quizzer the name, points, errors, correct answers and correct answers by type; the quiz's
  own formula. No placement points.
* **Every route that needs scored facts reads the rows**: a division's stats, the list of what needs
  attention, and the problems shown beside each quiz in the results list. None of them scores a
  division on the spot. What needs attention is built from scored facts and names alone, with no
  ranking, so one request covers the meet.
* **The database's limit**: D1 on the free plan allows 50 queries in one Worker invocation and 100
  bound parameters in a query (Cloudflare's D1 limits page, read 2026-11-14). A stats request reads
  about a dozen tables once each; the rows it rescores are written in one statement, which with
  three values a row holds about thirty. So a request rescores at most what fits both that one
  statement and the CPU limit.
* **After a deploy that changes scoring**: rows are rescored as divisions are opened, a few per
  request. A meet of 75 quizzes is ready after a handful of retries of the first page load.
* **Alternatives considered**: Score on every request (fine on the paid plan; over the limit here).
  Score in the browser (viewers cannot be sent quiz files, R1). Rescore from the cron trigger: a
  second owner for the same work, and the same CPU limit applies to it.

## R3. A quiz's stage, and what becomes of "counted"

* **Decision**: A stored quiz's stage is derived when read, in this order: the newest stage an admin
  set for it; else the stage of the scheduled quiz it is linked to; else, for a quiz with counting
  records from before this feature and no link, prelim when its newest record says counted and not
  counted otherwise; else not counted. Only an admin's choice is stored.
* **Rationale**: FR-010 has existing counted quizzes become prelims, and the constitution forbids
  hand-written migrations, so the old `quiz_result_count_changes` rows are read as a fallback
  instead of being rewritten. Deriving the schedule's stage at read time means a republished
  schedule is followed without touching any quiz. The counting toggle and its route go away; the
  table stays, read-only, and its rows stay in each quiz's history.
* **A scheduled quiz's stage**: `phase: 'prelim'` is a prelim; an elim with `line` set is an
  intermediate (`ScheduleQuiz.line` is "the intermediate on this line"); an elim with `deciding` is
  a Finals (`elims.ts` marks every lane's deciding quiz, whether or not it is labelled "Finals");
  any other elim is an elimination.
* **Alternatives considered**: Write a stage row for every quiz when it is linked: stale as soon as
  the schedule is republished. Drop the counting table: on D1 a table rebuild cascades (see the note
  on `quiz_results.room_id`), and the history would lose its counting records.

## R4. The schedule link

* **Decision**: The link is its own record, apart from the quiz's name: which scheduled quiz (by the
  schedule document's quiz `id`), how it was made (sent by the scoresheet, or by hand; a link by
  name is worked out when read), who and when. The scoresheet sends `scheduleQuizId` on
  `POST /results` when the sheet is linked and omits it otherwise; nothing is added to `QuizFile`,
  so `FILE_VERSION` is unchanged.
* **Rationale**: FR-009 and the user's ruling with the scoresheet session: the file records what the
  room typed; the link travels with the submission only. The scoresheet's meet session already holds
  the value (`quizId` in `useMeetSession.ts`, set by `applyLoadedQuiz`), unread until now. The
  schedule document's quiz ids are stable across publishes ("by that quiz's id, so renames follow",
  `scheduleFile.ts`).
* **Linking by name**: a quiz with no explicit link is linked, when read, to the scheduled quiz
  whose `resultName` equals its `resultKey`. It is never written, so a quiz stored before the
  schedule was published, or renamed, or whose explicit link a new schedule dropped, is linked
  without anyone acting. Its teams are not part of the match: teams that differ are a schedule error
  on the linked quiz (R16). An earlier design matched on teams too and offered a near miss as a
  suggestion; the maintainer replaced it on 2026-11-16, since a quiz saved under a name is that
  quiz.
* **In error**: a linked quiz whose name or teams differ from the scheduled quiz's is in error
  (FR-009a) by the same comparison, so there is one definition of "matches".
* **Alternatives considered**: A field in `QuizFile`: a file format change, and the file would then
  be tied to one meet's schedule (rejected by the user). A column on `quiz_results`: no history of
  who linked what, which FR-009 asks for.

## R5. One log for decisions about a stored quiz

* **Decision**: One append-only table, `quiz_result_changes`, holds every decision this feature adds
  about a stored quiz: stage set, link changed, revision accepted or acceptance withdrawn, kept
  after a withdrawn order. A quiz's current value of each kind is its newest row of that kind.
* **Rationale**: Each of these is "who decided what about this quiz, and when", shown in the quiz's
  history beside its revisions and counting records, and each is read the same way (newest wins), as
  `quiz_result_count_changes` already is. One table means one write helper and one history query.
* **Alternatives considered**: A table per kind (four more tables, four more history joins, and by
  hand four more blocks of DDL in `test-db.ts`). Reusing `quiz_result_count_changes`: its columns
  are a boolean and an account, and it cannot be altered safely.

## R6. Accepting a quiz in error

* **Decision**: An acceptance names the revision it accepts. A quiz counts when it has a stage and
  either no errors or an acceptance of its current content. "Current content" follows restores: a
  revision restoring accepted content is accepted. An accepted quiz is placed by ranking its team
  scores as they stand, with the placement points its places and scores give under the meet's
  formula.
* **Rationale**: FR-015 and FR-016. Today `quizOutcome` reports `placed: false` and null places when
  there is any error or an unanswered question; an accepted quiz needs places anyway, and the only
  honest source is the scores. `quizOutcome` stays as it is: scoring one revision (R2) keeps each
  team's place by score whatever the quiz's errors, and a division's stats use that place for a quiz
  in error only while it is accepted.
* **Alternatives considered**: Acceptance sticks to the quiz whatever is saved later: a later edit
  with new errors would count unseen.

## R7. Individual stats come from the scoring that already exists

* **Decision**: A quizzer's line in a quiz is read from `scoreTeam`'s `QuizzerScoring`: `points`,
  `errorCount`, `correctCount` (all regulation only since #166). Jumps are
  `correctCount + errorCount`. Correct answers by type come from the quiz's `questionTypes` for the
  columns the quizzer answered correctly outside overtime. No scoring rule is written anew.
* **Rationale**: Checked against the reference meet before this feature: 807 of 807 quizzer rows
  match the statistician's workbook on points, errors, jumps and types, and 137 of 137 quizzer
  totals. Principle III.
* **A quizzer's identity** (FR-002): folded name within folded team within division, as teams are
  already identified in `standings.ts`. A quizzer is "listed" in a quiz when a seat on their team's
  sheet carries their name.

## R8. Ranking options in the shared standings

* **Decision**: `divisionStandings` takes the meet's tie-break order. Placement points are worked
  out when stats are read, from each team's kept place and score through `computePlacementPoints`
  with the meet's formula in place of the file's own `placementFormula`; `quizOutcome` is not called
  then and does not change (R2). The re-rank is a second function beside it: the confirmed prelim
  placement points plus the intermediate's, ranked within the ranks that intermediate plays, by the
  same tie-break order. Finalist marking moves out of the ranking into a flag the caller asks for
  only where prelims lead straight to a Finals.
* **Rationale**: FR-023, FR-023a, FR-012, FR-011. The reference meet's order (points, then errors,
  no head-to-head) is the existing chain with its first step left out. The re-rank was checked
  against the reference meet's seeding: six of six.
* **The two formulas** are the existing `PlacementFormula.Rules` and `Legacy`; the setting's wording
  is the user's, the values are these.

## R9. Division states, and what a confirmation records

* **Decision**: `DIVISION_STATES` gains `finals` between `elim_running` and `division_done`. The
  move to `stats_break` confirms the prelim order; the move to `elim_running` confirms the re-rank
  where the division has intermediates. Each confirmation and each withdrawal is a row in an
  append-only table holding the order as it stood; the state itself stays the one row per division
  it is today.
* **Rationale**: FR-019a to FR-019c. The state column is text with a TypeScript-level enum, so, as
  with `review`, adding a value needs no migration. The existing route moves one step at a time in
  either direction and already requires an admin; it gains the warnings and the records.
* **A division with no eliminations**: the spec has it pass from its stats break straight to Finals.
  The route keeps every move a single step; the portal's control offers "Start Finals" and makes
  both moves behind one confirmation, so the admin sees one step.
* **Readiness** (FR-019a) is derived: the scheduled quizzes of the stage that is ending, each linked
  to a stored quiz that counts.
* **Withdrawing with later quizzes stored**: the route answers 409 with the affected quizzes unless
  the request says to go ahead; going ahead records them on the withdrawal. A quiz is flagged as
  played under a withdrawn order while it is named by a withdrawal newer than its newest "kept"
  record and still has a stage.

## R10. Settings: one document, kept as a history

* **Decision**: The meet's stats settings are one validated document (a TypeBox schema in shared, as
  the schedule document is), saved whole. Each save is a new row; the newest is current; a meet with
  none uses the defaults (FR-018b, FR-023, FR-023a).
* **Rationale**: FR-022 wants who changed it and when, and FR-023c saves the whole form at once
  after showing what changes for viewers. The same shared schema validates in the API and types the
  portal's form.

## R11. One function says what a viewer has

* **Decision**: A pure function in shared answers, from the settings, the division's state and the
  meet's phase, what a viewer gets of each thing (nothing, or it, and for results how much) and
  which of the three states standings are in. The API filters with it; the settings page uses it for
  "right now" and for the before-and-after shown at save.
* **Rationale**: The mockup needed this logic twice within one page; the product needs it in the API
  and in the portal. One owner keeps "what the settings page promises" and "what the API sends" the
  same thing.

## R12. Names: rosters, names that look alike, dismissals

* **Decision**: Roster matching is by name, within the quiz's division: a team by its full name or
  its short name, ignoring case, spacing and punctuation, a quizzer by the team's `team_rosters`
  names, folded. The team comparison is the one the scoresheet makes when a meet is linked
  (`teamNamed` and `looseName` in `useMeetSession.ts`, `docs/meet-link.md`); it moves to shared so
  the sheet and the server agree, and the scoresheet calls it there. A matched name counts as the
  roster team when stats are read, shown under the roster's full name, so two spellings of one team
  are one row; the scored rows keep names as written (R2). A name that matches nothing, a blank team
  name included, is a roster error (R16). Look-alike quizzer names on a team reuse the test
  `standings.ts` uses for teams (`editDistance`). A dismissed pair is stored folded and keyed by
  meet, division and, for quizzers, team, and is left out when flags are built.
* **Rationale**: FR-002a, FR-032, and the user's ruling with the scoresheet session on 2026-11-14:
  roster picks made in the scoresheet are never saved or sent, so the server has only names.
  `standings.ts` today flags two real teams of different churches that share a number; a dismissal
  is how the admin says so.
* **Merging quizzer names** (FR-031) is the existing edit path: `editQuizFile` already takes quizzer
  names by id, and `mergeEdits` does the same for teams.

## R13. The download and the printed page

* **Decision**: The admin's download is three CSV files made in the browser from the admin's stats
  response: team rows per quiz, quizzer rows per quiz, and the standings, in the workbook's column
  order. The printed page is the stats page under print styles.
* **Rationale**: FR-028 asks for "a file a spreadsheet opens"; CSV needs no library and no route.
  The workbook's shapes are known (`Team, Quiz, Place, Score, Points, Errors` and
  `Quizzer, Team, Quiz, Points, Errors, Jumps, REF, FTV, INT, MA, Q, SIT`). The browser's own print
  dialog serves FR-025.
* **Alternatives considered**: A workbook file with three sheets: a new dependency for one button.

## R14. Proving it against the reference meet without its names

* **Decision**: A script kept outside the repository reads the reference meet's sheets with
  `readOds`, replaces every team and quizzer name with a made-up one, consistently, and writes the
  quiz files and the workbook's expected rows as test fixtures under
  `packages/shared/src/scoring/__tests__/fixtures/`. The shared specs for quizzer lines, individual
  standings, prelim standings and the re-rank run against them.
* **Rationale**: SC-001 and SC-002 are checks against that meet; the sheets, workbook and report
  hold minors' names and stay out of the repository, issues and commits (spec Assumptions). Scores
  don't depend on names, so scrubbed fixtures prove the same thing.
* **Known limits of the source**: five of the 74 sheets hold slips made on the day and need
  accepting; the workbook ranks ties by points then errors; consolation team rows are not in the
  workbook's team table.

## R15. What the scoresheet does

* **Decision**: Two small changes. `submitResult` sends `scheduleQuizId` when the meet session has a
  `quizId`. A sheet working with a meet takes the meet's way of scoring level teams as its quiz's
  `placementFormula` when it is linked or a quiz is loaded from the meet.
* **Rationale**: FR-009, FR-023b. Both read state the scoresheet already keeps: the meet session's
  `quizId`, which the meet link sets and clears (#168, `docs/meet-link.md`). Team and quizzer picks
  stay in the sheet and are never sent. Neither change touches scoring with the API down (principle
  I): an unlinked sheet sends nothing and scores by its own setting.

## R16. Three kinds of quiz problem, found by shared code

* **Decision**: A stored quiz is in error for any of three kinds of problem, each with one shared
  implementation that works from the quiz and the meet's data alone, with no pick or other state of
  the scoresheet:
  * Scoring errors come from `assessQuiz`, which already lists every validation error by team, seat
    and column. Scoring one revision (R2) keeps that list, not a count, since it depends on nothing
    but the revision.
  * Roster errors come from one new function in shared `stats/`: a quiz's team and quizzer names
    against the teams of its division and their rosters. It gives names that match nothing (with the
    nearest roster name), a team listing more quizzers than its roster has, and roster quizzers
    missing from the quiz.
  * Schedule errors come from the match between a quiz and a scheduled quiz (R4), and from the
    quiz's stage: an elimination or Finals level with no overtime (the rulebook's rule), and, where
    the meet's setting says its prelims have no overtime (not the rulebook, so a setting, on by
    default, FR-023d), overtime played in a prelim or an intermediate. Scoring one revision keeps
    each team's place, whose key shows a shared place, and will keep whether overtime was played
    once the setting arrives, so the stage check needs no rescoring. Roster and schedule errors are
    worked out when a quiz is read, never kept, so a corrected roster or a republished schedule
    clears them with no rescoring. An acceptance covers every kind (R6), and stands for its revision
    if the roster or schedule later changes.
* **Rationale**: The maintainer's ruling of 2026-11-14 with the scoresheet session: an error is
  wrong whatever the meet, and a roster or schedule problem is known only against a meet. The
  scoresheet shows the last two as warnings while linked; in the portal, which always has the meet,
  all three keep a quiz out until fixed or accepted. The sheet sends nothing but the quiz file, so
  the server must find them again, and the two must agree: the team-name comparison moves to shared
  from `useMeetSession.ts` (R12), and the scoresheet's schedule warnings (#170) can call the same
  match.
* **Consequence accepted**: a rostered quizzer who sits a quiz out puts that quiz in error, so meets
  with rosters larger than their seats accept such quizzes; accepting the quizzes shown together
  keeps that to one action.
* **Alternatives considered**: The sheet sends its warnings with the quiz: they depend on picks,
  which are never sent, and a file uploaded later would carry none. Roster problems as flags that
  still count: standings would be built on names the meet doesn't know.
