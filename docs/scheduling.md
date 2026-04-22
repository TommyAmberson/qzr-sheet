# Schedule design

This document defines the domain model for meet scheduling. A qzr meet has two materially different
scheduling phases (prelims and elims) with a pivot step in between. The official rules
(`docs/rules.md` §"Rules for Tournament" and §"Tournament Brackets") already specify the preliminary
pairings, elimination brackets, and intermediate quiz structures, and this doc is the design layer
that sits above those rules.

**Source of truth for rules**: `docs/rules.md`. If `rules.md` is missing something from the official
PDF, `rules.md` gets corrected first and this doc may need re-alignment.

**Philosophy**: the schedule feature is an **admin-driven builder**, not a generator. The admin
assembles the schedule in a grid editor, and the system offers assists — draw helpers, drag-and-drop
swaps, conflict warnings, quick fills — that make building fast without taking the wheel. When the
admin clicks "Generate prelims", the system produces a first draft that the admin is expected to
tweak; rearranging rounds, swapping teams, and adding events all remain first-class actions. The
admin should feel like they built the schedule with help, not like they approved a computed result.

Planning and work tracking live in GitHub issues (see `#9` Schedule epic and its sub-issues). This
doc is the stable design reference those issues link back to.

## 1. Vocabulary

| Term                           | Meaning                                                                                                                                                                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Meet**                       | A named multi-day event. One `quiz_meets` row.                                                                                                                                                                                              |
| **Division**                   | A competitive tier inside the meet. Set once at meet creation and never changes for a team. Today: Divisions 1, 2, 3. Stored as JSON on `quiz_meets.divisions`; teams carry a `division` string.                                            |
| **Team**                       | A church-owned roster for one meet + division. `teams` row. Has `consolation: boolean` (already in schema) — always `false` during prelims; set post-stats-break to route a team into the consolation elim bracket. Division never changes. |
| **Room**                       | A physical location where quizzes run in parallel. Named ("Room 1"–"Room 5"). New concept — not in schema today.                                                                                                                            |
| **Round**                      | An ordinal grouping of quizzes that run simultaneously across rooms in the same time slot.                                                                                                                                                  |
| **Slot**                       | A wall-clock time for a round. Not 1:1 with round — non-quiz events also occupy slots.                                                                                                                                                      |
| **Quiz**                       | Three teams competing at one `(round, room)` pair. Labeled `Div 1 Quiz 1`, `Div 2 Quiz A`, `Div 2 Quiz X`, etc.                                                                                                                             |
| **Prelim** (qualifier)         | Round-robin within a division. Every team plays exactly 3 prelim quizzes. Pairings are lookup tables (`rules.md` §"Preliminary Round Brackets", 4–21 teams).                                                                                |
| **Stats break**                | Transition. Admin reviews standings and picks an elim structure based on team count.                                                                                                                                                        |
| **Elim** (elimination round)   | Bracketed post-prelim phase. Teams identified by seed (`1st Quiz A`), not name, until results resolve placements.                                                                                                                           |
| **XYZ quizzes** (intermediate) | Three 3-team quizzes holding 9 teams ranked 7–15 after prelims. Top 3 join the championship bracket; bottom 6 go to consolation (positions 10–15). `rules.md` §2.a.i–iii.                                                                   |
| **XXYYZZ quizzes**             | Three 3-team quizzes for teams 16–24 in meets with > 24 teams. `rules.md` §2.a.iv–vi.                                                                                                                                                       |
| **Championship bracket**       | 9-team elim bracket for the top 9 teams (or top 6 + top 3 of XYZ). Three named templates: Bracket A, B, C. `rules.md` §"Elimination Round Brackets".                                                                                        |
| **Consolation bracket**        | Secondary 9-team bracket for positions 10–18 in meets with > 24 teams. Uses the same templates.                                                                                                                                             |
| **Championship quizzes**       | 3–5 end-of-bracket quizzes with "win twice" semantics. `rules.md` §3.                                                                                                                                                                       |
| **Event**                      | Non-quiz item on the schedule — Breakfast, Stats Break, Worship, etc. Occupies a slot, no room/teams.                                                                                                                                       |

