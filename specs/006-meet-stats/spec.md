# Feature Specification: Meet stats

**Feature Branch**: `feat/stats-management`

**Created**: 2026-11-14

**Status**: Draft

**Input**: User description, from a working session: "I want the stats page to look better. I want
it easier to manage saved results. I want it prettier. I want results to be shown properly (we have
to decide what is public when; what each role can see when). Quiz results, team standings,
individual standings. And we need to verify that the stats are calculated correctly. If a quiz has
validation errors there should definitely be a way to accept and include it anyway. I think we need
per-meet stat settings."

## Context

A meet's stats are worked out today by a statistician in a spreadsheet: every quiz is typed in as a
row per team and a row per quizzer, the workbook ranks teams and quizzers, and a report is printed
for the awards. The portal already holds each quiz as officials submit it and ranks a division's
teams by placement points for an admin (the practice meet results feature). It knows nothing about
quizzers, shows nothing to anyone but admins, and drops any quiz with a validation error from the
standings.

This feature takes the portal from a prelim ranking for the admin to the meet's stats: individual
standings beside prelim standings, each quiz counted for the right tables, a page that people other
than the admin may be shown at a time the admin chooses, and a results list that is easier to keep
in order. It builds on stored quizzes, their revisions and the standings as they are.

Checking the portal's existing scoring against a past weekend meet (74 scoresheets, the
statistician's workbook and the published report) gave the decisions below.

Decisions from the working session:

* A quizzer's average is their total points divided by the number of quizzes their team played. The
  number of quizzes the quizzer was listed in should equal it; when it doesn't, something went
  wrong, and the quizzer is flagged.
* Individual stats count every quiz except a Finals: prelims, intermediates and eliminations.
* Finalists are always three (gold, silver, bronze). There is no setting.
* "Public" means people holding the meet's viewer code. Nobody sees stats anonymously.
* A meet has stats settings: the order of team tie-breakers, how teams level in a quiz are scored,
  and what viewers see and when. The reference meet ranked ties by total points and then fewest
  errors, with no head-to-head, and seeded its intermediates that way.
* An admin can accept a quiz that has validation errors, and it then counts.
* The mass results importer and score-only results stay separate work.

## Clarifications

### Session 2026-11-14

* Q: How does a division reach its stats break and division done points, which decide when viewers
  see standings? → A: Only by the admin. Quizzes count on their own (linked to the schedule and free
  of errors), the portal says when a division is ready, and the admin confirms the move with a
  control on the meet. The admin may move on with scheduled quizzes still missing, after a warning
  that names them (FR-009, FR-019a).
* Q: Can a division's stats break be redone? → A: Yes, but it is like redoing the prelim draw: the
  confirmed prelim order decides where teams quiz next. While no later quiz of the division is
  stored it can simply be taken back. Once later quizzes are stored, taking it back needs the admin
  to confirm past a warning that says those quizzes were seated from the order being withdrawn and
  names each one; they stay stored and are flagged until the admin deals with them (FR-019b).
* Q: Which quizzes do viewers see in the quiz results list? → A: Those that count (a stage, and free
  of errors or accepted), and those with a stage that have errors not yet accepted, shown as under
  review with no scores. Never a quiz that is not counted (FR-021).
* Q: Who sees the warnings on the stats tables? → A: Admins see all of them. An official sees the
  warnings about quizzes of their own rooms. Everyone else sees clean tables with only the
  standings' state, and under review or accepted as scored on a quiz (FR-020a).
* Q: Are averages ranked on their exact value or as shown? → A: Exact. Averages are shown to two
  decimals, so two quizzers may show the same average and hold different places (FR-004).
* Q: In a meet with rosters, how is a team or quizzer on a scoresheet matched to the roster? → A:
  The aim is that every team and quizzer matches the roster. One that doesn't means either the quiz
  or the roster is wrong, so the quiz is in error, with both fixes on offer, and adds nothing until
  fixed or accepted (FR-002a; first answered as a flag that still counts, changed the same day).
* Q: How is a stored quiz linked to a scheduled quiz, and how does the link relate to its name? → A:
  They are separate, and should agree. A quiz that is linked to a scheduled quiz in the scoresheet
  when it is submitted arrives linked. One that arrives unlinked is linked automatically when its
  name and its team names match a scheduled quiz; otherwise it stays unlinked until an official of
  its room, or an admin, links it by hand, or until its name is corrected, which links it as on
  arrival. A linked quiz whose name differs from the scheduled quiz's is in error: flagged, not
  counted, and in need of review (FR-009, FR-009a, FR-014).
* Q: How does a quiz linked in the scoresheet arrive linked? → A: The scheduled quiz the sheet is
  linked to at that moment, whether the quiz was started or opened from the schedule or linked to it
  part-way, is sent along when the quiz is submitted. It is not written into the quiz file, which
  stays a record of what the room typed, so an uploaded file arrives unlinked and is matched on
  arrival (FR-009).
* Q: How closely must team names match for a quiz to link on its own? → A: They don't: a quiz is
  linked by its name, as a quiz saved under a name is that quiz. Teams that differ from the
  schedule's are then an error on the linked quiz, not a reason to leave it unlinked (FR-009;
  replaced the earlier answer that a team-name near miss is offered as a suggestion, 2026-11-16).
* Q: Is a quiz that is not linked an error? → A: Yes, in a meet with a published schedule, until it
  is linked or accepted. That covers a name the schedule doesn't have, an admin's unlink, and a link
  to a scheduled quiz a later schedule dropped (FR-014).
* Q: What about a team or seat left unnamed? → A: The scoresheet now leaves it blank, and older
  files carry "Team 3" or "Quizzer 1" there. Either is a name not on the roster, a roster error; a
  seat with no name and no answers is nobody (FR-002a).
* Q: A team is written by its short name in one quiz and its full name in another: one team or two?
  → A: One. A name that matches a roster team by its full or short name counts as that team and is
  shown under the roster's name (FR-002a).
* Q: What kinds of problem can a stored quiz have, and what does each do? → A: Three. A scoring
  error is known from the quiz alone. A roster error is a name that doesn't agree with the meet's
  roster. A schedule error is a quiz that doesn't agree with the schedule: it keeps an unlinked quiz
  from linking itself, and is an error on a linked one. All three are errors in the portal: the quiz
  adds nothing until fixed or accepted. The scoresheet shows the first as errors and the other two
  as warnings, and both compare names by the same rules (FR-014, FR-014a).
* Q: Does a quiz's overtime have to fit its stage? → A: Yes. Eliminations and Finals must have a
  winner, as the rulebook has it, so one that ends level with no overtime is in error. Prelims and
  intermediates, which are prelims of a special kind, are played at these meets with no overtime: a
  tie stands and the level teams share the place. That is not the rulebook, which sends every tied
  quiz to overtime, so it is a setting of the meet, on unless an admin turns it off. With it on,
  overtime played in a prelim or an intermediate is an error, since it changes placement points; a
  prelim with overtime switched on but never played is not, its result being the same (FR-014,
  FR-023d).
