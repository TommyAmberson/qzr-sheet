# Feature Specification: Practice meet results

**Feature Branch**: `feat/practice-meet-results`

**Created**: 2026-10-02

**Status**: Draft

**Input**: User description, from a brainstorm: "On a 1-day meet we might not bother adding teams
and quizzers properly, which means we might not add the schedule either. We'd probably just use the
scoresheet and type names by hand. It would still be useful to gather the results. Last year we did
it on paper and calculated the teams for the finals by hand. We basically just do prelims, then the
top 3 of each division quiz a final. Submitting over the internet is better; passing files around is
a backup. The admin needs to see the saved quizzes and edit them. Immutable isn't required, but a
paper trail is."

## Context

A practice meet is a one-day meet whose stats don't count. It runs prelims, usually as 15-question
quizzes, then the top three teams of each division quiz a final. Nobody sets up churches, teams, or
quizzers in the portal for it: officials type team and quizzer names into the scoresheet.

Today the results stay on each room's device. Ranking teams for the finals means collecting paper or
files and adding up placement points by hand, which is slow and error-prone while the meet waits.

This feature lets officials send each quiz to the meet, and gives the meet's admin the submitted
quizzes, a ranking per division, and a way to correct mistakes with every change on record. It
relies only on what a practice meet already has: a meet, its rooms, and their codes.

Decisions from the brainstorm:

* Submitting over the internet is the main path; uploading saved quiz files is the backup.
* Ranking follows the rulebook prelim round: total placement points, with its tie-breakers.
* Edits are allowed, but each one is kept with who made it and when.
* Teams only for now; quizzer totals come later.
* Standings are for admins for now; viewer-code access comes later.

## Clarifications

### Session 2026-10-02

* Q: When two teams tied on placement points met in three-team quizzes, how is head-to-head decided?
  → A: Count the quizzes where they played each other; the team that finished above the other more
  often wins. Never met or level: fall through to total points (FR-011a).
* Q: How does an admin take a quiz that shouldn't count (a test, a duplicate) out of the standings?
  → A: Nothing is removed. Standings count only the quizzes an admin selects (opt in). A quiz not
  linked to a schedule slot, as in a practice meet, must be selected by hand; quizzes linked to a
  slot will be selected automatically once schedule linkage exists. Selecting replaces marking
  quizzes as prelim or final: the final is simply not counted (FR-013).
* Q: If teams are still tied for third after every tie-breaker, how are the finalists settled? → A:
  Flag only. The standings mark the teams as tied for the final, and the admin settles it away from
  the app; nothing is recorded (FR-012).
* Q: Which errors count for the fewest-errors tie-breaker? → A: Every error the team made in counted
  quizzes, whether or not it cost points; fouls excluded. The rulebook doesn't say, so this is an
  assumption to document (FR-011, Assumptions).
* Q: If an admin corrected a stored quiz and the room's official then resubmits their copy, what
  happens? → A: Newest save wins, but the history must be obvious: the list shows each quiz's
  revision number and who saved it last, so an overwritten correction is noticed. A diff between
  versions is a follow-up (FR-006).
* Q: What happens when a quiz's division isn't one of the meet's divisions ("Div 1" where the meet
  uses "1")? → A: Use it as given: the division text forms its own group in the standings, where the
  admin sees it and fixes a typo with the quick form. Like a quiz not linked to the schedule, it is
  never counted automatically (FR-010, FR-013).
* Q: Can an admin make an earlier version of a quiz current again in one action? → A: Yes. Restoring
  adds a new revision, recorded as restored from revision N with who and when; newer revisions are
  kept, never discarded. Restoring content that is already current changes nothing (FR-005a).
* Q: How does an admin count quizzes? → A: In the list of quizzes, each quiz has a counted toggle,
  with select all and deselect all for the quizzes shown (FR-013).
* Q: How does the meet know which stored quiz a submission belongs to? → A: A quiz not tied to the
  schedule is known by its name: division, consolation and quiz number, ignoring case and spaces.
  Submitting a name the meet already has, from the same room or another, warns with the stored
  revision and who saved it, and on confirmation adds a new revision (FR-003).
* Q: What can an official do with a quiz the meet already has? → A: Three choices: don't submit;
  save it as the new current revision; or save it but keep the current revision. Keeping the current
  revision records the submitted copy in the history and then a revision restoring the earlier
  content, so the newest revision is always the current one (FR-003, FR-005).

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Submit a quiz to the meet (Priority: P1)