## 2. How a meet actually runs

Based on a sample Quiz Meet Finals 2023 schedule:

```
Friday
  7:00  Registration (event)
  7:30  Assembly (event)
  8:00  PRELIMS ROUND 1 — Div 1 Quiz 1 in Room 1, Div 2 Quizzes 1–4 in Rooms 2–5
  8:25  PRELIMS ROUND 2
   …
  9:40  PRELIMS ROUND 6 (Div 1 finishes; Div 2 continues)
Saturday
  8:00  Breakfast (event)
  9:00  PRELIMS ROUND 7–8
  9:50  Stats Break (event)
 10:30  ELIMS — Div 1 Quiz A/B, Div 2 Quiz X/Y (intermediates)
 11:20  ELIMS continue
 12:45  ELIMS — lettered quizzes (Div 1 Quiz C, Div 2 Quiz C, Div 2C Quiz N…)
   …
  3:15  Div 2C Finals
  3:45  Div 2 Finals
  4:15  Div 1 Finals
  5:00+ non-quiz events (Supper, Worship, Awards)
```

Observations that shape the data model:

1. Rooms persist across both phases. Room 1 runs Div 1 quizzes in prelims and Div 1 elims in finals.
   The room pool is a meet-level resource.
2. Multiple divisions run in parallel in the same slot. Each division owns a subset of rooms per
   round.
3. Slot durations vary. Most prelim slots are 25 min; events take variable time. Admin controls slot
   duration per row.
4. Different divisions have different prelim round counts. Division 1 finishes earlier than Division
   2 because it has fewer teams.
5. Seeds become meaningful at the stats break. Prelim points → standings → bracket assignments.
6. Elim quizzes reference _other_ quizzes, not teams. `Div 2 Quiz D` = "2nd Quiz A, 3rd Quiz A, 1st
   Quiz B". Teams substitute in as prior quizzes finish.
7. XYZ intermediates take their seeds from prelim standings (`rules.md` §2.a.i–iii).
8. Consolation is a separate elim bracket _inside the same division_, not a separate division. Team
   division never changes. `consolation: boolean` on a team is the bracket-lane marker.
9. Consolation and XYZ are both conditional on team count per `rules.md` §2.a.

## 3. Rules and invariants

The builder enforces a small set of hard rules. There are no soft rules — opponent / room / round
balance is already determined by the `rules.md` preliminary pairing tables, and once the admin
deviates from those tables they're doing it on purpose.

**Prelim invariants enforced by the lookup table** (admin can't violate these because they pick the
table by team count and the table is fixed):

1. 3 letter-slots per quiz. Always.
2. 3 quizzes per letter. A division with `q` teams has exactly `q` prelim quizzes.
3. No letter appears twice within a single quiz.

**Prelim hard rules enforced by the editor** (these are the ones the admin can violate by dragging
quizzes around):

1. No room hosts two quizzes in the same round.
2. No quiz from the same division appears twice in the same round (the admin shouldn't be able to
   set this up by dragging — moving a quiz into a room where another from its division already lives
   in that round is a hard conflict).
3. Divisions are fixed — no moving teams between divisions.

**Prelim count invariant**:

With 3 teams per quiz and 3 quizzes per team, `# quizzes == # teams`. The builder surfaces this when
the admin picks room count and round count.

**Elim rules**: deferred to the elim epic; `rules.md` §"Elimination Round Brackets" is the source of
truth.

**Event rules**:

* Events occupy a slot but no rooms or quizzes.
* Events can be inserted between quiz rounds.
* Events don't enforce the default slot duration.

## 4. The prelim draw (utility, not the main UX)

**The draw is a lookup keyed on team count, not on team identity.** `rules.md` §"Preliminary Round
Brackets" spells out pairings for 4–21 teams as a fixed table. Example for 9 teams:

```
Quizzes: 1. ABC  2. DEF  3. GHI  4. ADG  5. BEH  6. CDH  7. AEI  8. BFG  9. CFI
```

The schedule is built around these letter slots, not around concrete teams. Team identity is bound
to letters only when the event is about to start (see §4.2). This decouples the schedule from the
roster: the admin can build and publish the schedule before all teams are registered.

