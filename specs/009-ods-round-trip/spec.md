# Feature Specification: ODS round trip for meet results

**Feature Branch**: `feat/import-results`

**Created**: 2026-11-19

**Status**: Draft

**Input**: User description: "ODS import and export for meet results, so a meet can switch from
LibreOffice ODS scoresheets to the app, or back, partway through. Today the scoresheet app opens and
exports .ods, and the portal Results page uploads saved quiz files, but only .json. Add round-trip
utilities wherever convenient: portal upload accepts .ods exports alongside .json; portal downloads
any stored quiz as .ods or .json; portal downloads a meet's quizzes in bulk so rooms can carry on in
ODS. Officials and admins keep the permissions they have for uploads today. Closes the remaining gap
in issue #52 (mass results importer); no CLI." Goal, from the user: "be able to switch from or back
to using ODS in the middle of a meet. As many utilities to go back and forth as you can, in
convenient places."

## Context

Meets have long been scored in a LibreOffice spreadsheet, one `.ods` file per quiz, filled from the
sister organization's `Scoresheet.ots` template. The app does not ship that template: whoever
exports picks their own copy.

What exists today:

* **Scoresheet app**: opens an `.ods` quiz onto the sheet, and exports the quiz on the sheet to
  `.ods` by filling a template the official picks. A quiz opened from `.ods` can then be submitted
  to the meet like any other.
* **Portal Results page**: an admin, or an official of a room, uploads saved quiz files (`.json`
  only), several at once, all for one room the uploader picks. Each file is reported as stored, a
  new revision, or refused.
* Nothing in the portal hands a stored quiz back as a file, in either format.

So a meet can move from ODS to the app one quiz at a time, through the scoresheet, but not in bulk;
and it cannot move back to ODS at all without an official reopening each quiz in the scoresheet.

A meet switches format partway through for ordinary reasons: a room's laptop dies and the room
carries on in a spreadsheet; a meet starts in spreadsheets because the app isn't trusted yet, then
switches; the statistician wants every quiz in one format to work on. A finished meet scored
entirely in ODS (the backfill case of issue #52) is the same problem at its largest.

A real run of this (73 ODS sheets from a 2024 meet loaded into a local copy of the app) found:

* File names don't reliably name the quiz: consolation quizzes, round robins and stray duplicates
  are named loosely and inconsistently.
* Team and quizzer names in a sheet must match the meet's; otherwise the standings gain phantom
  teams.
* ODS doesn't record which of two errors on an A/B question came first, so a quiz read from ODS has
  its error order guessed from the seats. Re-exporting it is exact; the guess only affects
  per-question statistics.
* Many real sheets come up "under review" (for example a rostered quizzer absent from the sheet) and
  need an admin's "Accept as scored", which already exists.

## Clarifications

### Session 2026-11-19

* Q: When an uploaded sheet's team or quizzer names don't match the meet's roster, what should the
  upload do? → A: Just upload it as read. The results page's existing roster-mismatch handling
  (attention list, Merge) deals with the names afterwards.
* Q (user decision, relayed from the FBC 2024 import): how is a bonus that falls to an empty chair
  read from a sheet? → A: Old sheets sometimes mark "mb" on the empty seat's row. The app's way to
  record it is a no-jump on that question, and that stays; reading a sheet turns an "mb" in an empty
  seat into a no-jump. Allowing "mb" on an empty seat directly is left as a later option. A correct
  bonus written as "c" in the bonus chair is a genuine sheet error, read as written.
* Q: Should the scoresheet app's own upload of saved quiz files accept `.ods` too? → A: Yes. Both
  apps' uploads accept `.ods`, with the same rules. (Corrected during implementation: the scoresheet
  has no batch upload. It already opens one `.ods` and submits it to the meet, which the user judged
  enough; batch uploads stay in the portal.)
* Q: Blank sheets for the remaining scheduled quizzes: per room only, or every room at once? → A:
  Both. An official gets their room's; an admin also gets every room's in one archive, a folder per
  room. (Superseded below: blank sheets were dropped.)
* Q: A quiz that went past the template's two overtime rounds is downloaded as `.ods`: what happens?
  → A: It is exported through Q26 with a warning naming the questions left out, as the scoresheet
  does today; a bulk download lists such quizzes.
* Q: A batch re-uploads quizzes the meet already has: what happens? → A: A file identical to the
  stored current revision is reported unchanged, with no prompt and no new revision. For a changed
  one, the first "already stored" prompt offers to apply the choice to the rest of the batch.
* Q: Who may download the meet's bare template? → A: Anyone who may see the meet's full roster in
  its phase (viewers once the meet is live, admins always), and the meet's officials.