An official in a practice meet room finishes a quiz and sends it to the meet with one action. The
meet's admin sees it arrive in a list of the meet's quizzes, grouped by division.

**Why this priority**: Every other story needs the quizzes in one place. On its own it already
replaces carrying paper between rooms.

**Independent Test**: Join a scoresheet to a room of a meet, score a quiz with typed names, submit
it, and see it in the admin's list with its division, quiz number, teams, and scores, marked as not
counted.

**Acceptance Scenarios**:

1. **Given** a scoresheet joined to a room of a meet and a quiz with no validation errors, **When**
   the official submits, **Then** the quiz is stored for that meet, recorded as submitted by that
   room, and the official sees a confirmation.
2. **Given** a submitted quiz, **When** an official of any room submits a quiz with the same
   division, consolation and quiz number, **Then** they are warned that it was already submitted,
   with its revision number and who saved it, and choose not to submit, to save it as the new
   current revision, or to save it but keep the current revision; either save adds to that quiz's
   history, not a second quiz.
3. **Given** a submitted quiz, **When** the official submits a quiz with a different division,
   consolation or quiz number, **Then** it is stored as a separate quiz.
4. **Given** no connection, **When** the official submits, **Then** they are told it was not sent,
   the quiz stays on the device unchanged, and they can retry or save it as a file.
5. **Given** a quiz with validation errors, **When** the official tries to submit, **Then**
   submission is refused with the reason.
6. **Given** a meet admin, **When** they open the meet's results, **Then** they see every submitted
   quiz grouped by division, with quiz number, room, team names, team scores, its revision number,
   who saved it last and when, and whether it is counted in the standings.

---

### User Story 2 - Division standings and finalists (Priority: P1)

The admin selects which quizzes count, normally the prelims, and the standings show each division's
teams ranked by placement points over those quizzes, with the top three marked as finalists. The
final is just another quiz that isn't counted; its result is read from the quiz itself.

**Why this priority**: This is the calculation done by hand last year, and the reason for gathering
results at all. With Story 1 it replaces the paper process.

**Independent Test**: Submit a set of prelim quizzes for two divisions, count them, open the
standings, and check each division's order, totals, and finalists against a hand calculation.

**Acceptance Scenarios**:

1. **Given** quizzes an admin has counted in a division, **When** the admin opens the standings,
   **Then** each team appears once with its total placement points and number of quizzes, ranked
   highest first.
2. **Given** two teams with equal totals, **When** the standings are ranked, **Then** the tie is
   broken by head-to-head results, then total points scored, then fewest errors, and the deciding
   criterion is shown.
3. **Given** teams still tied after every criterion, **When** the standings are shown, **Then** they
   share a rank and are flagged as tied, and if the tie affects who reaches the final, the flag says
   so.
4. **Given** the standings, **When** they are shown, **Then** the top three teams of each division
   are marked as finalists.
5. **Given** a quiz that isn't counted (the final, a test, or a duplicate), **When** the standings
   are shown, **Then** it has no effect on them, and it stays listed and viewable.
6. **Given** a newly submitted or uploaded quiz, **When** the admin opens the results, **Then** it
   is listed as not counted until an admin counts it.
7. **Given** a counted quiz, **When** the admin uncounts it, **Then** the standings drop it, and the
   change is recorded with who made it and when.
8. **Given** teams in a division with different numbers of counted quizzes, **When** the standings
   are shown, **Then** a warning names the teams and counts.

---

### User Story 3 - Upload saved quiz files (Priority: P2)

When a room can't submit, its official saves the quiz as a file, and the admin uploads one or more
files into the meet. Uploaded quizzes join the list like submitted ones, ready to be counted.

**Why this priority**: The backup path for rooms without a connection. Without it, one offline room
puts the meet back on paper.

**Independent Test**: Save three quizzes as files, upload them together, and see them in the list,
recorded as uploaded by the admin.

**Acceptance Scenarios**:

1. **Given** quiz files saved by the scoresheet, **When** the admin uploads them, **Then** each
   becomes a quiz of the meet, recorded as uploaded by that admin.
2. **Given** a file that isn't a valid quiz file, **When** it is uploaded, **Then** it is rejected
   with the reason and the other files still upload.