* Q: Are all of a quiz's scoring errors shown? → A: Yes, each with its team, seat, question and
  message, to admins and the quiz's room officials (FR-014).
* Q: What counts as a roster error besides a name not on the roster? → A: A team listing more
  quizzers than its roster has, and a quizzer of the team's roster missing from a quiz the team
  played (FR-002a).
* Q: A team is left blank where the schedule doesn't yet name the quiz's teams? → A: The schedule
  can't say it is wrong, so it is shown as a team the meet doesn't know: a roster error where the
  meet has rosters (FR-002a).
* Q: Is a team checked against the whole meet's teams or its division's? → A: The teams of the
  quiz's division. A team of another division is not on the roster: a roster error (FR-002a).
* Q: The scoresheet shows a blank division or quiz number as `_`. What does the portal make of a
  quiz submitted with `_`? → A: The same as blank: no division the meet lists (FR-009a).
* Q: Is the re-ranked order after a division's intermediates confirmed and recorded like the prelim
  order? → A: Yes. Intermediates end the same way as prelims: the admin confirms the re-rank, the
  order is recorded, and it is withdrawn under the same rules. No division state is added for it:
  the move to the stats break confirms the prelim order, intermediates are played during it, and the
  move to eliminations running confirms the re-rank. That move is also a point from which viewers
  may be shown a table (FR-018, FR-019a, FR-019c).
* Q: Is a division being done the same as the meet moving to review? → A: No. Done is per division,
  while other divisions may still be quizzing; review is the whole meet, after all quizzing. Both
  are points from which viewers may be shown a table. The meet does not move to review on its own:
  when the admin marks the last division done, the portal offers the move in the same step (FR-018,
  FR-019d).
* Q: Do the top three of the prelim standings matter? → A: Only where prelims lead straight to a
  Finals, as in a practice meet. In a meet with eliminations the prelim order is a seeding, and the
  first three come from the Finals (FR-011, FR-013).
* Q: What happens to a confirmed prelim order or re-rank when a stats setting is changed afterwards?
  → A: It stays. The standings follow the new setting and are shown as differing from the confirmed
  order, exactly as after a corrected quiz (FR-022).
* Q: Is the Finals part of a division's eliminations? → A: No. Finals is its own division state,
  after the eliminations and before done, and a point from which viewers may be shown a table
  (FR-018, FR-019a).
* Q: What can viewers be shown, and when? → A: Quiz results stage by stage (prelims, intermediates,
  eliminations, Finals), each from a chosen moment and at a chosen level, places only or places and
  scores, with the full scoresheet left as a later third level. Prelim standings and the re-rank
  once confirmed, with one switch for showing them live before that. Quizzer standings from a chosen
  moment, live or by stage. The moments are the steps of the day: start, prelims confirmed,
  intermediates confirmed, eliminations in, Finals done, review, done (FR-018).
* Q: What does "prelim standings" mean after the prelims? → A: Nothing single. Prelim standings and
  the re-rank are stage tables that lock when confirmed; team placings beyond them are left for
  later (FR-018, FR-024).
* Q: Quizzer standings by stage: frozen figures, or the quizzes up to that step? → A: The quizzes up
  to the last confirmed step, worked out afresh, so corrections show (FR-018a).
* Q: What does the settings page look like? → A: One place: each division's progress as a row of
  steps with its confirm control, then what viewers see as one plain line for each thing, with what
  each division's viewers have of it right now beside it. A timeline grid was tried and dropped as
  harder to read. Saved, not instant, with what changes for viewers stated first, and a look at a
  division's page as a viewer (FR-023c).
* Q: How does a reader know whether standings can still change? → A: Standings say which of three
  states they are in: live preview (still changing as quizzes come in), preview (not changing now,
  may still be corrected), or locked in (confirmed into the draw, or the meet is done) (FR-020).
* Q: Should "when the actual results show" and "whether there is a live preview" be separate
  settings? → A: No. One choice of moment for each thing is enough; what matters is that the
  wording, in the settings and on the page, always makes plain whether standings are a live preview
  or the actual standings. Quiz results need no such label (FR-018, FR-020).
* Q: When are quizzer standings the actual standings? → A: Only once the meet is done. Anything
  shown of them before that is a preview: a live preview while it follows quizzes still coming in,
  otherwise a preview (FR-020).

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Quizzer standings (Priority: P1)

The admin opens a division's stats and sees its quizzers ranked by average, with each quizzer's
team, total points, errors and jumps, as the statistician's report lists them. Quizzers whose teams
played in the consolation bracket are listed apart.

**Why this priority**: Quizzer standings are what the portal lacks entirely, and the reason a
statistician still retypes every quiz. Everything else in this feature shows or manages them.

**Independent Test**: Store a division's quizzes, count them, open the quizzer standings, and check
each quizzer's points, errors, jumps, average and place against a hand calculation.

**Acceptance Scenarios**:

1. **Given** counted quizzes in a division, **When** the admin opens the quizzer standings, **Then**
   each quizzer appears once with their team, average, total points, errors, jumps and number of
   quizzes, ranked by highest average.
2. **Given** two quizzers with the same average, **When** they are ranked, **Then** the one with
   fewer errors is placed higher; quizzers level on both share a place and the next place is
   skipped.
3. **Given** a quizzer who answered a bonus question or answered in overtime, **When** their points
   are totalled, **Then** those answers add nothing to their points, errors or jumps.
4. **Given** a quizzer listed in fewer quizzes than their team played, **When** the standings are
   shown, **Then** the average still divides by the team's quizzes, and the quizzer is flagged with
   both counts.
5. **Given** a division with a consolation bracket, **When** the quizzer standings are shown,
   **Then** quizzers of teams that played in the consolation bracket form their own list, ranked
   among themselves, with every quiz their team played counted except a Finals.
6. **Given** quizzes whose questions have types recorded, **When** the admin looks at a quizzer,
   **Then** their correct answers are counted by question type, and a quizzer whose types don't add
   up to their correct answers is flagged as incomplete.

---

### User Story 2 - Each quiz counts for the right tables (Priority: P1)

Every stored quiz has a stage: prelim, intermediate, elimination, Finals, or not counted. Team
standings use the prelims, the re-rank after an intermediate uses the prelims and that intermediate,
and quizzer standings use everything but the Finals. A quiz linked to a quiz in the meet's published
schedule takes its stage from it; the admin sets or corrects the rest.

**Why this priority**: Today a quiz is only counted or not, which cannot say that an elimination
counts for quizzers and not for the prelim ranking. Story 1 gives wrong averages without it.

**Independent Test**: Store a division's prelims, two intermediates, eliminations and a Finals; set
or confirm their stages; check that the prelim standings use only prelims, the re-rank adds the
intermediates, and a quizzer's average covers all but the Finals.

