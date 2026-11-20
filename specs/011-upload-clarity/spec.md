# Feature Specification: Upload clarity

**Feature Branch**: `feat/upload-clarity`

**Created**: 2026-11-20

**Status**: Draft

**Input**: User description: "Make the portal's batch upload and results page explain themselves,
after the first real backfill (FBC Feb 2024, 73 sheets) showed three misunderstandings: upload
outcomes that stay, a review table that explains matching, and one name per quiz. Out of scope:
loading a finished meet without phases (#212), grouping attention notices (#213). Builds on spec
009."

## Context

Spec 009 (PR #209) added batch uploads of quiz files and LibreOffice sheets on the Results page,
with a review that matches each file to its scheduled quiz before sending. Its first real use loaded
a whole 2024 meet into production: 73 sheets, sent a time slot at a time. 72 matched by themselves
and all 73 were stored, but three things were misread, none of them a defect:

* **Failures looked silent.** Four files in two batches were not saved. Each showed as a red line
  with its reason, but picking the next batch replaced the report, and the reason was gone before
  anyone read it. All four stored on a second try, so the cause was most likely a passing server
  error, reported in the server's own words.
* **An unmatched file gave no reason.** One sheet's quiz number cell said "p" where the official
  meant consolation quiz "cp", so it read as main-bracket quiz D2 Qp, which the schedule doesn't
  have. The review offered nothing better than "none picked", though D2c QP was the obvious match.
* **Names kept the sheet's spelling.** Quizzes stored from sheets show as "D2c Qh" beside "D2c QE",
  because a sheet's lowercase letter is kept. Matching ignores case, so links and standings were
  right; only the display differed from the schedule. How stored quizzes are named is left to a
  follow-up (see Clarifications).

Since this was written, the meet page has become one page in tabs (spec 010, #214): uploading is in
the meet page's header on every tab, and the stored quizzes are listed on the Quizzes tab.

## Clarifications

### Session 2026-11-20

* Q: Should a linked quiz be named as its scheduled quiz? → A: Not in this feature. A linked quiz
  will lead with its scheduled quiz's name, noting the sheet's when they differ by more than case,
  everywhere the portal names it (#220); resubmitting a renamed quiz (#221) and fixing a stored quiz
  the schedule doesn't match (#222) follow too.
* Q: Should a file that fails on a server error or timeout be retried automatically before it goes
  under Not sent? → A: No. Every failure is reported at once, and the user decides when to retry.
* Q: With uploading in the meet page's header on every tab, how should the report and the Not sent
  list show? → A: As one line beside the upload button, such as "5 files: 4 stored · 1 not sent",
  which opens the full report under the header; it opens by itself when something wasn't saved.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Upload outcomes that stay (Priority: P1)

An admin sends a batch and moves on to the next. Every batch ends with a one-line summary of what
happened. Any file that wasn't saved stays in a "Not sent" box, with the reason in plain words,
until it is sent again or dismissed, whatever else is uploaded meanwhile.

**Why this priority**: It is the only one of the three that can lose information: a file that wasn't
saved, with no record of it once the next batch starts.

**Independent Test**: Make the API refuse one file of a batch with a server error, then pick and
send another batch: the refused file is still listed as not sent, with a readable reason, and Retry
stores it.

**Acceptance Scenarios**:

1. **Given** a batch of five files where one fails on a server error, **When** it is sent, **Then**
   the page says "5 files: 4 stored, 1 not sent" and lists the failed file under Not sent with a
   reason such as "The server was busy and this file wasn't saved".
2. **Given** a file under Not sent, **When** the admin picks and sends another batch, **Then** the
   file is still under Not sent.
3. **Given** a file under Not sent, **When** the admin chooses Retry, **Then** it is sent again as
   reviewed, and leaves the box once stored, unchanged or skipped by choice.
4. **Given** a file under Not sent, **When** the admin dismisses it, **Then** it leaves the box and
   nothing is sent.

---

### User Story 2 - A review that explains its matches (Priority: P2)

Before sending, each file in the review shows its division and quiz number exactly as read, and says
how it was matched: by name to a scheduled quiz, or not at all and why. Where the same quiz with the
consolation flag the other way is on the schedule, the review suggests it, and one click takes it.

**Why this priority**: A sheet slip like a missing "c" is common in old archives, and the review is
where it can be caught before a quiz is stored under the wrong name.

**Independent Test**: Upload a sheet whose number cell says "p" against a schedule with D2c QP: the
review shows "2 / p" as read, says no scheduled quiz is named D2 Qp, and offers D2c QP; accepting it
stores the sheet as D2c QP.

**Acceptance Scenarios**:

1. **Given** a file whose name matches a scheduled quiz, **When** the review shows it, **Then** it
   says it matched by name.
2. **Given** a file whose name matches nothing, but would with the consolation flag the other way,
   **When** the review shows it, **Then** it says no scheduled quiz has its name and suggests the
   near match, which one click picks.
3. **Given** a file with no match and no near match, **When** the review shows it, **Then** it says
   no scheduled quiz has its name, and offers the schedule's quizzes to pick from as now.

### Edge Cases

* A batch where every file fails: the summary says none were sent, and all are under Not sent.
* A file refused for what it is (not a quiz file, a blank sheet): counted in the batch summary and
  listed with its reason under it, not kept under Not sent, as sending it again would change
  nothing.
* A file skipped by the user's own choice ("Don't submit"): counted as skipped, not under Not sent.
* Retrying a file whose quiz meanwhile reached the meet some other way: answered as for any send
  (unchanged, or the "already submitted" question).
* Leaving the page: the Not sent box doesn't survive a reload; the summary says so while it holds
  files.
* A near match on both sides is impossible: only the flag is flipped, so there is at most one.

## Requirements _(mandatory)_

### Functional Requirements

* **FR-001**: Every sent batch MUST end with a one-line summary counting its files, stored,
  unchanged, skipped, refused and not sent, leaving out counts of zero; a new revision and a stored
  file kept behind the current revision count as stored. The summary heads the batch's per-file
  lines: refused and skipped files keep their line and reason, stored and unchanged ones are folded
  under the summary, and not-sent files move to the Not sent list.
* **FR-002**: A file not saved because sending failed MUST go straight to a Not sent list, with no
  automatic retry, and be kept there with a plain reason, until it is stored, found unchanged,
  skipped by choice, or dismissed. Later batches MUST NOT clear it.
* **FR-003**: Each Not sent file MUST offer Retry, which sends it again as it was reviewed, and
  Dismiss; the list MUST also offer both for all its files at once.
* **FR-004**: A server error, an unreachable server or a timeout MUST be reported in plain words
  (for example "The server was busy and this file wasn't saved"), not as a status code or status
  text. Refusals the API explains (phase, permission, invalid file) keep the API's message.
* **FR-005**: The review MUST show each file's division and quiz number as read from it, and the
  consolation flag when set.
* **FR-006**: The review MUST say, for each file, whether it matched a scheduled quiz by name, was
  given one by hand, or matched none.
* **FR-007**: For a file that matches no scheduled quiz, the review MUST suggest the scheduled quiz
  with the same division and number and the consolation flag the other way, when the schedule has
  one, and one action MUST pick it.

### Key Entities

* **Batch summary**: the outcome counts of one sent batch.
* **Not sent file**: a reviewed file, with its scheduled quiz, and why it wasn't saved; kept in the
  page until stored, found unchanged, skipped or dismissed.
* **Match**: how a reviewed file came to its scheduled quiz: by name, by hand, by suggestion, or
  none.

## Success Criteria _(mandatory)_

### Measurable Outcomes

* **SC-001**: In a backfill like the 2024 one, no failed file goes unnoticed: every file not saved
  is still listed, with its reason, after the following batch is sent.
* **SC-002**: A sheet with a missing or extra consolation "c" is matched in one click, without
  scrolling the schedule's list.

## Assumptions

* The Not sent list lives in the page only; keeping it across reloads is not needed for a backfill
  done in one sitting.
* The suggestion only flips the consolation flag; other slips (a wrong number, a misspelled
  division) are picked by hand as now.
* Upload matching and "unchanged" answers are as in spec 009.
* Scoresheet submissions are unchanged; this is the portal's upload, in the meet page's header.
