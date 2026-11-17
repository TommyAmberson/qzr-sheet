# Feature Specification: Each scoresheet tab keeps its own quiz, and recent quizzes are kept

**Feature Branch**: `feat/tab-autosaves`

**Created**: 2026-11-16

**Status**: Draft

**Input**: User description (issue #176, as rewritten 2026-11-16): "Give each scoresheet tab its own
auto-save. Each tab keeps its own quiz and meet link, and quizzes left by closed tabs can be found
again: a new tab offers to restore them from a list, and Open has a way to see them at any time."
Widened in clarification to keep recent quizzes, saved and unsaved, with their undo history.

## Context

The scoresheet keeps the quiz on the sheet, and the meet it is linked to, in the browser as it is
scored, so that a reload or a crash loses nothing. There is one such copy per browser. Every tab
reads it when it opens and writes it as it changes, and no tab knows about another.

That was enough while an official scored in one tab. It no longer is:

* **The portal opens quizzes in the scoresheet.** Someone looking at several stored quizzes opens
  each in a new tab to see them side by side. Each tab first reads the last tab's quiz, then asks
  whether to throw away "unsaved changes" that were never theirs, and replaces the copy.
* **The last tab to write wins.** Each tab writes its own quiz over the copy. Reloading any tab
  brings back whichever was written last, not the one that tab showed.
* **A quiz being scored can lose its copy or its link.** A tab opened for a look replaces the
  scoring tab's copy. The scoring tab writes its quiz back on its next edit, but not its meet link,
  so after a reload it can come back linked to another tab's meet or scheduled quiz. Once a
  submission names the scheduled quiz it is linked to (the stats work), that quiz would be sent
  against the wrong one.

The same happens with two tabs opened by hand, and would happen with a link from the scoresheet to
the portal opened in a new tab (#122, which waits on this).

Two smaller losses sit beside it. A quiz replaced by New or Open is gone once the official says yes
to "unsaved changes will be lost", and undo history never survives a reload.

This feature gives every tab its own copy, keeps the quizzes a tab no longer shows as recent quizzes
to go back to, and keeps undo history with every quiz.

## Clarifications

### Session 2026-11-16

* Q: With exactly one unsaved quiz left by a closed tab and no other tab open, does it come back by
  itself or get offered? → A: By itself, as today (FR-010).
* Q: When New, Open or restoring replaces a quiz, is that quiz lost or kept? → A: Kept: it goes to
  the recent quizzes with no question, and the action goes ahead (FR-019).
* Q: Which quizzes are kept, and with what? → A: Every quiz a tab no longer shows, saved and
  unsaved, as recent quizzes, each with its undo history; unsaved ones are offered back, saved ones
  only listed (FR-008, FR-020).
* Q: How many are kept? → A: The 80 most recently changed unsaved quizzes and the 40 most recently
  changed saved ones (FR-009).

### Session 2026-11-17

* Q: When the official starts a blank quiz instead of restoring the offered ones, are those offered
  again on the next new tab? → A: No: each quiz left by a closed tab is offered once; later tabs
  offer only quizzes left since, and the rest stay under Recent quizzes (FR-010).
* Q: What makes two kept quizzes the same quiz, and how many copies of one are kept? → A: A quiz is
  one undo history. New starts a new one; reload and restore continue it; Open continues the recent
  quiz whose current, last saved or last submitted state matches what is opened, from that state,
  and starts a new one when none does. A quiz is saved when its current state, however reached,
  matches its last save to a file or its last submission; redo steps are kept. Each quiz is kept
  once, carrying its current state and, where they differ, its last saved and last submitted states,
  each with its undo history up to that state. Continuing from an earlier state and editing splits
  off the later states as a quiz of their own (FR-008, FR-009, FR-022, FR-023).
* Q: When Open matches a quiz that is open in another tab, what happens? → A: The official is told
  it is open in another tab, and it opens here as a new quiz with an empty undo history (FR-023).
* Q: How are a quiz's several kept states shown under Recent quizzes? → A: As separate rows, one per
  state, each saying which it is; restoring a row brings the whole quiz back in that state (FR-012,
  FR-013).
* Q: Is a quiz with no edits since it was started kept? → A: Not when nothing was done by hand:
  names filled in by itself on starting or opening (from the schedule, a link or the roster) don't
  count, so it is still new. Once edited by hand, every change counts, roster changes included.
  Quizzes opened from a file or a submission are kept, being saved (FR-008).
* Q: On a device shared by several people, are recent quizzes kept, and how are they cleared? → A:
  Kept, like files saved to the device, with a "Discard all" in Recent quizzes that asks first
  (FR-014).

### Session 2026-11-18

* Q: Does a quiz's meet link count as part of its state when deciding whether it is saved, or
  whether an opened file matches a recent quiz? → A: Against its last file save, only what a file
  holds counts (no link); against its last submission, the scheduled quiz it went to counts too. A
  file that matches continues the recent quiz with its link (FR-009, FR-023).
* Q: How many undo steps does a quiz keep? → A: Up to 1000, raised from today's 100; beyond that the
  oldest fall off, and the saved states are still kept (FR-020, SC-007).

### Session 2026-11-19

* Q: Which changes to a quiz become undo steps? → A: Every change to what a quiz file holds, after
  the first edit by hand: answers, no-jumps, timeouts, team and quizzer names, on-time marks,
  quizzer order, question types, division, quiz number, consolation and overtime, roster changes
  included. Changes made by themselves on starting or opening, before any edit by hand, are the
  quiz's start, not steps (FR-020).
* Q: How much typing in a name field makes one undo step? → A: One step per visit to the field:
  everything typed from entering it until leaving it, or until another edit, undoes as one (FR-020).
* Q: Do Clear answers and Clear names become undo steps, instead of emptying the undo history? → A:
  Yes: each is one step that undo takes back, and the history goes on; a quiz's history begins only
  at New or Open (FR-020, FR-022).

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Several quizzes open at once, each kept (Priority: P1)

An official or admin opens several quizzes in separate tabs, from the portal or by hand, looks at
them side by side, edits one, and reloads any tab. Each tab keeps showing the quiz it had, with its
own meet link, and none of them disturbs another.

**Why this priority**: it is the fault that makes several tabs unsafe today, and it can send a quiz
against the wrong scheduled quiz. Everything else builds on each tab having its own copy.

**Independent Test**: open three quizzes from the portal in three tabs, edit one, reload each in
turn: each shows the quiz it had, linked as it was, and no tab asked about another tab's changes.

**Acceptance Scenarios**:

1. **Given** a tab scoring a quiz, **When** another quiz is opened in a new tab, **Then** the new
   tab opens it without asking about unsaved changes, and the first tab's quiz and link are as they
   were, including after the first tab is reloaded.
2. **Given** several tabs each showing a different quiz, **When** any one is reloaded, **Then** it
   shows the quiz, answers, names and meet link it had before the reload.
3. **Given** a tab linked to one meet and scheduled quiz and another linked to a different one,
   **When** each submits, **Then** each sends its own quiz against its own link.
4. **Given** a tab, **When** the browser duplicates it, **Then** the copy shows the same quiz and
   link, and from then on each keeps its own: an edit in one does not appear in the other, before or
   after a reload.
5. **Given** a quiz scored in a tab, **When** the browser crashes and restores its tabs, **Then**
   each restored tab shows the quiz it had.

---

### User Story 2 - Get back an unsaved quiz (Priority: P2)

An official closes a tab, or the browser, with a quiz that was never saved to a file or submitted,
or replaces it with New or Open. When they next open the scoresheet, an unsaved quiz left by a
closed tab comes back by itself, or is offered among others when there are several.

**Why this priority**: per-tab copies would otherwise strand a closed tab's quiz where nothing shows
it. Today the one shared copy comes back by itself; this keeps that safety net, and adds one for
quizzes replaced by New or Open.

**Independent Test**: score part of a quiz in a tab, close it, open the scoresheet in a new tab: the
quiz comes back with its answers, names and link. Do it with two tabs closed: both are offered.

**Acceptance Scenarios**:

1. **Given** one unsaved quiz left by a closed tab and no other tab open, **When** the scoresheet is
   opened in a new tab with no quiz to open, **Then** that quiz comes back without a question, with
   its answers, names, division, number and meet link.
2. **Given** a quiz that was saved to a file after its last change, **When** its tab is closed and
   the scoresheet opened again, **Then** the sheet opens blank, and the quiz is listed under Recent
   quizzes.
3. **Given** several unsaved quizzes left by closed tabs, or one while another tab is open, **When**
   a new tab opens with no quiz to open, **Then** they are listed together, each by its quiz name,
   teams, number of answers and when it was last changed, with a choice to start a blank quiz
   instead.
4. **Given** a sheet with unsaved changes, **When** the official chooses New or Open, **Then**
   nothing is asked, the new quiz is shown, and the quiz it replaced is listed as unsaved under
   Recent quizzes.
5. **Given** a tab opened by a link from the portal, **When** it opens, **Then** it opens the linked
   quiz without asking about unsaved quizzes, and says only that there are some, with a way to see
   them.
6. **Given** unsaved quizzes offered on a new tab and passed over for a blank quiz, **When** another
   tab opens later, **Then** they are not offered again, only quizzes left by tabs closed since, and
   the ones passed over are still listed under Recent quizzes.

---

### User Story 3 - Go back to a recent quiz at any time (Priority: P3)

From the Open menu, an official lists the recent quizzes, unsaved ones first, and restores or
discards any of them, whenever they like, with no network needed.

**Why this priority**: the offer on a new tab can be passed over, tabs opened by a portal link don't
make it, and saved quizzes are never offered; this is the place that is always there.

**Independent Test**: with two unsaved and two saved recent quizzes, choose Open, Recent quizzes:
all four are listed, the unsaved ones first and marked; restore one, discard another.

**Acceptance Scenarios**:

1. **Given** recent quizzes, **When** the official chooses Open, Recent quizzes, **Then** they are
   listed with the unsaved ones first and marked as unsaved, each by its quiz name, teams, number of
   answers and when it was last changed, with a way to restore or discard it.
2. **Given** a recent quiz, **When** it is restored in a tab, **Then** it becomes that tab's quiz,
   with its meet link, and is no longer listed; the quiz the tab showed goes to the recent quizzes.
3. **Given** a recent quiz, **When** the official discards it, **Then** after confirming it is gone
   for good.
4. **Given** a quiz that is open in another tab, **When** the list is shown, **Then** that quiz is
   not in it.
5. **Given** no recent quizzes, **When** the official chooses Open, Recent quizzes, **Then** the
   list says there are none.
6. **Given** a quiz submitted yesterday and since replaced, **When** the official restores it from
   Recent quizzes with no network, **Then** it opens as it was submitted.
7. **Given** a quiz saved to a file, then submitted after more edits, then edited again, **When** it
   is listed, **Then** it shows as three rows, its current state (unsaved), as saved to a file, and
   as submitted, and restoring any of them brings the quiz back in that state; had it been submitted
   as it was saved, those two would be one row.
8. **Given** a quiz started from the schedule with the rosters' names filled in and nothing done by
   hand, **When** its tab is closed, **Then** it is not kept.

---

### User Story 4 - Undo survives a reload and a restore (Priority: P4)

An official reloads a tab, or restores a recent quiz, and can still undo the edits made before.

**Why this priority**: a reload today takes undo away, so a mistake found after one can only be
fixed by hand. It is the least urgent part, and can ship after the others.

**Independent Test**: score five answers, reload, undo five times: the answers are removed one by
one, newest first. Do the same after the quiz has been replaced and restored from Recent quizzes.

**Acceptance Scenarios**:

1. **Given** a tab with edits made, **When** it is reloaded, **Then** undo and redo step through the
   same edits as before the reload.
2. **Given** a recent quiz restored into a tab, **When** the official undoes, **Then** the edits
   made before it was replaced are undone in order, newest first.
3. **Given** a quiz sent to the meet or saved to a file, **When** its file or submission is looked
   at, **Then** it carries no undo history.
4. **Given** a team name typed in, an on-time mark set and the division changed, **When** the
   official undoes three times, **Then** each is taken back in turn, the whole typed name at once.
5. **Given** answers scored and then cleared with Clear answers, **When** the official undoes,
   **Then** the answers come back.
6. **Given** a quiz saved, then renamed and scored further, and restored from Recent quizzes as
   saved, **When** the official redoes every step, **Then** the sheet shows exactly the quiz as it
   was last left, names included.

---

### Edge Cases

* **The only tab is closed and the scoresheet is opened again later**, the everyday case for one
  official on one device. With exactly one unsaved quiz left over and no other tab open, it comes
  back by itself, as today. A quiz that was saved to a file or submitted before its tab closed is
  not offered, so the scoresheet opens blank, and the quiz is under Recent quizzes: today it would
  bring back the finished quiz.
* **A tab is reloaded.** It keeps its own quiz and undo history; a reload never offers recent
  quizzes.
* **The same file is opened again**, or the same stored quiz again from the portal, after its tab
  closed. Open finds the recent quiz in that state and continues it (FR-023), so it is still one
  entry, with its undo history.
* **A backup file of a quiz linked to a meet is opened** after its tab closed. It matches the recent
  quiz, so it opens linked as it was and can be submitted; a file that matches nothing opens
  unlinked, as today.
* **A file older than the quiz's last save is opened.** Its state is in the quiz's history but is
  none of its kept states, so it opens as a new quiz.
* **A duplicated tab** copies the quiz and its history; from then on the copy is a quiz of its own,
  since their histories part.
* **Undoing past a save and editing** drops the redo steps, and with them the saved state from the
  current history; the quiz still keeps that saved state, with its own history, to restore.
* **Two tabs try to restore the same recent quiz at once.** One gets it; the other is told it was
  taken and is offered the rest.
* **More than 80 unsaved quizzes**, or more than 40 saved. The least recently changed of that kind
  is dropped to make room. Dropping an unsaved quiz is said once, the next time the official opens
  the list or a new tab, naming the quiz.
* **Storage is full.** Saving the tab's quiz fails; the tab says so, as it does for any other failed
  write, which master never did (#92). No unsaved quiz is removed to make room without the
  official's say; saved ones may be, oldest first.
* **A quiz from a newer version of the scoresheet** is found among the recent quizzes. It is listed,
  marked as from a newer version, and opening it warns that it may be scored wrong, as the kept quiz
  from a newer version does today.
* **An undo step that also changed the meet's picks** (moving or replacing a team) undoes the
  sheet's part after a reload or restore, and the links take the names as they would take them typed
  back by hand: each seat is held against its quizzer by name, and a team's pick stays, flagged when
  its name no longer names it, as it is when undoing after another meet was linked.
* **Updating the scoresheet.** The single copy kept by the previous version becomes the first tab's
  quiz, with no question and an empty undo history, so an official mid-quiz notices nothing.
* **The tutorial** runs in one tab, keeps that tab's quiz aside while it runs and gives it back when
  it ends, as today; a crash during the tutorial gives that tab's quiz back, not another tab's. The
  tutorial's own practice quiz is never kept as a recent quiz.
* **The desktop and Android apps** have one window, so one tab; they keep recent quizzes and undo
  history like a browser.
* **A device shared by several people.** Recent quizzes stay, signed in or not, like files saved to
  the device, including quizzes from a meet the next person can't open; signing out leaves them.
  "Discard all" clears them before handing the device on.
* **Private browsing** keeps nothing after the window closes, as today.

## Requirements _(mandatory)_

### Functional Requirements

**Each tab's own quiz**

* **FR-001**: Each tab MUST keep its own copy of the quiz on its sheet and of its meet link,
  separate from every other tab's, written as it changes as today.
* **FR-002**: Reloading a tab MUST bring back that tab's own quiz and link, never another tab's, and
  MUST NOT offer recent quizzes.
* **FR-003**: A tab opened to open a quiz (a portal link, or a link that starts a scheduled quiz)
  MUST NOT ask about unsaved changes: a new tab has none.
* **FR-004**: A tab duplicated by the browser MUST start with the original's quiz, link and undo
  history and from then on keep its own, so that neither tab's edits reach the other.
* **FR-005**: A tab restored by the browser after a crash or a restart MUST bring back the quiz it
  had.
* **FR-006**: Submitting MUST send the tab's own quiz with the tab's own meet and scheduled quiz
  link.
* **FR-007**: Sign-in, meet codes and guest sessions, and the list of team names fetched for
  suggestions, MUST stay shared by every tab, as today: they belong to the person, not to a quiz.

**Recent quizzes**

* **FR-008**: A tab's quiz MUST be kept as a recent quiz when its tab closes and when New, Open or
  restoring replaces it (FR-019), with its answers, names, division, number, meet link, undo
  history, when it was last changed, and whether it is unsaved. Each quiz (FR-022) MUST be kept
  once: keeping it again replaces what was kept before. A quiz with nothing done by hand since New
  or Open MUST NOT be kept, unless it has a saved or submitted state: names filled in by itself on
  starting or opening (from the schedule, a link or the roster) don't count, so such a quiz is still
  new. After the first edit by hand, every change counts, roster changes included.
* **FR-009**: A quiz is saved when its current state matches the state it was last saved to a file
  in, or last submitted in, and unsaved otherwise. Against a file save, the state is what a quiz
  file holds (teams, names, answers and settings, not the meet link); against a submission, it is
  that and the scheduled quiz it was sent to, so linking to another scheduled quiz makes it unsaved.
  The state is what counts, not how it was reached: undoing, or editing by hand, back to a saved
  state makes it saved again, and redo steps are kept, so undoing to a saved state loses nothing.
  The 80 most recently changed unsaved quizzes and the 40 most recently changed saved ones MUST be
  kept; beyond that the least recently changed of that kind is dropped, and dropping an unsaved one
  MUST be said once, naming it.
* **FR-010**: A tab opened with no quiz to open, when exactly one unsaved quiz was left by a closed
  tab and no other tab is open, MUST bring that quiz back without asking, as today. Otherwise, when
  any unsaved quizzes were left by closed tabs, it MUST offer them, listed with each one's quiz
  name, teams, number of answers and when it was last changed, and a choice to start a blank quiz
  instead. Each such quiz MUST be offered once: a later tab offers only quizzes left since the last
  offer, and those passed over stay under Recent quizzes (FR-012). Saved recent quizzes are not
  offered.
* **FR-011**: A tab opened by a link MUST open the linked quiz without the offer, and MUST say that
  unsaved quizzes exist, with a way to see them.
* **FR-012**: The Open menu MUST offer Recent quizzes, listing every recent quiz, unsaved ones first
  and marked, each as FR-010 lists them, any of which can be restored or discarded at any time, with
  no network needed. With none, it says so.
* **FR-013**: Restoring a recent quiz MUST make it the tab's own quiz, with its link and undo
  history, and remove it from the recent quizzes. The quiz it replaces goes to the recent quizzes
  (FR-019). A quiz carrying more than one state (FR-022) is listed as one row per state, each saying
  which it is (current, as saved to a file, as submitted); restoring a row brings the whole quiz
  back in that state, with its other states still kept. Discarding a row discards the whole quiz,
  and the confirmation says so.
* **FR-014**: Discarding a recent quiz MUST ask for confirmation and then remove it for good. Recent
  quizzes MUST offer "Discard all", which asks for confirmation and then removes every recent quiz
  for good; quizzes open in tabs are untouched.
* **FR-015**: A quiz open in any tab MUST NOT be listed as recent, and two tabs MUST NOT both
  restore the same recent quiz.
* **FR-016**: A quiz kept aside because it was saved by a newer version of the scoresheet MUST be
  listed with the recent quizzes, marked as such, and opening it MUST warn as today.

**Which quiz is which**

* **FR-022**: A quiz MUST be one undo history. New starts a new quiz; a reload and a restore
  continue the same one. Besides its current state, with its undo and redo steps, a quiz MUST keep
  the state it was last saved to a file in and the state it was last submitted in, each with its
  undo history up to that state; states that match are kept once. The quiz an Open shows (FR-023)
  has the opened state as its last saved state, or, from a submission on the meet, its last
  submitted state: a new one starts saved, and a recent one continued in a state it had not been
  saved in is saved in it now. The quiz the tab showed before is untouched, and goes to the recent
  quizzes as it was.
* **FR-023**: Open (from a file, the meet, the schedule's stored result or a link) MUST NOT continue
  the tab's current quiz. It MUST look among the recent quizzes for one whose current, last saved or
  last submitted state matches what is opened (compared as FR-009 does), and continue that quiz from
  that state, with its meet link, its undo history up to it and, while unbroken, redo to its later
  states. With several matches it continues the most recently changed. With no match, or when the
  matching quiz is open in another tab, it starts a new quiz, saying so in the second case. When a
  quiz continued from an earlier state is edited or cleared, its later states MUST be kept as a
  recent quiz of their own, with their undo history, rather than lost with the redo steps.

**Replacing a quiz**

* **FR-019**: New, Open (from a file, the meet, the schedule's stored result or a link) and
  restoring a recent quiz MUST NOT ask about unsaved changes. The quiz they replace, unless FR-008
  leaves it out, MUST go to the recent quizzes before the replacement is shown. This replaces the
  unsaved-changes question of the open-new-link work (its FR-025).

**Undo history**

* **FR-020**: A tab's undo history MUST survive a reload of the tab, and a recent quiz's MUST come
  back when it is restored, so that undo and redo step through the same edits as before. Every
  change to what a quiz file holds MUST be an undo step: answers, no-jumps, timeouts, team and
  quizzer names, on-time marks, quizzer order, question types, division, quiz number, consolation
  and overtime, whether made by hand or by the sheet itself (a roster change). Changes made by
  themselves on starting or opening, before the first edit by hand, are the quiz's start (FR-008),
  not steps. Typing in a field (a name, the quiz number, a typed division) MUST make one step per
  visit to the field, from entering it until leaving it or another edit. Clear answers and Clear
  names MUST each be one step, which undo takes back; nothing but New and Open begins a new history.
  A quiz MUST keep up to 1000 undo steps (today 100); beyond that the oldest fall off, and the
  states kept by FR-022 are kept regardless.
* **FR-021**: Undo history MUST NOT be sent to the meet and MUST NOT be written into quiz files: it
  stays with the tab's quiz and the recent quizzes on the device.

**Moving to the new way**

* **FR-017**: After an update, the quiz and meet link the previous version kept MUST become the
  first tab's own, with no question.
* **FR-018**: The tutorial's safekeeping of the quiz it replaces, and crash recovery during the
  tutorial, MUST give back that tab's own quiz.

### Key Entities

* **Tab's quiz**: the quiz on one tab's sheet with its meet link and scheduled quiz link, its undo
  history, and when it was last changed. Belongs to one open tab; outlives a reload of it.
* **Quiz**: one undo history, begun by New, or by an Open that matches no recent quiz, and continued
  by an Open that matches one. Carries up to three states: its current one (with redo steps), its
  last saved to a file and its last submitted, each with its undo history up to it; matching states
  are one. Saved when its current state matches either saved state, however it got there. Editing
  after continuing from an earlier state splits off the later states as a quiz of their own.
* **Recent quiz**: a quiz a tab no longer shows, because the tab closed or the quiz was replaced.
  Kept once, listed as one row per kept state; unsaved or saved; restored into a tab in any of its
  states (where it becomes that tab's quiz again) or discarded. At most 80 unsaved and 40 saved,
  counted as quizzes, not rows.
* **Undo history**: every change made to a quiz's file contents since its start, in order, that undo
  and redo step through, up to 1000. Kept with the quiz on the device, never in its file or
  submission.
* **Shared person data**: sign-in, guest sessions for meets, fetched team names. One per browser,
  read by every tab.

## Success Criteria _(mandatory)_

### Measurable Outcomes

* **SC-001**: With up to five tabs open on different quizzes, reloading any tab shows the quiz and
  link it had, in every case tested.
* **SC-002**: Opening a quiz in a new tab never asks about unsaved changes and never changes what
  another tab shows or brings back after a reload.
* **SC-003**: A quiz in a tab that is closed, replaced or lost to a crash can be found and restored
  with its answers, names and link, in every case tested, until it is discarded or pushed out by 80
  more recent unsaved quizzes (40 if saved).
* **SC-004**: No submission is sent against a scheduled quiz other than the one its own tab is
  linked to.
* **SC-005**: An official scoring in a single tab sees no new question in their day: a reload keeps
  the quiz, as today, and New and Open no longer ask.
* **SC-006**: No quiz is lost by New, Open or restoring another: in every case tested it can be
  found under Recent quizzes afterwards.
* **SC-007**: After a reload or a restore, every edit made before, up to the last 1000, can be
  undone, newest first, in every case tested.

## Assumptions

* **How tabs are told apart, how an open tab is known, and where recent quizzes are stored are the
  plan's to choose** (issue #176 sketches the first two). The spec needs only that each tab is told
  apart, that an open tab's quiz is never treated as recent, and that the device has room for the
  quizzes FR-009 keeps.
* **The room needed** is a few megabytes: a quiz is tens of kilobytes, its undo history (up to 1000
  small steps) about as much again, up to 120 are kept, and a quiz may carry up to three states.
  That is more than today's single copy, and near what some browsers give the simplest kind of site
  storage, so the plan may need a roomier one.
* **Browsers in use** (current Chrome, Firefox, Safari and Edge, and the desktop and Android apps)
  all keep per-tab data across a reload and a restored session. A browser that doesn't restore tabs
  after a restart leaves their quizzes as recent quizzes, which FR-010 offers back.
* **The kept quiz from a newer version** joins the recent quizzes (FR-016); its notice in the header
  may stay or go, as the plan finds simplest.
* **A portal link opened from the scoresheet** (#122) is not built here; it builds on this.
* **What counts as unsaved** changes from the open-new-link work's rule (answers or names changed
  since the sheet was last saved, started or opened) to comparing the quiz's state with its saved
  ones (FR-009). Since New and Open no longer ask (FR-019), the old rule has nothing left to guard.
* **Clear answers and Clear names** no longer empty the undo history, as they do today: each is one
  step (FR-020). The quiz stays the same quiz, and its saved and submitted states are kept.
* **A quiz file is unchanged.** Undo history lives only on the device (FR-021), so files and
  submissions are as today.

## Dependencies

* The auto-save and crash recovery as they exist on master, including the tutorial's safekeeping and
  the setting aside of a newer version's quiz.
* The undo history as it exists on master. Names, on-time marks, quizzer order, question types and
  the quiz's settings were outside it there; FR-020 brings them in.
* The meet link as kept by `docs/meet-link.md` and the open-new-link work (specs 007).
* The stats work's submission of the linked scheduled quiz (SC-004 protects it). It edits the same
  scoresheet files that keep the meet link; whichever lands second rebases.