Team counts > 21 are out of scope for the built-in helper; the admin builds those compositions
manually in the editor.

### 4.1 Composition utility

`drawPrelims(teamCount: number): Quiz[]` — looks up the team count in the `rules.md` table and
returns `teamCount` quizzes, each holding three letter slots (`A`–`U`). Pure function.

A second utility, `autoSlot(quizzes, rooms, rounds)`, fits the quizzes into a `(round, room)` grid
without hard-rule conflicts. Each utility is independently invocable from the editor toolbar.

### 4.2 Team assignment (at event start)

When the admin is ready to start the meet (or one division of it), they hit a "Roll teams" button.
This generates a random permutation of the registered teams and binds each team to one letter: `A` →
Heritage 1, `B` → GRBC 2, etc. The mapping is then propagated to every prelim quiz seat in that
division.

* The roll can be re-rolled until the admin clicks "Lock", at which point the assignment is final.
* Admin can override individual letter→team assignments before locking (drag a team chip onto a
  letter slot).
* After locking, the editor shows team chips instead of letter chips, and edits are direct
  team-level edits (rare; mostly reserved for team-no-shows).

### 4.3 Late teams

If a team is added _before_ the event starts, the schedule is regenerated to the new team count's
table (the structure changes — the admin re-places quizzes into rooms/slots). After "Lock", late
teams are out of scope for automated handling; the admin patches manually in the editor.

Divisions are independent: the admin can lock Division 1 while still tweaking Division 2.

## 5. Stats break — the pivot

Per `rules.md` §2.a, the transition is deterministic once team count is known. Per division, the
admin:

1. Reviews prelim standings (sum of 3 prelim quiz scores per team, per `rules.md` §1.a).
   Tiebreakers: quiz score at end of question 20 (§1.a.iv).
2. Looks up the tournament shape for team count:

   | Team count | Structure                                                                                                |
   | ---------- | -------------------------------------------------------------------------------------------------------- |
   | ≤ 9        | Single championship bracket, no XYZ, no consolation.                                                     |
   | 10–14      | Top 9 → championship bracket. Teams 10+ dropped.                                                         |
   | 15–20      | Top 6 → championship (auto-qualify). Teams 7–15 → XYZ. Teams 16+ dropped.                                |
   | 21–24      | Same as 15–20.                                                                                           |
   | > 24       | Top 6 → championship. Teams 7–15 → XYZ. Teams 16–24 → XXYYZZ. Consolation final-9 holds positions 10–18. |

3. Flips `teams.consolation=true` for teams headed to consolation. For the "> 24 teams" shape,
   consolation membership is finalised _after_ XYZ and XXYYZZ resolve, not at the break itself.
4. Generates the elim schedule using the selected bracket template (A / B / C).

`teams.consolation` is the authoritative lane marker, written at stats break and updated by the elim
result pipeline. A team's `division` is never rewritten.

## 6. Elims (elimination round)

Elim quizzes hold three **seed references** rather than teams. The structure is not a search —
`rules.md` spells out every bracket template.

**Intermediate quizzes**: XYZ (`rules.md` §2.a.i–iii) and XXYYZZ (§2.a.iv–vi) with their hard-coded
compositions.

**Championship brackets**: A (winner-move-up, quizzes A–I), B (double-elim, quizzes A–L), C
(combination, quizzes A–M). Admin picks one per division at stats break.

**Championship quizzes**: 3–5 quiz series with "win twice" termination (`rules.md` §3). Championship
quizzes after Quiz H/I/etc. are added on demand as results come in.

**Consolation bracket**: 9-team bracket using one of A/B/C, populated from positions 10–18. Only
present in meets > 24 teams.

**Seed-reference formats**:

| Format                                     | Meaning                                      |
| ------------------------------------------ | -------------------------------------------- |
| `prelimSeed(n)`                            | Team ranked `n` from prelim standings        |
| `place(quizId, p)`                         | Team that placed `p` in a given bracket quiz |
| `xyzTop3(rank)` / `xyzBottom6(rank)`       | XYZ advancers / fall-throughs                |
| `xxyyzzTop3(rank)` / `xxyyzzBottom6(rank)` | XXYYZZ equivalents                           |
| `winner(quizId)` / `loser(quizId)`         | Convenience for championship series          |
| `tiebreaker(candidates)`                   | Unresolved tied teams (`rules.md` §2.b)      |

