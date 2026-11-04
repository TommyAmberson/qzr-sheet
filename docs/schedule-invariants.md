# Schedule invariants

The rules every meet schedule must satisfy, written down even where they are obvious. The schedule
builder's generator never produces a schedule that breaks one, and the conflict check flags any
schedule that does, whoever made it. Each rule has an ID so specs, tests and conflict messages can
cite it.

Three kinds of rule:

* **Hard rules** (`H-…`) make a schedule wrong. The generator never breaks one. A director can still
  break one by hand, since the builder never blocks an edit, but the cells involved are marked with
  the rule. A schedule with a broken hard rule can still be published, after a confirmation: on the
  day, a last-minute swap can leave a team due in two rooms at once, and the schedule should show
  what actually happens.
* **Warnings** (`W-…`) make a schedule worse but not wrong. They are shown, and never block
  anything.
* **Preferences** (`P-…`) are what a good schedule looks like when there's a choice. The generator
  aims for them, in their listed order, but never at the cost of a hard rule. They aren't flagged
  when a schedule misses them.

Terms follow [scheduling.md](./scheduling.md): a **slot** is a row of the grid (a time), a **room**
is a column, a **cell** is one slot in one room, and a **seat** is one place in a quiz. In the
prelims a seat holds a **letter**, which the draw later maps to a team. In the elims a seat holds a
**source**: a prelim rank (`3`), an intermediate result (`New 10`), or a place in an earlier quiz
(`2 of A`).

## People and places

* **H-1. A team is in at most one quiz per slot.** A team can't be in two rooms at once. This holds
  for letters in the prelims and for sources in the elims: two seats in the same slot can't name the
  same letter, or the same source.
* **H-2. A room holds at most one quiz per slot.**
* **H-3. Nothing is scheduled over an event.** An event across all rooms leaves its slot with no
  quizzes. An event in one room (a coaches' meeting in Room 2) leaves that cell empty, and the other
  rooms free.
* **H-4. A team appears at most once in a quiz.** No letter or source fills two seats of the same
  quiz.

## Quizzes

* **H-5. A quiz has three seats**, except a championship quiz the rule book allows to be a two-team
  quiz (`rules.md` Bracket B quiz K, Bracket C quiz L). A seat held by a team marked absent still
  counts: that quiz runs with two teams, and nothing is wrong with the schedule.
* **H-6. A quiz belongs to one division**, and every seat in it comes from that division. Teams
  never change division.
* **H-7. Quiz labels are unique within a schedule** (`Div 2 Quiz 5`, `Div 2 Quiz A`,
  `Div 2C Quiz I`, `Div 2 Finals`), so a quiz can be named without ambiguity, on paper and in "2 of
  A".
* **H-8. A quiz sits in one cell or in the unplaced tray**, never in two cells. A schedule with
  quizzes left in the tray is incomplete, but not wrong.

## Prelims

* **H-9. Every team plays the same number of prelim quizzes**: the schedule's quizzes per team (3 by
  default, 6 at one-room meets). So a division of `n` teams has `n × quizzes per team ÷ 3` prelim
  quizzes.
* **H-10. A division's letters run from A with no gaps**, one letter per team: `A` to `I` for 9
  teams. After `Z` they continue `AA`, `AB`, …, so a 32-team division runs `A` to `AF`. There's no
  maximum division size. No prelim seat uses a letter outside the division's range.
* **W-1. No two teams meet twice in the prelims**, where the team count allows it. The rule book's
  8-team table and every table under 7 teams have repeats; the rotating draw has none from 7 teams
  up.

## Order in time

* **H-11. A division's prelims all come before its elims.** No prelim of a division sits in the same
  slot as, or after, one of its elims. The gap between its last prelim and first elim is the
  division's stats break, worked out automatically, so one division can be in its elims while
  another is still in its prelims. A "Stats break" event row is just an event.
* **H-12. A quiz comes after every quiz it takes a team from.** A seat sourced from `2 of A` sits in
  a later slot than quiz A. A seat sourced from `New 10` sits later than **all** of the
  intermediate's quizzes, X and Y both, since every `New n` depends on every team's result (see
  H-16). Same-slot is too early.
* **H-13. A lane's finals come after every other quiz in that lane.**

## Elim structure

* **H-14. Every team in the division enters the elims exactly once.** Each prelim rank from 1 to the
  team count enters exactly one place: an intermediate, or one lane. Nobody is dropped and nobody is
  entered twice. In a bracket or an intermediate, a rank seeds exactly one seat. In a round-robin
  lane (the extras for the lowest ranks), a rank seeds every quiz the round-robin gives it. (In a
  10-team division, rank 10 enters through the X quiz and, as `New 10`, plays the main bracket's
  bottom placing quiz.)
* **H-15. Each result is sent at most once.** `2 of A` is the source of at most one seat. A result
  that is sent nowhere means that team is finished.
