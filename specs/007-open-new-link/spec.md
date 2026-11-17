# Feature Specification: New, Open and Link on the scoresheet

**Feature Branch**: `feat/open-new-link`

**Created**: 2026-11-14

**Status**: Draft

**Input**: User description: "Separate New, Open and Link on the scoresheet. New clears everything,
and New from schedule starts a blank quiz linked to a scheduled quiz with its division, number and
decided teams filled in. Open replaces the sheet with a saved quiz: from a file, from the schedule
(that quiz's latest stored version) or from the meet (any stored quiz). Link attaches a meet or a
scheduled quiz to the quiz on the sheet at any time and overwrites nothing: it may fill what is
empty, never typed text. While linked to a scheduled quiz, warn where the quiz on the sheet differs
from it. Today's 'Load from schedule' does half of each."

## Context

A scoresheet can stand alone, or be tied to a meet in two ways: to the meet itself, which gives it
the meet's teams, rosters and divisions to pick from and be checked against (`docs/meet-link.md`),
and to one quiz of the meet's published schedule, which says which quiz this is.

Three different things an official wants are tangled together today:

* **Starting a quiz.** "New" gives a blank quiz. To start the quiz the schedule says is next, the
  official uses "Load from schedule", which is not a new quiz: it keeps whatever is scored on the
  sheet, replaces the teams, and keeps or drops typed quizzers depending on whether they fit the new
  roster.
* **Getting a saved quiz back.** "Open" reads a file from the device. A quiz already sent to the
  meet can be opened only by following a link from the portal; the scoresheet has no way to list the
  meet's stored quizzes.
* **Tying the quiz on the sheet to the meet.** "Load teams from meet" links a meet. A scheduled quiz
  can be linked only by loading it, which changes the sheet. The sheet remembers which scheduled
  quiz was loaded and then does nothing with it: a quiz scored under the wrong number, or with
  another quiz's teams, gets no warning.

The result is that one menu item can either keep or destroy an official's work depending on what was
on the sheet, that a quiz scored before anyone linked it can't be tied to its place in the schedule
without being disturbed, and that the schedule, which knows what the quiz should be, is never
compared with it.

Two rules this feature is built on, both set by the maintainer:

* **Linking overwrites nothing.** Linking ties what is on the sheet to the meet: it picks the roster
  teams the typed names name, fills what is blank, and warns where the two disagree. It never
  changes anything typed or scored. Only New and Open replace what is on the sheet, and they say so
  first.
* **Errors and warnings** (`docs/meet-link.md`). An error is wrong whatever the meet. A warning is
  only known by comparing the quiz with a linked meet, so it exists only while linked. Neither stops
  a quiz being sent.

A **pick** is the tie between a team slot and a roster team, with its seats tied to that team's
quizzers. Picks are not part of the quiz: they are never saved in a file or sent, and they can
always be made again from the names. So making, keeping or remaking picks changes nothing the
official typed.

## Clarifications

### Session 2026-11-14

* Q: When the sheet has the right teams in other slots than the schedule's, what should the one-step
  fix on that warning do? → A: Move the whole team (name, quizzers, answers) to the slot the
  schedule gives it, swapping with the team there. A plain replacement of the slot's team is used
  only when the scheduled team isn't on the sheet at all. The maintainer wants a clear interface for
  the move; its design is for the plan.
* Q: What should happen when the official chooses New from schedule for a quiz the meet already has
  a stored result for? → A: Say that the quiz already has a stored result and offer to open the
  stored one, start a new one anyway, or cancel.
* Q: Which version of a stored quiz opens when it has several? → A: The current one, the version
  that counts. An earlier version can be opened too, by choice from the same place: a way to do it,
  not a question asked each time.
* Q: After a quiz is linked to a scheduled quiz, when should the sheet check the schedule again? →
  A: When linking, on reload, when the official asks, and once just before the submit question is
  built. Not on a timer, and not when names are edited: warnings are worked out again at once from
  the copy the sheet holds, as they are today. A check only updates warnings; it never changes the
  sheet.
* Q: Besides updating warnings, what should the refresh symbol do? → A: The same as linking again.
  Refreshing is relinking what is already linked, with a fresh copy from the meet: it picks unpicked
  slots whose names now name a roster team and fills what is blank, as any link does, and changes
  nothing typed or scored. The fetches the sheet makes by itself (on reload, before the submit
  question) refresh the copy and the warnings only (superseded in part by the next answer but one:
  they make no picks).
* Q: What happens to the links when a file is opened, and which picks may the sheet make without
  being asked? → A: Opening a file unlinks: the sheet is tied to no meet and no scheduled quiz,
  shows the file as saved, and asks the server nothing. The official links it if they want it held
  against a meet. The sheet makes no pick without being asked: picks and filling come from linking,
  the refresh symbol, or the official's hand. The fetches the sheet makes by itself only bring the
  warnings up to date.
* Q: What can the official do while an action is waiting on the meet? → A: Only cancel it. The sheet
  shows it is waiting and takes no other input until the action finishes or is cancelled, so a slow
  answer can never land on a quiz started meanwhile. The reload fetch is the exception: it runs in
  the background and never holds up scoring.
* Q: (analysis) One blank slot raised both a roster and a schedule warning; consolation was filled
  but never warned about; "undoable" covered boxes with no undo; two success criteria counted
  clicks. → A: One warning per blank slot, the schedule's; consolation is warned and fixed with the
  division; undo is required for team moves and replacements only, with undo for the division and
  number boxes a possible later change; the click counts are dropped.
* Q: Which quiz format does New from schedule start? → A: The schedule should say, and doesn't yet:
  a known gap. Until it does, New from schedule starts a 20-question quiz.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Start the scheduled quiz from a clean sheet (Priority: P1)

An official is about to score the next quiz in their room. They choose New, pick the quiz from the
meet's schedule, and get an empty sheet that already knows which quiz it is: the division and quiz
number are filled in, and so are the teams the schedule has decided for it, each picked from the
roster with its quizzers seated. A seat the schedule hasn't decided yet (an elimination seat still
waiting on earlier results) comes up blank.