**Acceptance Scenarios**:

1. **Given** a meet with a published schedule, **When** a quiz linked to a scheduled quiz in the
   scoresheet is submitted, **Then** it arrives linked to that scheduled quiz, takes its stage, and
   counts without the admin doing anything.
2. **Given** a quiz scored without the schedule, **When** it arrives with a name and team names that
   match a scheduled quiz, **Then** it is linked automatically and counts the same way.
3. **Given** a quiz that arrives matching no scheduled quiz, or in a meet with no schedule, **When**
   it is listed, **Then** it is unlinked and not counted, until an admin gives it a stage, an
   official of its room or an admin links it by hand, or its name is corrected so that it matches.
4. **Given** a linked quiz whose name differs from the scheduled quiz's, **When** it is listed,
   **Then** it is flagged as in error and does not count, until its name is corrected or an admin
   accepts it.
5. **Given** quizzes with stages, **When** the prelim standings are shown, **Then** they rank teams
   over the prelims only. Only where the division's prelims lead straight to its Finals, as in a
   practice meet, are the top three marked as finalists; where it has intermediates or eliminations,
   the prelim order is a seeding and nobody is marked.
6. **Given** teams that played an intermediate, **When** the standings are shown, **Then** a
   re-ranked order is shown for those teams by prelim placement points plus the intermediate's, and
   once the division's intermediates are all in the admin confirms it, as the prelim order is
   confirmed at the stats break.
7. **Given** a Finals quiz, **When** stats are shown, **Then** its result gives the division's
   first, second and third, and it adds nothing to prelim standings or to any quizzer's stats.
8. **Given** a quiz whose stage came from the schedule, **When** the admin changes its stage,
   **Then** the admin's choice holds, and the change is recorded with who made it and when.
9. **Given** quizzes counted before this feature, **When** it arrives, **Then** they are prelims.

---

### User Story 3 - Accept a quiz that has errors (Priority: P1)

A quiz with a validation error, or with questions left unanswered, is left out of the standings
today, and its teams lose a quiz. The admin can look at what is wrong and accept the quiz as it
stands, so it counts, stays marked as accepted as scored, and the acceptance is on record.

**Why this priority**: Real meets are not clean. In the reference meet two prelims with slips made
on the day put 18 of a division's 28 teams in the wrong place until they were counted.

**Independent Test**: Store a quiz with a validation error, see it flagged and left out, accept it,
and see its teams' placement points and its quizzers' points join the tables with a mark on the
quiz.

**Acceptance Scenarios**:

1. **Given** a quiz with a stage that has validation errors or unanswered questions, **When** stats
   are shown, **Then** it adds nothing, and a warning names it and says what is wrong.
2. **Given** such a quiz, **When** the admin accepts it, **Then** its teams are placed by their
   scores as they stand, it counts in every table its stage calls for, and it is marked "accepted as
   scored" wherever it is listed; admins and its room's officials also see what the errors are.
3. **Given** an accepted quiz, **When** the admin withdraws the acceptance, **Then** it drops out
   again; both actions are recorded with who and when.
4. **Given** an accepted quiz, **When** a later revision still has errors, **Then** the acceptance
   does not carry over: the quiz drops out with the warning until an admin accepts that revision.
5. **Given** an official or a viewer, **When** they look at an accepted quiz they may see, **Then**
   they see it marked "accepted as scored", and cannot accept or withdraw; a viewer is not shown
   what the errors were.
6. **Given** a quiz with three validation errors, **When** an admin or the quiz's room official
   opens it, **Then** each error is listed with its team, seat, question and message.
7. **Given** a meet with rosters and a quiz naming a quizzer the team's roster doesn't have,
   **When** stats are shown, **Then** the quiz adds nothing and is named with a roster error
   offering the nearest roster name; **When** the roster is corrected to include that name, **Then**
   the quiz counts with nothing else done.
8. **Given** a quiz accepted as scored, **When** the roster is later changed so that the quiz has a
   new roster error, **Then** the quiz stays accepted.

---

### User Story 4 - Who sees what, and when (Priority: P2)

The admin decides what the meet's viewers see as the day goes on: each stage's quiz results and how
much of them, whether the prelim standings show while prelims are still being played, and when the
quizzer standings appear and how they update. Until a thing's moment arrives only admins see it.
Once shown, standings say whether they are a live preview, a preview or locked in.

**Why this priority**: Stats exist to be read by coaches, quizzers and parents, but a ranking shown
too early, or quizzer standings shown before the awards, causes trouble. The first three stories are
useful to the admin alone.

**Independent Test**: Set prelim results to show from the start with places only, prelim standings
not to show live, and quizzer standings by stage from the end of prelims; as a viewer, follow a
division through its day and check each thing is absent before its moment, present after, and that
the quizzer list changes only when the admin confirms a step.

**Acceptance Scenarios**:

1. **Given** something set to show from a moment its division or the meet has not reached, **When**
   a viewer opens the stats, **Then** it is absent and the page says it isn't available yet.
2. **Given** a stage's quiz results set to places only, **When** a viewer looks at a counted quiz of
   that stage, **Then** they see its teams and who placed first, second and third, and no scores;
   set to places and scores, they see the scores too.
3. **Given** prelim standings not set to show live, **When** prelims are being played, **Then**
   viewers see no prelim standings; once the admin confirms the prelims, viewers see the confirmed
   order, and likewise the re-rank once it is confirmed.
4. **Given** prelim standings set to show live, **When** prelims are being played, **Then** viewers
   see the standings change as quizzes count, and from the confirmation on they see the confirmed
   order.
5. **Given** quizzer standings set to update by stage from the end of prelims, **When** quizzes are
   stored during the eliminations, **Then** the list viewers see still covers the quizzes up to the
   end of prelims, and it moves on when the admin confirms the division's next step.
6. **Given** quizzer standings by stage, **When** a prelim it covers is corrected, **Then** the list
   is worked out again over the same quizzes, so it is right without covering anything newer.
7. **Given** a meet in registration or build, **When** anyone but an admin opens the stats, **Then**
   there is nothing to see.
8. **Given** someone with no access to the meet, **When** they ask for its stats, **Then** they are
   refused.
9. **Given** a coach or an official, **When** they open the stats, **Then** they see what a viewer
   sees; an official also keeps their own rooms' quizzes as today.
10. **Given** a division whose scheduled prelims are all stored and counting, **When** the admin
    opens the settings, **Then** the division is shown as ready for its next step, and nothing more
    is shown to viewers until the admin confirms it.
11. **Given** a division with a scheduled prelim missing, **When** the admin confirms its prelims
    anyway, **Then** a warning names the missing quiz, and on confirming the division moves.
12. **Given** the admin has changed what viewers see, **When** they go to save, **Then** they are
    told what viewers will newly see, and what they will stop seeing, the moment it is saved.

