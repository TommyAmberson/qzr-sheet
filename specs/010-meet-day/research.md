# Research: Meet day

Decisions for `spec.md`, from reading the portal's meet pages, the schedule's bench model and the
stats API on master (`76a6875`) and the open #200 (`fix/papercuts`).

## R1. One response for the meet day

* **Decision**: A new `GET /api/meets/:id/day` gives everything the Schedule and Quizzes tabs show
  that the published schedule doesn't: each scheduled quiz's status and result, each bench's team
  once settled, the stored quizzes not on the schedule, and for admins the number of things that
  need attention. It is cut to the reader as a division's stats are (`viewerHas`, `cutTo`). The
  published schedule document is still read from `GET /schedule/published`, once, and again only
  when the day response names a newer version.
* **Rationale**: Today no response says which scheduled quiz a stored result belongs to except
  `GET /results`, which is for admins and officials; a viewer's stats name quizzes by name only. The
  join has to happen on the server, where the cut happens. Keeping the document out of the polled
  response keeps each refresh small.
* **What a viewer's Quizzes tab reads**: the day response alone. It carries the stored quizzes that
  aren't on the schedule as well as the scheduled ones (every stored quiz when none is published),
  each with its teams named as stored, so a meet without a schedule still lists its quizzes for
  viewers, and a quiz matched to the schedule by name, whose teams may not be in the benches' order,
  puts each result beside the right team. Admins and officials read the results list and the
  attention list besides, for their controls. Every part goes through the cut a division's stats
  make, so the tabs give each reader exactly what meet stats gives them (spec FR-024): a stage whose
  results a reader may not see yet shows its quizzes as "result not shown yet", in or not, never
  revealing that one has been played.