**Why this priority**: it is the path every scheduled quiz takes, and the one where today's
behaviour can carry the last quiz's scores into the next one.

**Independent Test**: with a quiz scored on the sheet, choose New from schedule and pick another
quiz; the sheet shows no answers, the picked quiz's division, number and decided teams, and nothing
of the previous quiz.

**Acceptance Scenarios**:

1. **Given** a sheet with answers and names, **When** the official chooses New from schedule, picks
   a quiz and confirms, **Then** every answer, name, timeout and no-jump mark from the old quiz is
   gone, and the sheet is linked to the picked quiz and its meet.
2. **Given** a scheduled quiz whose three teams are decided, **When** it is started from the
   schedule, **Then** the division and quiz number are the schedule's, each team is picked from the
   roster under its roster name, and each team's rostered quizzers are seated.
3. **Given** a scheduled quiz with a seat not yet decided, **When** it is started from the schedule,
   **Then** that team slot is blank and unpicked, and the decided ones are filled.
4. **Given** a sheet with unsaved changes, **When** the official chooses any New and declines the
   confirmation, **Then** the sheet, its picks and its links are exactly as they were.
5. **Given** a link from the portal's schedule to a quiz, **When** the official follows it, **Then**
   it behaves as New from schedule for that quiz, with the same confirmation.
6. **Given** a scheduled quiz the meet already has a stored result for, **When** the official
   chooses it under New from schedule, **Then** they are told a result is stored and offered to open
   it, start a new quiz anyway, or cancel, and cancelling leaves the sheet as it was.
7. **Given** a sheet linked to a meet, **When** the official chooses a plain New (20 or 15
   questions), **Then** the sheet is blank and still linked to the meet, and linked to no scheduled
   quiz.

---

### User Story 2 - Link a quiz already on the sheet without disturbing it (Priority: P2)