---

### User Story 5 - A stats page worth reading (Priority: P2)

Each division has one page: its medallists, prelim standings, quizzer standings and quiz results,
clear on a phone and on a projector, and printing as the report the statistician hands out.

**Why this priority**: The user finds today's page and the printed report ugly. A clearer page is
the visible half of this feature, but it shows nothing new without Stories 1 and 2.

**Independent Test**: Open a division's stats on a phone and on a wide screen, find a named
quizzer's place and a team's prelim rank without scrolling sideways, then print the division and
compare the page with the statistician's report.

**Acceptance Scenarios**:

1. **Given** a division with stats, **When** its page is opened, **Then** it shows the Finals result
   when there is one, prelim standings, quizzer standings with the consolation list apart, and the
   division's quizzes with their places, and their scores where the reader may see them.
2. **Given** a narrow screen, **When** the page is shown, **Then** each table's main columns (place,
   name, and the figure it ranks by) fit without scrolling sideways.
3. **Given** a division's page, **When** it is printed, **Then** it comes out as one division per
   sheet with places, teams, quizzers, averages, errors and jumps, the number of quizzers in the
   division, and no controls or navigation.
4. **Given** a quizzer with no jumps in the meet, **When** the list is printed, **Then** they are
   left off the printed list and still counted in the number of quizzers and in the places.
5. **Given** a table the reader may not see yet, **When** the page is shown or printed, **Then** the
   rest of the page still reads well.

---

### User Story 6 - Stats settings for the meet (Priority: P2)

The admin sets how the meet breaks ties between teams, how level teams are scored, and what viewers
see and when (Story 4), in one place, beside each division's progress through the day.

**Why this priority**: The rulebook order breaks ties by head-to-head first; the reference meet
ranked by total points and then fewest errors, which changed who met whom in the intermediates. A
meet has to be able to rank the way it runs.

**Independent Test**: With two teams level on placement points whose head-to-head and total points
disagree, switch the meet's tie-break order and see their ranks swap and the deciding criterion
named.

**Acceptance Scenarios**:

1. **Given** a new meet, **When** nothing is set, **Then** ties are broken as in the rulebook:
   head-to-head, total points, fewest errors.
2. **Given** a meet set to rank ties by total points and then fewest errors, **When** standings and
   re-ranks are shown, **Then** head-to-head is not used, and each broken tie names the criterion
   that decided it.
3. **Given** an admin, **When** they change a stats setting, **Then** every table follows as soon as
   it is saved, and who changed it and when is recorded.
4. **Given** a prelim that ended with two teams level and no overtime, **When** the meet's setting
   for level teams is switched, **Then** both teams' placement points for that quiz change in every
   table, switching back restores them, and no stored quiz gets a new revision.
5. **Given** a stored quiz whose own way differs from the meet's, **When** the admin looks at it,
   **Then** a note says its scoresheet shows different placement points, and one action sets every
   such quiz to the meet's way, each with a history entry.
6. **Given** a meet that is done, **When** an admin tries to change a setting, **Then** it is
   refused until the meet is moved back to review.

---

### User Story 7 - Results that are easy to keep in order (Priority: P3)

Managing the stored quizzes is its own page, apart from the stats. It lists what needs attention
(quizzes with no stage, quizzes with errors, names that look alike, quizzers missing from a quiz)
with the fix one step away, and lets the admin act on many quizzes at once.

**Why this priority**: The admin can already do most of this one quiz at a time. It saves time at a
meet, which matters, but nothing is impossible without it.

**Independent Test**: Store quizzes including one with no stage, one with an error, and one where a
quizzer's name is spelt two ways; open the list of what needs attention and clear each item from
there.

**Acceptance Scenarios**:

1. **Given** stored quizzes, **When** the admin opens results management, **Then** the quizzes are
   listed and can be narrowed by division, stage and whether they need attention.
2. **Given** things that need attention, **When** the admin opens the list, **Then** each says what
   is wrong, names the quiz, team or quizzer, and leads to the action that fixes it.
3. **Given** several quizzes shown, **When** the admin sets a stage for them together, **Then** all
   of them take it, each with its record.
4. **Given** a quizzer's name spelt two ways on one team, **When** the standings are calculated,
   **Then** the two are flagged as possibly the same quizzer, and the admin can merge one name into
   the other across that team's quizzes in one action, each quiz getting a history entry.
5. **Given** two names flagged as looking alike that are in fact different teams or quizzers,
   **When** the admin says so, **Then** the flag goes away and stays away.

---

### User Story 8 - Check any number (Priority: P3)

Anyone who may see a table can open a team or a quizzer and see the quizzes behind their totals. The
admin can take the tables away as a file a spreadsheet opens.

**Why this priority**: A stats page is trusted only if a doubted number can be traced. The
statistician also needs a way to compare with their own workbook while the portal earns that trust.

**Independent Test**: Open a quizzer and add up their per-quiz points by hand to their total;
download the division's tables and open them in a spreadsheet.

**Acceptance Scenarios**:

1. **Given** the quizzer standings, **When** a quizzer is opened, **Then** each quiz they were
   listed in is shown with their points, errors, jumps and correct answers by type, adding up to
   their totals.
2. **Given** the prelim standings, **When** a team is opened, **Then** each of its quizzes is shown
   with its stage, place, score, placement points and errors.
3. **Given** an admin, **When** they download a division's stats, **Then** they get its team and
   quizzer rows per quiz and its standings in a form a spreadsheet opens.

---

### Edge Cases

* A quizzer appears on two teams in one division (a name shared by two people, or a move between
  teams): they are two entries, one per team; nothing is combined across teams.
* The same quizzer name appears in two divisions: separate entries, ranked separately.
* A team plays its prelims in the main bracket and its eliminations in consolation: its quizzers are
  in the consolation list, with the prelims counted.
* A division has no consolation bracket: one individual list.
* A team's name differs in case or spacing between quizzes: one team, as today. A quizzer's name is
  treated the same way within a team.
* An official opens a quiz from the schedule and then types over its quiz number: it arrives linked
  with a name that differs, is flagged as in error and does not count until the name is corrected or
  an admin accepts it.
* A quiz scored without the schedule has the right name and one team spelt differently from the
  schedule's: it is not linked automatically; correcting the team name links it, or it is linked by
  hand.
* A quiz is linked by hand to a scheduled quiz with a different name: it behaves as any linked quiz
  whose name differs, in error until renamed or accepted.
* An elimination quiz is opened from the schedule before its teams are known, and submitted with a
  team name left blank: it arrives linked, and where the meet has rosters the unnamed team is a
  roster error until the admin names it or accepts the quiz.
* A quiz file saved in a room is uploaded later: it carries no link, and is linked to the scheduled
  quiz of its name.
* A quiz is given the Finals stage by mistake: it leaves the individual stats; changing the stage
  puts it back.
