# Schedule design

This document defines the domain model for meet scheduling. A qzr meet has two materially different
scheduling phases (prelims and elims) with a pivot step in between. The official rules
(`docs/rules.md` §"Rules for Tournament" and §"Tournament Brackets") already specify the preliminary
pairings, elimination brackets, and intermediate quiz structures, and this doc is the design layer
that sits above those rules.

**Source of truth for rules**: `docs/rules.md`. If `rules.md` is missing something from the official
PDF, `rules.md` gets corrected first and this doc may need re-alignment.

**Source of inspiration — a sister-org meet**: `docs/example-winkler-2026.md` is a worked example
from a sister organisation that runs nearly the same rule book with more mature tooling and process.
When the rule book underspecifies how a meet actually runs (multi-bracket elim composition for 12+
team fields, late-team draw handling, realistic slot pitches), look there for one tested answer. The
rule book always wins on rule conflicts; this example shows one working approach to the gaps the
rule book leaves open. We're free to adapt or diverge wherever it makes sense for QuizMeet.

**Philosophy**: the schedule feature is an **admin-driven builder**. The admin enters team counts
and settings, the builder generates a whole weekend from them, and from then on every quiz, row and
seat can be changed by hand. A hand edit pins what it touched, and later settings changes re-flow
the rest of the grid around the pins, so generating never throws away the admin's work. The admin
should feel like they built the schedule with help, not like they approved a computed result.

**Current design**: the schedule redesign in `specs/005-schedule-redesign/` (spec, plan, data model
and contracts) is the detailed reference for the builder as it ships. This page keeps the domain
background; where the two differ, the spec and the code win.

Planning and work tracking live in GitHub issues (see `#9` Schedule epic and its sub-issues). This
doc is the stable design reference those issues link back to.

## 1. Vocabulary

| Term                           | Meaning                                                                                                                                                                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Meet**                       | A named multi-day event. One `quiz_meets` row.                                                                                                                                                                                              |
| **Phase**                      | Meet-wide lifecycle stage: `registration`, `build`, `live`, `review`, or `done`. Drives edit permissions and visibility. See §2.                                                                                                            |
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
| **Lane**                       | A division's elim path. Real meets often run more than two — Winkler runs A (championship), K (next 12), B (consolation), and M (extras). See `docs/example-winkler-2026.md` §6.                                                            |
| **Custom bracket template**    | Hand-composed elim template for fields larger than the rule book's 9-team A/B/C. Stored as data in `packages/shared/scheduling/templates/`. See `docs/example-winkler-2026.md` §6.1.                                                        |
| **Event**                      | Non-quiz item on the schedule — Breakfast, Stats Break, Worship, etc. Occupies a slot, no room/teams.                                                                                                                                       |

## 2. Meet phases

A meet moves through five meet-wide phases. Each phase gates what coaches, officials, and admins can
do. The phase model is the source of truth for "is registration still open?", "can the admin edit
this quiz?", "are coaches allowed to see the schedule yet?".

| Phase            | Trigger                                                                         | What's allowed                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **registration** | Default at meet creation.                                                       | Coaches edit their own rosters. Admin has all powers.                                                                  |
| **build**        | Auto at `quiz_meets.registrationClosesAt` (admin-set), or admin manual advance. | Rosters read-only for coaches (changes go through admin via email). Admin builds schedule, manages rooms, rolls teams. |
| **live**         | Auto at `quiz_meets.meetStartsAt` (admin-set), or admin manual advance.         | Coaches/viewers see the published schedule with team names. Admin can still edit, but completed quizzes are immutable. |
| **review**       | Admin manual, suggested once every division is `division_done`.                 | Quizzing is over. Officials no longer submit. Admin keeps every power to correct results and settle disputes.          |
| **done**         | Admin manual.                                                                   | Everything read-only, admins included. Final stats locked. A late correction moves the meet back to `review`.          |