An official started scoring before linking anything: the room had no connection, or they typed the
teams in from a paper draw. Later they link the meet, or the scheduled quiz this is, so the quiz
arrives at the meet as the right one. Nothing they typed or scored changes. Teams whose typed names
are on the roster become picked, blanks the schedule can fill are filled, and anything that
disagrees is left as typed.

**Why this priority**: it makes the offline-first path whole. Without it the only way to tie a quiz
to the schedule is to load over it.

**Independent Test**: score part of a quiz with typed names unlinked, link the scheduled quiz, and
compare the sheet before and after: every answer and every typed name is unchanged, blanks the
schedule could fill are filled, teams named as the roster names them are picked, and the sheet says
which quiz it is linked to.

**Acceptance Scenarios**:

1. **Given** a sheet with answers, typed team names and typed quizzer names, **When** the official
   links a meet or a scheduled quiz, **Then** no answer, team name or quizzer name changes.
2. **Given** a slot whose typed name names a roster team that the scheduled quiz does not seat,
   **When** the official links that scheduled quiz, **Then** the slot is picked as the team typed,
   its quizzers are held against that team's roster, and the difference from the schedule is a
   warning (User Story 3).
3. **Given** a slot whose typed name names a roster team of the quiz's division, **When** the
   official links the meet or a scheduled quiz, **Then** that team is picked for the slot, the name
   stays as typed, and blank seats take the team's quizzers.
4. **Given** a sheet with a blank division, a blank quiz number and a blank team slot, **When** the
   official links a scheduled quiz, **Then** the division and number take the schedule's values and
   the blank slot takes the team the schedule seats in that slot, picked from the roster.
5. **Given** a slot already picked, **When** a meet or scheduled quiz of the same meet is linked,
   **Then** the pick and its seated quizzers stay as they are.
6. **Given** a sheet linked to one meet, **When** the official links another meet or a scheduled
   quiz of another meet, **Then** the names stay as typed and the picks are made again against the
   new meet's roster, as for any quiz being linked.
7. **Given** a sheet linked to a scheduled quiz, **When** the official unlinks the quiz, **Then**
   the sheet's contents, its picks and its link to the meet are unchanged, and it is tied to no
   scheduled quiz.
8. **Given** a sheet linked to a meet and a scheduled quiz, **When** the official unlinks the meet,
   **Then** the scheduled quiz is unlinked with it, and names, answers, division and number stay as
   typed.
9. **Given** a sheet linked to no meet, **When** the official links a scheduled quiz, **Then** the
   sheet is linked to that quiz's meet as well.
10. **Given** a sheet linked to a scheduled quiz, **When** the official looks at the sheet, **Then**
    it shows which scheduled quiz it is linked to, and that stays true after the page is reloaded.

---

### User Story 3 - See where the quiz differs from the schedule (Priority: P3)

An official linked to a scheduled quiz has the wrong quiz number typed, or one of the teams in the
room isn't the one the schedule put there. The sheet warns, in the same list as its other warnings,
and asks about it once before the quiz is sent. The official can take the schedule's value in one
step or leave what the room typed, since the schedule may be the thing that is wrong.

**Why this priority**: it is what makes the link worth having in the room. It follows Link because
there is nothing to compare until a quiz can be linked without changing it.

**Independent Test**: link a scheduled quiz to a sheet whose quiz number and one team differ from
it; the warning count shows both, each names the schedule's value, taking the schedule's value
clears its warning, and submitting asks about whatever is left.

**Acceptance Scenarios**:

1. **Given** a sheet linked to a scheduled quiz, **When** its division or quiz number differs from
   the schedule's, **Then** a warning says so and names the schedule's value.
2. **Given** a sheet linked to a scheduled quiz, **When** a slot's team is not the one the schedule
   seats in that slot, **Then** a warning names the slot, its team and the schedule's team, as in
   "Team 2: Lions 1, schedule has Tigers 2". The right three teams in another order than the
   schedule's warn for each slot that differs.
