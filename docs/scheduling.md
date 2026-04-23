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
| **Phase**                      | Meet-wide lifecycle stage: `registration`, `build`, `live`, or `done`. Drives edit permissions and visibility. See §2.                                                                                                                      |
| **Division state**             | Per-division sub-state inside the `live` phase: `prelim_running`, `stats_break`, `elim_running`, `division_done`. See §2.                                                                                                                   |
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

## 2. Meet phases

A meet moves through four meet-wide phases. Each phase gates what coaches and admins can edit. The
phase model is the source of truth for "is registration still open?", "can the admin edit this
quiz?", "are coaches allowed to see the schedule yet?".

| Phase            | Trigger                                                                         | What's allowed                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **registration** | Default at meet creation.                                                       | Coaches edit their own rosters. Admin has all powers.                                                                  |
| **build**        | Auto at `quiz_meets.registrationClosesAt` (admin-set), or admin manual advance. | Rosters read-only for coaches (changes go through admin via email). Admin builds schedule, manages rooms, rolls teams. |
| **live**         | Auto at `quiz_meets.meetStartsAt` (admin-set), or admin manual advance.         | Coaches/viewers see the published schedule with team names. Admin can still edit, but completed quizzes are immutable. |
| **done**         | Admin manual.                                                                   | Everything read-only. Final stats locked.                                                                              |

Phase order is `registration → build → live → done`. Reverse transitions are admin-only and flagged
in the UI as unusual.

### Per-division state inside `live`

While the meet is `live`, each division has its own state machine that the admin advances
independently:

```
prelim_running → stats_break → elim_running → division_done
```

This lets Division 1 finish its prelims and start elims while Division 2 is still running prelims.
State transitions are admin-manual.

### Phases vs draft/publish

The schedule still has a draft / published toggle, independent of phase. The admin can stage edits
in any phase; they're not visible to coaches/viewers until published. In `registration` and `build`
even a published schedule is visible only to admin (no coach-facing schedule yet); in `live` a
published schedule is visible to everyone.

## 3. How a meet actually runs

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

## 4. Rules and invariants

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

**Overtime rule**:

* No overtime in prelims. Tied prelim quizzes are tied; tiebreaking happens at standings time per
  `rules.md` §2.b.
* Overtime allowed in elims. The scoresheet's existing OT support kicks in only for `phase='elim'`
  quizzes.

**Event rules**:

* Events occupy a slot but no rooms or quizzes.
* Events can be inserted between quiz rounds.
* Events don't enforce the default slot duration.

**Phase-aware rules** (see §2):

* Coach roster edits are blocked outside the `registration` phase. Admin can still edit on a coach's
  behalf at any phase.
* Schedule edits to a quiz are blocked once `scheduled_quizzes.completedAt` is set, regardless of
  phase. Completed quizzes are immutable so prior results stay coherent.
* Phase advances (`registration → build → live → done`) are one-way by default. Admin-manual reverse
  transitions are allowed but flagged in the UI.
* Per-division state advances (`prelim_running → stats_break → elim_running → division_done`) are
  admin-manual; reverses also allowed and flagged.

## 5. The prelim draw (utility, not the main UX)

**The draw is a lookup keyed on team count, not on team identity.** `rules.md` §"Preliminary Round
Brackets" spells out pairings for 4–21 teams as a fixed table. Example for 9 teams:

```
Quizzes: 1. ABC  2. DEF  3. GHI  4. ADG  5. BEH  6. CDH  7. AEI  8. BFG  9. CFI
```

The schedule is built around these letter slots, not around concrete teams. Team identity is bound
to letters only when the event is about to start (see §5.2). This decouples the schedule from the
roster: the admin can build and publish the schedule before all teams are registered.

Team counts > 21 are out of scope for the built-in helper; the admin builds those compositions
manually in the editor.

### 5.1 Composition utility

`drawPrelims(teamCount: number): Quiz[]` — looks up the team count in the `rules.md` table and
returns `teamCount` quizzes, each holding three letter slots (`A`–`U`). Pure function.

A second utility, `autoSlot(quizzes, rooms, rounds)`, fits the quizzes into a `(round, room)` grid
without hard-rule conflicts. Each utility is independently invocable from the editor toolbar.

### 5.2 Team assignment ("Roll Teams")

During the `build` phase, the admin clicks "Roll Teams" for a division. This generates a random
permutation of the registered teams and binds each team to one letter: `A` → Heritage 1, `B` → GRBC
2, etc. The mapping is written to `prelim_assignments` (one row per letter per division) in a single
transaction.

* Re-roll is allowed throughout `build` — it's a transactional UPDATE on the same rows. There's no
  separate "lock" step; the `build → live` phase transition is what makes the assignment
  coach-visible.