Phase order is `registration → build → live → review → done`. Reverse transitions are admin-only and
flagged in the UI as unusual. Who can see and do what in each phase is defined in
[roles-and-access.md § Access by phase](./roles-and-access.md#access-by-phase).

### Per-division state inside `live`

While the meet is `live`, each division has its own state machine that the admin advances
independently:

```
prelim_running → stats_break → elim_running → division_done
```

This lets Division 1 finish its prelims and start elims while Division 2 is still running prelims.
State transitions are admin-manual.

### Phases vs draft/publish

A linked schedule has a draft and published versions, independent of phase. The admin edits the
draft in any phase; nobody else sees it. Publishing adds the draft as the meet's next version, and
every version is kept. Anyone with access to the meet sees the newest version: in letters while the
meet is in `registration` or `build`, with team names from `live` on.

## 3. How a meet actually runs

For a fully worked example with team counts, time slots, room counts, and the exact post-stats-break
multi-bracket layout, see `docs/example-winkler-2026.md`. The summary below is a generalised version
of the pattern that example documents.

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
10. **Real meets run more than two elim lanes.** The rule book describes a championship + optional
    consolation. Winkler 2026 runs four lanes off A division alone — A (championship, top 12), K
    (next 12), B (consolation 25–36), and M (extras round-robin overlapping K and B) — plus a
    separate C-division bracket. Lane structure beyond championship/consolation is
    meet-director-authored using custom templates. See `docs/example-winkler-2026.md` §6.
11. **Intermediate quizzes generalise beyond XYZ/XXYYZZ.** Winkler runs W/X/Y/Z (4 quizzes, 12
    teams, ranks 9–20) where the rule book only specifies XYZ (3 quizzes, 9 teams). Rank-range
    intermediates (`drawIntermediate(from, to)`) are a real requirement.
12. **Lateness biases the draw.** Spreadsheets carry an "expected late?" flag per team that pushes
    the team to higher-numbered letter slots, minimising the disruption of a delayed bus. See
    `docs/example-winkler-2026.md` §3.2.

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
* Phase advances (`registration → build → live → review → done`) are one-way by default.
  Admin-manual reverse transitions are allowed but flagged in the UI.
* Per-division state advances (`prelim_running → stats_break → elim_running → division_done`) are
  admin-manual; reverses also allowed and flagged.

## 5. The prelim draw

**The prelims are letters; the draw decides which team is which letter.** `rules.md` §"Preliminary
Round Brackets" spells out pairings for 4 to 21 teams as fixed tables. Example for 9 teams:

```
Quizzes: 1. ABC  2. DEF  3. GHI  4. ADG  5. BEH  6. CDH  7. AEI  8. BFG  9. CFI
```

The schedule is built around these letters, not around concrete teams, so it can be built and
published before every team is registered. Each division has a prelim draw source: the rule book's
tables, or a rotating draw with no rematches from 7 teams up, for any size to 90 teams. Where the
rotating draw would rematch (8 and 13 teams), a cyclic pattern takes over.

### 5.1 The draw

The draw, per division, gives each team a letter. It never moves a quiz. Draw, Redraw and Clear work
per division or for all, and a cleared division shows letters again. When linked to a meet, the
teams are the meet's; the draw lives in the schedule document, not in `prelim_assignments`.

### 5.2 Late and absent teams

A team can be marked late before the draw. The draw then gives late teams the letters that put them
in as few quizzes as possible, starting as late as possible, so nothing has to move. If lateness is
learned after the draw, Sort moves the prelims so late teams play late, within each division's rooms
or across rooms, saying first how many quizzes will move.

A team that drops out is the admin's choice: lower the division's team count (the prelims are
rebuilt and the draw needs redoing) or mark the team absent (nothing moves; its quizzes run with two
teams).

## 6. Stats break — the pivot

Stats break is admin-triggered per division. The admin clicks "Advance to Stats Break" on a division
once its prelims have completed; from then on, that division's elim slots are auto-filled as
standings finalize and intermediate (XY/XYZ/XXYYZZ) results land. Per `rules.md` §2.a, the
transition is deterministic once team count is known. Per division, the admin:

1. Reviews prelim standings (sum of 3 prelim quiz scores per team, per `rules.md` §1.a).
   Tiebreakers, per `rules.md` §2.b: head-to-head competition first, then total prelim points, then
   fewest errors. (Verify against current rulebook.)
2. Follows the division's elim shape, set in the builder's Elim settings: one or more lanes, each
   taking a number of prelim ranks and playing a bracket or a round robin, with an intermediate on
   the line between two lanes where one is wanted. The defaults per team count, and every reference
   meet's shape, are in `specs/005-schedule-redesign/spec.md` (FR-030) and `bracket-library.md`.

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

**Lanes and intermediates**: a division's elims are lanes, top first: the championship, then any
consolation lanes, each a bracket from the bracket library or a round robin of 1 to 3 quizzes per
team with an optional Finals on points. Between two lanes sits an optional intermediate of 1 to 4
quizzes (X, XY, XYZ, WXYZ), either reranking the teams around the line or playing in to the lane
above.

**Seats**: an elim seat names where its team comes from, as one of:

| Seat         | Meaning                                                                           |
| ------------ | --------------------------------------------------------------------------------- |
| rank `n`     | The team ranked `n` after the prelims                                             |
| new `n`      | The team at rank `n` after an intermediate's rerank                               |
| place in `q` | The team that placed `p` in quiz `q`, named by the quiz's id, so a rename follows |
| points `p`   | The team placed `p` in points across a lane's round robin                         |
| empty        | Not chosen yet                                                                    |

### Def vs resolution layering

Elim quiz seats carry only the **def** — the seedRef. The **resolution** (which concrete team a
given seedRef currently points to) lives in a separate table (`seed_resolutions`, see §8). This
matters because the same seedRef appears in multiple seats (e.g. `place(quizB, 2)` could feed two
downstream bracket quizzes), and a single resolution row keeps them consistent. The same pattern
applies to prelim seats with their `letter` def → `prelim_assignments` resolution.

## 8. Data model

**Storage since the redesign**: a schedule is one schedule document (settings, frame rows, rooms,
quizzes with their seats and pins, and the draw), the same in the browser, in a file and on the
server. A linked meet keeps its draft in `meet_schedules` and every published version in the
append-only `meet_schedule_versions` (see `docs/data-model.md`). The `meet_slots`,
`scheduled_quizzes`, `scheduled_quiz_seats` and `prelim_assignments` tables below are no longer
written: a meet built with them is converted to a document when an admin first opens its schedule,
and the old read routes answer from the newest published version for installed scoresheets. They go
once every meet is converted and no supported scoresheet calls them.

The original design follows. Existing `quiz_meets` gains phase fields.

```ts
// Existing quiz_meets table gains:
//   phase: text enum ['registration', 'build', 'live', 'review', 'done'] (default 'registration')
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

## 9. UX: the builder

The builder lives in the portal: `/builder` for schedules kept in the browser with no account, and a
meet's Schedule edit page for its linked schedule. A settings panel (Teams, Time slots and rooms,
Prelims, Elims) sits beside the grid; time runs down, rooms across, with day headings, events across
all rooms or one, and note rows. Each quiz card shows its seats in letters, or team names once a
division is drawn.

* **Generate and re-flow**: settings changes re-flow the grid around pinned quizzes and rows. With
  Auto-apply off, changes wait, each marked, until Apply, which first says how many quizzes move.
* **Edit by hand**: a quiz's menu renames it, sets any seat, moves it (drag, or pick then choose the
  target, by pointer or keyboard), sends it to the unplaced tray, pins or unpins it, and deletes it.
  Rows and rooms have menus of their own. Every change can be undone.
* **Conflicts**: every hard rule and warning of `docs/schedule-invariants.md` is checked after each
  change, marked on its cells and counted, with a way to step through them. Nothing is refused.
* **Linked schedules**: the draft is kept in the browser and sent shortly after each change, offline
  edits included. Publish asks before going past hard conflicts and turns Auto-apply off; the
  history shows every version, to view or restore. A quiz with results changes only after a
  confirmation, and is then marked as changed after results.
* **Printing**: the room grid, a one-room list, or the basic schedule.

## 10. UX flow (end-to-end)

```
Meet setup [phase: registration]
  1. Admin creates meet, adds divisions, adds rooms, sets
     registrationClosesAt and meetStartsAt timestamps.
  2. Coaches register churches / teams / quizzers.

Prelim build [phase: build — auto-advanced at registrationClosesAt]
  3. Admin opens the meet's schedule in the builder, which starts from the
     meet's divisions, teams and rooms and generates the weekend.
  4. Admin adjusts settings and edits by hand; seats show letters.
  5. Admin marks late teams and draws each division.
  6. Publishes; readers see letters until the meet goes live.

Live transition [phase: live — auto-advanced at meetStartsAt]
  8. Coaches/viewers now see the published schedule with team names.
  9. Per-division state initialised to 'prelim_running'.

Prelim running [div state: prelim_running]
  10. Officials load each quiz from the published schedule; the scoresheet
      fills its teams.
  11. Officials submit results, saved under the quiz's result name.

Stats break [div state: stats_break — admin manual]
  12. Admin reviews Standings.
  13. Confirms the division's elim shape (§6).
  14. Flips `consolation=true` on bottom-M teams.

Elim build [div state: stats_break]
  15. The elims are already in the schedule from the division's elim shape;
      the admin adjusts lanes, seats or rows if needed.
  16. Publishes; advances division to 'elim_running'.

Elim running [div state: elim_running]
  17. XYZ/XXYYZZ resolve → `consolation=true` propagates to remaining teams.
  18. Results flow in; elim seats resolve to teams.
  19. Final placements displayed → admin advances division to 'division_done'.

Review [phase: review, admin manual]
  20. When all divisions are 'division_done', the UI suggests advancing to 'review'.
      Officials stop submitting; admin corrects results and settles disputes.

Wrap-up [phase: done, admin manual]
  21. Admin advances meet to 'done'. Schedule and stats become read-only for everyone.
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