3. **Given** a file from a newer scoresheet than the meet's portal understands, **When** it is
   uploaded, **Then** it is rejected with that reason rather than read wrongly.
4. **Given** an uploaded file whose division, consolation and quiz number the meet already has,
   **When** it is uploaded, **Then** the admin is told it was already submitted, with its current
   revision and who saved it, and gets the same three choices as an official.

---

### User Story 4 - Correct a quiz, with a paper trail (Priority: P2)

The admin fixes mistakes in a stored quiz: names, division, or quiz number through a short form, and
answers by opening the quiz in the scoresheet. Every save keeps the previous revision, and the admin
can see each quiz's history.

**Why this priority**: Typed names and rushed scoring produce mistakes, and the standings are only
as right as the quizzes. The paper trail makes every correction accountable.

**Independent Test**: Rename a team and change a quiz number through the form, correct an answer
through the scoresheet, and see three entries in the quiz's history with who made each change and
when, and the standings updated.

**Acceptance Scenarios**:

1. **Given** a stored quiz, **When** the admin changes a team or quizzer name, the division, or the
   quiz number and saves, **Then** the quiz shows the change and the standings reflect it.
2. **Given** a stored quiz, **When** the admin opens it in the scoresheet, changes answers, and
   saves, **Then** the stored quiz is updated from the scoresheet.
3. **Given** any change to a quiz, by an official's resubmission or an admin's edit, **When** the
   admin opens its history, **Then** each revision is listed with who saved it, when, and how
   (submitted, uploaded, edited, merged, restored), and any earlier revision can be viewed or
   restored.
4. **Given** someone other than a meet admin, **When** they try to view or change the meet's
   results, **Then** they are refused.

---

### User Story 5 - Merge look-alike team names (Priority: P3)

The standings flag team names in a division that look like the same team typed differently, and the
admin merges one into the other in a single action, correcting every quiz that used it.

**Why this priority**: Repeated typos are tedious to fix one quiz at a time, but Story 4 already
covers them, so this is a convenience.

**Independent Test**: Submit and count quizzes using "Calgary 1" and "Calgry 1", merge the second
into the first from the standings, and see one team with the combined totals and a history entry on
each quiz that changed.

**Acceptance Scenarios**:

1. **Given** names that differ only in letter case or spacing, **When** standings are calculated,
   **Then** they count as the same team, shown under the most-used spelling.
2. **Given** names in a division that differ only slightly, **When** the standings are shown,
   **Then** they are flagged as possibly the same team.
3. **Given** a flagged pair, **When** the admin merges one name into the other, **Then** every quiz
   in that division using the merged name is changed to the kept name, each with a history entry,
   and the standings show one team.

---

### User Story 6 - Team list for the meet (Priority: P3)

The admin may enter each division's team names for the meet, without churches or quizzers. A
scoresheet joined to one of the meet's rooms then offers those names to choose from, so officials
rarely type them.

**Why this priority**: Prevents most name mismatches at the source, but costs setup time that some
practice meets will skip, and Stories 4 and 5 fix mismatches anyway.

**Independent Test**: Enter team names for a division, join a scoresheet to a room, and pick teams
from the list when setting up a quiz in that division.

**Acceptance Scenarios**:

1. **Given** a meet admin, **When** they add, rename, or remove team names for a division, **Then**
   the list is saved for the meet.
2. **Given** a meet with a team list and a scoresheet joined to one of its rooms, **When** the
   official sets a team's name, **Then** the division's team names are offered, and typing a name
   not on the list is still allowed.
3. **Given** a meet with no team list, **When** officials set up quizzes, **Then** they type names
   as they do today.

---

### Edge Cases

* An official resubmits after an admin corrected the same quiz: after the warning, saving it as the
  new current revision makes the official's copy current and keeps the correction in the history.
  The list shows the new revision number and the official as last saver, so the admin can see it and
  restore the correction. Saving it but keeping the current revision leaves the correction current.
* A quiz is submitted with the wrong division: the admin corrects it in the form, and it moves
  between divisions in the standings.
* An admin changes a quiz's division or quiz number to one another stored quiz already has: the
  change is refused, naming the clash, and the quiz keeps its old name.
* A division has fewer than three teams: all of its teams are marked as finalists.
* A counted quiz is resubmitted or edited: the standings use its newest revision, and it stays
  counted.