* Admin can override individual letter→team assignments before advancing to `live` (drag a team chip
  onto a letter slot — single-row UPDATE).
* In `live`, edits to letter→team assignments are still possible but constrained: completed quizzes
  (`scheduled_quizzes.completedAt` set) won't accept seat changes that would alter their results.

### 5.3 Late teams

If a team is added _before_ `build` (i.e. during `registration`), the schedule isn't built yet —
nothing to patch. If a team is added during `build` (admin approves a late roster change), the draw
is regenerated to the new team count's table — the admin re-places quizzes into rooms/slots. During
`live`, the admin patches manually in the editor, swapping teams between not-yet-completed quizzes;
if too many quizzes have already completed for the team to fit fairly, the team forfeits the missed
quizzes.

## 6. Stats break — the pivot

Stats break is admin-triggered per division. The admin clicks "Advance to Stats Break" on a division
once its prelims have completed; from then on, that division's elim slots are auto-filled as
standings finalize and intermediate (XY/XYZ/XXYYZZ) results land. Per `rules.md` §2.a, the
transition is deterministic once team count is known. Per division, the admin:

1. Reviews prelim standings (sum of 3 prelim quiz scores per team, per `rules.md` §1.a).
   Tiebreakers, per `rules.md` §2.b: head-to-head competition first, then total prelim points, then
   fewest errors. (Verify against current rulebook.)
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

After step 4, the elim quiz seats carry seedRefs (e.g., `prelimRank(4)`, `place(quizA, 2)`) and
those seedRefs auto-resolve to teamIds in the `seed_resolutions` table (see §8) as prior quizzes
complete. The admin doesn't manually fill in elim seats — the system propagates results.

`teams.consolation` is the authoritative lane marker, written at stats break and updated by the elim
result pipeline. A team's `division` is never rewritten.

## 7. Elims (elimination round)

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

