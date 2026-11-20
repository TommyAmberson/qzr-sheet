# Data model: Upload clarity

Nothing new is stored. These are the page-side shapes the spec's entities take.

## File report (changed)

Each sent or refused file's line, as the upload returns it.

| Field   | Meaning                                                                                       |
| ------- | --------------------------------------------------------------------------------------------- |
| item    | The reviewed file it reports on, so a file not sent can be sent again as it was               |
| outcome | stored, new revision, kept current, unchanged, skipped, refused or not sent (research R1, R2) |
| message | What the page shows: the plain reason for not sent, the API's message for refused             |

## Reviewed file (changed)

The review's row, as spec 009 defined it, plus:

| Field      | Meaning                                                                           |
| ---------- | --------------------------------------------------------------------------------- |
| match      | by name, by hand, suggestion, or none, worked out from the rest (research R4)     |
| suggestion | The scheduled quiz with the consolation flag the other way, for an unmatched file |

The division, quiz number and consolation flag "as read" are the file's own quiz fields; nothing
new.

## Not sent list (new, page only)

The upload's list of reviewed files whose send failed, each with its report. Survives later batches;
cleared by Retry (once stored, unchanged or skipped), Dismiss, or leaving the page.

## Batch summary (new, page only)

Counts of the last batch's reports by outcome, zeros left out.
