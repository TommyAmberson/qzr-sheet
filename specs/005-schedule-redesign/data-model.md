# Data model: Schedule builder redesign

A schedule is one **schedule document**: everything the builder needs, in one JSON value, the same
whether it sits in the browser, in a file, or in a meet's draft or published slot (research R4, R5).
Field names here are the document's; their spelling in code follows them.

## Schedule document

| Field      | Meaning                                                                                      |
| ---------- | -------------------------------------------------------------------------------------------- |
| `version`  | `SCHEDULE_FILE_VERSION`, starting at 1 (FR-003)                                              |
| `id`       | Stable id, so a schedule kept in the browser and the same one opened from a file are matched |
| `name`     | Shown in the schedule list (FR-002)                                                          |
| `settings` | What the grid is built from (below)                                                          |
| `applied`  | The settings the grid was last built with; differs from `settings` while Auto-apply is off   |
| `frame`    | Ordered rows of the grid (below)                                                             |
| `rooms`    | Ordered rooms: id, name, and when linked the meet's room id                                  |
| `quizzes`  | Every quiz, placed or in the unplaced tray (below)                                           |
| `draw`     | Per division: team names, late and absent marks, letter per team (below)                     |
| `link`     | Absent when standalone; the meet id and its time zone when linked                            |

Validation: a document that fails validation doesn't load (FR-003); one that loads may still break
hard rules, which the conflict check reports and never repairs on its own (FR-037).

## Settings

| Field              | Meaning                                                                 |
| ------------------ | ----------------------------------------------------------------------- |
| `framePreset`      | Weekend, One day or One room; the builder starts on Weekend (FR-015)    |
| `slotMinutes`      | Default slot length, 25 (FR-016); each slot can differ                  |
| `rooms`            | A fixed count, or "as many as needed" (FR-018)                          |
| `quizzesPerTeam`   | 3 or 6 (FR-022, H-9)                                                    |
| `prelimDraw`       | Rule book or No rematches (FR-023)                                      |
| `totallingMinutes` | Gap after an intermediate before a `New n` quiz (FR-028a, W-3)          |
| `finals`           | Finals order, spacing, rooms; defaults, not edited in builder (FR-019a) |
| `autoApply`        | On or off (FR-012a); publishing turns it off                            |
| `divisions`        | Ordered: id, name, team count, elims (below) (FR-021)                   |

### A division's elims

Lanes stacked down the ranks (FR-027), with a line between each pair:

* **Lane**: rank count; format `bracket` (with the library entry for its size, FR-029) or
  `roundRobin` (with quizzes per team, 1 to 3); whether its deciding quiz is called a Finals
  (FR-034); label (suffix, division name, or its own name) and lettering (continue or restart)
  (FR-033).
* **Line**: optionally an intermediate: one to four quizzes; rerank or play-in; how many of its
  ranks sit above the line; seating order (FR-028).

The defaults by division size are FR-030's table. Every setting has a production reader: the
generator.

## Frame rows

Ordered, across one or more days. Each row is one of:

* **Day**: a heading (`Saturday`).
* **Slot**: start time and length; holds at most one quiz per room (H-2). Its use (prelim, elim or
  finals) says which quizzes the generator puts there; a slot made for events (Breakfast, Lunch) has
  the use `event` and takes no generated quizzes.
* **Note**: a line of text with no time and no effect on placement (FR-017).

## Event

Sits in a slot's rooms like a quiz (FR-017):

| Field    | Meaning                                                                |
| -------- | ---------------------------------------------------------------------- |
| `id`     | Stable                                                                 |
| `label`  | `Lunch`, `Coaches meeting`                                             |
| `slot`   | The row it's in, or none (the unplaced tray)                           |
| `rooms`  | The rooms it takes, or `all`, which follows the room count             |
| `pinned` | Set by any hand edit; a frame with a pinned event is kept, not rebuilt |

Events of the same name in one slot are one event: placing one beside another joins them. A quiz in
a room an event takes, at a time the event's row overlaps, breaks H-3.

