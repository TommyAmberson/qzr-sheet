# Feature Specification: Meet day: one page, in tabs

**Feature Branch**: `docs/meet-day-spec`

**Created**: 2026-11-20

**Status**: Draft

**Input**: User description: "I don't like the results being separated from the stats like how it
is. And it should be better integrated with the schedule. Maybe the results page should have tabs?
Schedule, quiz results, standings." Shaped with the maintainer into the "Meet day layout" mockups:
one meet page with three tabs, the schedule as the backbone.

## Context

Today a meet day is spread over separate pages that each show the same quizzes in their own way:

* **Schedule**: the published schedule, with nothing on it about what has been played.
* **Results**: the admins' and officials' desk: upload, what needs attention, and every stored quiz
  with its stage, link and acceptance.
* **Stats**: the divisions, then a division's standings, its quizzer standings and its quizzes
  again, by stage. Its settings page mixes each division's steps through the day with what viewers
  see.

An admin running a meet reads the standings on one page, fixes the quiz on another, and confirms a
division's step on a third. A viewer following the day cannot see on the schedule which quizzes have
been played or how they went.

This feature puts the meet day on one page with three tabs, **Schedule**, **Quizzes** and
**Standings**, built on one idea: every quiz is a scheduled quiz, and a stored result is that quiz
played. The three tabs are three views of the same quizzes: when and where, what happened and what
to fix, and what it adds up to. Two more tabs hold what is set up before the day: **Roster** (the
churches, teams and quizzers) and **Setup** (the meet's details and phase, rooms and codes,
members), so the whole meet is one page.

It reorganizes pages that exist. The rules of meet stats (`specs/006-meet-stats/`) are unchanged:
what counts, how standings are ranked, what viewers may see and when, and what needs an admin's
attention.

## Clarifications

### Session 2026-11-20

* Q: Should the meet page update itself while open, as quizzes come in? → A: Yes: it re-reads on
  reload, on switching tabs, when the browser tab comes back into view, with a Refresh control, and
  every 30 seconds while the browser tab is visible.
* Q: Where should the meet's setup live? → A: In two more tabs: Roster (churches, teams and
  quizzers), shown to whoever may read rosters today, and Setup (details and phase, rooms and codes,
  members), shown to admins only.