* Q (user decision): should a rostered quizzer missing from a sheet, often a fifth quizzer old
  sheets left off, stop being an error for imports? → A: No. It is an error: a quiz without its
  fifth quizzer gives wrong personal statistics. Imported sheets come up under review like any other
  and are fixed or accepted by an admin.
* Q: Should a blank sheet's decided teams come with their roster's quizzers in the seats, as New
  from schedule fills them in the app? → A: Yes. Seats are filled from the roster, a fifth quizzer
  included; the official reorders or clears them in LibreOffice. (Superseded: see the next answer.)
* Q (user decision): are blank pre-headed `.ods` sheets useful? → A: No. Officials start a sheet
  from the template `.ots`, so a room falling back to spreadsheets needs the meet's template
  (FR-013a) rather than blank sheets. Blank sheets are dropped from this feature.
* Q: A quiz exported to `.ods` and uploaded back untouched isn't always identical to the stored one:
  should the upload still call it unchanged? → A: No, only an exact match is unchanged. A sheet
  can't hold everything a quiz file does (A/B error order, overtime past Q26, timeouts, the quiz's
  placement and bonus settings), so a round trip that lost any of it is offered as a new revision.
  The meet link isn't in the file at all, so it plays no part.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Upload ODS sheets to the meet (Priority: P1)

An admin of a meet scored in spreadsheets, or partly so, picks a batch of `.ods` files on the
Results page. Each is read as a quiz and stored exactly as a `.json` upload would be, and the report
lists every file with what happened to it. An official does the same for their own room.

**Why this priority**: It is the one direction with no bulk path today, and it is what issue #52
asked for: backfilling a whole meet, or catching up the quizzes a room scored in a spreadsheet.

**Independent Test**: Upload a mix of `.ods` and `.json` files for a meet; every readable file is
stored and appears in the results list; the report names each file and its outcome.

**Acceptance Scenarios**:

1. **Given** a live meet and an admin on its Results page, **When** they upload ten `.ods` sheets,
   **Then** ten quizzes are stored, each recorded as uploaded by that admin, and the report lists
   all ten as stored.
2. **Given** an uploaded `.ods` whose quiz the meet already has, **When** it is uploaded, **Then**
   the uploader is asked, as for `.json` today, whether to make it the current revision, keep the
   current one, or skip it, and may apply that choice to the rest of the batch.
3. **Given** a whole meet uploaded a second time with no sheet changed, **When** the batch is sent,
   **Then** every file is reported unchanged, no prompt appears, and no quiz gains a revision.
4. **Given** a file that is neither a quiz file nor a readable sheet (a different spreadsheet, a
   corrupt archive), **When** it is uploaded in a batch, **Then** that file is reported as refused
   with a reason, and the rest of the batch is still stored.
5. **Given** an `.ods` sheet whose team or quizzer names aren't on the meet's roster, **When** it is
   uploaded, **Then** the quiz is stored with the names as read, and the results page's attention
   list flags the names that don't match.

---

### User Story 2 - Download stored quizzes as files (Priority: P1)

An admin, or an official for their own rooms' quizzes, downloads a stored quiz from the portal as
`.ods` or `.json`: one quiz from its result page, or every quiz they may see, of the meet or of one
division, at once as a single archive. Viewers don't download quizzes: a quiz file is the full
scoresheet, which the meet stats spec keeps with admins and the quiz's room officials
(`specs/006-meet-stats/spec.md`, FR-021).

**Why this priority**: It is the way back to spreadsheets, which doesn't exist today, and it lets a
statistician take a whole meet into LibreOffice.

**Independent Test**: For a meet with stored quizzes, download one quiz as `.ods` and open it in
LibreOffice: scores, fouls and totals match the app's. Download the whole meet as `.json`, upload
that archive's files to an empty copy of the meet, and get the same results.

**Acceptance Scenarios**:

1. **Given** a stored quiz, **When** an admin downloads it as `.json`, **Then** the file holds the
   quiz's current revision and opens in the scoresheet app.
2. **Given** a stored 20-question quiz, **When** an admin downloads it as `.ods`, **Then** they get
   a filled copy of the scoring template that LibreOffice opens, with the same marks, scores and
   totals as the app shows.
3. **Given** a meet with stored quizzes, **When** an admin downloads all of them, **Then** they get
   one archive with one file per quiz, named so the quiz is clear from the file name alone.
4. **Given** an official of Room 2, **When** they download all quizzes, **Then** the archive holds
   the quizzes their rooms saved, the same ones the Results page lists for them.
5. **Given** a viewer of the meet, **When** they look at its results, **Then** no quiz download is
   offered.
6. **Given** a stored 15-question quiz, **When** an admin asks for it as `.ods`, **Then** they are
   told spreadsheets hold only 20-question quizzes, and `.json` is still offered.

