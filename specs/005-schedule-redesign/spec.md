# Feature Specification: Schedule builder redesign

**Feature Branch**: `feat/schedule-redesign`

**Created**: 2026-11-01

**Status**: Draft

**Input**: User description: "The current schedule feature does not work well. It needs a full
redesign." Refined in discussion: a schedule tool that works for a director entering teams on their
own, isolated from the rest of the app, with clean integration into meets that takes nothing away
from it.

## Context

A meet director builds a schedule: when and where every quiz runs, for every division, from the
first prelim round through the finals. Today that is only possible inside a meet in the portal, and
the feature as shipped (#58, #60) falls short in four ways the maintainer has seen in practice:

1. **The workflow is confusing.** Building is split across four tabs (Prelim setup, Elim setup,
   Skeleton, Draw) whose order doesn't match how a director thinks. One meet-wide "Stats break" row
   divides every division. **Populate** wipes and regenerates every quiz, so manual fixes are lost
   each time it runs.
2. **The grid can't be edited directly.** Moving a quiz means deleting and re-adding it, and
   problems are reported in browser `alert()` and `confirm()` dialogs (#14, #61).
3. **Elims don't work.** Lane sizes are lost on reload and every elim seat is a placeholder `A`,
   `B`, `C`; there are no brackets, intermediates or finals (#42, #62).
4. **Automatic layouts are poor.** A single greedy pass leaves avoidable conflicts and gives up
   silently (#59), and divisions over 21 teams get placeholder seats.

This redesign is grounded in fourteen real schedules from the org's meets (2021 to 2026, one to six
rooms, one to three divisions, 5 to 32 teams per division) and in a sister org's draw spreadsheet
(`docs/example-winkler-2026.md`). Those schedules are strikingly consistent, which is what makes a
generated starting point possible:

* The weekend frame barely changes: prelims Friday evening from 8:00 every 25 minutes, the rest of
  the prelims Saturday morning, a stats break, elims through Saturday, and each division's finals
  staggered in the late afternoon, with events (Registration, Assembly, Lunch, Supper, Worship)
  around them. One-day and one-room meets follow the same pattern on a shorter frame.
* Each division keeps its own block of rooms.
* Prelim draws come from the rule book's tables up to 21 teams.
* Elims follow from division size: a main bracket of 9 or 12 teams, consolation lanes for everyone
  else, and an intermediate (X or XY) across the line between two lanes to settle it. Nobody is
  dropped. Every bracket comes from one small library keyed by team count, and the sister org uses
  the same 12-team bracket. Ranks left over at the bottom sometimes play a short round robin
  instead.

So the redesigned builder **starts generated and is then tweaked**: the director enters each
division's team count, gets a complete schedule in the org's usual shape at once, and adjusts it
from settings on the left or by hand on the grid on the right. Anything the director changes by hand
is **pinned**: later settings changes re-flow everything else around it. The rules a schedule must
satisfy are numbered in [schedule-invariants.md](../../docs/schedule-invariants.md).

A clickable mockup, [mockup.html](./mockup.html), shows the agreed layout and behaviour; open it in
a browser. It fakes what this spec leaves to the implementation (elims come from fixed brackets,
nothing is saved), and where it and this spec differ, the spec wins.

The builder is **a tool of its own**, a page of the portal. It needs no meet and no account, and
once open it edits without the network. Linking a schedule to a meet is a later, optional step that
takes nothing away from it.

## Clarifications

### Session 2026-11-01

* Q: What doesn't work well today? → A: All four: the workflow is confusing, the grid can't be
  edited directly, elims don't work, and automatic layouts are poor.
* Q: How much does this spec cover? → A: Building and sharing the full schedule, prelims and elims.
  Resolving seats from live results (#16) is a follow-up.
* Q: Must the builder depend on a meet? → A: No. It works for a director on their own, isolated from
  the rest of the app; meet integration is a clean layer on top.
* Q: Build from scratch with assists, or generate then tweak? → A: Generate then tweak. With teams
  entered, everything starts generated in the usual shape; with none, a minimal frame (3 rooms and
  some slots). The director then adds, removes and edits as they go.
* Q: Layout? → A: Expandable sections on the left (Teams; Time slots, rooms and events; Prelim
  settings; Elim settings; the Draw section later moved into Prelim settings) and the grid on the
  right, both editing the same schedule: a room can be added with the grid's + or by raising the
  room count on the left.
* Q: What happens to hand edits when settings change? → A: They are pinned. Settings changes re-flow
  only what hasn't been touched by hand.
* Q: What does the schedule need about teams? → A: Only the team count per division. Prelim seats
  are letters. The draw (assigning teams to letters, handling late teams) never changes the
  schedule.
* Q: Is the "Stats break" event treated specially? → A: No. Each division's stats break is
  automatic, between its last prelim and its first elim; a "Stats break" row is just an event.
* Q: Should late teams sit with the draw or with sorting? → A: With sorting, in Prelim settings. The
  draw only decides which team is which letter. Sorting is an explicit action, never a side effect,
  because mixing lateness into placement caused problems in the earlier editor (#59).
* Q: Where does the draw live? → A: Always present: team names are typed in when standalone and come
  from the meet when linked. A toggle switches the grid between letters and drawn teams. (Its own
  Draw section was later folded into Teams and Prelim settings; see 2026-11-02.)
* Q: Rule book elims or the org's practice? → A: Mostly follow the examples (the org's practice).
  There are three divisions now; each has finals, and sometimes a consolation lane (2C, 3C) does
  too.
* Q: Rule book prelim tables or the rotating draw? → A: A setting, per schedule, with an (i) in the
  app explaining the difference. "Rotating draw" is the name shown for the cyclic formula.
* Q: Where does a standalone schedule live? → A: Like the scoresheet, for now: no account, kept in
  the browser and saved to files. (It was "offline" too, until 2026-11-02.)
* Q: Who sees a published schedule, and when do team names show instead of letters? → A: It depends
  on the meet's phase. Everyone with access to the meet sees the published schedule in letters
  during `registration` and `build`, and with team names from the published draw in `live` and
  `done`. Admins always see the draft and every view. The draw stays private until the meet starts,
  so it can be redone after late changes.
* Q: What happens when an admin publishes a schedule that still has hard conflicts? → A: The
  conflicts are shown and the admin confirms in the page, then it publishes. On the day, a no-show
  or a last-minute swap can force a team into two rooms at once, with one room running a slot
  behind; there may be no way to make the schedule "right", and it should show what actually
  happens.
* Q: How much time must there be between the XY quizzes and the first quiz that uses their results?
  → A: A setting, defaulting to the 2025 meets: the next slot, starting about 10 to 20 minutes late,
  so the reranking can be totalled.
* Q: How does a division's Finals run, given the rule book's "win twice" championship series? → A:
  The org doesn't play a series. Finals is a single quiz of three teams, so each division's Finals
  takes one slot.
* Q: When do ranks left over below a consolation lane get a bracket rather than a round robin? → A:
  A setting per lane (FR-029). By default, a lane of up to 6 leftover teams is a round robin and one
  of 7 or more a bracket of its size.
* Q: How much can be done by hand? → A: Everything. A quiz can be edited completely, and any seat
  can be set to a prelim letter, a prelim rank, a `New n` from an intermediate, or a place in any
  other quiz. Nothing is refused; anything wrong is marked.
* Q: Can the director edit a quiz that already has submitted results? → A: Yes, after a confirmation
  in the page saying it has results. The change is marked, and it's obvious from the results page
  too.
* Q: Can a seat be set to a specific team by name? → A: No. A prelim seat is always a letter. In
  Teams view the director still picks a letter, but each letter is shown with its drawn team's name,
  so picking "Heritage 3" picks that team's letter.
* Q: Should everything done by dragging also be doable without a mouse? → A: Yes. Every drag action
  also works as select-then-choose, by click, tap or keyboard. A phone should be usable too, at
  least for on-the-day fixes.
* Q: After a schedule is published, should settings changes still re-flow unpinned quizzes? → A:
  Only when the director applies them. An Auto-apply switch on the left panel controls whether
  settings changes re-flow the grid straight away; when it's off, they wait for an Apply button.
  It's on by default, and publishing turns it off.

### Session 2026-11-02

* Q: How is a late team marked: a switch, or the time it arrives? → A: A switch per team, for now.
  There is no arrival time.
* Q: How should the draw place late teams? → A: In as few quizzes as possible, and those quizzes as
  late as possible.
* Q: Which ranks does an X quiz take by default? → A: Two from above the line and one from below
  (Heritage 2025). Its window can be slid along the ranks.
* Q: Where do spare prelim cells go? → A: Anywhere. Ending a division with them is a weak
  preference, below late teams playing late and rooms staying on one division (P-8).
* Q: How does a director think about elims? → A: Lanes first: how many ranks go to each lane ("top 9
  to Div 2, the rest to Div 2C"). An intermediate (X or XY) is added on top, across the line between
  two lanes, to settle where that line falls. Any line can have one, including between 2C and 2CC;
  the second one down is named XX and YY, as in the rule book. (XYZ and WXYZ, first left for later,
  were brought in when the settings were asked to cover CMQ's workbook.)
* Q: What does a consolation lane play? → A: Either its own elimination bracket, like the main lane,
  or a round robin: a couple more quizzes each (2 or 3) for personal stats and fun, with nobody
  moving on. A round robin can have a Finals of its top three in points (Nov 2021). It is never
  called a "draw", which means too many things already.
* Q: Where do team names, late teams and the draw live? → A: Team names in Teams. Late teams, the
  draw and sorting in Prelim settings, with late teams hidden by default behind a row that shows who
  is marked. There is no separate Draw section.
* Q: Can a bracket lane have no Finals? → A: No. A bracket always has its deciding quiz; the only
  question is whether it's called a Finals (Apr 2025's Div 3 Quiz Q and Heritage 2025's 3C Quiz T
  are Finals by another name).
* Q: How far should the settings go? → A: The grid can do anything by hand. The settings on the left
  MUST be able to produce every structure in the org's printouts and CMQ's 2026 workbook without
  hand edits: intermediates of one to four quizzes, play-ins, lanes that restart their letters,
  finals side by side, note rows.
* Q: Should a small division spread its prelims over both days? → A: No. It plays from the first
  slot in a row, with spare cells at the end; lateness is the draw's and Sort's job.
* Q: In what order are the Finals by default? → A: Highest division first (Div 3, Div 2, Div 1, as
  in 2025), each division's consolation Finals just before its own.
* Q: Does the builder need to work offline? → A: No. It's a page of the portal; once open it edits
  without the network, but opening it needs a connection. It still needs no account and no meet.
* Q: Is a meet's schedule history kept? → A: Every published version is, with when and by whom, so
  an admin can see what was out at any time and restore an old version as the draft. Draft saves
  aren't.
* Q: Two consolation lanes that both letter from A would save results under the same name; how is
  that handled? → A: The conflict check warns (W-5) and the admin renames one. Recording the lane in
  the scoresheet's quiz file, so names can't clash, is future work.
* Q: How do edits to a meet's linked draft reach the server? → A: Saved automatically shortly after
  each change, and kept in the browser too, so work survives a lost connection until it can be sent.
* Q: What happens when a team drops out after the schedule is built? → A: The admin decides, every
  time: lower the division's team count (prelims rebuilt, draw redone) or mark the team absent
  (nothing moves; its seats show "Absent" and those quizzes run with two teams).
* Q: How do the panel and the grid share the work? → A: Only one section on the left is open at a
  time. The grid can do everything the panel can, rooms, slots and events included, by clicking a
  room's name, a time or an event.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Generate a full schedule from team counts (Priority: P1)

A director opens the schedule builder with no meet and no account, names a new schedule, and enters
three divisions of 6, 17 and 16 teams. A complete schedule appears on the right at once, in the
org's usual weekend shape: Friday evening and Saturday, five rooms with a block per division,
lettered prelims, each division's stats break, elims with brackets and intermediates sized to each
division, consolation lanes, and finals one at a time in Room 1. Event rows (Registration, Assembly,
Lunch, Supper, Worship) sit where they usually do. The conflict check shows no conflicts.

**Why this priority**: this is the core promise of the redesign. A director who has only team counts
gets a usable schedule in seconds instead of hours in a spreadsheet, and every other story adjusts
what this one produces.

**Independent Test**: with no meet and no account, create a schedule with divisions of 6, 17 and 16
teams. The schedule has the shape of the FBC 2025 printout: 5 prelim rounds Friday and 3 Saturday at
25-minute intervals, a stats break, XY intermediates on ranks 7 to 12 for the 17 and 16-team
divisions, 9-team main brackets, 8 and 7-team consolation lanes, the 6-team bracket for the smallest
division, and three finals 25 to 30 minutes apart. No hard conflicts.

**Acceptance Scenarios**:

1. **Given** a new schedule, **When** the director enters division team counts, **Then** a full
   schedule is generated with no hard conflicts (schedule-invariants H-1 to H-17).
2. **Given** a new schedule with no team counts yet, **When** it opens, **Then** it shows a minimal
   generated frame: 3 rooms and a Friday-evening and Saturday set of slots, ready for teams.
3. **Given** a generated schedule, **When** the director reads any prelim quiz, **Then** its seats
   show letters (`A`, `B`, `C`), never team names.
4. **Given** divisions whose prelims can't all fit before their stats breaks in the frame, **When**
   the schedule generates, **Then** the frame grows (more slots or rooms, per the room setting) or,
   if rooms are fixed and the day is full, the quizzes that don't fit are left in the unplaced tray
   with a message saying why.
5. **Given** a one-day meet, **When** the director deletes the other days and retimes the events,
   **Then** the schedule generates on that one day.

---

### User Story 2 - Adjust settings and watch the schedule follow (Priority: P1)

The director expands sections on the left and changes settings: the number of rooms, slot length,
start times, events, a division's team count, quizzes per team, the prelim draw source, or a
division's elim structure. The grid on the right updates as they go. Quizzes the director has moved
or edited by hand stay where they are; everything else re-flows around them.

**Why this priority**: generation is only useful if the director can steer it without losing their
work. This replaces Populate, which wiped everything.

**Independent Test**: on a generated schedule, drag two quizzes to new cells, then change a
division's team count, the slot length and the room count. The two dragged quizzes haven't moved;
everything else re-flows to the new settings with no hard conflicts.

**Acceptance Scenarios**:

1. **Given** a generated schedule, **When** the director raises the room count on the left, **Then**
   a room column appears and unpinned quizzes re-flow to use it.
2. **Given** a pinned quiz, **When** any setting changes, **Then** that quiz keeps its cell, label
   and seats (H-19), and the re-flow works around it.
3. **Given** a pinned quiz that no longer fits a setting change (its division shrank, or its room
   was removed), **When** the change applies, **Then** the quiz is kept, marked with the conflict it
   now causes, and the director decides what to do with it.
4. **Given** a pinned quiz, **When** the director unpins it, **Then** it returns to the generator,
   which may move it. Resetting a section or division unpins everything in it at once.
5. **Given** any settings change, **When** the director undoes it, **Then** the schedule returns to
   exactly its state before the change.
6. **Given** Auto-apply is off, **When** the director changes a setting, **Then** the grid doesn't
   change, the setting is marked as unapplied (showing its applied value) and its section shows a
   count, and pressing Apply says how many quizzes will move, re-flows them, and clears every mark.
7. **Given** a schedule with Auto-apply on, **When** the admin publishes it, **Then** Auto-apply
   turns off, and turning it back on is the director's choice.

---

### User Story 3 - Edit the grid directly (Priority: P1)

The director fixes the schedule by hand on the grid. They drag a quiz to an empty cell to move it,
or onto another quiz to swap them; drag a seat onto another seat to swap two letters or sources; add
a quiz, a slot, an event or a room on the grid, and click a time, event or room's name to change it;
and delete what they don't need. A quiz can be edited completely: its label, division, phase, lane,
and each seat, which can be set to any kind of source (a prelim letter, a prelim rank, a `New n`
from an intermediate, or a place in any other quiz). Everything the generator can make, the director
can also make or change by hand. Every change can be undone and pins what it touched. Nothing is
refused: a change that breaks a rule is made and marked on the cells involved straight away, naming
the rule, never in a pop-up.

**Why this priority**: generation gets the director most of the way; direct editing finishes the
job. Without it, every fix is a settings change or delete-and-re-add, which is the main complaint
today.

**Independent Test**: on a generated schedule, move a quiz, swap two quizzes, swap two seats, insert
a slot, add a single-room event, delete a quiz, undo all six, then redo them. Each step's grid is as
expected, conflicts appear and clear as the edits cause and remove them, and no browser dialog
appears.

**Acceptance Scenarios**:

1. **Given** a placed quiz, **When** the director drags it to an empty cell, **Then** it moves there
   and is pinned.
2. **Given** two placed quizzes, **When** the director drags one onto the other, **Then** they swap
   cells and both are pinned.
3. **Given** a move that puts a letter in two quizzes in one slot, **When** the director drops the
   quiz, **Then** the move happens and both quizzes are marked "H-1: a team can't be in two rooms at
   once".
4. **Given** an elim quiz dragged into or before the slot of a quiz it takes a team from, **When**
   the director drops it, **Then** both are marked with H-12.
5. **Given** the + between two slots, **When** the director adds a slot or an event there, **Then**
   it is inserted and the rows after it on that day move down only as far as they would overlap it.
6. **Given** any edit, **When** the director undoes it, **Then** the schedule returns to the state
   before it, pins included, and redo reapplies it.
7. **Given** a seat in any quiz, **When** the director edits it, **Then** they can set it to a
   prelim letter (`C`), a prelim rank (`4`), an intermediate result (`New 10`) or a place in any
   other quiz (`2 of Div 2 Quiz A`), whatever the quiz's phase, and the seat changes.
8. **Given** a seat edited to something that breaks a rule (a letter outside the division's range, a
   source from a later quiz, `2 of A` already used elsewhere), **When** the edit is made, **Then**
   it is kept and marked with the rule it breaks (H-10, H-12, H-15).

---

### User Story 4 - Elims shaped by division size (Priority: P2)

Each division's elims are generated from its team count, following the org's practice, and the
director can change them per division in Elim settings. They first decide how many ranks go to each
lane (top 9 to the main lane, the rest to the consolation lane, or split it again), then add a
intermediate (X or XY) across a line to settle it, then pick for each lane a bracket or a round
robin and whether it has its own Finals. Every elim seat names its source ("3", "New 10", "2 of A"),
and the conflict check keeps every quiz after the quizzes that feed it.

**Why this priority**: elims are half of a meet day and the part the current feature can't do at
all. It builds on stories 1 to 3.

**Independent Test**: generate divisions of 6, 10, 12, 14, 17, 21 and 32 teams. Each gets the shape
the org's meets used for that size (table under FR-030), every rank enters the elims exactly once
(H-14), and every seat's source is in an earlier slot (H-12).

**Acceptance Scenarios**:

1. **Given** a 17-team division, **When** it generates, **Then** its elims are: ranks 1 to 6 to the
   main bracket; XY on ranks 7 to 12 (X = 7, 10, 12; Y = 8, 9, 11); a 9-team main bracket of ranks 1
   to 6 and New 7 to 9; an 8-team consolation lane of New 10 to 12 and ranks 13 to 17, continuing
   the main lane's quiz letters; and a Finals quiz for the main lane.
2. **Given** a 32-team division, **When** it generates, **Then** its elims are: XY on ranks 10 to
   15; a 12-team main bracket; a 12-team 2C of New 13 to 15 and ranks 16 to 24; and an 8-team third
   lane for ranks 25 to 32.
3. **Given** a division's elims, **When** the director removes the XY intermediate from the line
   between the main lane and 2C, **Then** the main bracket and lanes regenerate to match, keeping
   pinned quizzes.
4. **Given** a consolation bracket, **When** the director turns its Finals off, **Then** its
   deciding quiz stays, renamed as the lane's next letter (`Div 3 Quiz Q`), and turning Finals back
   on renames it `Div 3C Finals`.
5. **Given** a lane size with no bracket in the library, **When** the director picks it, **Then**
   the lane is left as unplaced placeholder quizzes for the director to fill, with a message saying
   no bracket exists for that size.
6. **Given** an 8-team consolation lane, **When** the director makes it a round robin with 2 quizzes
   each, **Then** it becomes 6 quizzes seated by rank only (New n for ranks from the intermediate
   above), every team plays at least twice and no three teams meet twice, and the lane has no Finals
   until the director turns one on, seated 1st, 2nd and 3rd in points.
7. **Given** a division split into three lanes, **When** the director adds an intermediate on each
   line, **Then** the first is named X and Y and the second XX and YY, and each settles only its own
   line.

---

### User Story 5 - Keep, share and print a schedule without a meet (Priority: P2)

A director builds a schedule over several sittings with no meet and no account. It is kept in the
browser between sessions, they can save it to a file and open it on another device, and they can
print it: the room grid by day, or a "basic schedule" that shows only events and "Quizzing" blocks,
in letters or (after the draw) team names.

**Why this priority**: a standalone tool is only useful if the work survives and reaches the people
running the meet. Printouts are how every example schedule was shared.

**Independent Test**: build a schedule, close the browser, reopen it and find the schedule as left;
save it to a file, open the file in another browser, and print all three views.

**Acceptance Scenarios**:

1. **Given** a schedule in progress, **When** the director closes and reopens the builder, **Then**
   the schedule is as they left it, including pins.
2. **Given** a schedule, **When** the director saves it to a file and opens that file elsewhere,
   **Then** every setting, pin, quiz, seat and draw is restored.
3. **Given** a file from a newer, unknown schedule format, **When** the director opens it, **Then**
   it fails with a message saying why, and nothing already open is lost.
4. **Given** a schedule, **When** the director prints the room grid, **Then** it shows one or more
   pages per day with the time column on each page, and quizzes split across a page break are
   avoided.
5. **Given** a schedule, **When** the director prints the basic schedule, **Then** consecutive quiz
   slots collapse into "Quizzing" rows between the events.

---

### User Story 6 - The draw: assign teams to letters (Priority: P2)

Once the teams are known, the director enters each division's team names in Teams (a linked schedule
takes them from the meet), then in Prelim settings marks the teams expected to arrive late and runs
the draw. Each letter gets a team at random, except that late teams get the letters whose first quiz
is latest. A Letters / Teams toggle above the grid switches between letters and drawn teams. The
director can redraw, or swap two teams' letters by hand. The schedule itself doesn't change.

**Why this priority**: a schedule is only useful to coaches once it names teams, but building it
doesn't depend on them. Because the draw never changes the schedule, the schedule can be built and
shared before registration closes.

**Independent Test**: on a generated schedule, enter team names for a 9-team division, mark two
late, and draw. Every team holds exactly one letter (H-18), both late teams' first quizzes are the
latest available, and no quiz has moved.

**Acceptance Scenarios**:

1. **Given** a division with team names entered, **When** the director draws, **Then** each team
   gets exactly one letter, at random apart from late teams.
2. **Given** teams marked late, **When** the director draws, **Then** they get letters that put them
   in as few prelim quizzes as possible, and those quizzes as late as possible.
3. **Given** a late team whose first quiz is in its division's first quiz slot, **When** the
   director looks at the grid, **Then** that quiz shows warning W-2.
4. **Given** a drawn division, **When** the number of team names changes, **Then** the team count
   setting follows, the schedule re-flows (story 2) when applied (FR-012a), and the draw is flagged
   to be redone.
5. **Given** a drawn division, **When** the director toggles between letters and team names,
   **Then** the grid and printouts switch without changing the schedule.
6. **Given** a linked schedule, **When** the director opens Teams, **Then** the team names are the
   meet's, and late marks, the draw and swaps work as on a standalone schedule.

---

### User Story 7 - Link a schedule to a meet (Priority: P3)

When the meet exists in qzr, an admin links the schedule to it, or starts a schedule from the meet.
The meet then supplies the divisions, team counts, team names and rooms; when linking an existing
schedule, the admin reviews how its divisions and rooms match the meet's before confirming. Edits
stay a draft until the admin publishes, and the meet's schedule view and the scoresheet's schedule
picker read the published version.

**Why this priority**: this is how a schedule reaches a running meet, but the standalone builder is
useful without it, and stories 1 to 6 are the bulk of the work.

**Independent Test**: build a standalone schedule, link it to a meet whose divisions match, publish,
then make a further edit without publishing. The meet's schedule view shows the published version
without the edit, and the scoresheet loads a published quiz with the right teams.

**Acceptance Scenarios**:

1. **Given** a meet, **When** an admin starts a schedule from it, **Then** the schedule's divisions,
   team counts and rooms come from the meet, and stories 1 to 6 work the same.
2. **Given** a standalone schedule, **When** an admin links it to a meet, **Then** they see its
   divisions and rooms matched to the meet's, with mismatches listed, and nothing links until they
   confirm.
3. **Given** a linked schedule with hard conflicts, **When** the admin publishes, **Then** the
   conflicts are listed with links to their cells, and the schedule publishes once the admin
   confirms in the page.
4. **Given** a published schedule, **When** the admin saves more edits without publishing, **Then**
   the meet's viewers still see the published version and the admin sees an "unpublished changes"
   marker.
5. **Given** a schedule published three times, **When** the admin opens its history, **Then** all
   three versions are listed with when and by whom; any one can be viewed, and restoring one makes
   it the draft without publishing it.

---

### Edge Cases

* A division with 3 or fewer teams: no rule-book table and no bracket. Its prelims and elims are
  left as placeholder quizzes for the director, with a message.
* A division larger than the library's largest pattern (over 32 teams): the generator follows the
  pattern for 19 and up: a 9 or 12-team consolation lane, then a lane for the rest, a round robin
  for up to 6 teams or a bracket for 7 or more.
* Two divisions whose prelims finish at different times: each has its own stats break and its elims
  start when its prelims allow, as at the 2026 one-day meet.
* A frame too short for everything: the generator fills what it can and leaves the rest in the tray
  with a message, rather than breaking a hard rule.
* Pinned quizzes that make a conflict-free re-flow impossible: the generator places what it can
  without breaking a hard rule around them, and reports what it couldn't place.
* A room removed while it holds pinned quizzes: they move to the tray, stay pinned, and are listed.
* An event taking one room's cell (a coaches' meeting in Room 2) in a quiz slot: the generator
  leaves that cell free.
* A schedule opened from a file saved by an older version: it opens with defaults for anything the
  older format lacked.
* The connection drops while editing a linked schedule: editing carries on, the builder shows the
  draft as not saved, and the edits are sent when the connection returns (FR-048a).
* The browser's stored data is cleared: schedules saved to files are unaffected; the builder says
  that browser-kept schedules are gone rather than failing.
* A team drops out after the draw or after publishing: the admin chooses between a smaller division
  and an absent team (FR-042b); the builder doesn't choose by phase.
* A last-minute change on the day (a no-show, a swapped team) puts a team in two rooms in one slot:
  the director records it as it will actually run, conflict and all, confirms, and publishes; one
  room runs a slot behind until it catches up.
* An existing meet built with the current editor: its schedule still opens, as a linked schedule
  with every quiz pinned, and its placeholder elim seats show as seats with no source.

## Requirements _(mandatory)_

### Functional Requirements

**Standalone tool**

* **FR-001**: The builder MUST be a page of the portal that works with no meet and no account. Once
  it's open, editing, saving in the browser and saving to a file MUST NOT need the network; only
  loading the page and linked-schedule actions do. It doesn't need to open with no network.
* **FR-002**: The builder MUST keep schedules in the browser automatically, list them, and let the
  director create, rename, duplicate and delete them.
* **FR-003**: Directors MUST be able to save a schedule to a file and open it from one. The file
  MUST carry a format version; an older version opens with defaults for what it lacked, and an
  unreadable or newer file fails with a message that says why.

**Layout and workflow**

* **FR-004**: The builder MUST show settings on the left in expandable sections (Teams; Time slots
  and rooms; Prelim settings; Elim settings) and the grid on the right, both editing the same
  schedule and both always visible. Only one section MUST be open at a time.
* **FR-004a**: The grid MUST be able to make any schedule by hand (FR-005c, FR-035a). The settings
  MUST be able to generate, without hand edits, every structure in the reference schedules: the
  org's printouts from 2021 to 2026 and CMQ's 2026 workbook (`docs/example-winkler-2026.md`).
* **FR-005**: Every change, from either side, MUST be reflected on the other side immediately.
* **FR-005a**: Every action done by dragging (moving or swapping quizzes, swapping seats) MUST also
  be doable without dragging: select the quiz or seat, then choose the target, by click, tap or
  keyboard.
* **FR-005b**: On a phone-sized screen, the settings panel MUST open as a sheet over the grid, and
  the grid MUST scroll sideways with its time column fixed. A phone MUST be enough for on-the-day
  fixes (move or swap quizzes, change a seat, publish); building a whole schedule is expected on a
  laptop or larger.
* **FR-005c**: The grid MUST be able to do everything the panel can. Clicking a quiz MUST open its
  menu (rename, edit seats, move, move to the unplaced tray, pin or unpin, delete); clicking a time
  MUST let the director retime or delete its row, or insert a slot or event; clicking an event MUST
  open its menu (rename, rooms, move, move to the unplaced tray, pin or unpin, delete, turn into a
  quiz); clicking a room's name MUST let them rename or remove the room; and the grid MUST have a
  way to add a room. Every popup MUST close with an × or a click elsewhere, and a seat editor opened
  from a quiz's menu MUST lead back to that menu.
* **FR-006**: Every change MUST be undoable and redoable for the rest of the editing session.
* **FR-007**: Errors, conflicts and confirmations MUST be shown in the page. The builder MUST NOT
  use browser `alert`, `confirm` or `prompt` dialogs.
* **FR-008**: Every setting whose effect isn't obvious MUST have an (i) that explains it in the app.
  The prelim draw setting's explanation MUST say that both options give every team the same number
  of quizzes against different opponents, that the rule book has no tables over 21 teams, that its
  8-team table has a pair meeting twice, and that the draw makes the letters random.

**Generation and pinning**

* **FR-009**: With at least one division's team count entered, the builder MUST generate a complete
  schedule (frame, rooms, prelims, stats breaks, elims, finals) satisfying hard rules H-1 to H-17 of
  [schedule-invariants.md](../../docs/schedule-invariants.md).
* **FR-010**: With no team counts, the builder MUST show a minimal generated frame: 3 rooms and a
  default set of slots.
* **FR-011**: A quiz MUST become pinned when the director moves it, edits its label or seats, or
  adds it by hand. A pinned quiz MUST be visibly marked and MUST be unpinnable, singly or for a
  whole division, room column or slot's row, or all at once; a room's column and a slot's row can
  also be pinned together. Unpinned quizzes return to the generator at the next re-flow.
* **FR-012**: A settings change MUST regenerate only unpinned quizzes and MUST NOT move, change or
  delete a pinned one (H-19).
* **FR-012a**: An Auto-apply switch at the top of the left panel MUST control when settings changes
  reach the grid. On, they re-flow the grid straight away (FR-012). Off, they are held: each setting
  whose value differs from what the grid was built with MUST be marked as unapplied, beside the
  setting itself, with its applied value shown, and each section MUST show how many of its settings
  are unapplied, so the director can tell at a glance which settings the grid reflects. An Apply
  button re-flows them all, first saying how many quizzes will move. Changing a setting back to its
  applied value clears its mark. Auto-apply MUST default to on, and publishing MUST turn it off, so
  nothing people have already seen moves without the director choosing to. Hand edits on the grid
  always apply at once.
* **FR-013**: When the generator can't place everything without breaking a hard rule, it MUST place
  what it can, leave the rest in the unplaced tray, and say what it left and why. It MUST NOT place
  a quiz in breach of a hard rule.
* **FR-013a**: Among placements that satisfy the hard rules, the generator MUST follow the
  preferences P-1 to P-8 of [schedule-invariants.md](../../docs/schedule-invariants.md) in their
  listed order: late teams play late, higher-numbered divisions sit in higher-numbered rooms, rooms
  switch divisions and lanes as few times as possible (never back and forth), quizzes run in order,
  elims finish early, finals balance being watched against finishing on time, the schedule stays
  compact, and spare cells come last. A division's prelims are packed from its first slot, not
  spread over the days, however small the division.
* **FR-014**: Generating a schedule for 3 divisions totalling up to 60 teams MUST take under 2
  seconds on a typical laptop, so the grid can follow the settings as they change.

**Frame: days, slots, rooms and events**

* **FR-015**: A new schedule MUST start on the Weekend frame. The builder doesn't offer a choice of
  frame yet: directors shape it by adding and deleting days and editing events (FR-016). The One day
  and One room frames below are kept for a later preset picker:
  * **Weekend**: Friday 7:00 PM Registration, 7:30 PM Assembly, prelims from 8:00 PM; Saturday 8:00
    AM Breakfast, prelims from 9:00 AM, each division's stats break, elims, 12:00 PM Lunch, elims,
    each division's Finals staggered about 30 minutes apart from about 3:15 PM, then 5:00 PM Supper,
    6:00 PM Social Activities and 8:00 PM Worship/Awards; Sunday Worship Service and Lunch.
  * **One day**: 9:30 AM Assembly, quizzes from 10:00 AM, 12:00 PM Lunch, quizzes from 1:00 PM,
    finals to close.
  * **One room**: one room, the schedule printed as a single time-ordered list.

  One-day and one-room meets are small and run however suits them; their frames are only a starting
  point, and the defaults in this spec are tuned for weekend meets.
* **FR-016**: Directors MUST be able to add, remove, retime and reorder rows, and set each row's
  length. A row is a time; quizzes and events sit in its rooms. A day's rows MUST NOT overlap: a row
  inserted, lengthened or moved later pushes the rows after it down only as far as they would
  overlap, and a row moved earlier takes its place in time order. The default slot length MUST be 25
  minutes, for 20-question quizzes; 15-question quizzes (practice and one-day meets) run in shorter
  slots.
* **FR-017**: An event MUST sit in a row like a quiz, taking any set of its rooms or all of them
  (all follows the room count). Events of the same name in one row are one event. Adjacent rooms
  MUST be drawn as one cell; rooms apart are drawn as separate cells with the same name. A row with
  events and no quizzes MUST be drawn as a short event row, and an event's cell beside quizzes is
  shaded like one. Like a quiz, an event MUST be able to be moved, dragged, sent to the unplaced
  tray, pinned and deleted, and turned into a quiz and back (FR-035a); a quiz in a room an event
  takes at that time is marked (H-3). The grid MUST also take **note rows**: a line of text with no
  time and no effect on placement, such as "Stats will be calculated from W to Z to place 9 to 20"
  under an intermediate.
* **FR-018**: The room count MUST be settable. The builder MUST recommend the fewest rooms (at least
  3) that fit the prelims in the frame; a new schedule follows the recommendation as its teams
  change, and a count the director sets stays until they choose the recommendation again.
* **FR-019**: By default each division MUST get its own block of adjacent rooms, in division order
  (Div 1 in the lowest-numbered rooms) and sized to its share of the quizzes, and each elim lane
  MUST keep to the same rooms (P-2, P-3). A division MAY borrow other rooms when its block can't fit
  its quizzes. Each room's header MUST show every division that uses it, Finals aside.
* **FR-019a**: Finals MUST default to one at a time, in Room 1, about 25 to 30 minutes apart from
  mid-afternoon, so they can be watched and still finish before the evening (P-6). The director
  changes their order, spacing and rooms on the grid, including two side by side (CMQ), by moving
  and pinning them (FR-004a); Elim settings has no Finals controls beyond each lane's Finals on or
  off. The default order MUST be highest division first (Div 3, Div 2, Div 1, as every 2025 meet),
  each division's consolation Finals just before its own; it's a starting point, not a preference
  the generator weighs (P-6).
* **FR-020**: Each division's stats break MUST be worked out automatically: it falls between the
  division's last prelim and its first elim, so divisions can break at different times (H-11). It
  isn't a special row and the builder doesn't list it. A "Stats break" event in the frame is an
  ordinary event for the people at the meet.

**Prelims**

* **FR-021**: The Teams section MUST set the number of divisions and take, per division, a name, a
  team count, optionally team names (story 6), and a colour from a fixed palette, which its quizzes
  and settings are drawn in; by default divisions take the first four colours in turn. There is no
  maximum division size; letters run past `Z` as `AA`, `AB`, … (H-10).
* **FR-022**: Quizzes per team MUST be a setting, default 3 (6 is used at one-room meets) (H-9).
* **FR-023**: The prelim draw source MUST be a per-schedule setting with two options:
  * **Rule book** (default): the tables in `docs/rules.md` for 4 to 21 teams, the rotating draw
    above 21.
  * **No rematches**: the rotating draw for 7 teams or more, the rule book's tables below 7.
* **FR-024**: The rotating draw MUST give, for `n` teams and a step `k`, quiz `i` the letters
  `(i, i + k + 1, i + 2k)` counted round from 1 to `n`, choosing `k` so that no two teams meet twice
  where that's possible (W-1); where no step does (8 and 13 teams), it MUST use another cyclic
  pattern `(i, i + a, i + b)` that does. Its result MUST satisfy H-9 and H-10 for every team count
  from 4 to at least 90.
* **FR-025**: With 6 quizzes per team, the draw MUST be two rounds of the 3-quiz draw, and SHOULD
  avoid repeating the first round's pairings in the second.
* **FR-026**: Prelim quizzes MUST be labelled `Div <division> Quiz <n>`, numbered in draw order.

**Elims**

* **FR-027**: A division's elims MUST be set up as **lanes** stacked down its prelim ranks: the main
  lane takes the top ranks, and each consolation lane (`C`, `CC`, …) the ranks below the lane above.
  The director MUST set how many ranks each lane takes ("Top 9 → Div 2", "The rest → Div 2C"), and
  MUST be able to split a lane in two and merge two lanes. A line between two lanes sits after a
  rank.
* **FR-028**: Any line between two lanes MAY carry an **intermediate** that settles it: one to four
  quizzes of three ranks each, straddling the line: **X** (3 ranks), **XY** (6), **XYZ** (9, the
  rule book's) or **WXYZ** (12, CMQ's). How many of its ranks sit above the line MUST be a setting,
  with the window sliding along the ranks and keeping at least one rank on each side; defaults: X 2
  above and 1 below (Heritage 2025), XY 3 and 3, XYZ the rule book's, WXYZ 4 and 8 (CMQ). Seating
  MUST default to the org's (XY: X = 1st, 4th, 6th and Y = 2nd, 3rd, 5th of the range) or a snake
  (WXYZ: W = 1st, 8th, 9th; X = 2nd, 7th, 10th; …), with the other seen orders available (XY: X =
  1st, 4th, 5th; Y = 2nd, 3rd, 6th, Nov 2024). An intermediate MUST be one of two kinds:
  * **Rerank** (default): its results rerank all of its teams together, by prelim points plus their
    intermediate quiz's points, as `New n` within the same range (H-16); the top of the range joins
    the lane above and the rest the lane below, so every quiz with a `New n` seat comes after all of
    the intermediate's quizzes (H-12).
  * **Play-in**: its places go straight into seats (`1 of X`, `2 of S`), as at Heritage 2023 (X on 9
    to 11, its winner seeded 9) and in CMQ's brackets for 13 to 20 teams; its other teams go to the
    lane below or to extra quizzes in the same lane.

  Intermediates are named as in the rule book: X, XY, XYZ or WXYZ on the first line that has one,
  with the letters doubled on the second (XX, XXYY, …).
* **FR-028a**: The generator MUST leave time for totalling an intermediate: a gap between the end of
  the intermediate's slot and the start of the first quiz with a `New n` seat, 15 minutes, so that
  quiz runs in the next slot starting late (the 2025 meets). A hand edit that shortens it MUST show
  warning W-3. Making the gap a setting (a full skipped slot as in 2023, or none) is future work.
* **FR-029**: Each lane MUST be a **bracket** or a **round robin**. A bracket comes from the
  **bracket library**, which MUST include every bracket in the reference schedules: the org's 5, 6,
  7, 8 and 12-team brackets; the 9-team bracket seeded both ways (rule-book Bracket B order 1, 4, 9
  / 2, 5, 7 / 3, 6, 8 when an X feeds it, snake order 1, 6, 7 / 2, 5, 8 / 3, 4, 9 otherwise); the
  10-team bracket (Heritage 2025: the 9-team bracket with New 10 entering its bottom placing quiz, G
  = 3 of F, 2 of F, New 10); an 11-team bracket built the same way (a play-in X on 9 to 11 whose
  winner takes seed 9, A = 1, 4, 1 of X as at Heritage 2023, and whose other two join G = 2 of F, 2
  of X, 3 of X, which places 9th to 11th); CMQ's 14-team bracket (its C division as run, with a
  play-in); and the rule book's Brackets A, B and C. Each lists its quizzes, each seat's source, and
  its deciding quiz; the entries are in [bracket-library.md](./bracket-library.md). A round robin
  seats every quiz by rank alone (`New n` for ranks from the intermediate above), so nobody moves
  on: it gives each team a set number of quizzes (1 to 3, default 2) for personal stats and fun. Its
  quizzes walk the lane's ranks in order, with every other pass mixed so the same three teams don't
  meet again (22, 25, 23 / 26, 24, 27, Feb 2023), and a short last quiz is topped up from the top of
  the lane.
* **FR-030**: By default, elims MUST follow division size, as the org's meets did:

  | Teams     | Main lane                 | Intermediate                                    | Below the main lane         |
  | --------- | ------------------------- | ----------------------------------------------- | --------------------------- |
  | 4 to 9    | that size                 | none                                            | none                        |
  | 10        | 10-team bracket           | rerank X on ranks 8 to 10                       | none (New 10 plays G)       |
  | 11        | 11-team bracket           | play-in X on ranks 9 to 11, its winner seeded 9 | none (X's other two play G) |
  | 12        | 12                        | none                                            | none                        |
  | 13 to 18  | 9 (top 6 + New 7 to 9)    | XY on ranks 7 to 12                             | one lane of the rest        |
  | 19 and up | 12 (top 9 + New 10 to 12) | XY on ranks 10 to 15                            | lanes by what's left, below |

  What's left below the main lane is laid out by count: 12 or fewer, one lane of them all, a bracket
  if the library has that size and otherwise a round robin (2021, 2022); 13 to 15, a 9-team bracket
  and then a lane for the rest (2022, 2023); 16 or more, a 12-team bracket and then a lane for the
  rest (2023, 2024). A lane for the rest is a bracket for 7 or more teams and otherwise a round
  robin.
* **FR-031**: Each part MUST be changeable per division: each lane's size, splitting and merging
  lanes, an intermediate on any line (its size, kind, window and seating), each lane's format and
  bracket, a round robin's quizzes per team, whether a lane's deciding quiz is called a Finals, and
  each lane's label and lettering. Changing a lane rebuilds only that lane's unpinned quizzes.
* **FR-032**: Every team MUST enter the elims exactly once, and every intermediate result MUST be
  used (H-14, H-16).
* **FR-033**: Each lane after the main one MUST be labelled with a suffix: `Div 2C`, then `Div 3CC`
  for a third lane. Other labels, the division's own name (`Div 3 Quiz I`, Apr 2025) or a name of
  the lane's own (CMQ's `K Qz`, `B Qz`), are future work. Each lane's lettering MUST be a setting:
  the letters either continue the lane above's (main A to H, consolation from I; the default, as
  since 2025) or restart at A (`Div 2C Quiz A`, 2021 to 2024; every CMQ lane). A lane below a
  consolation lane continues or restarts from that lane's letters.
* **FR-034**: Every bracket ends in a deciding quiz: one quiz of three teams, in one slot. There is
  no "win twice" series (`rules.md` §3 isn't used). Whether that quiz is called a Finals MUST be a
  setting per lane: on, it is `Div 2 Finals` and runs with the other finals (FR-019a); off, it is
  named as the lane's next letter (`Div 3 Quiz Q`) and stays in the lane's rooms. It defaults to on.
  A round robin has no deciding quiz of its own; turning its Finals on adds one, seated 1st, 2nd and
  3rd in points across the round robin (Nov 2021), and it defaults to off.
* **FR-034a**: Elim settings MUST offer re-placing a division's elims, or every division's, where
  the generator would put them around everything else as it is, events and rows included. Like Sort
  (FR-042a) it says first how many quizzes will move, and leaves pinned elims unless the director
  includes them, which unpins them.
* **FR-035**: Every elim seat MUST show its source: a prelim rank (`3`), an intermediate result
  (`New 10`), a place in an earlier quiz (`2 of A`), or a place in points across a round robin
  (`1st in pts`) (H-15, H-17).
* **FR-035a**: Everything MUST be editable by hand. A quiz's label, division, phase, lane, cell and
  seats can all be changed, and quizzes and events can be added, deleted and turned into each other
  (FR-017). Any seat can be set to any kind of source: a prelim letter, a prelim rank, an
  intermediate result (`New n`), a place in any other quiz (`n of Quiz X`), or a place in points
  across a round robin. The builder MUST NOT refuse an edit; one that breaks a rule is kept and
  marked by the conflict check (FR-037).
* **FR-035c**: A seat that takes a team from another quiz MUST refer to that quiz itself, not its
  name, so renaming a quiz updates every seat that refers to it (`2 of C` becomes `2 of C2`).
  Quizzes MUST be renameable from the quiz's menu on the grid (FR-005c), and two quizzes with the
  same label MUST be marked (H-7).
* **FR-035b**: On a linked schedule, a quiz with submitted results MUST NOT be changed by the
  generator. The director MUST be able to edit it after confirming in the page that it has results.
  The quiz MUST then be marked as changed after its results, in the schedule and on the meet's
  results page, so the mismatch is obvious from both (H-20).
* **FR-036**: A lane size with no bracket in the library MUST be generated as placeholder quizzes
  for the director, with a message.

**Conflict check**

* **FR-037**: The builder MUST check every hard rule and warning in
  [schedule-invariants.md](../../docs/schedule-invariants.md) after every change, mark the cells
  involved with the rule's ID and a short reason, and show running counts with a way to step through
  them.
* **FR-038**: The generator MUST never produce a hard conflict; only hand edits can (H-19, FR-013).

**Draw**

* **FR-039**: The draw MUST only map each division's letters to its teams, and MUST NOT change the
  schedule.
* **FR-040**: The draw MUST always be available in Prelim settings, with team names entered in Teams
  (typed in when standalone, taken from the meet when linked). Directors MUST be able to swap two
  teams' letters (H-18). The draw MUST be run, redone and cleared per division, as well as for all
  divisions at once, so a late change only redraws the division it affects. Clearing a division's
  draw returns its seats to letters. The Teams view shows team names for drawn divisions and letters
  for the rest.
* **FR-041**: The draw MUST give late teams letters that put them in as few prelim quizzes as
  possible, preferring the letters whose quizzes are latest, and otherwise assign letters at random
  (W-2).
* **FR-042**: When a division's team count no longer matches its draw, the draw MUST be flagged to
  be redone.
* **FR-042a**: Late teams and sorting MUST sit together in Prelim settings, apart from the draw.
  Directors mark each team expected late with a switch; there is no arrival time. The switches MUST
  be hidden by default, behind a row that shows who is marked (none, their names, or a count). The
  generator MUST NOT use lateness, so a layout depends only on team counts and rooms; before the
  draw, lateness is handled by the draw (FR-041). A **Sort prelims** action, for all divisions or
  one, MUST re-place prelims in quiz order, with drawn late teams' quizzes later, treating lateness
  as a preference that gives way to the hard rules. Late teams' quizzes MUST take the latest cells
  available, including empty cells and free cells in other divisions' rooms; the other quizzes stay
  in their division's rooms. A **Sort across rooms** option MUST let every sorted quiz move between
  rooms, weighing late teams playing late above keeping divisions in room order and rooms on one
  division (P-1 to P-3). Across rooms, each division MUST still keep a block of adjacent rooms, and
  the line between two divisions' blocks MUST move at most once, so no room switches back. Sort MUST
  say how many quizzes will move before it applies, and MUST leave pinned quizzes alone unless the
  director includes them. Sorting never happens as a side effect of another change.

* **FR-042b**: When a team drops out, the builder MUST offer the admin both ways and pick neither
  itself: **lower the team count**, which rebuilds the division's unpinned prelims and flags the
  draw to be redone; or **mark the team absent** in Teams, which changes no quiz: its seats show
  "Absent", those quizzes run with two teams, and the conflict check doesn't count an absent seat as
  empty (H-5). Marking a team absent MUST be undoable like any change.

**Viewing and printing**

* **FR-043**: A Letters / Teams toggle above the grid MUST switch the grid and printouts between
  letters and drawn teams once a draw exists, and show letters until then. Editing a prelim seat
  always sets a letter; in Teams view the choices show each letter with its drawn team's name. A
  seat can't name a team directly.
* **FR-044**: Directors MUST be able to print: the room grid, on one or more landscape pages per day
  with every room across the page; and a basic schedule of events and "Quizzing" blocks. A printout
  holds only the schedule, not the portal around it.

**Meet integration**

* **FR-045**: Meet admins MUST be able to start a schedule from a meet, or link an existing schedule
  to one. A meet has at most one linked schedule.
* **FR-046**: Linking MUST show a review matching the schedule's divisions and rooms to the meet's,
  list mismatches, and link nothing until confirmed.
* **FR-047**: While linked, the meet's divisions, team counts and team names MUST be the schedule's,
  and changes on either side MUST show on the other. The meet's rooms MUST follow the schedule's
  when it's published, and a room with an official code MUST never be removed
  ([contracts/api.md](./contracts/api.md)).
* **FR-048**: Unlinking MUST leave a standalone schedule with what it had.
* **FR-049**: On a linked schedule, edits MUST stay unpublished until the admin publishes. Before
  publishing, the admin MUST be shown any hard conflicts and warnings. With hard conflicts, the
  schedule MUST publish after the admin confirms in the page; with only warnings, it publishes
  without asking. Publishing MUST never be refused, so the schedule can show what actually happens
  on the day.
* **FR-048a**: Edits to a linked schedule MUST save to the meet's draft automatically, shortly after
  each change, with the save state shown ("Saving…", "Saved", "Not saved: offline"). Every edit MUST
  also be kept in the browser at once, so closing the tab or losing the connection loses nothing;
  unsent edits are sent when the builder can reach the server again, including after a reload. If
  the server's draft changed meanwhile (another admin), the builder MUST show both in the page and
  let the admin keep theirs or take the server's, never overwriting silently.
* **FR-049a**: Every publish MUST be kept: each adds a version, numbered, with when and by whom, and
  none is overwritten or deleted while the meet exists. The admin MUST be able to list the versions,
  view any one read-only, and restore one as the draft, which publishes nothing until the admin
  publishes again. Draft saves between publishes aren't kept; undo covers those (FR-006).
* **FR-050**: The meet's schedule view and the scoresheet's schedule picker MUST read the published
  version.
* **FR-051**: Only meet admins and superusers MAY link, edit or publish a meet's schedule.
* **FR-052**: People with access to the meet MUST see only the published version, by the meet's
  phase: in letters during `registration` and `build` (even if a draw exists), and with team names
  from the published draw during `live` and `done`. Admins MUST always see the draft, letters and
  team names.
* **FR-053**: Existing meets' schedules MUST still open after the redesign, as linked schedules with
  every quiz pinned; no saved slot, quiz, seat or assignment is lost.

### Key Entities

* **Schedule**: a named, self-contained plan: settings, divisions, frame, rooms, quizzes, pins and
  draw. Standalone, or linked to one meet.
* **Settings**: frame preset, slot length, room count, quizzes per team, prelim draw source, and per
  division the elims: lane sizes, an intermediate on any line, and per lane its format (bracket or
  round robin, with quizzes per team), Finals and label.
* **Division**: a name and a team count, with its own stats break, prelim draw, elim structure and
  room block.
* **Frame**: the ordered rows across one or more days; each a day heading, a slot (time, length, and
  what it's for: prelims, elims, finals or events) or a note.
* **Event**: a label in a slot, over any set of its rooms or all of them, or in the unplaced tray.
* **Room**: a column of the grid.
* **Quiz**: a label, a division, a phase (prelim or elim), a lane for elims, seats, and a cell or a
  place in the unplaced tray. Pinned or not.
* **Seat**: a letter (prelims) or a source (elims: a prelim rank, `New n`, a place in an earlier
  quiz, or a place in points across a round robin).
* **Bracket**: a library entry for a team count: quizzes, each seat's source in bracket terms, and
  the final.
* **Lane**: one elim path in a division (main or consolation), a range of ranks played as a bracket
  or a round robin.
* **Intermediate**: an X or XY on the line between two lanes, reranking its range as `New n`.
* **Draw**: per division, team names, late and absent marks, and the letter each team holds.
* **Schedule file**: a versioned file holding one complete schedule.
* **Meet link**: the tie between a schedule and a meet: its draft and its published versions, the
  newest of which is what people see.
* **Conflict**: a broken hard rule or warning, with its ID, reason and cells. Derived, not stored.

## Success Criteria _(mandatory)_

### Measurable Outcomes

* **SC-001**: Entering the team counts of each reference meet (FBC 2025: 6, 17, 16 in 5 rooms;
  Heritage 2025: 10, 14, 21 in 6 rooms; Heritage 2024: 6, 32 in 5 rooms; the 2026 one-day meet: 5,
  10, 12 in 3 rooms) generates a schedule with no hard conflicts and the same elim structure as the
  printed schedule. CMQ's 2026 meet (36 and 14 teams in 9 rooms) reaches its structure through the
  settings alone, with no hand edits.
* **SC-002**: A director with only team counts can produce a printed, conflict-free weekend schedule
  in under 10 minutes, without help.
* **SC-003**: For every team count from 4 to 90, both draw sources give every team exactly the set
  quizzes per team, never twice in one quiz; the rotating draw has no rematches from 7 teams up.
* **SC-004**: Across every acceptance scenario, no settings change ever moves, changes or deletes a
  pinned quiz.
* **SC-005**: No step in this spec uses a browser dialog.
* **SC-006**: A schedule saved to a file and reopened is identical, pins and draw included.
* **SC-007**: The schedule updates to a settings change within 2 seconds for meets up to 60 teams.
* **SC-008**: Every existing meet's schedule opens after the redesign with the same slots, quizzes,
  seats and assignments.

## Assumptions

* The reference schedules (2021 to 2026) and the Winkler spreadsheet are representative of how the
  org runs meets. Defaults follow them; every default can be changed per schedule.
* The rule book (`docs/rules.md`) governs scoring, not scheduling; its prelim tables are the default
  draw source, and its elim structure (top 6 or 9, XYZ, dropping teams) is not the default because
  the org doesn't run it. `docs/scheduling.md` will be amended in the same change to record this,
  the standalone builder, generation with pins, per-division stats breaks, and the invariants doc,
  as the constitution requires.
* Out of scope: resolving elim seats from submitted results and reprinting "after prelims" and
  "after XY" (#16); standings and the stats calculator (#8); the viewer improvements in #63 beyond
  showing the published version.
* Future work: recording a quiz's lane in the scoresheet's quiz file, so results from two
  consolation lanes that both letter from A can't share a name (W-5 covers it until then).
* There are no tie-breaker quizzes. Ties in the standings are broken on the record (head-to-head
  results, then total prelim points, then fewest errors), which is the standings' job (#8), so the
  schedule never needs a slot for one. The rule book's tie-breaker quiz at positions 6, 15 and 24
  isn't used.
* Placement labels on elim quizzes (`(6, 7)` beside a quiz, as in the 2021 to 2023 printouts) are
  out of scope; later printouts dropped them.
* Drag interactions use pointer events, per the constitution. The builder targets a laptop or larger
  for building, with phones covered for on-the-day fixes (FR-005b); touch dragging isn't required,
  since every drag has a select-then-choose equivalent (FR-005a).
* Meet phases and division states stay as they are.
* Storage on a server, accounts, and sharing between people are out of scope for standalone
  schedules for now; files cover sharing.