## 7. Data model

```ts
// A named physical location within a meet.
export const meetRooms = sqliteTable('meet_rooms', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  meetId: integer('meet_id')
    .notNull()
    .references(() => quizMeets.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull(),
})

// A row in the left-hand time column. May hold quizzes or a non-quiz event.
export const meetSlots = sqliteTable('meet_slots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  meetId: integer('meet_id')
    .notNull()
    .references(() => quizMeets.id, { onDelete: 'cascade' }),
  startAt: integer('start_at', { mode: 'timestamp' }).notNull(),
  durationMinutes: integer('duration_minutes').notNull(),
  kind: text('kind', { enum: ['quiz', 'event'] }).notNull(),
  eventLabel: text('event_label'),
  sortOrder: integer('sort_order').notNull(),
})

// One 3-team quiz at (slot, room). Prelim or elim.
export const scheduledQuizzes = sqliteTable('scheduled_quizzes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  meetId: integer('meet_id')
    .notNull()
    .references(() => quizMeets.id, { onDelete: 'cascade' }),
  slotId: integer('slot_id')
    .notNull()
    .references(() => meetSlots.id, { onDelete: 'cascade' }),
  roomId: integer('room_id')
    .notNull()
    .references(() => meetRooms.id, { onDelete: 'cascade' }),
  division: text('division').notNull(),
  phase: text('phase', { enum: ['prelim', 'elim'] }).notNull(),
  lane: text('lane', { enum: ['main', 'consolation', 'intermediate'] }),
  label: text('label').notNull(),
  bracketLabel: text('bracket_label'),
  publishedAt: integer('published_at', { mode: 'timestamp' }),
})

// Three seats per quiz. Identifier shape depends on phase:
//   prelim — `letter` ('A'–'U') from the rules.md table; `teamId` filled at "Lock teams"
//   elim   — `seedRef` JSON; `teamId` filled as prior quizzes resolve
export const scheduledQuizSeats = sqliteTable('scheduled_quiz_seats', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  quizId: integer('quiz_id')
    .notNull()
    .references(() => scheduledQuizzes.id, { onDelete: 'cascade' }),
  seatNumber: integer('seat_number').notNull(),
  letter: text('letter'), // 'A'–'U' — set at composition time for prelim seats
  teamId: integer('team_id').references(() => teams.id, { onDelete: 'set null' }),
  seedRef: text('seed_ref'),
})

// Tracks the per-division team assignment lock (set by "Lock teams" at event start).
export const divisionAssignments = sqliteTable('division_assignments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  meetId: integer('meet_id')
    .notNull()
    .references(() => quizMeets.id, { onDelete: 'cascade' }),
  division: text('division').notNull(),
  lockedAt: integer('locked_at', { mode: 'timestamp' }),
})
```

**Notes**:

* `scheduled_quizzes` is a single table for both phases; `phase` discriminates. `lane` is only
  meaningful when `phase='elim'`.
* Prelim seats start with `letter` set and `teamId` null. "Lock teams" resolves all letters in a
  division to concrete `teamId` values in one transaction.
* Elim seats start with `seedRef` set; `teamId` fills in as prior quizzes resolve (issue `#16`).
* Events live on `meet_slots` with `kind='event'`, no child `scheduled_quizzes`.
* `teams.division` is immutable. `teams.consolation` starts false, set post-stats-break or post-XYZ.

**First-delivery scope cut**: the initial schema PR ships these tables, but only writes
`phase='prelim'` rows. The `lane`, `bracketLabel`, and `seedRef` columns exist from day one but stay
unused until the elim epic.

## 8. UX — the builder (primary experience)

The Schedule tab is a grid editor: y-axis = slots, x-axis = rooms, plus division filter. Each cell
is a quiz card with three seat chips. Pre-lock, the chips show letters (`A`, `B`, `C`); post-lock,
they show team names.