---

### User Story 3 - Match an uploaded sheet to its scheduled quiz (Priority: P2)

Before a batch is sent, the uploader sees each file's quiz as read from it (division, number,
consolation) and the scheduled quiz and room it will be stored as, and can correct one that was read
wrong before sending.

**Why this priority**: Real archives name quizzes loosely; storing a sheet as the wrong quiz puts
results in the wrong place, and fixing it after the fact is slower than catching it at upload.

**Independent Test**: Upload a batch where one sheet names a quiz the schedule doesn't have; it is
shown as unmatched, the uploader picks its scheduled quiz, and it is stored as that quiz in that
quiz's room.

**Acceptance Scenarios**:

1. **Given** a batch of sheets whose quiz names match the published schedule, **When** they are
   picked, **Then** each is shown with its scheduled quiz and room, and an admin sends the whole
   batch in one step with each quiz stored for its own room.
2. **Given** a sheet whose quiz isn't on the schedule, **When** the batch is shown, **Then** it is
   marked unmatched, and the uploader can pick a scheduled quiz for it or send it unlinked.
3. **Given** two sheets in one batch that name the same quiz, **When** the batch is shown, **Then**
   both are flagged as duplicates before anything is sent.

---

### Edge Cases

* A quiz that went to a third overtime round, downloaded as `.ods`: exported through Q26 with a
  warning naming the questions left out (FR-016).
* An `.ods` that isn't the scoring template (another spreadsheet): refused as not a quiz sheet,
  never stored as an empty quiz.
* A meet that is done, or in review for a non-admin: uploads are refused by phase, as for `.json`
  today. Downloads are allowed in every phase.
* A bulk download of a meet with no stored quizzes: says there is nothing to download rather than
  handing over an empty archive.
* A quiz with several revisions: downloads give the current revision. A past revision is downloaded
  from its own revision view.
* A file name that clashes in a bulk archive (two quizzes with the same name in different
  divisions): file names include the division, so they don't clash.
* A guessed A/B error order (Context): uploading the sheet again, or exporting and re-reading it,
  gives the same quiz, so a round trip doesn't drift.
* A sheet whose division is written with a prefix ("Div 1" where the meet has "1"): the upload shows
  it as a division the meet doesn't have, so the uploader corrects it before sending. Names are not
  rewritten silently.
* A bonus to an empty chair marked "mb" on the empty seat's row: read as a no-jump on that question
  (FR-005), so the quiz isn't flagged for a mark in an empty seat.
* A meet's template replaced partway through: later downloads use the new one; files already
  downloaded are unaffected.
* Real names: sheets from real meets carry real names. They belong in the meet's data only, never in
  the repo's fixtures or tests.

## Requirements _(mandatory)_

### Functional Requirements

* **FR-001**: The portal's quiz upload MUST accept `.ods` scoring sheets alongside `.json` quiz
  files, in the same batch. The scoresheet app keeps opening one `.ods` and submitting it, as it
  does today.
* **FR-002**: An `.ods` sheet MUST be read the same way the scoresheet app reads it, so a sheet
  gives the same quiz whichever app it is opened in.
* **FR-003**: An uploaded `.ods` MUST be stored, reported and permitted exactly as an uploaded
  `.json` is today: same roles, same phase rules, same "already stored" choices, recorded as
  uploaded.
* **FR-003a**: A file identical to its stored quiz's current revision MUST be reported unchanged,
  without asking and without adding a revision. When a batch asks what to do with a changed quiz it
  already has, the uploader MUST be able to apply that answer to the rest of the batch.
* **FR-004**: A file in a batch that cannot be read as a quiz MUST be reported as refused with a
  reason, without stopping the rest of the batch.
* **FR-005**: An uploaded sheet MUST be stored with its team and quizzer names as read; the upload
  neither checks them against the roster nor rewrites them. Reading a sheet MUST turn an "mb" in an
  empty seat into a no-jump on that question, in the scoresheet and the portal alike.
* **FR-006**: Before sending, the upload MUST show each file's quiz, the scheduled quiz and room it
  will be stored as, and duplicates within the batch; the uploader MUST be able to change a file's
  scheduled quiz or leave it unlinked.
* **FR-007**: An admin MUST be able to send a batch in which each quiz is stored for its own
  scheduled room, rather than one room for the whole batch.
* **FR-008**: Anyone who may see a stored quiz's full scoresheet (an admin, or an official of a room
  that saved it) MUST be able to download its current revision as `.json`, and as `.ods` when it is
  a 20-question quiz. Viewers MUST NOT be offered quiz downloads: how much of a quiz a viewer sees
  is decided in one place by the meet stats spec (FR-021 there), and the full scoresheet is a level
  it leaves for later.
