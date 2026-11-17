# Quickstart: checking New, Open and Link

How to prove the feature works end to end. The link, session and swap rules are in
[data-model.md](./data-model.md); the menus, questions and warning lines in
[contracts/client.md](./contracts/client.md).

## Prerequisites

* `pnpm install` in the worktree.
* A local database with a meet that has a published schedule with prelim quizzes, teams with rosters
  in at least two divisions, and a room whose code you know. `pnpm dev:api` serves it on 8787. A
  copy of another worktree's `packages/api/.wrangler/state` and the canonical clone's
  `packages/api/.dev.vars` (both git-ignored) is the quickest way to get one.
* `pnpm dev` for the scoresheet on 5173 (the dev API's CORS allows 5173 and 5174 only).

## Automated

```sh
pnpm test:unit
pnpm type-check
pnpm lint
```

All three pass. New tests sit beside the code: the link routine and schedule warnings in
`apps/scoresheet/src/components/__tests__/` and `composables/__tests__/`, the team swap in
`stores/__tests__/`.

## By hand

Each block starts from a scoresheet joined to the meet as an official of a room.

**1. New from schedule (Story 1)**

1. Score a few answers and type names. New ▸ New from schedule…, pick a prelim quiz, confirm.
2. Expect: no answers; division, number and three teams as the schedule has them; each team's roster
   seated; the linked display shows the meet and the quiz.
3. New ▸ New 20-question quiz. Expect: blank sheet, meet still shown, no quiz shown.
4. With unsaved answers, New from schedule… and cancel the question. Expect: nothing changed.
5. On a blank sheet, type one team name only, then New ▸ New 20-question quiz and cancel the
   question. Expect: the name is still there. Then New from schedule… a quiz and confirm, and New ▸
   New 20-question quiz again. Expect: no question, since the names came from the schedule.

**2. Link without disturbing (Story 2)**

1. Unlinked, type three team names as the roster spells them, a quizzer or two, and some answers.
   Leave the division blank.
2. Link ▸ Link a scheduled quiz…, pick the quiz those teams are in.
3. Expect: every typed name and answer as it was; division and number filled; each team picked,
   blank seats filled from its roster.
4. Unlink quiz. Expect: sheet and picks unchanged, quiz gone from the linked display.
5. Reload. Expect: links as they were.

**3. Schedule warnings and fixes (Story 3)**

1. Link a scheduled quiz, then change the quiz number and swap two team names by typing.
2. Expect: the warning count includes "Quiz …: schedule has …" and a line per swapped slot.
3. Open the warnings, take the move for one slot. Expect: the two teams change places with their
   quizzers and answers, both lines gone, scores unchanged. Undo puts them back.
4. Submit to meet and decline. Expect: the remaining lines in the one question.
5. Unpublish or replace the schedule in the portal without that quiz, then press the refresh symbol.
   Expect: "Quiz: no longer in the meet's schedule".

**4. Open from the meet and the schedule (Story 4)**

1. Submit a quiz, start a new one. Open ▸ From the meet…, pick the submitted quiz.
2. Expect: its names and answers, teams picked where the roster has them.
3. Submit a correction so it has two versions. Open ▸ From the meet…: the row opens the current
   version, and its earlier version can be opened from the same row.
4. Open ▸ From the schedule…, pick a quiz with nothing stored. Expect: told so, offered to start it
   new.
5. New ▸ New from schedule… for the submitted quiz. Expect: told a result is stored; open, new or
   cancel.
6. As a viewer, Open ▸ From the meet…. Expect: told they may not see the meet's stored quizzes.

**5. Opening a file, and waiting**

1. Linked to the meet and a scheduled quiz, Open ▸ From file… and pick a saved quiz.
2. Expect: the file as saved; the linked display shows no meet and no quiz; no warnings; no request
   in the network panel. Link ▸ Link a meet… brings the picks and warnings back.
3. Throttle the network to its slowest. New ▸ New from schedule… and pick a quiz.
4. Expect: the sheet shows it is waiting; cells, name boxes, keys and menus do nothing; Cancel
   returns the sheet exactly as it was, and nothing changes when the answer arrives later.
5. Repeat for the refresh symbol and for Submit to meet (which waits while it fetches before its
   question).
6. Reload with the network still throttled. Expect: the sheet can be scored at once.

**6. Offline (Edge cases)**

1. Stop `pnpm dev:api`. Expect: plain New, scoring, Save, Open from file and both Unlinks work; New
   from schedule, Open from the meet or schedule, Link and the refresh symbol say the meet can't be
   reached and change nothing; warnings already shown stay.

**7. Portal links**

1. From the portal's schedule, follow a quiz's link. Expect: step 1's result.
2. From a stored quiz's page, follow a version's link. Expect: that version, linked as in step 4.