**Direct manipulation (any time)**:

* Drag a quiz card between `(round, room)` cells → move the whole quiz.
* Drag a row header to reorder rounds.
* Right-click / ellipsis on quiz card → delete, move to…, convert to event row.
* Click an empty cell → "Add quiz" popup.
* Click "+" between rows → "Add event" popup.

**Pre-lock interactions** (letter mode):

* The letter compositions are determined by the `rules.md` lookup; admin can't edit which letters
  are in which quiz.
* Admin focuses on slot placement: which rooms each division uses per round, where event rows go,
  custom slot times.

**Post-lock interactions** (team mode):

* Click a team chip → dropdown to pick a different team in the same division (rare; reserved for
  no-shows / late substitutions).
* Drag a team chip between quizzes → swap.

**Toolbar assists (not automation)**:

* Draw Prelims (division + count picker) — produces the letter-based composition for the chosen team
  count.
* Auto-slot — assigns `(round, room)` without changing compositions.
* Find Conflicts — jump to next hard-rule violation.
* Roll Teams (per division) — random A→Team mapping; re-rollable until "Lock".
* Lock Teams (per division) — finalises the assignment; chips switch from letter to team mode.
* Regenerate (destructive) — wipes prelim composition for a division and starts from scratch
  (forbidden after lock).

**Rule surfacing**:

* Hard violations: red border, blocks save/publish. Hover tooltip names the rule.
* Division status panel: per-division progress summary (e.g. "Div 2: 26 quizzes, all letter slots
  placed, awaiting team lock").

**Publish vs lock**:

* **Publish** — draft (admin-only) vs published (coaches/viewers see it). Coaches see the letter
  schedule pre-lock and the team schedule post-lock.
* **Lock teams** — separate per-division action. Independent of publish state.

## 9. UX flow (end-to-end)

```
Meet setup
  1. Admin creates meet, adds divisions, adds rooms.
  2. Coaches register churches / teams / quizzers.

Prelim build (letter mode)
  3. Admin opens Schedule tab (empty grid).
  4. Admin enters team count per division → "Draw Prelims" produces letter
     compositions from the rules.md table.
  5. Admin places quizzes into (round, room) cells, adds event rows, tweaks
     slot times. Chips show letters (A, B, C…).
  6. Publishes (coaches see letter schedule).

Event start (per division)
  7. Admin clicks "Roll Teams" → random A→Team permutation.
  8. Admin can re-roll or override individual letter→team assignments.
  9. Admin clicks "Lock Teams" → assignment is final; chips switch to team mode.

Prelim running
  10. Scoresheet auto-populates teams.
  11. Officials submit results.

Stats break (per division)
  12. Admin reviews Standings.
  13. Picks elim shape (looks up team count in §5 table).
  14. Flips `consolation=true` on bottom-M teams.

Elim build
  15. Admin opens Schedule tab, switches to Elim mode.
  16. (Optional) clicks "Draw Elims" per division → bracket draft.
  17. Admin edits seed refs, reorders rounds, adds events.
  18. Publishes.

Elim running
  19. XYZ/XXYYZZ resolve → `consolation=true` propagates to remaining teams.
  20. Results flow in; seed refs resolve to teams.
  21. Final placements displayed.
```

## 10. Open questions

1. Is `docs/rules.md` complete vs the official PDF? Flagged as uncertain.
2. Sample schedules show "Quiz X" and "Quiz Y" only (6 teams), but `rules.md` §2.a specifies XYZ (9
   teams). Is X+Y (no Z) a variant used for smaller fields?
3. `new 11` / `new 15` placeholders in sample schedules — confirm naming convention for
   XYZ-to-consolation transitions.
4. Championship-series termination: auto-generate Quiz H/I/etc. or admin-added on demand?
5. Tie-breaker quizzes for positions 6/15/24 (`rules.md` §2.b) — on-demand rows or pre-scheduled?
6. Late teams during elims — current assumption: prelims only. Confirm.
7. Bracket auto-advance vs manual confirm when Quiz A's result lands.
8. Keep both `teams.consolation` and `scheduled_quizzes.lane`, or collapse one into the other?
   Proposal keeps both.