* The admin counts a final by mistake: its placement points join the totals like any counted quiz;
  uncounting it restores the standings.
* The same team name appears in two divisions: they are different teams, ranked separately.
* A quiz's division is spelt differently from the meet's ("Div 1" for "1"), typically from an
  uploaded file: it forms its own group in the standings until the admin corrects it.
* A quiz uses a different placement formula from the others: its placement points are counted as the
  quiz itself computes them.
* A counted quiz can't be placed, typically an uploaded file with unanswered questions or validation
  errors: it adds nothing to the standings, and a warning names it.
* An admin scores a quiz in a room: they join with the room's code as an official, or save the file
  and upload it.
* The scoresheet is not joined to a meet: submitting isn't offered, and the quiz works as today.
* A quiz in a 20-question format is submitted to a practice meet: it is accepted and counted like
  any other.

## Requirements _(mandatory)_

### Functional Requirements

* **FR-001**: Officials MUST be able to submit a quiz from a scoresheet joined to one of a meet's
  rooms, storing it as a quiz of that meet recorded with the room.
* **FR-002**: Submission from the scoresheet MUST be refused while the quiz has validation errors,
  with the reason.
* **FR-003**: A quiz not tied to the schedule MUST be identified by its name: division, consolation
  and quiz number, ignoring case and spaces. Submitting or uploading a name the meet already has
  MUST warn with the stored quiz's current revision and who saved it, and offer three choices: not
  to submit, to save it as the new current revision, or to save it but keep the current revision.
  Either save MUST add to that quiz's history rather than create another quiz.
* **FR-004**: A failed submission MUST say so, MUST leave the quiz on the device unchanged, and MUST
  NOT block scoring or saving to a file.
* **FR-005**: Every save of a stored quiz (submission, upload, edit, merge, restore) MUST be kept as
  a revision recording who saved it, when, and how. Earlier revisions MUST remain viewable and MUST
  NOT be deleted by later saves. The newest revision is always the current one: keeping the current
  revision on a save records the submitted copy, then a revision restoring the earlier content.
* **FR-005a**: Meet admins MUST be able to restore any earlier revision of a stored quiz in one
  action. Restoring MUST add a new revision recorded as restored from that revision, with who and
  when, and MUST keep every newer revision. Restoring content that is already current changes
  nothing.
* **FR-006**: Meet admins MUST be able to list the meet's stored quizzes grouped by division, with
  quiz number, room, team names, team scores, whether it is counted, its revision number, and who
  saved it last and when, so that a quiz changed since an admin last looked stands out.
* **FR-007**: Meet admins MUST be able to upload one or more scoresheet quiz files into the meet. A
  valid file whose name the meet doesn't have becomes a stored quiz; one whose name it already has
  is reported with that quiz's current revision and gets the same three choices (FR-003). Each
  invalid or too-new file is rejected individually with its reason.
* **FR-008**: Meet admins MUST be able to change a stored quiz's team names, quizzer names,
  division, and quiz number. A change of division or quiz number that would give the quiz another
  stored quiz's name MUST be refused with the reason.
* **FR-009**: Meet admins MUST be able to open a stored quiz in the scoresheet and save the
  corrected quiz back to the meet.
* **FR-010**: Standings MUST group counted quizzes by the division written in each quiz, as given,
  so a division the meet doesn't list forms its own group. Standings MUST rank each division's teams
  by total placement points over the counted quizzes, each quiz's placement points being those the
  quiz itself scores.
* **FR-011**: Ties in total placement points MUST be broken, in order, by head-to-head results
  between the tied teams, total points scored in counted quizzes, and fewest errors in counted
  quizzes, as in the rulebook's preliminary round. Errors MUST count every error a team made in the
  counted quizzes, whether or not it cost points, and MUST NOT count fouls. Teams still tied MUST
  share a rank and be flagged.
* **FR-011a**: Head-to-head MUST count only the counted quizzes in which the tied teams played each
  other, and compare how often each finished above the other; other teams' places don't matter. With
  two tied teams, the one that finished above the other in more of those quizzes ranks ahead. With
  three or more, a team ranks ahead of the rest only if it finished above each of them in more of
  their shared quizzes than it finished below. If the teams never met, or no team is ahead this way,
  head-to-head decides nothing and total points are compared next.
