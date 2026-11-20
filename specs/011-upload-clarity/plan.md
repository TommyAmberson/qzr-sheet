# Implementation Plan: Upload clarity

**Branch**: `feat/upload-clarity` | **Date**: 2026-11-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/011-upload-clarity/spec.md`

## Summary

Make the batch upload explain itself. The shared upload gives every file an outcome (stored,
unchanged, skipped, refused, not sent and so on) and plain reasons for server and network failures;
the upload in the meet page's header (spec 010) shows the last batch in one line, opening its full
report, and keeps not-sent files, with Retry and Dismiss, across later batches. The review says how
each file matched and suggests the consolation near miss. No API, data or shared-contract change.

## Technical Context

**Language/Version**: TypeScript ~5.9

**Primary Dependencies**: Vue 3; `@qzr/shared` helpers (`resultKey`, `resultName`,
`scheduleQuizMeta`, `quizName`, `ApiError`)

**Storage**: none new; the Not sent list is page state

**Testing**: Vitest (`apps/web/src/__tests__/sendQuizzes.spec.ts`, `results.spec.ts`,
`downloads.spec.ts`)

**Target Platform**: the portal (browsers)

**Project Type**: pnpm monorepo web application

**Performance Goals**: none beyond today's

**Constraints**: no API change; the scoresheet's single submit is untouched

**Scale/Scope**: batches of a time slot (about 5 files) up to a whole meet (about 150)

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| #   | Principle                       | Answer                                                                              |
| --- | ------------------------------- | ----------------------------------------------------------------------------------- |
| I   | Offline, always                 | Unaffected: portal only; the scoresheet doesn't change.                             |
| II  | Rulebook is the spec            | N/A: no scoring, scheduling, auth, role or data-model change.                       |
| III | One pure scoring implementation | No: nothing computes scores or placement.                                           |
| IV  | Meet data gated per meet        | No new or changed route.                                                            |
| V   | Contract versions               | N/A: `packages/shared/src/` is not touched.                                         |
| VI  | Validate before merge           | Yes: outcomes, reasons, suggestions and display names get unit tests. No migration. |
| VII | Simplest design that works      | Yes, see Reuse and Ownership; nothing test-only, no restated defaults.              |
| -   | Technology constraints          | No new package, client or drag.                                                     |

Post-design re-check: unchanged.

## Project Structure

```text
specs/011-upload-clarity/   plan.md, research.md, data-model.md, quickstart.md (no contracts: no
                            interface changes)
packages/ui/src/sendQuizzes.ts            outcomes, plain reasons, match and suggestion
packages/ui/src/apiErrors.ts              a refusal told from a failure that may pass
apps/web/src/components/UploadQuizzes.vue the header's line, report, Not sent list and review
```

## Reuse and Ownership

| Decision or write path                 | Owner                                         | Existing code reused                                                              |
| -------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------- |
| A file's outcome and its plain reason  | `sendOne` in `packages/ui/src/sendQuizzes.ts` | `existingQuizOf`, `isRefusal` (moved to `apiErrors.ts` from the room-code module) |
| How a file matched, and its suggestion | `matchOf` and `planUpload`                    | `resultKey`, `resultName`, `markDuplicates`                                       |
| Batch summary and the header's line    | `UploadQuizzes.vue`, from the batch's reports | `summaryOf`, `isSaved`                                                            |
| Not sent list, Retry, Dismiss          | `UploadQuizzes.vue`                           | `sendPlanned` for Retry                                                           |

**Platform already provides**: `fetch` rejects with a `TypeError` on a network failure; the API
answers 5xx for a Worker that exceeds its limits.

**Releases**: web MINOR. `@qzr/ui` isn't versioned; shared and api don't change.

## Complexity Tracking

None.
