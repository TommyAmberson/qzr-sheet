---

description: "Tasks for upload clarity"
---

# Tasks: Upload clarity

**Input**: Design documents from `specs/011-upload-clarity/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, quickstart.md

**Tests**: Follow the constitution's testing principle. Where it calls for a test, the implementation
task names the test task or existing test that covers it.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing
of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2)

<!--
  ============================================================================
  TASK WRITING RULES (project override; constitution principle VII)
  These rules and the constitution override the speckit-tasks skill's
  defaults: tests are not optional where the testing principle calls for
  them, and stories are not ordered Models -> Services -> Endpoints.
  Keep this comment in the generated tasks.md, so commands that add tasks
  later (/speckit-converge) see the same rules.

  - Describe the behaviour, and the test that proves it where the testing
    principle calls for one, not the code. Name a function, signature, option,
    or literal only when the task changes an existing one or the spec,
    data-model.md, or contracts/ already fixes it. Let implementation choose new names; naming the file a change
    lands in is fine.
  - Every decision or write path the feature adds has one owner, named in
    plan.md's "Reuse and Ownership" table. A task that touches it points at that
    owner; never split one rule's implementation across several tasks or files.
  - Reuse first. A task that adds a helper, module, type, or test fixture names
    the existing code it checked and why that doesn't fit. Test tasks extend
    existing fixtures and stubs rather than copying them.
  - No speculative surface: every new production export has a caller the
    constitution accepts, and no task adds an option, reason code, or counter
    that only a test reads.
  - Don't specify framework or library defaults; plan.md records what the
    platform already provides.
  - Name the packages a release bumps and the semver level of each, never the
    resulting version number. The number is set when the bump commit is
    written, from master at that time, and a hotfix landing first takes it.
  - Prefer one task per coherent change over one task per layer (model, then
    service, then endpoint). Split only where tasks can genuinely run or be
    reviewed apart.
  ============================================================================
-->

## Phase 1: User Story 1 - Upload outcomes that stay (Priority: P1) 🎯 MVP

**Goal**: Every batch ends with a summary; files not sent stay, with plain reasons, Retry and
Dismiss, across later batches.

**Independent Test**: Make the API answer 500 for one file of a batch, send another batch: the
failed file is still under Not sent with a plain reason, and Retry stores it.

- [X] T001 [US1] Add failing cases to `apps/web/src/__tests__/sendQuizzes.spec.ts`: a report's outcome for each answer (created, new revision, kept current, unchanged, skipped, a 4xx refusal keeping the API's message, a 5xx and a network failure as not sent with the plain reasons of research R2: "The server was busy and this file wasn't saved", "The meet couldn't be reached, so this file wasn't saved"), and a file refused for what it is as refused, not not sent
- [X] T002 [US1] Give each file report its outcome, and not-sent failures their plain reasons, in `sendOne` in `packages/ui/src/sendQuizzes.ts` (data-model.md "File report": outcome is one of "stored, new revision, kept current, unchanged, skipped, refused or not sent"), replacing the `stored` flag the page reads today; covered by T001
- [X] T003 [US1] Show the batch summary (counts by outcome, zeros left out, new revisions and kept-current files counted as stored, FR-001) heading the batch's per-file lines (refused and skipped files with their reasons; stored and unchanged ones folded), and a Not sent list that later batches don't clear, with Retry (through `sendPlanned`, for one file or all) and Dismiss (one or all), in `apps/web/src/components/UploadQuizzes.vue`, the meet page header's upload (spec 010), as one line beside the upload button that opens the report; files leave the list once stored, unchanged or skipped (FR-002, FR-003); say while it holds files that it doesn't survive a reload (spec Edge Cases)

**Checkpoint**: No failed file can go unnoticed.

---

## Phase 2: User Story 2 - A review that explains its matches (Priority: P2)

**Goal**: The review shows what was read, how each file matched, and suggests the consolation near
miss.

**Independent Test**: A sheet reading "2 / p" against a schedule with D2c QP: the review shows what
was read, says nothing has that name, offers D2c QP, and one click stores it as D2c QP.

- [X] T004 [P] [US2] Add failing cases to `apps/web/src/__tests__/sendQuizzes.spec.ts`: `planUpload` marks a file matched by name or none (data-model.md "match: by name, by hand, suggestion, or none"); an unmatched file whose quiz with the consolation flag flipped is on the schedule gets that scheduled quiz as its suggestion, and one with no such quiz gets none
- [X] T005 [US2] Record each reviewed file's match and suggestion in `planUpload` in `packages/ui/src/sendQuizzes.ts` (research R4), reusing `resultKey` and `resultName`; covered by T004
- [X] T006 [US2] In the review of `apps/web/src/components/UploadQuizzes.vue`, show each file's division, quiz number and consolation flag as read (FR-005), how it matched (FR-006), and for an unmatched file "No scheduled quiz is named …" with its suggestion as a one-click pick (FR-007); picking by hand or by the suggestion sets the match accordingly and re-marks duplicates (`markDuplicates`)

**Checkpoint**: A missing consolation "c" is caught in the review.

---

## Phase 3: User Story 3 - One name per quiz (dropped)

Dropped by decision (spec Clarifications): how stored quizzes are named is a follow-up of its own.
Its tasks, T007 to T010, were implemented, then left out when the work moved onto spec 010's meet
page.

---

## Phase 4: Polish

- [X] T011 [P] Describe the batch summary, Not sent list and match explanations in `docs/architecture.md`'s "Uploads and downloads"
- [X] T012 Bump web MINOR with a dated changelog section in `apps/web/CHANGELOG.md` naming the bundled shared version (unchanged) under `### Bundled contract`
- [X] T013 Run `pnpm test:unit`, `pnpm type-check`, `pnpm lint`, and walk quickstart.md's scenarios on local dev

---

## Dependencies & Execution Order

- Stories are independent: US1 touches the upload's reports and the header's report; US2 the
  review. Both meet in `UploadQuizzes.vue`, so T003 and T006 run one after the other.
- Within a story, the test task comes first and fails.
- Polish last.

## Parallel Opportunities

- T004 alongside US1.
- T011 any time after the stories.

## Implementation Strategy

1. US1 (the one that can lose information). Shippable alone.
2. US2.
3. Polish and release.
