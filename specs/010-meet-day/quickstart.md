# Quickstart: Meet day

Validation scenarios for [spec.md](./spec.md). The response is in
[contracts/meet-day-api.md](./contracts/meet-day-api.md); what is worked out, in
[data-model.md](./data-model.md).

## Setup

```sh
pnpm install
pnpm --filter @qzr/api db:migrate:local
pnpm dev:all     # scoresheet :5173, portal :5174, API :8787
```

Use a meet with a published schedule that has prelims, an intermediate or eliminations, and a
Finals, in at least two divisions, with rosters, two rooms and stored quizzes, some linked and one
in error: the FBC test meet (`~/notes/fbc-e2e`, or a copy of its local database) is one. Keep a
second, private window joined with the viewer code, and a third joined as one room's official.

## Automated checks

```sh
pnpm test:unit && pnpm type-check && pnpm lint
```

Expect the shared specs for `resolveBenches` (every bench kind, a withdrawn order, a tie at a
cutoff, a source quiz not counting), the API specs for `GET /day` (each reader's cut, the cache for
viewers only, 503 while preparing), and the portal specs for the tab routes and redirects.

## Scenarios

1. **The schedule fills in (Story 1)**: Open the meet as the admin: it opens on Schedule, in the
   published layout. Played quizzes show places and scores beside their teams; the one in error is
   marked as needing attention; quizzes not in are plain. In the viewer window the quiz in error is
   under review, and every quiz of a stage the settings don't show yet reads "result not shown yet",
   in or not.
2. **Benches settle (Story 1, #16)**: Before a division's prelims are confirmed, its elimination
   benches show only their source in both windows, even with live standings shown. Confirm the
   prelims on the Standings tab: the benches name their teams. Store and count an elimination quiz:
   the benches its winner, 2nd and 3rd feed name their teams. Take the confirmation back: the
   benches show their source again.
3. **Every quiz on one list (Story 2)**: On Quizzes, what needs attention is first, across
   divisions, each item leading to its fix; each stage lists its scheduled quizzes, in or not; a
   quiz stored with a name the schedule doesn't have is in its own group, with a way to link it. The
   official sees their room's problems only; the viewer, no attention list, and only what that
   viewer's division stats would list. In a meet with no published schedule, the viewer's Quizzes
   tab still lists its counted quizzes by stage.
4. **Standings and steps (Story 3)**: On Standings the division's tables show as the stats page did,
   with print and download; the admin sees the steps, what's missing, and the controls. Setup has
   the same steps in its stats settings.
5. **One division across tabs (Story 4)**: Pick a division on Schedule, switch to Quizzes and
   Standings: it stays picked. Reload; copy the address into a signed-out window: sign in, and the
   same tab and division show. Open the old `/results`, `/stats`, `/stats/<division>` and
   `/stats/settings` addresses: each lands on its tab.
6. **Keeping current (FR-022)**: With the Schedule tab open in the viewer window, store a quiz from
   the scoresheet: it appears played within 30 seconds, plus up to 20 for the viewers' copy. Hide
   the window for a minute: no requests while hidden; showing it again re-reads at once.
7. **The scoresheet (FR-023)**: After the prelims are confirmed, open an elimination quiz from the
   schedule in the scoresheet: its benches come filled with the teams. Store it with a team swapped:
   it is in error, its teams differing from the schedule's.
8. **Phone (Story 5)**: At 390 px every tab is reachable, the tab bar and the division picker scroll
   on their own, the page never does, and Schedule is the division's quizzes as a list by time.
9. **Cost (R2)**: With five viewer windows open on Schedule, `wrangler tail` shows one full build of
   the day response per meet about every 20 seconds, the rest served from the copy.
