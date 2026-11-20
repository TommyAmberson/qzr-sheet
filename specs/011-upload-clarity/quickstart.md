# Quickstart: validating upload clarity

Prerequisites as in [spec 009's quickstart](../009-ods-round-trip/quickstart.md): local dev with a
meet that has a published schedule and stored quizzes.

## Unit checks

`pnpm test:unit`, `pnpm type-check`, `pnpm lint` pass, including:

* the upload's outcome for each kind of answer (created, revision, kept current, unchanged, skipped,
  refused 4xx, 5xx, network failure), and the plain reasons for the last two;
* the suggestion for a file whose consolation flag is the other way, and none when there is no such
  scheduled quiz;

## Scenarios

1. **Not sent stays** (Story 1): stop the API mid-batch (or make it answer 500), send a batch: the
   summary counts the failures, which are listed under Not sent with a plain reason. Pick and send
   another batch: they are still there. Restart the API, Retry: they store and leave the list.
   Dismiss clears what's left.
2. **Matching explained** (Story 2): upload a sheet whose number cell lacks the consolation "c": the
   review shows the division and number as read, says no scheduled quiz has that name, and offers
   the consolation quiz; one click picks it, and it is stored as that quiz.