Each division's stats break isn't a row: it's derived from its quizzes (FR-020, H-11).

## Quiz

| Field                 | Meaning                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------- |
| `id`                  | Stable; seats refer to quizzes by id, so renames follow (FR-035c)                        |
| `label`               | `Div 2 Quiz 5`, `Div 2C Quiz I`, `Div 3 Finals`; unique (H-7)                            |
| `division`            | One division (H-6)                                                                       |
| `phase`               | Prelim or elim                                                                           |
| `lane`                | Elims: which lane, or the intermediate on which line                                     |
| `cell`                | A slot and a room, or none (the unplaced tray, H-8)                                      |
| `seats`               | Three seats, in order (H-5); a rule-book championship quiz may have two                  |
| `pinned`              | Set by any hand edit, cleared by unpin; the generator never touches a pinned quiz (H-19) |
| `deciding`            | Marks a lane's deciding quiz, whether or not it's called a Finals (FR-034)               |
| `changedAfterResults` | Set when a quiz with submitted results is edited after confirmation (H-20, FR-035b)      |

Whether a quiz has results isn't stored in the document: when linked, the API marks it by matching
the quiz's result name (`quizName`: division, whether it's in a consolation lane, number or letter,
folded) to `quiz_results.quizKey` (W-5).

## Seat

A seat holds one source (FR-035, FR-035a):

| Kind   | Example      | Meaning                                                    |
| ------ | ------------ | ---------------------------------------------------------- |
| letter | `C`          | A prelim letter; letters run `A` to `Z`, then `AA`… (H-10) |
| rank   | `4`          | A prelim rank                                              |
| new    | `New 10`     | A reranking intermediate's result (H-16)                   |
| place  | `2 of A`     | A place in another quiz, by that quiz's id                 |
| points | `1st in pts` | A place in points across a lane's round robin              |
| empty  | `Choose…`    | Not set yet (placeholders, FR-036)                         |

## Draw

Per division (FR-039 to FR-042b):

* teams, in order: a name typed when standalone; when linked, the meet's team id, with its name read
  from the meet (FR-047);
* late marks and absent marks, by team;
* the letter each team holds, or none before the draw;
* whether the draw needs redoing (team count changed, FR-042).

## Meet schedule (server, linked only)

One row per meet in a new `meet_schedules` table (research R5):

| Column          | Meaning                                                 |
| --------------- | ------------------------------------------------------- |
| `meetId`        | Unique; a meet has at most one linked schedule (FR-045) |
| `draft`         | The draft document                                      |
| `draftRevision` | Increments on every save; a save names the one it read  |
| `draftSavedAt`  | When the draft was last written                         |

Every publish adds a row to a new, append-only `meet_schedule_versions` table (FR-049a):

| Column        | Meaning                                            |
| ------------- | -------------------------------------------------- |
| `meetId`      | The meet                                           |
| `version`     | 1, 2, 3, … per meet; unique with `meetId`          |
| `document`    | The document as published                          |
| `publishedAt` | When                                               |
| `publishedBy` | The admin's account, and their name as it was then |

The newest version is the published schedule; there's no separate published column. Rows are never
updated or deleted while the meet exists, unlinking included, so relinking continues the numbering.
A meet converted from the old tables gets its conversion as version 1.

Both tables are generated with `db:generate` from the Drizzle schema (Principle VI).

## State transitions

* **Quiz**: unpinned ⇄ pinned (hand edit pins; unpin, or resetting a section or division, unpins).
  With results: protected; a confirmed edit marks it changed after results.
* **Division draw**: not drawn → drawn → needs redoing (team count changed) → drawn; cleared returns
  to not drawn (FR-040).
* **Settings**: applied, or unapplied while Auto-apply is off; Apply makes them applied (FR-012a).
* **Linked schedule**: draft only → published; a further save makes the draft differ from the newest
  version ("unpublished changes"); publishing adds the draft as the next version (FR-049, FR-049a);
  restoring a version copies it into the draft. Readers see the published version by the meet's
  phase (FR-052).