* Q: Should benches filled from results (#16) be part of this, and how? → A: Yes. Each bench's team
  follows from the confirmed orders and the quizzes that count, without writing into the published
  schedule, and it reaches the Schedule tab, the scoresheet opening a scheduled quiz, and the check
  of a stored quiz's teams. Order confirmed: prelim-seeded benches fill; each elimination quiz
  counted: the benches its winner, 2nd and 3rd feed fill.
* Q: Should the stats settings move into the Setup tab? → A: Yes: they become a section of the Setup
  tab, the old settings address opens it, and the division steps sit there and on the Standings tab.
* Q: Before a meet goes live, which tab should the page open on? → A: Schedule, for everyone, in
  every phase.
* Q: Should someone be able to follow one team across the tabs? → A: Later, not in this feature: the
  division picker is the only filter.
* Q: Before a division's order is confirmed, should its benches show provisional teams from the live
  standings? → A: No: a bench seeded from an order shows its source alone until an admin confirms
  the order and moves the division on, even where the live standings are shown.
* Q: Which division should the picker start on? → A: Every division, unless the page's address names
  one; nothing is remembered between visits, since that is part of following, which comes later.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Follow the day on the schedule (Priority: P1)

Anyone following a meet opens it and sees its published schedule as it is printed for the meet:
rooms across, times down, days and breaks marked, and each quiz's benches with their letters and
teams. As quizzes are played, the schedule fills in: beside each team of a played quiz, its place
and, where the meet shows them, its score. A quiz not in yet stays plain. An admin also sees which
quizzes need attention, marked on the schedule itself.

**Why this priority**: The schedule is what everyone at a meet already reads. Making it the place
results appear removes the most page-hopping for every role, and it is the backbone the other two
tabs hang from.

**Independent Test**: In a live meet with a published schedule, store some quizzes linked to their
scheduled quizzes, one of them with errors. Open the meet as an admin and as a viewer and read the
Schedule tab.

**Acceptance Scenarios**:

1. **Given** a live meet with a published schedule, **When** anyone who may read the meet opens it,
   **Then** the Schedule tab shows the schedule in the published schedule's layout: a column per
   room headed by its divisions, a row per time, day bands, events such as lunch, and each quiz's
   benches with letter and team.
2. **Given** a scheduled quiz whose result is stored and counts, **When** the Schedule tab is read,
   **Then** that quiz is marked played and each of its teams shows its place, and its score where
   the stage's results show scores to this reader.
3. **Given** a scheduled quiz with no stored result, **When** the Schedule tab is read, **Then** it
   shows as not in yet, with nothing beside its teams.
4. **Given** a stored quiz in error and not accepted, **When** an admin, or the official of its
   room, reads the Schedule tab, **Then** the quiz is marked as needing attention with what is wrong
   in a few words; **When** a viewer reads it, **Then** it shows as under review, with its teams and
   no places.
5. **Given** an elimination bench seeded from the prelim order, **When** the order is confirmed,
   **Then** the bench names its team beside its source (for example "1st prelim · Cedar Grove 1");
   before then it shows only its source.
6. **Given** a bench fed by an earlier quiz's place (for example "winner of Quiz A"), **When** that
   quiz counts, **Then** the bench names its team; before then it shows only its source.
7. **Given** a meet with no published schedule, **When** the Schedule tab is opened, **Then** it
   says the schedule hasn't been published, and the Quizzes and Standings tabs still work.

---

### User Story 2 - Every quiz and what to fix, in one list (Priority: P1)

An admin opens the Quizzes tab and finds everything that needs attention at the top, across
divisions, each item leading to its fix, then every quiz of the meet by stage: played, in error,
accepted, and scheduled but not in yet. Stored quizzes the schedule doesn't match are listed apart
until they are linked. Officials see the quizzes of their rooms with what is wrong with them;
viewers see the quizzes as far as the meet's settings allow.

**Why this priority**: It replaces the results page, the admin's working desk on a meet day; without
it the admin loses every action the results page has.

**Independent Test**: With quizzes stored as in Story 1 plus one not on the schedule, open the
Quizzes tab as an admin and clear each item needing attention from there; open it as an official and
as a viewer.

**Acceptance Scenarios**:

1. **Given** stored quizzes, **When** an admin opens the Quizzes tab, **Then** what needs attention
   is listed first, across every division, with every item and action the results page has today
   (FR-029 to FR-032 of meet stats).
2. **Given** a published schedule, **When** the Quizzes tab is read, **Then** each stage lists its
   scheduled quizzes, whether in or not, and a quiz not in yet is marked so, with when and where it
   is.
3. **Given** a stored quiz the schedule doesn't match, **When** an admin reads the Quizzes tab,
   **Then** it is listed in a group of quizzes not on the schedule, with a way to link it.
4. **Given** quizzes listed, **When** an admin narrows by division, stage or whether a quiz needs
   attention, **Then** only those quizzes show, and setting a stage for every quiz shown, or
   accepting every one in error, acts on those alone.
5. **Given** an official of one room, **When** they read the Quizzes tab, **Then** they see what is
   wrong with their room's quizzes only; **Given** a viewer, **Then** they see no attention list,
   and the quizzes, scheduled or not, only as a division's stats would list them for that viewer: a
   stage's results only from its moment and at its level, a quiz in error as under review with its
   teams alone, and never a quiz that doesn't count.

---

### User Story 3 - A division's standings and its day (Priority: P2)

Anyone opens the Standings tab, picks a division, and reads its prelim standings, the re-rank after
the intermediates, its quizzer standings and the Finals' first three, as far as the meet's settings
give them. An admin sees the division's steps through the day there too, with what's missing before
the next step and the control to take it.

**Why this priority**: The stats page already gives this; the tab brings it beside the schedule and
the quizzes and adds the division's steps where the admin reads the standings that the steps
confirm.

**Independent Test**: In a division with its prelims in, open the Standings tab as an admin, confirm
the prelims from there, and read the tab as a viewer before and after.

**Acceptance Scenarios**:

1. **Given** a division, **When** anyone who may read the meet opens the Standings tab, **Then** it
   shows that division's tables as the division stats page does today, including printing and, for
   admins, downloading.
2. **Given** an admin, **When** they open the Standings tab, **Then** the division's steps show with
   the current one marked, what's missing before the next, and the control to move on or take a step
   back, with the same warnings and confirmations as the Setup tab's stats settings.
3. **Given** the Setup tab's stats settings, **When** an admin opens them, **Then** the division
   steps are there as well, and both places act on the same steps.
4. **Given** a viewer before anything is visible to them, **When** they open the Standings tab,
   **Then** it says what will appear and when, rather than showing an empty page.

---

### User Story 4 - One division across the tabs (Priority: P2)

Someone following one division picks it once, and every tab shows that division until they choose
another. The page's address says which tab and division are showing, so it can be shared or
bookmarked.

**Why this priority**: Most people at a meet follow one division; without this they filter three
times.

**Independent Test**: Pick a division on the Schedule tab, switch to Quizzes and Standings, reload,
and open the copied address in another window.

**Acceptance Scenarios**:

1. **Given** a division picked on one tab, **When** the reader switches tabs, **Then** the other tab
   shows the same division.
2. **Given** "every division" picked, **When** the reader opens the Standings tab, **Then** it shows
   the first division, since standings are read one division at a time.
3. **Given** a tab and division showing, **When** the address is copied and opened elsewhere by
   someone who may read the meet, **Then** the same tab and division show; someone signed out is
   asked to sign in and then taken there.
4. **Given** an address of an old page (results, stats, a division's stats, the schedule), **When**
   it is opened, **Then** the matching tab and division show.

---

### User Story 5 - The meet day on a phone (Priority: P3)

On a phone, the tabs fit across the top, the division picker scrolls sideways, and the schedule is a
list by time for the division picked, each quiz a card with its benches and, once played, places and
scores.

**Why this priority**: Viewers and coaches mostly follow on phones, but the desktop layout works
there today, if awkwardly, so this comes after the structure.

**Independent Test**: Open the meet at phone width and use each tab.

**Acceptance Scenarios**:

1. **Given** a phone-width window, **When** the meet page opens, **Then** every tab is reachable,
   the tabs scrolling sideways on their own if they don't fit, and the page itself never scrolls
   sideways.
2. **Given** the Schedule tab at phone width with a division picked, **When** it is read, **Then**
   the quizzes are a list by time, the one under way marked, each with its benches and result.

### Edge Cases

* A confirmed order taken back: every bench it seeded shows its source alone again, and so do
  benches fed by quizzes filled from it, until a new order is confirmed.
* Teams tied across a seeding cutoff, which the admin settles away from the app: the tied benches
  show their source alone, marked as tied, until the order is confirmed. A confirmed order that
  still marks teams tied after every tie-breaker is taken in the order it lists them; three
  tie-breakers leave next to none, and a way for the admin to record how they settled one comes
  later.
* A source quiz in error and not accepted, or not counted: the benches it feeds show their source
  alone.
* A meet in registration or build: the tabs show, with nothing in them for anyone but admins and
  coaches beyond what they can read today, and each says why.
* A practice meet with no schedule: the Schedule tab says so; the Quizzes tab lists stored quizzes
  by division and stage, for admins and officials as the results page does today and for everyone
  else as the division stats pages do.
* A stage whose results a reader may not see yet: every scheduled quiz of that stage shows to them
  as "result not shown yet", whether it is in or not, so the page never tells them a quiz has been
  played before the settings would.
* A quiz stored in no division, or in a division the meet doesn't list: it shows only on the Quizzes
  tab, among what needs attention.
* Two stored quizzes linked to the same scheduled quiz cannot happen today; the link rules of meet
  stats stand.
* A Finals with no decided winner because teams are level in an overtime not played out (#199): the
  Schedule tab shows it as needing attention for admins and under review for viewers, as any quiz in
  error.
* A quiz accepted as scored is placed by its scores, as on the results page after #200.
* A scheduled quiz with a bench left empty in the schedule: the bench shows as the schedule shows
  it.
* A very wide meet (many rooms): the schedule scrolls sideways inside its own box, never the page.

## Requirements _(mandatory)_

### Functional Requirements

**The page**

* **FR-001**: A meet's main page MUST have the tabs Schedule, Quizzes, Standings, Roster and Setup,
  and MUST open on Schedule for everyone, whatever the meet's phase.
* **FR-002**: Everyone who may read the meet MUST see the Schedule, Quizzes and Standings tabs. What
  each shows MUST follow the division's state and the meet's settings as meet stats decides them,
  and a tab with nothing this reader may see yet MUST say so and why.
* **FR-003**: The Quizzes tab MUST carry, for admins, the number of things that need attention.
* **FR-004**: A division picker MUST filter every tab, offer every division as well where the tab
  allows it, and stay set as the reader moves between tabs. It MUST start on every division unless
  the page's address names one, and MUST NOT remember a choice between visits.
* **FR-005**: The tab and division showing MUST be part of the page's address, and the addresses of
  today's schedule, results, stats, division stats and stats settings pages MUST open the matching
  tab and division.
* **FR-006**: The Roster tab MUST hold the meet's churches, teams and quizzers, shown to whoever may
  read them today and edited by whoever may edit them today. The Setup tab MUST hold the meet's
  details and phase, its rooms and codes, its members and its stats settings (what viewers see and
  when, scoring, and the division steps), shown to the meet's admins only.
* **FR-007**: Uploading quiz files MUST be in the meet page's header, shown on every tab to those
  allowed to send quizzes.
* **FR-022**: The meet page MUST keep itself current while open: it MUST read the meet again when
  the reader switches tabs, when the browser tab comes back into view, when the reader asks with a
  Refresh control, and every 30 seconds while the browser tab is visible, and MUST NOT read it while
  the browser tab is hidden.

**Schedule tab**

* **FR-008**: The Schedule tab MUST show the published schedule in the published schedule's layout:
  rooms as columns with their divisions, time rows, day bands, events, and each quiz's benches with
  letter and team.
* **FR-009**: Each scheduled quiz MUST show its status: played, needing attention (for admins and
  its room's official), under review (for everyone else), not counted (for admins and its room's
  official, where an admin set the quiz not to count; not in yet for everyone else), not in yet, or
  result not shown yet (for a reader who may not see that stage's results yet, whether the quiz is
  in or not).
* **FR-010**: A played quiz MUST show each team's place beside it and its score where this reader
  may see the stage's scores.
* **FR-011**: A bench whose team comes from a result (#16) MUST name its team beside its source as
  soon as that source is settled: a prelim rank or re-rank once that order is confirmed, an earlier
  quiz's place once that quiz counts, a round robin's points once its quizzes count. Until then it
  MUST show its source alone, even where the reader is shown the live standings. A reader MUST see
  the team only if they may see the source it comes from: admins every source, officials every
  result and confirmed order (FR-019 of meet stats) and the draw as the schedule shows it to them,
  in letters until the meet is under way.
* **FR-023**: A bench's team, once settled, MUST also fill that bench when the scoresheet opens the
  scheduled quiz, and MUST be what the check of a stored quiz's teams against its scheduled quiz
  compares with. The published schedule itself MUST stay as published.
* **FR-012**: A quiz's title MUST open the quiz: its result, revisions and history, and for an
  official of its room or an admin, the scoresheet for it.

**Quizzes tab**

* **FR-013**: The Quizzes tab MUST keep every action of today's results page: what needs attention
  with each item's actions, stages, links, acceptance, merging names and dismissing look-alike
  flags.
* **FR-014**: With a published schedule, the Quizzes tab MUST list each stage's scheduled quizzes
  whether in or not, each with its status, and MUST list stored quizzes the schedule doesn't match
  in a group of their own. For a reader who is neither an admin nor an official, both lists hold
  only what FR-024 gives them.
* **FR-015**: The Quizzes tab MUST be narrowable by division, stage and whether a quiz needs
  attention, and actions on every quiz shown MUST act on those alone.
* **FR-016**: An official MUST see what is wrong with their own room's quizzes only, and a viewer no
  attention list, as meet stats decides today.

**Who sees what, and when**

* **FR-024**: Every tab MUST give each reader exactly what meet stats' rules of who sees what, and
  when, give them (`specs/006-meet-stats/`, FR-017 to FR-021, applied through the same cut as a
  division's stats), and nothing those rules hold back. In particular, for anyone but an admin:
  nothing at all in registration and build; a stage's results only from the moment the settings set
  and at their level (places, or places and scores); a quiz in error and not accepted only as under
  review with its teams' names; a quiz set not to count never, the schedule showing it as not in
  yet; a bench's team only once its source is settled and the reader may see that source; and the
  attention list for admins only. An official additionally sees their own room's quizzes with what
  is wrong with them, as the results page shows them today.

**Standings tab**

* **FR-017**: The Standings tab MUST show one division's tables as the division stats page does
  today, with printing for everyone and downloading for admins.
* **FR-018**: For admins, the Standings tab MUST show the division's steps, the current one marked,
  what's missing before the next, and the controls to move on and take a step back, with the same
  warnings and confirmations as the Setup tab's stats settings.
* **FR-019**: The Setup tab's stats settings MUST keep the division steps as well, both places
  acting on the same steps.

**Pages that go**

* **FR-020**: The separate results, stats, division stats and stats settings pages MUST give way to
  the tabs, their addresses leading to the matching tab (FR-005). A stored quiz's own page MUST
  stay.

**Phone**

* **FR-021**: At phone width every tab MUST be reachable, the tabs and the division picker each
  scrolling sideways on their own where they don't fit, the page itself never; and the Schedule tab
  MUST show the division's quizzes as a list by time, the one under way marked: the time slot that
  contains the current time in the meet's time zone, or before the day's first slot, none.

### Key Entities

* **Scheduled quiz**: a quiz of the published schedule: when, which room, its division and stage,
  its benches. The unit every tab lists.
* **Stored quiz**: a quiz as sent from a scoresheet or uploaded, with its revisions. Linked to the
  scheduled quiz it played, or listed apart as not on the schedule.
* **Quiz status**: played, needing attention, under review, not counted, not in yet, or result not
  shown yet: what a scheduled quiz's stored result, its errors and its acceptance say, as this
  reader may see it.
* **Bench**: a place in a scheduled quiz: where its team comes from (a draw letter, a rank in a
  confirmed order, a place in an earlier quiz, points across a round robin), and which team that is
  once its source is settled.
* **Division**: the unit the picker filters by; each has its steps through the day and its tables.

No new data is stored: the tabs read what the schedule and meet stats already hold.

## Success Criteria _(mandatory)_

### Measurable Outcomes

* **SC-001**: An admin gets from any tab to the action that fixes any item needing attention in at
  most two clicks.
* **SC-002**: A viewer gets from opening a meet to a division's standings in at most two clicks, and
  to how a given scheduled quiz went in one.
* **SC-003**: A meet day needs one page plus a quiz's own page, where today it takes up to five
  (schedule, results, stats, a division's stats, stats settings).
* **SC-004**: Every scheduled quiz's status is readable on the Schedule tab without opening
  anything.
* **SC-005**: At a phone width of 390 px, no tab makes the page scroll sideways.
* **SC-006**: Every address of today's schedule, results, stats and division stats pages still opens
  what it showed, on the matching tab.
* **SC-007**: A viewer sees nothing on any tab that meet stats would not give them today (FR-024),
  including whether a quiz of a stage they may not see yet has been played.

## Assumptions

* The rules of meet stats stand: what counts, ranking, what viewers see and when, what needs
  attention and who sees it (`specs/006-meet-stats/`).
* Portal and scoresheet papercuts (#200) is merged first: the results list without its From column,
  accepted quizzes placed by their scores, scoresheet links opening a new tab on desktop, the quiz
  page's names grid, "Preview as viewer", and signed-out deep links continuing after sign-in.
* The separate team names section of the meet page is not brought back (#186).
* Benches are filled from results as #16 asks, without changing the published schedule: a bench
  keeps where its team comes from, and which team that is follows from the confirmed orders and the
  quizzes that count, as the schedule's design keeps the two apart (`docs/scheduling.md`, "Def vs
  resolution layering"). This closes #16.
* The schedule's own editing stays where it is, reached from the meet page by admins.
* A meet with no published schedule keeps working: the Quizzes tab lists its stored quizzes for
  admins and officials as the results page does today, and for everyone else as the division stats
  pages do.
* Printing and downloading stay per division, from the Standings tab.
* Following one team, its quizzes picked out across the tabs, and remembering a reader's division
  between visits come later (#201); the division picker is the only filter here.