* **FR-012**: Standings MUST mark the top three teams of each division as finalists, and MUST flag a
  tie that decides who reaches the final, naming the tied teams. The admin settles such a tie away
  from the app; the standings record no choice.
* **FR-013**: Meet admins MUST choose which stored quizzes count towards the standings, with a
  counted toggle on each quiz in the list and select all and deselect all for the quizzes shown. A
  quiz not linked to a schedule slot, which in this feature is every quiz, MUST NOT count until an
  admin selects it, and the same holds for a quiz whose division the meet doesn't list, even once
  schedule linkage exists. The list MUST show which quizzes are not counted, and each count or
  uncount MUST be recorded with who did it and when.
* **FR-014**: Standings MUST warn when a division's teams have different numbers of counted quizzes,
  and when a counted quiz can't be placed (questions unanswered or validation errors), which then
  adds no placement points and doesn't count as one of its teams' quizzes.
* **FR-015**: Standings MUST treat team names that differ only in letter case or surrounding and
  repeated spaces as the same team, shown under its most-used spelling, a tie going to the spelling
  seen first.
* **FR-016**: Standings MUST flag team names in a division that differ only slightly, and meet
  admins MUST be able to merge one into another across every quiz in that division in one action.
* **FR-017**: Meet admins MUST be able to keep a list of team names per division for the meet, and a
  scoresheet joined to the meet's room MUST offer that list while still accepting typed names.
* **FR-018**: Only the meet's admins (and superusers) MUST be able to view stored quizzes, their
  history, and the standings, or change them. Officials MUST only be able to submit to the meet of
  the room they joined.
* **FR-019**: Standings MUST always use the newest revision of each counted quiz, with no further
  action after a counted quiz is resubmitted or edited.

### Key Entities

* **Meet**: an existing meet, with divisions and rooms. A practice meet needs no churches, teams, or
  quizzers.
* **Stored quiz**: one quiz of a meet, identified by its name (division, consolation and quiz
  number) when not tied to the schedule: its current content (as the scoresheet saves it), the room
  it came from if submitted, and whether it is counted in the standings.
* **Quiz version** (a revision): one save of a stored quiz: its revision number, its content (a full
  quiz, or the earlier revision it restores), who saved it, when, and how (submitted, uploaded,
  edited, merged, restored).
* **Counting record**: who counted or uncounted a stored quiz, and when.
* **Division standings**: derived, never stored: each team's prelim totals, rank, tie-break detail,
  finalist marking, and warnings.
* **Team list**: optional team names per division for a meet.

## Success Criteria _(mandatory)_

### Measurable Outcomes

* **SC-001**: Within one minute of the last prelim quiz being submitted, the admin can count the
  prelims and name each division's three finalists without any hand calculation.
* **SC-002**: For a set of prelim quizzes ranked by hand under the rulebook rules, the standings
  agree on every team's total, rank, and finalist marking.
* **SC-003**: No submitted, uploaded, or edited quiz is lost: every revision saved during a meet can
  be viewed afterwards.
* **SC-004**: Every change to a stored quiz can be traced to who made it and when.
* **SC-005**: A room without a connection can still get its quizzes into the standings, through
  saved files, with no retyping.
* **SC-006**: A team name misspelt across several quizzes can be corrected everywhere in one action.

## Assumptions

* Meets, divisions, rooms, room official codes, and admin access already exist and are reused; the
  admin creates the practice meet and its rooms as for any meet.
* Officials join a scoresheet to a room with the room's code, without an account, as the access
  design describes.
* Standings use the placement points each quiz computes under its own placement formula setting.
* In a scheduled meet, quizzes linked to a schedule slot will be counted automatically. That arrives
  with schedule result linkage (#16) and is out of scope here.
* "Fewest errors" counts every error, including those that cost no points, and no fouls. The
  rulebook doesn't define it, so this is an assumption, documented with the other rules not in the
  rulebook.
* The rulebook tie-breakers are written for elimination-round positions; applying them to every
  prelim tie in a practice meet is documented as a rule not in the rulebook.
* A stored quiz's history is kept for as long as the meet exists.
* Out of scope: a side-by-side diff between revisions of a quiz (planned as a follow-up), schedules
  and draws, quizzer totals and individual stats, standings for viewers or coaches, counting
  practice meets towards season stats, and real (non-practice) meet workflows beyond what these
  stories provide.
