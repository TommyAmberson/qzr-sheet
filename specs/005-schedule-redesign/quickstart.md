# Quickstart: validating the schedule builder

How to show the feature works, end to end. Behaviour is defined in [spec.md](./spec.md); shapes in
[data-model.md](./data-model.md) and [contracts/](./contracts/).

## Prerequisites

* `pnpm install` at the repo root (hooks included).
* For the linked scenarios: `pnpm dev:all` (scoresheet :5173, portal :5174, API :8787) and a local
  D1 with migrations applied (`pnpm --filter @qzr/api db:migrate:local`).

## Automated checks

```sh
pnpm test:unit     # shared schedule logic, API routes, builder and viewer components
pnpm type-check
pnpm lint
```

The shared tests carry the reference meets as fixtures. Each must pass:

| Fixture                        | Expect                                                                                                               |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| FBC 2025: 6, 17, 16 in 5 rooms | no hard conflicts; XY on 7 to 12; 9-team mains; 8 and 7-team consolations                                            |
| Heritage 2025: 10, 14, 21 in 6 | 10-team bracket with a rerank X on 8 to 10; 5-team consolation; 9-team 3C                                            |
| Heritage 2024: 6, 32 in 5      | XY on 10 to 15; 12-team main and 2C; 8-team third lane                                                               |
| One-day 2026: 5, 10, 12 in 3   | one room per division; per-division stats breaks                                                                     |
| Heritage 2023 Div 1: 11 teams  | 11-team bracket: play-in X on 9 to 11, G = 2 of F, 2 of X, 3 of X                                                    |
| Nov 2021 Div 2: 22 teams       | 2C as a 10-team round robin, 3 each, Finals on points                                                                |
| CMQ 2026: 36 and 14 in 9 rooms | reached by settings alone: WXYZ on 9 to 20, 12-team A and K, B round robin                                           |
| Draw sources, 4 to 90 teams    | every team plays the set number of quizzes, never twice in one; no rematches from 7 up in the rotating draw (SC-003) |
| Generation time, 60 teams      | under 2 seconds (FR-014, SC-007)                                                                                     |

## Manual scenarios

1. **Standalone** (story 1, 5): signed out, open the portal's builder page and start a schedule;
   enter 6, 17 and 16 teams. A full weekend schedule appears with no conflicts. Turn the network off
   and keep editing and saving to a file: nothing fails. Reload (online): it's still there. Open the
   saved file in another browser: identical.
2. **Settings and pins** (story 2): drag two quizzes, then change a team count, the slot length and
   the room count. The dragged quizzes haven't moved; everything else re-flowed. Turn Auto-apply
   off, change a setting: it's marked unapplied with its applied value, and Apply says how many
   quizzes will move.
3. **The grid** (story 3): move, swap, swap two seats, insert a slot, add a one-room event and a
   note row, delete a quiz; undo all, redo all. Conflicts appear and clear in the page, never in a
   browser dialog.
4. **Elims** (story 4): for a 17-team division, remove the XY, then put it back; make the
   consolation a round robin with 2 each; untick its Finals (the deciding quiz stays, renamed as the
   next letter); add a WXYZ on another line.
5. **The draw** (story 6): enter names, mark two late and one absent, draw. Late teams' first
   quizzes are as late as they can be; the absent team's seats show "Absent". Sort prelims, then
   Sort across rooms: no room switches division back and forth.
6. **Linked** (story 7): in the portal, open a meet's Schedule tab and choose Edit: the builder
   opens on the meet's schedule. Publish with a conflict: it's listed and published after confirming
   in the page. Edit again without publishing: the portal's view and the scoresheet's picker still
   show the published version, and the builder shows "unpublished changes". Publish twice more and
   open the history: three versions with when and by whom; restore the first as the draft, and
   readers still see the third until the next publish. Open a meet created with the old editor: it
   opens, every quiz pinned, as version 1.
7. **Phones** (FR-005b): on a phone-sized window, move a quiz and change a seat by
   select-then-choose, and publish.
