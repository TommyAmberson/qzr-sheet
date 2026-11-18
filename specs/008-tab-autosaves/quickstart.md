# Quickstart: checking tab auto-saves and recent quizzes

How to prove the feature works end to end. Records, states and rules are in
[data-model.md](./data-model.md); the dialog, rows and notices in
[contracts/client.md](./contracts/client.md).

## Prerequisites

* `pnpm install` in the worktree.
* `pnpm dev` for the scoresheet on 5173. Blocks 1 and 6 also need a meet: `pnpm dev:api` on 8787
  with a local database holding a meet with a published schedule and a room whose code you know (a
  copy of another worktree's `packages/api/.wrangler/state` and the canonical clone's
  `packages/api/.dev.vars`, both git-ignored), and the portal (`pnpm dev:web`) for portal links.
* A browser profile you can clear: the checks fill its storage. DevTools ▸ Application shows the
  `qzr-sheet` IndexedDB records, `sessionStorage` and, in Chrome, nothing for locks; run
  `await navigator.locks.query()` in the console to see which records are held.

## Automated

```sh
pnpm test:unit
pnpm type-check
pnpm lint
```

All three pass. New tests sit beside the code in `apps/scoresheet/src/persistence/__tests__/` and
`composables/__tests__/`, and `packages/ui`'s history tests cover the new history surface.

## By hand

**1. Several tabs (Story 1)**

1. In tab A, score a few answers. From the portal, open four stored quizzes, each in a new tab.
2. Expect: no tab asks about unsaved changes; A still shows its quiz.
3. Edit one portal tab; reload each tab in turn. Expect: each shows the quiz and link it had, and
   Open ▸ Recent quizzes… gains no row.
4. Link A to one scheduled quiz and B to another; submit each. Expect: each result lands on its own
   scheduled quiz.
5. Duplicate A (browser tab menu). Expect: the copy shows A's quiz; an answer added in the copy is
   not in A, before or after reloading both.

**2. Closing and coming back (Story 2)**

1. One tab: score part of a quiz, close the tab, open the scoresheet. Expect: the quiz is back, no
   question, with its link and undo.
2. Save it to a file, close, open the scoresheet. Expect: blank sheet; the quiz is under Open ▸
   Recent quizzes, not marked unsaved.
3. Score quizzes in two tabs, close both, open the scoresheet. Expect: both offered; choose Start a
   blank quiz. Open another tab. Expect: no offer.
4. With unsaved answers, choose New. Expect: no question; the old quiz is listed as unsaved.
5. With an unsaved quiz left over, open a portal link in a new tab. Expect: the linked quiz opens,
   and a notice says unsaved quizzes are waiting, with a link to them.

**3. Recent quizzes (Story 3)**

1. Open ▸ Recent quizzes…. Expect: unsaved first and marked; each row with name, teams, answers and
   time.
2. Restore one. Expect: it shows with its link; the quiz the tab had is now in the list.
3. Discard one, then Discard all. Expect: each asks first; quizzes open in other tabs stay.
4. Save a quiz to a file, edit, submit it, edit again, close. Expect: three rows for it, and each
   restores its own state.
5. Go offline (DevTools ▸ Network ▸ Offline) and restore a submitted quiz. Expect: it opens.
6. Start a quiz from the schedule, touch nothing, close the tab. Expect: it is not listed.

**4. Undo across reload and restore (Story 4)**

1. Score five answers, reload, undo five times. Expect: removed newest first; redo puts them back.
2. Replace the quiz with New, restore it from the list, undo. Expect: the same.
3. Save the quiz to a file and open the file in a text editor. Expect: no undo history in it.
4. Type a team name, tick on-time, change the division and the quiz number. Undo four times. Expect:
   each is taken back in turn, the whole name at once.
5. Clear answers, then undo. Expect: the answers, no-jumps and timeouts come back.
6. Save a quiz, rename a team, score more, close the tab, restore it as saved and redo everything.
   Expect: exactly the quiz as it was left, the new name included.

**5. Open finds its quiz (FR-023)**

1. Save a quiz to a file, edit, close the tab. Open the file in a new tab. Expect: the recent quiz
   continues (not listed any more), with undo back past the save and redo forward to the edits.
2. Make a new edit there, then Open ▸ Recent quizzes…. Expect: the later edits are listed as a quiz
   of their own.
3. Open the same file while that quiz is open in another tab. Expect: the notice; a separate quiz.

**6. Moving to this version (FR-017, FR-018)**

1. On master, score a quiz linked to a meet. Switch the dev server to this branch and reload.
   Expect: the same quiz and link, no question; `qzr-sheet:current` and `qzr-meet-session` gone from
   `localStorage`.
2. Start the tutorial, reload in the middle. Expect: the tab's own quiz, not the practice quiz, and
   the practice quiz never in the list.