* Two quizzes in one division are both marked as Finals of the same bracket: a warning names them,
  and no medallists are shown for that bracket until one is changed.
* A Finals ends level after its overtime, or isn't complete: no medallists are shown, and admins are
  told the Finals isn't decided.
* A quiz with a stage is edited and the new revision has errors: it drops out with a warning until
  corrected or accepted.
* A team sat a quiz with four quizzers listed where another quiz lists five: the fifth is listed in
  fewer quizzes than the team played and is flagged; the average rule doesn't change.
* A quiz has no question types recorded: its quizzers' type counts are incomplete and flagged; no
  other figure is affected.
* A quiz read from the old spreadsheet scoresheet: on a question from 16 on, a type may be recorded
  against the wrong part of the question, so type counts from such quizzes are a best guess.
* A division's name is spelt differently in some quizzes: its own group, as today, in every table.
* A quiz was scored on a device set to the other way of scoring level teams: the tables use the
  meet's way, and the quiz carries a note that its own scoresheet shows different placement points,
  with a way to set the quiz itself to the meet's way.
* A prelim is corrected after the division's stats break was confirmed and its eliminations have
  begun: the standings show the new figures and say that the order differs from the confirmed one,
  which stays as it was.
* The admin confirms a stats break by mistake, before any later quiz: it is taken back, and
  confirming again records the order afresh.
* A stats break has to be redone after eliminations began: the admin is warned which quizzes were
  seated from the order being withdrawn, confirms, and those quizzes are flagged until each is kept
  or set to not counted.
* A confirmation is taken back after viewers saw the confirmed standings: they see what the settings
  give for a division at the earlier step, a live preview or nothing, until it is confirmed again.
* A counted quiz a viewer has seen is edited and now has errors: the viewer sees it as under review,
  without scores, until it is corrected or accepted.
* A tie-break or level-teams setting is changed after a division's prelim order or re-rank was
  confirmed: the standings follow the new setting and are shown as differing from the confirmed
  order, which stays as it was; nothing already played changes.
* A viewer has the page open when the admin hides a table: on the next load it is gone.
* A meet moves back from done to review: quizzer standings, locked in only because the meet was
  done, are a preview again; confirmed prelim standings and re-ranks stay locked in.
* Teams in a division have played different numbers of prelims: the warning shown today, and
  quizzers' averages divide by their own team's count.
* A quizzer is on the scoresheet under a nickname the roster doesn't have: a roster error, so the
  quiz adds nothing until the roster name is picked in the quiz, the roster is corrected, or the
  quiz is accepted, in which case they count under the typed name.
* A team is on a scoresheet but not among its division's teams: a roster error the same way.
* A rostered quizzer sits a quiz out: a roster error on that quiz, passed by accepting it; in a meet
  with no roster it is only the quiz-count flag.
* A quizzer's average is negative: shown as it is.
* Two quizzers' averages differ only beyond the second decimal: they show the same average and hold
  different places.

## Requirements _(mandatory)_

### Functional Requirements

**Individual stats**

* **FR-001**: For each quiz that counts for individuals, each listed quizzer MUST get points, errors
  and jumps as the rulebook's individual points define them: 20 for each correct answer, 10 for
  quizzing out without an error, 10 off for a second and for a third error, 10 off for a third foul,
  and nothing for bonus questions or for anything in overtime. Errors are those made outside
  overtime, whether or not they cost points. Jumps are correct answers plus errors, outside
  overtime, bonus answers excluded.
* **FR-002**: A quizzer MUST be identified within a meet by their name and team within a division,
  names compared ignoring letter case and surrounding and repeated spaces, shown under the most-used
  spelling. The same name on another team or in another division is another quizzer.
* **FR-002a**: Where the meet has teams and rosters set up, each team and quizzer name in a stored
  quiz MUST be matched to the teams of the quiz's division and to that team's roster. A team name
  matches a team by its full name or its short name, compared ignoring case, spacing and
  punctuation; a quizzer name is compared as FR-002 says. A team or quizzer that matches is that
  roster entry and MUST be shown under the roster's name, so a team written by its short name in one
  quiz and its full name in another is one team. A quiz has a roster error, and is in error
  (FR-014), when: a team or quizzer name matches nothing, a team name left blank, a team of another
  division and the names older scoresheets wrote into an unnamed seat ("Team 1", "Quizzer 1")
  included; a team lists more quizzers than its roster has; or a quizzer of the team's roster is
  missing from the quiz. Each MUST say what doesn't agree and offer the fixes: change the name in
  the quiz to one from the roster, correct the roster, or accept the quiz as scored (FR-015), which
  is how a quiz a rostered quizzer sat out is passed. Roster errors follow the roster as it now
  stands, so correcting the roster clears them. A seat with no name and no answers is nobody, and a
  team with no name and no quizzer named is the empty seat of a two-team quiz: no error, and not
  counted against the schedule's teams. A meet with no roster has no roster errors and uses typed
  names alone.
* **FR-003**: Quizzer standings MUST give each quizzer's total points, errors and jumps over the
  quizzes that count for individuals, the number of those quizzes their team played, and their
  average: total points divided by that number.
* **FR-004**: Quizzer standings MUST rank quizzers by highest average, compared on its exact value
  and shown to two decimals, then fewest errors. Quizzers level on both MUST share a place, and the
  next place MUST be skipped.
* **FR-005**: Quizzer standings MUST flag a quizzer listed in fewer or more quizzes than their team
  played, giving both counts, and MUST NOT change the average because of it.
* **FR-006**: Quizzers of teams that played any quiz in a division's consolation bracket MUST be
  listed and ranked apart from the division's other quizzers, over every quiz their team played that
  counts for individuals.
* **FR-007**: For each quizzer, correct answers MUST be counted by question type from the types
  recorded in each quiz, correct answers only, and a quizzer whose type counts don't add up to their
  correct answers MUST be flagged as incomplete.

**Stages**

* **FR-008**: Every stored quiz MUST have one stage: prelim, intermediate, elimination, Finals, or
  not counted. Prelims count for prelim standings. Prelims and a team's intermediate count for the
  re-rank. Prelims, intermediates and eliminations count for individuals. A Finals counts only for
  the division's first three.
* **FR-009**: A stored quiz MAY be linked to one quiz in the meet's published schedule. The link and
  the quiz's name (division, consolation and quiz number) are separate. A quiz that is linked to a
  scheduled quiz in the scoresheet when submitted, however the sheet came to be linked, MUST arrive
  linked to that scheduled quiz: the scoresheet sends which scheduled quiz it is linked to with the
  submission, and nothing when it is unlinked, and MUST NOT write it into the quiz file, so a quiz
  uploaded as a file arrives unlinked. Any other stored quiz MUST be linked by its name to the
  scheduled quiz of that name, whenever and however it was stored, and so follows its name when the
  name changes; a quiz the schedule has no name for is linked to none. An official of its room, or
  an admin, MAY link it by hand to another scheduled quiz, or unlink it. A link can be changed or
  removed the same way, and each change MUST be recorded with who made it and when. A link made or
  removed by hand is kept: neither its name nor a later submission naming another scheduled quiz
  changes it. A link the sheet sent holds while its scheduled quiz is in the schedule; when a new
  schedule drops it, the quiz is linked by its name again.