| Format                                     | Meaning                                                                                 |
| ------------------------------------------ | --------------------------------------------------------------------------------------- |
| `prelimSeed(n)`                            | Team ranked `n` from prelim standings                                                   |
| `xyRank(n)`                                | Team at "new `n`" position after XY/XYZ rerank (e.g., `xyRank(11)` = sample's `new 11`) |
| `place(quizId, p)`                         | Team that placed `p` in a given bracket quiz                                            |
| `xyzTop3(rank)` / `xyzBottom6(rank)`       | XYZ advancers / fall-throughs                                                           |
| `xxyyzzTop3(rank)` / `xxyyzzBottom6(rank)` | XXYYZZ equivalents                                                                      |
| `winner(quizId)` / `loser(quizId)`         | Convenience for championship series                                                     |
| `tiebreaker(candidates)`                   | Unresolved tied teams (`rules.md` §2.b)                                                 |

The "`new N`" labels seen on sample schedules (`new 11`, `new 15`, etc.) refer to placement after
the XY/XYZ intermediate quizzes finish: a team that started at prelim rank 12 may end up at `new 11`
once intermediate results are factored in. Encoded as `xyRank(N)` in the data model.

### Def vs resolution layering

Elim quiz seats carry only the **def** — the seedRef. The **resolution** (which concrete team a
given seedRef currently points to) lives in a separate table (`seed_resolutions`, see §8). This
matters because the same seedRef appears in multiple seats (e.g. `place(quizB, 2)` could feed two
downstream bracket quizzes), and a single resolution row keeps them consistent. The same pattern
applies to prelim seats with their `letter` def → `prelim_assignments` resolution.

## 8. Data model

New tables and columns. Existing `quiz_meets` gains phase fields.

```ts
// Existing quiz_meets table gains:
//   phase: text enum ['registration', 'build', 'live', 'done'] (default 'registration')
//   registrationClosesAt: integer timestamp (nullable; auto-advance to 'build')
//   meetStartsAt: integer timestamp (nullable; auto-advance to 'live')

// Per-division state inside the 'live' meet phase.
export const divisionStates = sqliteTable('division_states', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  meetId: integer('meet_id')
    .notNull()
    .references(() => quizMeets.id, { onDelete: 'cascade' }),
  division: text('division').notNull(),
  state: text('state', {
    enum: ['prelim_running', 'stats_break', 'elim_running', 'division_done'],
  }).notNull(),
  transitionedAt: integer('transitioned_at', { mode: 'timestamp' }).notNull(),
})

// A named physical location within a meet.
// This is the existing official_codes table renamed: it already exists per-meet,
// already has a label conventionally meaning "Room A"/etc., and already carries
// the codeHash that gates official-role access for that room. We rename label →
// name, add sortOrder for grid display, and make codeHash nullable so admins can
// create rooms in the build phase without immediately issuing an official code.
export const meetRooms = sqliteTable('meet_rooms', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  meetId: integer('meet_id')
    .notNull()
    .references(() => quizMeets.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull(),
  codeHash: text('code_hash'), // nullable; null = no official code issued yet
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
  completedAt: integer('completed_at', { mode: 'timestamp' }), // set when results land — gates immutability
})

// Three seats per quiz. Holds only the def — letter (prelim) or seedRef (elim).
// The team binding lives in a separate resolution table (see below).
export const scheduledQuizSeats = sqliteTable('scheduled_quiz_seats', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  quizId: integer('quiz_id')
    .notNull()
    .references(() => scheduledQuizzes.id, { onDelete: 'cascade' }),
  seatNumber: integer('seat_number').notNull(),
  letter: text('letter'), // 'A'–'U' — set at composition time for prelim seats
  seedRef: text('seed_ref'), // JSON — set at composition time for elim seats
})

// Resolution layer — prelim. (meetId, division, letter) → teamId.
// One row per letter per division. "Roll Teams" writes here; re-roll = transactional UPDATE.
export const prelimAssignments = sqliteTable(
  'prelim_assignments',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    meetId: integer('meet_id')
      .notNull()
      .references(() => quizMeets.id, { onDelete: 'cascade' }),
    division: text('division').notNull(),
    letter: text('letter').notNull(), // 'A'–'U'
    teamId: integer('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    assignedAt: integer('assigned_at', { mode: 'timestamp' }).notNull(),
  },
  (t) => [unique().on(t.meetId, t.division, t.letter)],
)

// Resolution layer — elim. (meetId, seedRef) → teamId.
// Filled by the result-linkage pipeline as prior quizzes complete.
export const seedResolutions = sqliteTable(
  'seed_resolutions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    meetId: integer('meet_id')
      .notNull()
      .references(() => quizMeets.id, { onDelete: 'cascade' }),
    seedRef: text('seed_ref').notNull(), // canonical JSON form, e.g. '{"k":"place","quiz":42,"p":2}'
    teamId: integer('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    resolvedAt: integer('resolved_at', { mode: 'timestamp' }).notNull(),
  },
  (t) => [unique().on(t.meetId, t.seedRef)],
)
```

**Notes**:

* `scheduled_quizzes` is a single table for both phases; `phase` discriminates. `lane` is only
  meaningful when `phase='elim'`.
* `scheduled_quizzes.completedAt` is set by the result-linkage path (#16) when results land for a
  quiz. Editor blocks edits to any seat on a completed quiz.
* `scheduled_quiz_seats` carry only the def (letter or seedRef). To render "what team is in seat X",
  JOIN through `prelim_assignments` (for letters) or `seed_resolutions` (for seedRefs).
* "Roll Teams" (during `build` phase) writes one `prelim_assignments` row per letter per division in
  a single transaction. Re-roll is just an UPDATE of the same rows.
* Elim seedRefs auto-resolve into `seed_resolutions` as XY/XYZ/bracket quizzes complete (#16).
* "Un-resolve" (admin marks a quiz incomplete to redo it) is a clean delete from `seed_resolutions`
  for the affected refs; downstream seat reads naturally show null again.
* Events live on `meet_slots` with `kind='event'`, no child `scheduled_quizzes`.
* `teams.division` is immutable. `teams.consolation` starts false, set post-stats-break or post-XYZ.

**First-delivery scope cut**: the initial schema PR ships all of the above tables, but only the
prelim path writes rows. Elim columns (`scheduled_quizzes.lane`, `bracketLabel`,
`scheduled_quiz_seats.seedRef`, `seed_resolutions`) exist from day one but stay unused until the
elim epic.

## 9. UX — the builder (primary experience)

The Schedule tab is a grid editor: y-axis = slots, x-axis = rooms, plus division filter. Each cell
is a quiz card with three seat chips. Before "Roll Teams" runs the chips show letters (`A`, `B`,
`C`); after, they show team names.

A **phase header bar** sits above the grid showing the current meet phase (`registration` / `build`
/ `live` / `done`) with admin-only "Advance" and "Revert" controls. Inside the schedule, each
division's row carries a state badge (e.g. "Div 2: prelim running") when the meet is `live`.

**Direct manipulation (any time)**:

* Drag a quiz card between `(round, room)` cells → move the whole quiz.
* Drag a row header to reorder rounds.
* Right-click / ellipsis on quiz card → delete, move to…, convert to event row.
* Click an empty cell → "Add quiz" popup.
* Click "+" between rows → "Add event" popup.

**Letter mode** (before Roll Teams runs):

* The letter compositions are determined by the `rules.md` lookup; admin can't edit which letters
  are in which quiz.
* Admin focuses on slot placement: which rooms each division uses per round, where event rows go,
  custom slot times.

**Team mode** (after Roll Teams runs):

* Click a team chip → dropdown to pick a different team in the same division (rare; reserved for
  no-shows / late substitutions).
* Drag a team chip between quizzes → swap.

**Toolbar assists (not automation)**:

* Draw Prelims (division + count picker) — produces the letter-based composition for the chosen team
  count. Available in `build` phase.
* Auto-slot — assigns `(round, room)` without changing compositions.
* Find Conflicts — jump to next hard-rule violation.
* Roll Teams (per division) — random A→Team mapping. Available in `build` and on the boundary into
  `live`. Re-rollable until the meet enters `live`; in `live`, individual swaps only.
* Regenerate (destructive) — wipes prelim composition for a division and starts from scratch.
  Forbidden once the meet is `live`.

**Rule surfacing**:

* Hard violations: red border, blocks save/publish. Hover tooltip names the rule.
* Completed quizzes (`completedAt` set): rendered with a lock icon; all edits rejected with an
  inline explanation.
* Division status panel: per-division progress summary (e.g. "Div 2: 26 quizzes, prelim running, 18
  of 26 complete").

**Draft vs published**:

* Draft edits are admin-only until "Publish" is clicked.
* In `registration` and `build`, even published schedules stay admin-only — no coach-facing schedule
  before the meet starts.
* In `live`, published schedules are visible to everyone.

## 10. UX flow (end-to-end)

```
Meet setup [phase: registration]
  1. Admin creates meet, adds divisions, adds rooms, sets
     registrationClosesAt and meetStartsAt timestamps.
  2. Coaches register churches / teams / quizzers.

Prelim build [phase: build — auto-advanced at registrationClosesAt]
  3. Admin opens Schedule tab (empty grid).
  4. Admin enters team count per division → "Draw Prelims" produces letter
     compositions from the rules.md table.
  5. Admin places quizzes into (round, room) cells, adds event rows, tweaks
     slot times. Chips show letters (A, B, C…).
  6. Admin clicks "Roll Teams" per division → random A→Team mapping.
     Re-roll or hand-edit as needed.
  7. Publishes (admin-only visibility — phase still 'build').

Live transition [phase: live — auto-advanced at meetStartsAt]
  8. Coaches/viewers now see the published team-mode schedule.
  9. Per-division state initialised to 'prelim_running'.

Prelim running [div state: prelim_running]
  10. Scoresheet auto-populates teams.
  11. Officials submit results; scheduled_quizzes.completedAt fills in.

Stats break [div state: stats_break — admin manual]
  12. Admin reviews Standings.
  13. Picks elim shape (looks up team count in §6 table).
  14. Flips `consolation=true` on bottom-M teams.

Elim build [div state: stats_break]
  15. Admin opens Schedule tab, switches to Elim mode.
  16. (Optional) clicks "Draw Elims" per division → bracket draft.
  17. Admin edits seed refs, reorders rounds, adds events.
  18. Publishes; advances division to 'elim_running'.

Elim running [div state: elim_running]
  19. XYZ/XXYYZZ resolve → `consolation=true` propagates to remaining teams.
  20. Results flow in; seed refs resolve to teams.
  21. Final placements displayed → admin advances division to 'division_done'.

Wrap-up [phase: done — admin manual]
  22. When all divisions are 'division_done', admin advances meet to 'done'.
      Schedule and stats become globally read-only.
```

## 11. Open questions

All remaining questions concern the elim phase; none block prelim implementation.

1. Is `docs/rules.md` complete vs the official PDF? Flagged as uncertain.
2. Sample schedules show "Quiz X" and "Quiz Y" only (6 teams), but `rules.md` §2.a specifies XYZ (9
   teams). Is X+Y (no Z) a variant used for smaller fields, or does the sample reflect a different
   meet's house rules?
3. Which of Bracket A / B / C did the Finals 2023 sample use? Visual inspection of the sample should
   pin this down.
4. Tiebreaker rule confirmation — `rules.md` §2.b says head-to-head, then total prelim points, then
   fewest errors. Verify this matches current rulebook practice.
5. Championship-series termination (`rules.md` §3 "win twice"): auto-generate Quiz H/I/etc.
   on-demand as results land, or admin-added manually?
6. Tie-breaker quizzes for positions 6/15/24 (`rules.md` §2.b): pre-scheduled in the elim grid, or
   on-demand only when a tie actually occurs?
7. Late teams during elims — current assumption: prelims only, late elim entries handled with manual
   editor swaps and no automated rebalancing. Confirm.
8. Bracket auto-advance vs manual confirm: when a bracket quiz's result is submitted, should the
   `seed_resolutions` write happen automatically, or wait for admin confirmation?
9. Keep both `teams.consolation` and `scheduled_quizzes.lane`, or collapse one into the other?
   Current proposal keeps both since they have different lifecycles.