* **FR-009**: The same people MUST be able to download every stored quiz they may see, of the meet
  or of one division, as a single archive of `.json` or `.ods` files.
* **FR-010**: Downloaded files MUST be named so the quiz is identifiable from the name alone, and
  names within one archive MUST be unique.
* **FR-011**: A downloaded `.json` MUST open in the scoresheet app, and uploading it back MUST give
  the same quiz.
* **FR-012**: Dropped with blank sheets (see Clarifications); the number is kept free so later ids
  stay stable.
* **FR-013**: A meet admin MUST be able to upload the scoring template once for the meet, and
  replace it. The portal's `.ods` downloads for that meet MUST be filled from it.
* **FR-013a**: The meet's bare template MUST be downloadable by anyone who may read all of the
  meet's churches, teams and rosters in its current phase (`docs/roles-and-access.md`), and by the
  meet's officials. Nobody else may download it.
* **FR-014**: Until a meet has a template, its `.ods` downloads MUST say an admin needs to upload
  one, and `.json` downloads stay available.
* **FR-015**: The scoresheet app, when its quiz is linked to a meet that has a template, MUST export
  `.ods` from that template without asking for one. The official MUST still be able to pick another
  template, and MUST be asked to pick one when the meet has none or the sheet isn't linked.
* **FR-016**: Asking for `.ods` of a quiz format the template can't hold MUST say so and leave the
  `.json` download available. A quiz with more overtime than the template holds MUST be exported as
  far as the template goes, with a warning naming the questions left out; a bulk download MUST list
  every such quiz.
* **FR-017**: Importing a meet's roster MUST succeed for a roster the size of a large meet (at least
  60 teams and 300 quizzers; a real meet has 44 teams) in one import. An import that fails MUST
  leave the meet as it was, with no churches, teams or quizzers half-added, and MUST tell the admin
  why it failed rather than showing a bare server error. After any import, failed or not, the meet
  page MUST show the meet's roster as it now is, without a manual refresh.
* **FR-018**: The Results page MUST show a quiz an admin accepted as scored as placed whenever the
  meet's statistics place it, so the two never disagree. Delivered outside this feature, by the
  papercuts pull request (#200); teams level in an overtime never played, which the stats place
  together, are tracked in #199.

### Key Entities

* **Quiz file**: the app's own record of one quiz (`.json`), lossless.
* **Scoring sheet**: one quiz in the spreadsheet template (`.ods`); 20-question only, two overtime
  rounds, and no record of A/B error order.
* **Stored quiz**: a meet's quiz with its revisions; uploads add one, downloads read the current
  one.
* **Meet template**: the scoring template a meet admin uploaded for the meet; one per meet,
  replaceable.
* **Upload batch**: the files picked in one upload, each with its read quiz, matched scheduled quiz,
  room, and outcome.

## Success Criteria _(mandatory)_

### Measurable Outcomes

* **SC-001**: An admin backfills a 75-quiz meet scored in spreadsheets in one upload, in under 10
  minutes including matching corrections.
* **SC-002**: A room switches to spreadsheets mid-meet, with the meet's template in hand, in under 2
  minutes.
* **SC-003**: A meet admin (the statistician, typically) gets a whole meet as spreadsheets in one
  download.
* **SC-004**: Downloading any stored quiz as `.json` and uploading it to a copy of the meet
  reproduces identical standings and statistics.
* **SC-005**: Exporting any 20-question quiz to `.ods` and uploading it back gives the same scores,
  placements and standings.

## Assumptions

* The existing ODS reader and writer are correct for the current template; this feature reuses them
  in the portal rather than changing the format.
* The scoresheet app already opens and exports `.ods` one quiz at a time. Its one change is its
  export using the meet's template (FR-015).
* Two defects found loading a real meet must be fixed before a backfill is useful: a large roster
  import failing (FR-017), fixed here, and accepted quizzes shown as not placed (FR-018), fixed by
  #200 before this feature merges.
* After an import, the existing attention list on the results page names what to fix (quizzes with
  no stage, quizzes in error, look-alike names, quizzers missing from sheets); this feature adds no
  second list.
* A full-meet upload is the heaviest load the API sees. It is one ordinary request per quiz, as a
  scoresheet submission is, so it adds no heavier request; measuring per-request CPU on a full meet
  is separate work, which this feature makes possible by loading one.
* Viewer downloads of quiz files, if a meet ever chooses to show viewers full scoresheets, arrive
  with that level of the meet stats settings, not here.
* No command-line importer: the portal upload covers the backfill case.
* Sheets read from `.ods` that come up "under review" are accepted by an admin with the existing
  "Accept as scored"; no bulk acceptance is added here.
* Room-level permissions are unchanged: an official uploads only for their own room.