* **FR-009a**: A linked quiz MUST take its stage from the scheduled quiz, the deciding quiz of a
  bracket being its Finals, and, when it has no errors, MUST count without an admin's action. A
  linked quiz whose name differs from the scheduled quiz's, or whose teams differ from those the
  schedule gives that quiz, is in error (FR-014). In a meet with a published schedule, a quiz linked
  to none of its quizzes is in error (FR-014); it counts only with a stage from an admin and once
  accepted. A division or quiz number left blank, or written as `_` as the scoresheet shows a blank,
  is none.
* **FR-010**: Meet admins MUST be able to set any stored quiz's stage, one quiz at a time or for the
  quizzes shown together. An admin's choice MUST outrank the schedule's. Each change MUST be
  recorded with who made it and when. Quizzes counted before this feature MUST become prelims.
* **FR-011**: Prelim standings MUST keep ranking a division's teams over its prelims as they do
  today, with the existing warnings. The top three MUST be marked as finalists only in a division
  whose prelims lead straight to its Finals, with no intermediate or elimination quiz scheduled or
  stored; in any other division the prelim order is a seeding for the next quizzes and no team is
  marked.
* **FR-012**: Where teams played an intermediate, the standings MUST show a re-ranked order of those
  teams by prelim placement points plus the intermediate's placement points, ties broken as the
  meet's setting says.
* **FR-013**: A division's Finals MUST give its first, second and third from the places in that
  quiz. Where a bracket has no single decided Finals, no medallists are shown for it, and admins are
  told why.

**Quizzes with errors**

* **FR-014**: A quiz with a stage that is in error MUST add nothing to any table until accepted, and
  a warning MUST name it and say what is wrong. A quiz is in error when it has any of three kinds of
  problem:
  * a **scoring error**, known from the quiz alone: a validation error or an unanswered question.
    Every one MUST be listed with its team, seat, question and message, as the scoresheet lists
    them;
  * a **roster error**, known by holding its names against the meet's roster (FR-002a);
  * a **schedule error**, known by holding it against the scheduled quiz it is linked to: its name
    or its teams differ from the scheduled quiz's (FR-009a); or, in a meet with a published
    schedule, it is linked to none of its quizzes. On an unlinked quiz the same differences are not
    an error; they are why it did not link itself (FR-009). A quiz whose overtime doesn't fit its
    stage, however it came by the stage, is in error the same way: an elimination or Finals that
    ends level with no overtime, where there must be a winner; or, in a meet whose prelims are
    played without overtime (FR-023d), overtime played in a prelim or an intermediate, where a tie
    stands. An elimination or Finals still level in an overtime not played out is undecided, a
    scoring error.
* **FR-014a**: The scoresheet and the portal MUST compare names with the same rules, kept in one
  place: what counts as a team of the roster, and as a quizzer of it. The portal finds all three
  kinds from the quiz and the meet's roster and schedule alone. The scoresheet shows scoring errors
  as errors and, while linked to a meet, warns of roster and schedule problems; it may warn of more
  than the portal calls an error, and bringing its warnings fully into line with the portal's errors
  is the scoresheet's own work, outside this feature. None stops a submission.
* **FR-015**: Meet admins MUST be able to accept such a quiz, whichever kinds of error it has, one
  quiz at a time or the quizzes shown together. An accepted quiz MUST be placed by its team scores
  as they stand, MUST count as its stage says, and MUST be marked "accepted as scored" wherever it
  is listed, with what the errors are shown only to admins and the quiz's room officials. Admins
  MUST be able to withdraw an acceptance. Both MUST be recorded with who and when.
* **FR-016**: An acceptance MUST apply to the revision accepted. A later revision with errors MUST
  need its own acceptance; a later revision without errors needs none. An acceptance stands for its
  revision whatever roster or schedule errors a later change to the roster or the schedule gives
  that revision: the admin has passed the quiz as it was scored.

**Visibility**

* **FR-017**: Meet admins MUST see every table whenever the meet is live, in review or done.
* **FR-018**: The meet's settings say what viewers may be shown and from which moment. A moment is
  one of: from the start; once the division's prelims are confirmed; once its intermediates are
  confirmed; once its eliminations are in; once its Finals is done; once the meet is in review; once
  the meet is done. A thing cannot be set to show before it exists: a stage's quiz results start no
  earlier than that stage. Nothing MUST be given to a viewer before its moment, in the page or by
  any other route. The things and their settings:
  * **Quiz results, one setting for each stage** (prelims, intermediates, eliminations, Finals): the
    moment they start to show, or never, and how much of each quiz is shown: places only, or places
    and scores. The Finals result with its first three is the quiz results of the Finals stage.
  * **Prelim standings and re-rank**: always shown once the admin has confirmed them, as the
    confirmed order: confirming is what puts the prelim placements into the elimination draw, so
    viewers see the standings when they see the draw they produced. One setting says whether a live
    preview of them is also shown before that, changing as prelims come in ahead of the stats break.
  * **Quizzer standings**: the moment they start to show, or never, and how they update: live, or by
    stage. How they update is offered only where it means something: for a moment before the
    division's eliminations are in. From then on no further quiz counts for quizzers, so there is
    nothing to update.
* **FR-018a**: Quizzer standings that update by stage MUST cover the quizzes up to the last step the
  admin confirmed for the division, and MUST be worked out afresh from those quizzes as they now
  stand, so a correction to one of them shows and a newer quiz does not.
* **FR-018b**: Until an admin chooses otherwise: each stage's quiz results show from the start of
  that stage with places only, except the Finals result, which shows once the Finals is done; prelim
  standings are not shown live; quizzer standings show once the meet is done.
* **FR-019**: Coaches and officials MUST see what viewers see. Officials keep their own rooms'
  quizzes as today. Nobody without access to the meet, and nobody at all while the meet is in
  registration or build, sees any stats but an admin.
* **FR-019a**: A division's state (prelims running, stats break, eliminations running, Finals, done:
  today's four with Finals added as its own state after the eliminations; a division's intermediates
  are played during its stats break; for a division with no eliminations the admin's one action
  takes it from its stats break to Finals) MUST move only when an admin moves it, with a control on
  the meet, forward or back one step. The portal MUST show when a division is ready for its next
  state: for the stats break, every scheduled prelim stored and counting; for eliminations running,
  where the division has intermediates, every scheduled intermediate stored and counting; for
  Finals, every scheduled elimination stored and counting; for done, its Finals stored and counting.
  An admin MAY move a division on while scheduled quizzes are missing or not counting, after a
  warning that names them.