* **Alternatives considered**: Adding results to the published schedule response (that route is the
  schedule's, read by the builder and the scoresheet, and its document is versioned and immutable;
  mixing live results into it blurs both). Letting the portal join `GET /results` with the stats
  (viewers can't call `GET /results`, and joining by name is guesswork).

## R2. Refreshing every 30 seconds on the free plan

* **Decision**: The day response is built like the attention list, every division under one scoring
  budget, and a viewer's copy is kept in the Worker's cache for 20 seconds, keyed by meet and by
  audience: one copy for every viewer and coach (they get the same cut), none for admins or
  officials (few, and their cut differs). Membership is still checked before a cached copy is
  served. A response that answers 503 while revisions are scored is never cached.
* **Rationale**: The attention list costs 33 to 35 ms of CPU on the one production meet with results
  (research R2 of `006-meet-stats`), and most of that is start-up and the session check. Polling
  every 30 seconds from every open viewer would multiply the heavy share of requests the free plan
  tolerates. With the cache, the expensive build runs about three times a minute per meet however
  many viewers watch.
* **Alternatives considered**: A change stamp and `304 Not Modified` (needs a meet-wide "last
  changed" that four tables would have to keep current). Polling less often (the maintainer chose 30
  seconds). Server push (the maintainer chose polling, and Workers on the free plan have no cheap
  push).

## R3. Which team sits on a bench: one shared resolver

* **Decision**: A new pure `resolveBenches` in `packages/shared/src/schedule/resolve.ts` takes the
  schedule document, each division's confirmed prelim order and re-rank, and the final places of the
  quizzes that count (by schedule quiz id), and gives the team on each bench that is settled, keyed
  by quiz and bench. Bench kinds (`scheduleFile.ts:144-157`):
  * `letter`: the draw, as today.
  * `rank n`: the team at rank `n` of the confirmed prelim order; none until confirmed.
  * `new n`: the team at rank `n` of the confirmed re-rank.
  * `place {quiz, place}`: the team in that place of that quiz, once it counts.
  * `points {place}`: the team in that place across the holding quiz's lane's round robin, once
    every quiz of the round robin counts, ranked as the prelims are: by placement points, ties
    broken by the meet's tie-break setting (`divisionStandings`).
  * `empty`: none.

  Teams level in a source quiz leave the bench unsettled and marked tied. A confirmed order, or a
  round robin's standings, gives its teams by position even where it still marks them tied after
  every tie-breaker, which next to never happens; recording how the admin settled such a tie is
  later work. It also takes over three inline letter lookups (`quizProblems.ts:58-60`,
  `apps/scoresheet/src/api.ts:220-226`, `ScheduleSeat.vue:21-26`), so one function answers "which
  team is on this bench". The sheet's bench text keeps its own, which needs the team's place in the
  draw too.
* **Rationale**: `docs/scheduling.md` keeps a bench's def apart from its resolution; nothing writes
  `seed_resolutions` now. Confirmed orders (`MeetFacts.confirmed`) and scored places are already
  read on every stats request, so resolving is a pure step over data in hand. One function serves
  the API, the portal and the scoresheet alike (principle III's spirit).
* **Alternatives considered**: Writing teams into the schedule (rejected with the maintainer: every
  fill would publish a version, and a withdrawn order would need another). Resolving in each client
  (three copies of the rules).
* **Matching names to teams**: confirmed orders hold names, not team ids (`TeamRow`), so the
  resolver returns names, and callers match them to roster teams by folded name, as standings do.
* **Division keys**: a schedule quiz names its division by the schedule's settings id, the stats by
  the meet's division name; the resolver takes orders keyed by the settings id, mapped once by the
  API from the schedule's divisions.

## R4. Benches in the scoresheet and in the teams check

* **Decision**: The day response carries the settled benches. The scoresheet, opening a scheduled
  quiz, reads them from it beside the published document, and its existing fill (`planLink`,
  `teamForBlank`) takes them as it takes a drawn letter's team. The API's check of a stored quiz's
  teams (`scheduledQuizOf` in `quizProblems.ts:48-70`) uses `resolveBenches` too, so an elimination
  quiz is checked once its benches are settled.
* **Ordering**: a `place` bench depends on its source quiz counting, and counting depends on that
  quiz's problems. To avoid a chain, a source quiz's places are used once it counts on every problem
  except its own teams check; the schedule's order has no cycles, so this is enough.
* **Rationale**: the scoresheet already fills any bench that comes with a team (`api.ts:203-238`); a
  null team is all that stops it today.

## R5. The page: one route, five tabs

* **Decision**: One meet page at `/:slug` with the tab in the path and the division in the query:
  `/:slug` (Schedule), `/:slug/quizzes`, `/:slug/standings`, `/:slug/roster`, `/:slug/setup`, each
  taking `?division=`. Old paths redirect: `schedule` to Schedule, `results` to Quizzes, `stats` and
  `stats/:division` to Standings with the division, `stats/settings` to Setup's stats section.
  `results/:resultId`, `churches/:churchId/teams` and `schedule/edit` stay. Guests reach the
  Schedule, Quizzes and Standings tabs as they reach the pages today (`guestAccess`, meet id as
  slug); Roster and Setup are for members, as the meet page is today.
* **Tabs**: a small tab bar of router links (`role=tablist`), following the builder's `.seg` look;
  no new dependency. The existing views become the tabs' contents: `ScheduleView` (Schedule),
  `ResultsView` (Quizzes), `DivisionStatsView` with the steps from `StatsSettingsView` (Standings),
  the churches section of `QuizMeetView` (Roster), and the rest of `QuizMeetView` with
  `StatsSettingsView` (Setup).
* **Rationale**: path tabs keep links and the browser's back button working, and the redirects keep
  every address of today's pages working (FR-005, SC-006).

## R6. Results on the schedule

* **Decision**: `ScheduleSheet` gains an optional `marks` prop: per schedule quiz, its status and
  per bench a result line (place, score) and a settled team. `ScheduleSeat` shows a settled team on
  its team line, where a drawn letter's team goes today, and a result beside it. The builder passes
  nothing and is unchanged. At phone width the Schedule tab shows a new list of the picked
  division's quizzes by time, reusing `ScheduleSeat` for each bench.
* **Rationale**: the sheet has no slot for results today (only `quiz-title`); a prop keeps its
  layout the published layout (FR-008) without a second schedule renderer.

## R7. Keeping the page current

* **Decision**: one composable re-reads the day response on tab switch, on `visibilitychange` to
  visible, on a Refresh button, and every 30 seconds while `document.visibilityState` is visible; it
  stops while hidden. The Standings tab re-reads its division's stats on the same beat. The Roster
  and Setup tabs load once, as today.
* **Rationale**: FR-022; #200 already refreshes the quiz page when its tab comes back into view.

## R8. Docs the feature amends

* `docs/scheduling.md`: bench resolution is now built, from confirmed orders and counted quizzes,
  replacing the "still to come with #16" note.
* `docs/roles-and-access.md`: the meet page's tabs and who sees what in each, and the day response.
* `docs/architecture.md`: the meet page and its data flow.
