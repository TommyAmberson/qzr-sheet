# Research: New, Open and Link on the scoresheet

Findings from the code on master `320d2d2` (scoresheet 0.21.0), and the decisions they lead to.
Paths are under `apps/scoresheet/src/` unless they say otherwise.

## R1. No server or shared change is needed

**Decision**: the feature is scoresheet only. No API route, no D1 schema, no `packages/shared`
change, no `FILE_VERSION` change.

**Rationale**: every read the spec asks for is already served.

| Need                                           | Existing route                                   | Client call                        |
| ---------------------------------------------- | ------------------------------------------------ | ---------------------------------- |
| A meet's published schedule, quizzes and seats | `GET /api/meets/:id/schedule/published`          | `getPublishedSchedule` (`api.ts`)  |
| One scheduled quiz with its seats' teams       | built client-side from the above                 | `getScheduledQuiz` (`api.ts`)      |
| Roster teams and divisions                     | `GET /api/meets/:id/teams`                       | `getMeetTeams`                     |
| A team's quizzers                              | `GET /api/teams/:id/quizzers`                    | `getTeamQuizzers`                  |
| The stored quizzes a person may see, each with | `GET /api/meets/:id/results`                     | none yet: one new call in `api.ts` |
| its current file                               |                                                  |                                    |
| A stored quiz's versions                       | `GET /api/meets/:id/results/:resultId/revisions` | none yet: one new call in `api.ts` |
| One version's file                             | `GET …/revisions/:revision`                      | `getRevision`                      |

`GET /results` already answers 403 to anyone who is neither an admin nor an official of a room with
saved quizzes, and limits an official to their rooms' quizzes
(`packages/api/src/routes/results.ts`). That is exactly FR-006 and the spec's access assumption, so
the list's access rule stays the server's. The list row carries the newest revision's file, and the
server treats the newest save as current (a restore is itself a new revision that gives the restored
file), so "current version" needs no second request.

**Alternatives considered**: a route returning one scheduled quiz with seats and rosters in one
request. Rejected for this feature: `getScheduledQuiz` already assembles it, and #162 proposes the
rosters-per-division route on its own merits.

## R2. Which scheduled quiz a stored quiz is

**Decision**: match by `resultKey` (`packages/shared/src/results.ts`): folded division, consolation
flag and folded quiz number. A scheduled quiz's `scheduleQuizMeta` gives the same three fields.

**Rationale**: it is how the server names a stored quiz today, so the sheet's match can't disagree
with it. When the stats work adds a stored link (`scheduleQuizId` on a submission and on the stored
quiz), the match reads that link first and falls back to the key; that is its change to make.

**Consequence**: two lanes that reuse a quiz name in one division (#141) match the same stored quiz.
The sheet takes the first; nothing here makes that worse than it is on the server.

## R3. What "decided" means for a seat

**Decision**: a seat is decided when `getScheduledQuiz` resolves it to a roster team: a prelim
letter the draw has given a team. Every other seat (`seedRef` set, `team: null`) is undecided.

**Rationale**: that is the only resolution that exists until #16 fills elimination seats from
results. FR-002, FR-015 and FR-020 all key on it, and need no change when #16 lands: more seats
simply come back decided.

## R4. Moving a whole team is a swap of two numbers

**Decision**: a team's place on the sheet is `Team.seatOrder` (`stores/quizStore.ts`); `teams` in
`useScoresheet.ts` is the store's teams sorted by it. Answers are keyed by quizzer id, timeouts by
team id, on-time is a field of the team. So two teams change places, with everything that belongs to
them, by swapping their `seatOrder`. The meet session's picks are held by slot index (`slots[0..2]`
in `composables/useMeetSession.ts`) and are swapped in the same step.

**Rationale**: nothing is copied, so nothing can be lost or copied wrongly, and the scores are the
same by construction (FR-021, Story 3 scenario 4). It is one undo entry in the existing history
(`useHistory` from `@qzr/ui`), like a quizzer drag.

**Alternatives considered**: copying names and cells between slots. Rejected: many writes, many ways
to drop a timeout or a no-jump, and no simpler to undo.

## R5. One link routine

**Decision**: linking is one routine with one owner, grown from `onMeetLoaded` in
`components/Scoresheet.vue`, which today matches typed team names to the roster after a meet is
linked (`findMatchingTeam`, `pickMisspeltTeam`). It takes what to link (a meet, or a scheduled quiz
and its meet) and for each slot does, in order: keep a pick made against the same meet; else pick
the roster team the typed name names; else, when the slot is blank, take the scheduled seat's team
unless that team is on the sheet already. A blank division, consolation flag and quiz number take
the schedule's. Every link fills; the routine has no modes.

Everything else is that routine with a different start:

| Action                         | Is                                                                |
| ------------------------------ | ----------------------------------------------------------------- |
| Link a meet                    | link(meet)                                                        |
| Link a scheduled quiz          | link(scheduled quiz)                                              |
| Refresh symbol                 | link(what is linked now), after a fresh fetch                     |
| Fetch on reload, before submit | fresh fetch only: copy and warnings renewed, no link call         |
| New from schedule              | plain New, then link(scheduled quiz): every slot is blank         |
| Open from the meet             | open the file, then link(meet, and its scheduled quiz when found) |
| Open from the schedule         | open the stored file, then link(scheduled quiz)                   |
| Open from file                 | open the file and unlink; no link call, no request                |