* **FR-019b**: Confirming a division's stats break MUST record its prelim order as confirmed, with
  who confirmed it and when, since that order decides where teams quiz next. Standings keep showing
  current figures; when a later change to a prelim makes the current order differ from the confirmed
  one, the standings MUST say so to admins and show them both, MUST keep showing everyone else the
  confirmed order, and MUST NOT change it. Moving the division back to prelims running withdraws the
  confirmed order. With no intermediate, elimination or Finals quiz of the division stored, that
  needs no more than the usual confirmation. With any stored, the admin MUST first be warned that
  those quizzes were seated from the order being withdrawn and may no longer be valid, with each one
  named, and MUST confirm. Those quizzes MUST stay stored with their stages, and MUST be flagged as
  played under a withdrawn order until an admin keeps each as it is or sets it to not counted.
* **FR-019c**: A division's intermediates MUST end the same way as its prelims. Where a division has
  intermediates, moving it from its stats break to eliminations running confirms the re-ranked
  order, which MUST be recorded with who confirmed it and when. A later change that makes the
  current re-rank differ from the confirmed one MUST be shown to admins as differing, without
  changing the confirmed order. Moving back to the stats break withdraws it under the rules of
  FR-019b: freely while no elimination or Finals quiz of the division is stored, and otherwise past
  a warning that names those quizzes, which are then flagged until kept or set to not counted. No
  division state is added for this.
* **FR-019d**: The meet MUST NOT move to review on its own. When an admin moves the last division
  that was not yet done to done, the portal MUST offer moving the meet to review in the same step,
  and the admin may decline.
* **FR-020**: Standings shown to anyone (prelim standings, the re-rank and quizzer standings) MUST
  say plainly which of three states they are in, in the same words everywhere, so that a preview is
  never mistaken for the actual standings; the settings that choose what viewers see MUST use the
  same words. Quiz results need no such state: a quiz's result is its result, with the marks a quiz
  can carry (under review, accepted as scored). Apart from quizzer standings by stage (FR-018a) and
  the confirmed prelim order and re-rank, which are what the admin confirmed, what is shown MUST
  always be the current figures. The states:
  * **Live preview**: not the actual standings yet; still changing as quizzes come in. Prelim
    standings and the re-rank before they are confirmed; quizzer standings that update live while
    quizzes that count for them are still to come.
  * **Preview**: not the actual standings yet, and not changing with new quizzes, though a
    correction can still change them. Quizzer standings by stage, or once nothing more counts for
    them, at any time before the meet is done.
  * **Locked in**: the actual standings; will not change. Prelim standings and the re-rank once the
    admin has confirmed them, since they are in the elimination draw. Quizzer standings only once
    the meet is done: whatever is shown of them before that is a preview.
* **FR-020a**: Warnings and flags (a quizzer's quiz count, incomplete question types, unequal prelim
  counts, look-alike names, an order differing from the confirmed one, an undecided Finals and the
  rest) MUST be shown in full to meet admins only. An official MUST see those about a quiz of their
  own rooms, on that quiz: its errors of all three kinds (FR-014), that it has no stage or link, its
  incomplete question types, and that it was played under a withdrawn order; they do not see
  warnings about standings or about other rooms' quizzes. Anyone else MUST see the tables without
  warnings, with only these marks: on standings, their state (live preview, preview or locked in,
  FR-020), and on a quiz, under review or accepted as scored.
* **FR-021**: The quiz results a viewer is shown MUST list the quizzes that count, each with its
  teams and places, and its scores where the stage's setting says so, and the quizzes with a stage
  whose errors are not accepted, each as under review with its teams and nothing else. A quiz that
  is not counted MUST NOT be listed. The list MUST NOT include the full scoresheet with every
  quizzer's answers, which stays with admins and the quiz's room officials. How much of a quiz a
  viewer sees MUST be decided in one place, with the full scoresheet left as a third level a meet
  could later choose.

**Settings**

* **FR-022**: Each meet MUST have stats settings an admin can change while the meet is not done: the
  team tie-break order, how teams level in a quiz are given placement points, whether prelims are
  played without overtime, and what viewers see and when (FR-018). A change MUST take effect when it
  is saved (FR-023c) and MUST be recorded with who made it and when. A change MUST NOT alter a
  confirmed prelim order or re-rank; where the current order then differs from a confirmed one, that
  is shown as FR-019b and FR-019c say.
