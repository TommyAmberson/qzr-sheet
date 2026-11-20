# Research: Upload clarity

Decisions for [spec.md](./spec.md). No API or data change is needed: everything here is in the
shared upload (`packages/ui/src/sendQuizzes.ts`) and the portal's pages.

## R1. What each file's outcome is

**Decision**: A file's report carries its outcome as one of stored, new revision, kept current,
unchanged, skipped (the user's choice), refused (not a quiz file, a blank sheet, or refused by the
API for a reason it gives) or not sent (the send failed). The batch summary counts these; Not sent
holds only the last.

**Rationale**: Today a report has only `stored` and a message, so the page can't tell a refusal the
user should read once from a failure worth retrying. The outcome is decided where the send happens
(`sendOne`), once.

## R2. Which failures are "not sent"

**Decision**: A send is not sent when it fails without the API explaining a refusal: a status of 500
or more, a timeout, a rate limit, a signed-out session, or no response at all. Any other 4xx answer
is a refusal and keeps the API's own message, by the rule a room code's refusal already follows
(`isRefusal`). The plain reasons: "The server was busy and this file wasn't saved", "You were signed
out, so this file wasn't saved" (401), "The meet couldn't be reached, so this file may not have been
saved" (no response), and "No answer came from the meet, so this file may not have been saved" (no
answer within 30 seconds). The last two say "may": the meet may have stored the quiz before the
answer was lost, and sending it again then finds it unchanged. Any other error in the page is
refused with its own message.

**Rationale**: The four FBC failures stored unchanged on retry, which only a passing server or
network fault explains. A 4xx (phase, permission, invalid file) won't change on retry, so it isn't
offered one.

**Alternatives**: an automatic retry; declined by the user (spec Clarifications).

## R3. Keeping Not sent across batches

**Decision**: The upload in the meet page's header keeps the not-sent files, each with the reviewed
file it came from (its quiz and scheduled quiz), in page state that a new pick doesn't clear. Retry
sends them through the same `sendPlanned`, so a file with no scheduled room asks for its room again
as any upload does; Dismiss drops them. Page state only, per the spec's assumption.

## R4. How a file matched

**Decision**: The review says how a file came to its scheduled quiz: matched by name, picked by
hand, taken from the suggestion, or none. It is worked out from the file's name, the quiz picked and
the suggestion (`matchOf`), so there is nothing to keep in step as the user picks. The suggestion
for an unmatched file is the scheduled quiz whose name is the file's with the consolation flag
flipped (`resultKey` of the flipped quiz against `resultName`), when there is one.

**Rationale**: The missing-"c" slip is the one the backfill hit; flipping the flag gives at most one
candidate, so the suggestion is never ambiguous.