**Rationale**: the spec defines Open from the meet and schedule as "open, then link" and refresh as
"link again", so building them as anything else would be a second rule to keep in step (constitution
VII). It also removes `computeSeatChange` and `loadScheduledQuiz`'s per-seat policy, which are the
"keeps some, replaces some" behaviour the feature exists to delete.

**Alternatives considered**: keeping `loadScheduledQuiz` for New from schedule. Rejected: its
keep-or-replace decision per seat is meaningless on a blank sheet and wrong on a scored one.

## R6. Ask, then fetch, then apply

**Decision**: New and Open ask their unsaved-changes question first (unsaved answers, or names typed
since the last save, start or open), fetch second, and touch the sheet and the session only when the
fetch has succeeded. While an asked-for action waits, the sheet shows a waiting state with Cancel
and takes no other input (FR-028), so it cannot be overtaken; a cancelled fetch's answer is
discarded. Only the reload fetch runs in the background, and it keeps the existing `quizEpoch` guard
in `useMeetSession.ts` against a quiz started meanwhile.

**Rationale**: FR-025, FR-027 and FR-028 in one ordering. It fixes the fault left from the #168
review, where `loadStoredQuiz` relinks the meet, wiping picks, before the file is known to open.
`dropPicks`, called by hand at three sites today, goes: a file open unlinks, in the one open path.

## R7. Where the scheduled quiz is kept

**Decision**: the meet session (`MeetSessionData`, `localStorage` key `qzr-meet-session`) keeps a
copy of the linked scheduled quiz beside the `quizId` it already has: its label, division,
consolation flag, quiz number, and each seat's team id or none; or a mark that the published
schedule no longer has it. Details in [data-model.md](./data-model.md).

**Rationale**: warnings must be computable offline from "the copy held" (FR-023), and must survive a
reload (FR-017). The session is already the persisted home of everything the meet gave the sheet,
and the tutorial already snapshots and restores it whole.

`quizId` keeps its name and meaning, so the stats work's `scheduleQuizId` reads it unchanged
(FR-018).

## R8. Schedule warnings and their fixes

**Decision**: schedule warnings are added to the one warning list (`meetWarnings` in
`Scoresheet.vue`), which becomes a list of entries that may carry a fix rather than a list of
strings. The list is shown in a small dialog (today it is an `alert`), where a fixable entry has a
button whose label is the sentence of what it will do:

* "Set division to 2", "Set quiz to 3"
* "Move Lions 1 to Team 2 (swaps with Tigers 2)"
* "Replace Lions 1 with Tigers 2" / "Put Tigers 2 in Team 3" for a blank slot

Moving or replacing a team is one history entry; setting the division or number is a plain edit (the
boxes have no undo today). The submit question still lists the same lines as text.

**Rationale**: the maintainer asked for a clear interface for the team move. A button that states
the move in words, in the place the warning is read, needs no new gesture and works on a tablet. The
dialog also gives the roster warnings a touch-friendly home, replacing the `alert` added in #169.

**Alternatives considered**: dragging team blocks to reorder. Rejected for now: the sheet's drag
code is per-quizzer, and a drag doesn't say which slot the schedule wants. A fix button on the team
name cell itself: kept as a possible addition, not needed to meet the spec.

## R9. Menus and the linked display

**Decision**: three menus, each item doing one thing (FR-026):

* **New**: New 20-question quiz, New 15-question quiz, New from schedule…, Clear answers, Clear
  names.
* **Open**: From file… (Ctrl+O, as today), From the meet…, From the schedule….
* **Link**, opened from the linked display: Link a meet…, Link a scheduled quiz…, Unlink quiz,
  Unlink meet.

The linked display is today's session pill, grown: the meet's name, the scheduled quiz's label when
there is one, and the refresh symbol (FR-017, FR-023). Unlinked, it reads "Link…" and opens the same
menu.

**Rationale**: "Load teams from meet" and "Unlink meet" sit in the New menu today, which is where
the tangle shows. Putting link actions on the thing that shows the link is the least to learn.

## R10. Pickers

**Decision**: `SchedulePickerDialog.vue` already takes an `onPick` callback; it serves New from
schedule, Link a scheduled quiz and Open from the schedule with three callbacks. `MeetPickerDialog`
serves Link a meet as it does today. Stored quizzes need one new dialog: the list from R1 by quiz
name, each row opening its current version, with its earlier versions listed on demand (FR-008).

## R11. Portal links

**Decision**: `loadFromUrlParams` keeps reading `?meetId&quiz` and `?meetId&result&revision` (and
the older `meet` spelling), and calls New from schedule and Open from the meet. The contract with
the portal is unchanged.

## R12. Coordination with the stats work

The stats plan (`specs/006-meet-stats`, unmerged) edits `api.ts` and `useSubmitToMeet.ts` to send
`scheduleQuizId`, and `useMeetSession.ts` where a meet is linked, and later moves `teamNamed` and
`looseName` to `packages/shared`. This feature edits `useMeetSession.ts` and `api.ts` heavily and
`useSubmitToMeet.ts` not at all. Whichever lands second rebases; the stats session is to be told
when implementation here starts.

## R13. Tests

Component tests mount `Scoresheet.vue` with the API module mocked, as
`components/__tests__/openWhileLinked.spec.ts` does; session logic is tested in
`composables/__tests__/useMeetSession.spec.ts`, the team swap in `stores/__tests__/`. No scoring
code changes, so no scoring tests change.