* **FR-023**: The tie-break order MUST be one of: head-to-head, then total points, then fewest
  errors (the rulebook's, and the default); or total points, then fewest errors. Standings and
  re-ranks MUST follow it, and each broken tie MUST name the criterion that decided it.
* **FR-023a**: A quiz with no overtime, as prelims are played, can end with teams level, and there
  are two ways to give them placement points: each level team gets the points of the place they
  share (the rulebook formula, and the default), or level teams get the reduced points the older
  formula gives a shared place. The meet's setting MUST decide which is used in every table, for
  every quiz, whatever way the quiz file itself carries. Switching the setting MUST change no stored
  quiz.
* **FR-023b**: A stored quiz whose own way differs from the meet's MUST carry a note saying so,
  since its scoresheet shows different placement points from the tables; the note is information,
  not something that keeps the quiz out. Meet admins MUST be able to set the differing quizzes
  themselves to the meet's way in one action, each getting a history entry and keeping any
  acceptance it had. A scoresheet working with the meet, linked to it or opening a quiz from it,
  MUST score level teams the meet's way.
* **FR-023d**: The meet's settings MUST say whether its prelims and intermediates are played without
  overtime, a tie standing and the level teams sharing the place. It is on unless an admin turns it
  off, since these meets are run that way; off is the rulebook, under which every tied quiz goes to
  overtime and overtime in a prelim is no error. Changing it changes no stored quiz.
* **FR-023c**: The stats settings MUST be one place holding two things. First, each division's
  progress as a row of its steps (prelims, intermediates or stats break, eliminations, Finals,
  finished), with the step it is in marked, whether it is ready for the next, and the control to
  confirm the next step or take the last one back (FR-019a). Second, what viewers see, one line for
  each thing in plain words (what it is, from when, how much), offering only the choices that make
  sense for that thing, and beside each line what each division's viewers have of it right now.
  Changes to what viewers see MUST take effect when saved, and before saving the admin MUST be told
  what viewers will newly see and what they will stop seeing at that moment. The admin MUST be able
  to look at a division's page as a viewer sees it.

**The stats page**

* **FR-024**: Each division MUST have a stats page showing, as far as the reader may see them, the
  Finals result, prelim standings with any re-rank, quizzer standings with the consolation list
  apart, and the division's quizzes. It does not give teams a final placing after eliminations
  beyond the Finals' first three.
* **FR-025**: The stats page MUST be readable on a phone without sideways scrolling for each table's
  place, name and ranking figure, and MUST print one division per sheet in the form of the
  statistician's report: places, teams, quizzers, averages, errors, jumps, and the number of
  quizzers in the division.
* **FR-026**: The printed individual list MUST leave off quizzers with no jumps, while counting them
  in the number of quizzers and in the places. On screen every quizzer is listed.
* **FR-027**: Anyone who may see a table MUST be able to open a team or a quizzer in it and see the
  quizzes behind their totals: for a quizzer, points, errors, jumps and correct answers by type per
  quiz; for a team, stage, place, score, placement points and errors per quiz.
* **FR-028**: Meet admins MUST be able to download a division's stats as a file a spreadsheet opens:
  a row per team per quiz, a row per quizzer per quiz, and the standings.

**Managing results**

* **FR-029**: Managing stored quizzes MUST be its own page, apart from the stats, keeping every
  action the results page has today. Its list MUST be narrowable by division, stage and whether a
  quiz needs attention.
* **FR-030**: The page MUST list what needs attention, each item saying what is wrong, naming the
  quiz, team or quizzer, and leading to the action that fixes it: a quiz with no stage or link; a
  quiz in error that isn't accepted, with its scoring, roster and schedule errors; teams with
  different numbers of prelims; team names that look alike; quizzer names on one team that look
  alike; a quizzer listed in a different number of quizzes from their team; incomplete question
  types; two Finals for one bracket; a quiz played under a withdrawn prelim order.
* **FR-031**: Meet admins MUST be able to merge one quizzer name into another across a team's
  quizzes in one action, each changed quiz getting a history entry, as team names are merged today.
* **FR-032**: Meet admins MUST be able to dismiss a look-alike flag for two names that are different
  teams or quizzers, and a dismissed flag MUST NOT come back for those two names.

### Key Entities

* **Stored quiz**: as today, with a stage in place of counted or not, and whether its current
  revision was accepted as scored.
* **Schedule link**: which scheduled quiz a stored quiz is linked to, if any, apart from the quiz's
  name; how it was made (sent by the scoresheet, by hand, or by its name, which is worked out and
  not recorded), by whom and when.
* **Stage record**: who set a stored quiz's stage, to what, and when; a stage taken from the
  schedule is recorded as such.
* **Acceptance record**: who accepted or withdrew acceptance of which revision of a stored quiz, and
  when.
* **Roster match**: derived: whether each team and quizzer in a stored quiz matches the meet's teams
  and rosters, where the meet has them.
* **Quizzer line**: derived from the stored quiz, never entered or edited: one quizzer in one quiz,
  with points, errors, jumps and correct answers by question type.
* **Quizzer standings**: derived: per division and per consolation bracket, each quizzer's totals,
  quizzes, average, place and flags.
* **Prelim standings and re-rank**: derived, as today, with the meet's tie-break order.
* **Confirmed prelim order**: per division, the team order at the moment its stats break was
  confirmed, with who confirmed it and when.
* **Confirmed re-rank**: per division with intermediates, the re-ranked order at the moment the
  admin confirmed it, with who and when.
* **Stats settings**: per meet: the tie-break order; how level teams in a quiz are given placement
  points; whether prelims are played without overtime; for each stage's quiz results, from when and
  how much; whether prelim standings show live; for quizzer standings, from when and whether live or
  by stage; and who last changed each and when.
* **Dismissed look-alike**: two names in a division, or on a team, that an admin has said are
  different.

## Success Criteria _(mandatory)_

### Measurable Outcomes

* **SC-001**: For the reference meet, every quizzer's points, errors, jumps and correct answers by
  type in every quiz, and every quizzer's average and place, agree with the statistician's workbook.
* **SC-002**: For the reference meet, with its tie-break order set and its two prelims with slips
  accepted, every team's prelim rank and the re-ranked order after the intermediates agree with the
  workbook and with the seeding the meet used.
* **SC-003**: Within one minute of a division's last quiz arriving, the admin can show its team and
  quizzer standings to viewers without typing any quiz in again.
* **SC-004**: A printed division page can be handed out in place of the statistician's report: it
  carries the same places, names and figures.
* **SC-005**: No viewer, coach or official can obtain a table before the point the admin set for it.
* **SC-006**: Any total on the stats page can be traced to the quizzes behind it in two steps or
  fewer.
* **SC-007**: Everything that keeps a stored quiz out of the tables is named in one list, and each
  item can be cleared from there.
* **SC-008**: A reader on a phone finds a named quizzer's place in a division of 50 quizzers in
  under 30 seconds.

## Assumptions

* The practice meet results feature is the base: stored quizzes, revisions, restoring, the counted
  record, prelim standings, their warnings and the team-name list all stay. A stage replaces the
  counted toggle and keeps its history.
* Meet phases (with review) and division states exist; this feature adds the Finals state to a
  division's states. This feature is the first thing that depends on a division's state, and gives
  the admin the control to move it (FR-019a).
* The schedule already names the result each of its quizzes expects, and names the teams of a quiz
  once they are known. A quiz for which the schedule doesn't yet name teams is matched on its name
  alone. Filling elimination seats from results stays separate work; this feature gives it the
  prelim ranking and the re-rank to read.
* One consolation bracket per division is enough for the lists, since a division's consolation
  quizzes share one name space today. Nothing here should assume a bracket is only ever main or
  consolation.
* Deciding level teams' placement points by the meet's setting replaces the practice meet results
  rule that each quiz's placement points are those the quiz itself scores. That specification is
  amended when this is built.
* An accepted quiz's places come from its scores as they stand; nobody edits places by hand.
* Every figure is worked out from the stored quizzes, so an edit, a restore or a changed setting can
  never leave a stale number. What scoring makes of one saved revision may be kept beside it, since
  a revision never changes; nothing that a setting or a later decision affects is kept.
* The reference meet's sheets, workbook and reports hold real quizzers' names. They stay outside the
  repository. Any test data derived from them uses made-up names, and no issue, document or commit
  names a quizzer.
* Dividing by the team's quizzes, ranking averages by fewest errors, sharing places, leaving
  quizzers with no jumps off the printed list, and the second tie-break order are not in the
  rulebook. They are documented with the other rules not in the rulebook, and the access design is
  amended for what viewers, coaches and officials see.
* Viewers reach the stats with the meet's viewer code, signed in or as a guest, as they reach the
  schedule today.
* Every team's final placing after eliminations, which the printed report lists, is left for later.
  Working it out needs each elimination quiz's teams resolved from results, which is separate work,
  and a rule for ordering teams that went out before the Finals, which neither the rulebook nor the
  schedule states.
* Out of scope: the mass results importer; score-only results, which would count for nothing in
  individual stats; yearly averages and anything across meets, which need quizzer identity and
  grade; filling elimination seats from results; disputes; two-team quizzes; a championship series
  beyond one Finals per bracket; and stats for a meet with no stored quizzes.