3. **Given** a warning that the sheet differs from the schedule, **When** the official chooses to
   take the schedule's value, **Then** that value replaces the one on the sheet, a replaced team is
   picked from the roster, and the warning is gone.
4. **Given** a scored quiz whose first and second teams are each other's scheduled teams, **When**
   the official takes the schedule's team for either slot, **Then** the two teams change places with
   their names, quizzers and answers, every team's score is what it was, and both warnings are gone.
5. **Given** a scheduled quiz with a seat not yet decided, **When** it is linked, **Then** no
   warning is raised for that seat, whatever team is on the sheet.
6. **Given** a sheet with schedule warnings, **When** the official submits, **Then** the warnings
   are listed with the other warnings and scoring errors in the one question, and the quiz is sent
   as typed if they confirm.
7. **Given** a sheet linked to a meet and to no scheduled quiz, **When** the official looks at the
   warnings, **Then** none concern the schedule.
8. **Given** a sheet linked to a scheduled quiz the published schedule no longer has, **When** the
   official looks at the warnings, **Then** one says so, and the quiz can be unlinked or linked to
   another.

---

### User Story 4 - Open a quiz the meet already has (Priority: P4)

An official needs to correct a quiz they sent earlier, on a device that no longer has it, or an
admin needs to look at any quiz of the meet on the sheet. They choose Open, pick the quiz from the
meet's stored quizzes or from the schedule, and the sheet shows it as it was last sent, tied to the
meet the way it would be had they opened it from a file and then linked it.

**Why this priority**: corrections are less frequent than scoring, and a route exists today through
the portal. Bringing it into the scoresheet removes a round trip but unblocks nothing new.

**Independent Test**: send a quiz to a meet, start a new quiz, then choose Open from the meet and
pick the sent quiz; the sheet shows the sent quiz's names and answers, with its teams picked from
the roster where their names are on it.

**Acceptance Scenarios**:

1. **Given** an official of a room with stored quizzes, **When** they choose Open from the meet,
   **Then** they are offered the stored quizzes they may see, each by its quiz name, and picking one
   replaces the sheet with its current version.
2. **Given** a quiz opened from the meet, **When** it appears, **Then** the sheet is linked to that
   meet exactly as if the quiz had been opened from a file and the meet then linked: names as saved,
   and each team whose name is on the roster picked.
3. **Given** a scheduled quiz that has a stored version, **When** the official chooses Open from the
   schedule and picks it, **Then** the sheet shows its current version, linked to that scheduled
   quiz exactly as if it had been opened from a file and the scheduled quiz then linked.
4. **Given** a scheduled quiz with nothing stored, **When** the official picks it under Open from
   the schedule, **Then** they are told nothing is stored for it and offered to start it as a new
   quiz instead.
5. **Given** a sheet with unsaved changes, **When** the official chooses any Open and declines the
   confirmation, **Then** the sheet, its picks and its links are exactly as they were.
6. **Given** a sheet linked to a meet and a scheduled quiz, **When** the official opens a file,
   **Then** the file's names and answers are shown as saved, the sheet is linked to no meet and no
   scheduled quiz, there are no picks and no warnings, and no request is made.
7. **Given** a stored quiz with several versions, **When** the official picks it under Open,
   **Then** its current version opens without a further question, and the same list lets them open
   an earlier version instead.
8. **Given** a link from the portal to a stored quiz's version, **When** the official follows it,
   **Then** it behaves as Open from the meet for that version, with the same confirmation.
9. **Given** someone who may not see the meet's stored quizzes, **When** they choose Open from the
   meet, **Then** they are told so, and the sheet is unchanged.
10. **Given** someone who may not see the meet's stored quizzes, **When** they choose Open from the
    schedule and pick a quiz, **Then** they are offered to start it as a new quiz, as when nothing
    is stored.

---

### Edge Cases

* The device is offline. New (plain), Open from file, unlinking, scoring and saving all work. New
  from schedule, Open from the meet or schedule, and linking say the meet can't be reached and leave
  the sheet untouched. Warnings already shown stay, from what was last fetched.