* **H-16. Each intermediate result is used, and stays in its range.** A reranking intermediate
  reranks the teams of a rank range (7 to 12, say) together, across all its quizzes, by prelim
  points plus the points from their intermediate quiz (`rules.md` §2.b). The results are `New 7` to
  `New 12`: a team can't leave the range, however it did. Every `New n` is the source of exactly one
  seat. The top of the range joins the bracket above, the rest the lane below. A play-in
  intermediate reranks nobody: its places go to seats like any quiz's (H-15), and each of its teams
  still enters exactly one lane (H-14).
* **H-17. A source refers to a quiz in the same division.**

## The draw

* **H-18. Letters and teams match one to one within a division.** After the draw, each letter stands
  for exactly one team and each team holds exactly one letter.
* **W-2. A team expected late doesn't play in its division's first quiz slot.** The draw gives late
  teams the letters whose first quiz is latest, so this only fires when there aren't enough late
  letters to go round, or after hand edits.
* **W-3. A quiz using intermediate results leaves time to total them.** The first quiz with a
  `New n` seat starts no sooner after the intermediate's slot ends than the schedule's totalling gap
  (a setting, 10 to 20 minutes by default), since the rerank needs every intermediate team's points
  added up first (H-16).
* **W-4. Every quiz is on the schedule.** A quiz left in the unplaced tray breaks no hard rule
  (H-8), but the schedule isn't finished until it has a cell, so the builder never reports "no
  problems" while one is waiting.
* **W-5. Each quiz's results have a name of their own.** The scoresheet saves a quiz's results under
  its division, whether it's in a consolation lane, and its number or letter (`D2c QI`), so two
  quizzes that differ only in which consolation lane they're in would share a name and their results
  would mix. Lane letters that continue down the lanes (the default) never collide; lanes that each
  restart at A can. Rename one of the two. (Recording the lane in the scoresheet's quiz file would
  remove the clash, and is future work.)

## Editing

These are rules about how the builder behaves, not about a finished schedule.

* **H-19. The generator never moves, changes or deletes a pinned quiz.** A quiz is pinned once the
  director moves or edits it by hand. Settings changes re-flow only unpinned quizzes.
* **H-20. A quiz with submitted results is protected** (once schedules are linked to results). The
  generator never moves, changes or deletes it. The director can still edit it by hand after
  confirming in the page that it has results; the quiz is then marked as changed after its results,
  both in the schedule and on the results page.

## Preferences

Taken from the org's printed schedules (2021 to 2026), where every meet follows them, and ranked by
the maintainer. Earlier preferences win when two conflict.

* **P-1. Late teams play late** (see W-2), when the schedule counts lateness: it's off unless the
  director switches it on. Before the draw this is the draw's job: late teams get the letters that
  play last, and nothing moves. After the draw, re-flow places a division's prelims as Sort does
  within its rooms, so late teams' quizzes take its latest cells and a settings change keeps them
  there. The director's Sort across rooms goes further, using the latest free cells in any room, and
  this outranks every other preference.
* **P-2. Higher-numbered divisions sit in higher-numbered rooms**, in every slot: Div 1 in the
  lowest rooms, then Div 2, then Div 3. Each division's block is sized to its share of the quizzes.
* **P-3. A room switches divisions and lanes as few times as possible, and never back and forth.**
  Each division keeps its own block of adjacent rooms through prelims and elims, and within the
  elims each lane keeps to the same rooms, so officials and spectators stay put (2c in Room 3, 3c in
  Room 5, 2025). A room changes hands when its division or lane has finished, or when the largest
  division needs it (32 teams in 5 rooms, 2024); a room going Div 2, Div 3, Div 2 is the worst case.
  When a division has to borrow another division's room, it borrows as late as possible, so the
  overflow lands in its last round and the room's own division keeps it until done (Div 2 Quiz 13 in
  Room 1 at 9:50, 2025). Finals don't count: they run in Room 1 whatever its division.
* **P-4. Quizzes run in their number or letter order.** Prelim quiz 1 is in the first slot, and a
  lane's quizzes A, B, C, … follow each other in time, so the printed schedule reads in order.
* **P-5. Each division's elims start soon after its stats break, and finish as early as they can**,
  so finals aren't held up waiting on one lane.
* **P-6. Finals balance being watched against finishing on time.** Running finals one at a time, in
  one room, lets as many people as possible watch each one; running them together frees the evening
  sooner for the social and supper. Meets have settled on finals one at a time, about 25 to 30
  minutes apart, from mid-afternoon, the highest division first and each consolation Finals just
  before its own. The director changes any of it on the grid.
* **P-7. The schedule uses as few slots and rooms as it can**, so the day ends on time.
* **P-8. Spare cells come last**, so a division's rounds are full and only its last slot is partly
  empty. This is a weak preference: a gap can go anywhere when that lets a late team start later
  (P-1) or keeps a room on one division (P-3).

## Not rules (yet)

Things a director might expect that the examples don't show being enforced. Each would need a
decision before becoming a rule or a preference:

* A team playing in back-to-back slots, or a minimum rest between its quizzes. With one room per
  small division (6 teams, 3 quizzes each, one quiz per slot), back-to-back quizzes can't be
  avoided.