* One team's roster can't be fetched while linking. The link goes ahead without it: that slot is
  left unpicked, or keeps the pick it had, and shows its roster warning. The refresh symbol tries
  again.
* The meet answers slowly. For an action the official asked for, the sheet waits and offers only
  Cancel, so nothing else can be started over it; cancelling leaves the sheet as it was and the late
  answer is dropped. The reload fetch runs behind scoring instead, and is dropped if another quiz
  has been started or opened by the time it arrives.
* The published schedule changes after a quiz is linked: the linked quiz is renamed, its teams are
  decided, or it is removed. The link stays as made and the warnings follow the schedule as last
  fetched (FR-023 says when); nothing on the sheet changes by itself.
* The official starts a scheduled quiz that has a stored result they may not see (a viewer, or
  another room's quiz). The sheet can't tell and starts the new quiz; sending it meets the existing
  "already submitted" question.
* A seat undecided when the quiz was linked is decided later. Once the sheet has fetched again
  (FR-023) it raises a warning if the slot has another team or is blank. The slot is filled when the
  official refreshes or takes the schedule's value, and only if it is still blank.
* Linking would fill a blank slot with a scheduled team that already sits in another slot. The blank
  stays blank and both slots warn; taking the schedule's value moves the team (FR-021).
* An admin adds a missing team to the roster, or corrects its spelling, during the meet. After a
  refresh the slot bearing that name is picked and its warning is gone, with nothing retyped.
* Two slots bear the same team name, or a typed name is near a roster team's but not it. The
  existing rules of `docs/meet-link.md` decide the pick; this feature adds none.
* Opening a stored quiz whose scheduled quiz can't be told. It opens linked to the meet and to no
  scheduled quiz.
* A scheduled quiz seats two teams (a two-team quiz). The third slot stays blank; whether a blank
  third slot should warn is a question for the two-team work (#143).
* The tutorial is running. New, Open and Link behave as they do now during the tutorial and the
  official's quiz is restored when it ends.

## Requirements _(mandatory)_

### Functional Requirements

**New**

* **FR-001**: New MUST replace everything on the sheet with a blank quiz: no answers, names,
  timeouts, no-jump marks, division or quiz number, and no team picks.
* **FR-002**: The official MUST be able to start a new quiz from a quiz of a meet's published
  schedule. The new quiz MUST be linked to that scheduled quiz and its meet, carry the schedule's
  division and quiz number, and have each team the schedule has decided picked from the roster with
  its quizzers seated. A seat the schedule has not decided MUST be left blank and unpicked. The new
  quiz is a 20-question quiz, since the schedule does not yet say a quiz's format (see Assumptions).
  When the meet already holds a stored result for that quiz that the person may see, the sheet MUST
  say so first and offer three ways on: open the stored quiz (as FR-007), start a new one anyway, or
  cancel.
* **FR-003**: A plain New on a sheet linked to a meet MUST keep the meet link and MUST clear any
  link to a scheduled quiz.
* **FR-004**: Following the portal's link to a scheduled quiz MUST behave as FR-002.

**Open**

* **FR-005**: Open MUST replace the sheet with a saved quiz, from one of three sources: a file on
  the device, a meet's stored quizzes, or the stored version of a quiz picked from the schedule.
* **FR-006**: Open from the meet MUST offer exactly the stored quizzes the person may already see
  under the meet's access rules, and MUST open the current version of the one picked, the version
  that counts.
* **FR-007**: Open from the schedule MUST open the current version of the picked quiz. When nothing
  is stored for it, the sheet MUST say so and offer to start it as a new quiz from the schedule
  instead.
* **FR-008**: Wherever a stored quiz is offered to open, the person MUST be able to open one of its
  earlier versions instead, by choosing it. Opening the current version MUST NOT ask which version.
  An earlier version opens linked exactly as the current one would.
* **FR-009**: A quiz opened from the meet MUST end up exactly as if it had been opened from a file
  and that meet then linked (FR-013 to FR-015). A quiz opened from the schedule MUST end up exactly
  as if it had been opened from a file and that scheduled quiz then linked. A quiz opened from the
  meet whose scheduled quiz is known MUST be linked to it the same way.
* **FR-010**: Opening a file MUST unlink the sheet: no meet, no scheduled quiz, no picks. The file
  is shown as saved and no request is made. The official links it afterwards if they want it held
  against a meet.
* **FR-011**: Following the portal's link to a stored quiz's version MUST behave as Open from the
  meet for that version.

**Link**

* **FR-012**: The official MUST be able to link and unlink a meet, and link and unlink a scheduled
  quiz, at any time, whatever is on the sheet. Linking again what is already linked MUST be
  possible; it is what the refresh symbol does (FR-023).
* **FR-013**: Linking MUST NOT change any answer, timeout or no-jump mark, any name that has been
  typed, or a division or quiz number that has been typed.
* **FR-014**: Linking MUST pick, for each unpicked slot, the roster team its typed name names, by
  the matching rules `docs/meet-link.md` already has, keeping the name as typed. It MUST keep a pick
  already made against the same meet. Linking another meet MUST make the picks again against that
  meet's roster. A slot is picked from what is typed in it and never from the schedule: a scheduled
  quiz's team is not picked for a slot that bears another name, and a slot's quizzers are always
  held against the roster of the team the slot is picked as. The sheet makes no pick without being
  asked: picks come from a link, the refresh symbol, or the official picking by hand.
* **FR-015**: Linking MAY fill only what is blank: a blank division or quiz number from the
  scheduled quiz, a blank and unpicked team slot from the team the scheduled quiz seats in that
  slot, unless that team is already on the sheet in another slot, and blank seats of a picked team
  from its roster. Whether the quiz is a consolation quiz is taken from the scheduled quiz with its
  division. Tidying a typed name to the roster's spelling, where `docs/meet-link.md` already allows
  it, does not count as a change.
* **FR-016**: Linking a scheduled quiz MUST link its meet. Unlinking a meet MUST unlink the
  scheduled quiz. Unlinking a scheduled quiz MUST leave the meet link and the picks. Unlinking
  either MUST leave every name, answer, division and number as it is. Clearing names MUST also
  unpick the teams, since a blank name names no team; both links stay.
* **FR-017**: The sheet MUST show in one place what it is linked to: the meet, as it does today, and
  the scheduled quiz when there is one. The action that refreshes from the meet (FR-023) MUST sit
  beside it. Both links MUST survive a reload and an auto-saved restore.
* **FR-018**: The linked scheduled quiz MUST be available to whatever sends the quiz to the meet, so
  that the submission can name it (see Dependencies).

**Schedule warnings**

* **FR-019**: While linked to a scheduled quiz, the sheet MUST warn when the quiz's division or quiz
  number differs from the schedule's, naming the schedule's value. Whether it is a consolation quiz
  counts as part of its division here: a difference in either is one warning with one fix.
* **FR-020**: While linked to a scheduled quiz, the sheet MUST warn for each team slot whose team is
  not the one the schedule seats in that slot, naming the slot, its team and the schedule's team.
  Slots are compared one by one, first with first, by the same name matching the roster uses. A slot
  left blank where the schedule seats a team warns too, and that line stands in place of the
  roster's "no team picked" line for the slot, so one blank is one warning. A seat the schedule has
  not decided raises nothing.
* **FR-021**: Each schedule warning MUST offer to take the schedule's value in one step, replacing
  the value on the sheet at the official's choice and at no other time. For a team, what is taken
  depends on where the scheduled team is. If it is on the sheet in another slot, the two teams
  change places, each whole team moving with its name, pick, quizzers, answers, timeouts and on-time
  mark, and no score changes. If it is not on the sheet, the slot's team name and pick are replaced;
  quizzer names typed in the slot stay, and are then held against the new team's roster. The offer
  MUST say in words what it will do before it is taken (which team moves to which slot, or which
  team replaces which), and moving or replacing a team MUST be undoable like any other edit. Setting
  the division or quiz number is a plain edit of those boxes, which have no undo today.
* **FR-022**: The sheet MUST warn when the scheduled quiz it is linked to is no longer in the
  published schedule.
* **FR-023**: While linked to a meet, the sheet fetches the roster, divisions and schedule afresh at
  four moments, and at no other: it MUST NOT poll on a timer, and editing a name fetches nothing,
  since warnings follow each edit at once from the copy held.
  * **When a link is made**, as part of it.
  * **When the official asks**, with one action shown as a refresh symbol (the circling arrow)
    beside what the sheet is linked to, with the tooltip and accessible label "Refetch names from
    the meet and schedule". It links again what is already linked, against the fresh copy: FR-014
    and FR-015 apply as for any link, so unpicked slots whose names now name a roster team are
    picked and what is blank is filled, and nothing typed or scored changes.
  * **Before the submit question is built**, once, so the question lists warnings as the meet
    stands. It waits as FR-028 says, and only renews the copy and the warnings: no pick, no fill.
  * **On reload**, behind the sheet, which stays in use. It only renews the copy and the warnings:
    no pick, no fill.

  A fetch that fails for want of a network leaves the last copy, the picks and the warnings in
  place. Only one the official asked for says so.
* **FR-024**: Schedule warnings MUST be warnings as `docs/meet-link.md` defines them: shown and
  counted with the roster warnings, asked about once when the quiz is sent to the linked meet, never
  blocking, and absent when no scheduled quiz is linked.

**All of them**

* **FR-025**: New and Open MUST ask before replacing a sheet with unsaved changes, names typed since
  it was last saved, started or opened among them. Names a link filled in when the quiz was started
  or opened are the quiz's own and don't count. Declining MUST leave the sheet, its picks and both
  links exactly as they were, with nothing that was fetched for the declined action applied.
* **FR-026**: The menus MUST name the actions for what they do, so that no item both keeps and
  replaces parts of the sheet. Today's "Load from schedule" and "Load teams from meet" are replaced
  by New from schedule, Link a scheduled quiz and Link a meet.
* **FR-027**: Every action here that needs the network MUST fail by saying the meet can't be reached
  and leaving the sheet unchanged when the meet, its teams or the schedule can't be fetched. A
  single team's roster that can't be fetched leaves only that slot unpicked (see Edge Cases).
  Scoring, saving, plain New, Open from file and unlinking MUST work with no network.
* **FR-028**: While an action the official started is waiting on the meet (New from schedule, Open
  from the meet or the schedule, a link, the refresh symbol, and submitting while it fetches before
  its question), the sheet MUST show that it is waiting and accept nothing but cancelling it: no
  scoring, no edit and no other action until it finishes or is cancelled. Cancelling MUST be
  possible at once, return the sheet to use exactly as it was, and discard whatever arrives
  afterwards. Opening a file waits on nothing. The fetch on reload MUST NOT hold the sheet up:
  scoring goes on while it runs, and what it brings is discarded if the official has started or
  opened another quiz meanwhile.

### Key Entities

* **Quiz on the sheet**: the names, answers, division and number being scored. Replaced only by New
  and Open, or by the official taking a schedule's value. Its three team slots are ordered, and the
  schedule's seats are compared with them in that order.
* **Meet link**: ties the sheet to a meet, giving it teams, rosters and divisions to pick from and
  be held against. Holds the picks. Already exists.
* **Pick**: the tie between a team slot and a roster team, and between its seats and that team's
  quizzers. Made by linking or by the official; never saved or sent; can always be made again from
  the names.
* **Scheduled quiz link**: ties the sheet to one quiz of a meet's published schedule. Implies the
  meet link. Carries no names of its own: it fills blanks when made, is what the quiz is compared
  with while it lasts, and names the quiz when it is sent.
* **Stored quiz**: a quiz the meet holds, with its versions, one of which is current (the one that
  counts), as defined by the results feature (spec 003). Read here, never changed.

## Success Criteria _(mandatory)_

### Measurable Outcomes

* **SC-001**: An official can go from a finished quiz to the next scheduled quiz, ready to score
  with teams and quizzers in place and no answers carried over, in every case.
* **SC-002**: Linking a meet or a scheduled quiz changes no answer and no typed name on the sheet,
  in every case tested, including a fully scored quiz with names that disagree with the schedule.
* **SC-003**: A quiz linked to a scheduled quiz with a different number, division or team shows a
  warning for each difference before it is sent, in every case tested, and none when it agrees.
* **SC-004**: An official can open a quiz they sent earlier without leaving the scoresheet, and it
  comes up with the same picks and warnings as the same quiz opened from a file and then linked.
* **SC-005**: Declining a New or Open confirmation leaves the sheet identical, picks and links
  included, in every case.
* **SC-006**: With no network, an official can still start a blank quiz, score it, save it to a file
  and open a file, and each action that needs the meet tells them why it can't run.
* **SC-007**: No menu item's outcome depends on what was already on the sheet: an official asked
  what each item will do to their current quiz can answer from its name alone.

## Assumptions

* **Who may open stored quizzes** follows the existing rules in `docs/roles-and-access.md`: an admin
  sees every stored quiz, an official the quizzes saved for their rooms, a viewer none. This feature
  adds no access.
* **Schedule warnings are in this feature** (maintainer, 2026-11-14), so issue #170 is covered by it
  and closes with it. A quiz scored in another room or time slot than scheduled is not warned about.
* **Teams are compared with the schedule slot by slot** (maintainer, 2026-11-14): the schedule's
  first seat is the sheet's first team slot, and so on. A room that seats the right three teams in
  another order is warned for each slot that differs.
* **Switching meets needs no extra question.** Picks belong to the meet link and are made again from
  the names, so linking another meet loses nothing the official typed.
* **Sending the linked quiz's identity to the meet** is defined and built by the stats work
  (`specs/006-meet-stats` on its own branch: an optional `scheduleQuizId` on a submission). This
  feature only keeps the link available for it (FR-018). If this feature lands first nothing is
  sent; if the stats work lands first it sends the link today's "Load from schedule" makes.
* **The server will hold the same comparisons as errors.** The stats work has a submitted quiz that
  disagrees with its scheduled quiz or the roster kept out of the tables until fixed or accepted.
  The sheet's warnings are the room's chance to fix it first, so the matching rules should agree;
  issue #171 tracks bringing the sheet onto the shared rules once they exist.
* **Matching a stored quiz to its scheduled quiz** when opening from the schedule is by division and
  quiz number, as stored quizzes are named today. Once submissions carry the scheduled quiz (stats
  work), that link is used instead.
* **A plain New keeps the meet link**, as it does today, because an official scores a morning of
  quizzes against one meet.
* **Opening a file unlinks** (maintainer, 2026-11-15). The previous release kept the meet link and
  dropped the picks; `docs/meet-link.md` is amended. An official scoring against one meet all day
  who opens a saved file links again to have it checked; submitting does not need the link. Opening
  from the meet or the schedule is an open followed by a link, so those come up linked.
* **Two-team quizzes** are not supported by the scoresheet (issues #143, #114); a scheduled quiz
  with two seats is started with its third slot blank.
* **The spec directory is numbered 007** because `006-meet-stats` is in use on the stats branch, not
  yet merged.
* No change to the quiz file format is expected. Whether the stored quiz list or the schedule needs
  anything new from the server is for the plan to find out.

## Dependencies

* The published schedule and its quizzes (spec 005), the stored quizzes and their access rules (spec
  003), and guest sessions (spec 004), all as they exist on master.
* The roster and name rules in `docs/meet-link.md`, as changed by pull requests #168 and #169: blank
  names, errors and warnings. Its rule that opening a file keeps the meet link and drops the picks
  is replaced here: opening a file unlinks.
* The stats work for FR-018's consumer, as above. It also plans to edit the same scoresheet files
  that hold the meet link, and to move the name matching into shared code; whichever lands second
  rebases.
