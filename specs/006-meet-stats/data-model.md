# Data model: Meet stats

Changes to the D1 schema and to the shared contract for [spec.md](./spec.md), following the schema's
conventions (snake_case plural tables, integer autoincrement ids, `*_at` timestamps, meet-scoped
rows cascading on meet delete). `docs/data-model.md` is amended to match (principle II). Decisions
are in [research.md](./research.md).

Five tables are added. Nothing existing is altered or dropped. `quiz_results`,
`quiz_result_revisions`, `quiz_result_count_changes`, `division_states` and `meet_team_names` keep
their columns.

## decision about a stored quiz (`quiz_result_changes`, new)

Append-only: one row per decision; rows are never updated or deleted while the meet exists. A quiz's
current value of each kind is its newest row of that kind (R5).

| Field          | Meaning                                                                              |
| -------------- | ------------------------------------------------------------------------------------ |
| stored quiz    | the stored quiz; deleted with it                                                     |
| kind           | `stage`, `link`, `acceptance` or `kept`                                              |
| stage          | for `stage`: prelim, intermediate, elimination, finals, or not counted; else empty   |
| scheduled quiz | for `link`: the schedule document's quiz id, or empty when the link is removed       |
| how            | for `link`: sent by the scoresheet, matched on arrival, or by hand                   |
| revision       | for `acceptance`: the revision accepted or no longer accepted                        |
| accepted       | for `acceptance`: accepted, or withdrawn                                             |
| changed by     | the account, and for an official's link the room; and the name as it was at the time |
| changed at     | when                                                                                 |

Rules:

* **Stage** (R3, FR-008 to FR-010): the newest `stage` row; else the stage of the linked scheduled
  quiz; else, with no link, prelim when the newest counting record says counted; else not counted.
  Only admins write `stage` rows.
* **Link** (R4, FR-009): the newest `link` row. Written when a submission carries `scheduleQuizId`,
  when an unlinked quiz matches a scheduled quiz on arrival or after a rename, and when an admin or
  one of the quiz's room officials links, relinks or unlinks it by hand. At most one stored quiz of
  a meet should be linked to a scheduled quiz; a second is refused, naming the first. The automatic
  match runs only while a quiz has no `link` row, so an admin's unlink stays; a submission naming a
  scheduled quiz does not replace a link made or removed by hand.
* **Acceptance** (R6, FR-014 to FR-016): a quiz in error counts only while its current content is
  the content of an accepted revision. Only admins write `acceptance` rows.
* **Kept** (R9, FR-019b): clears the "played under a withdrawn order" flag raised by a withdrawal
  older than this row.
* A quiz is **in error** when its current content has validation errors or unanswered questions, or
  it is linked and its name or teams differ from the scheduled quiz's. Derived, not stored.

## counting record (`quiz_result_count_changes`, existing, now read-only)

No row is written any more. Its rows are still shown in a quiz's history, and still decide the stage
of a quiz that has no `stage` row and no link (R3).

## scored revision (`quiz_result_scores`, new)

What scoring makes of one stored revision, kept so that a stats request ranks without scoring (R2).
One row per revision that carries a quiz file; a restoring revision uses the row of the revision it
restores.

| Field          | Meaning                                                                                |
| -------------- | -------------------------------------------------------------------------------------- |
| revision       | the revision; deleted with it                                                          |
| shared version | the `@qzr/shared` version that scored it                                               |
| scored         | JSON: the quiz's name, whether it is a consolation quiz, and its own formula; per team |
|                | its name, score, score before overtime, errors and place by score; what is wrong with  |
|                | the quiz; per listed quizzer the name, points, errors, correct answers and types       |

Rules:

* Written when the revision is saved. A row that is missing, or whose shared version is not the
  running one, is replaced when stats are next read, a few per request.
* Holds nothing a setting or a later decision can change: no placement points, no stage, no ranking.
  Those are applied when stats are read.
* Every route that needs scored facts reads these rows: a division's stats, what needs attention,
  and the problems shown in the results list (R2).

## confirmation (`division_confirmations`, new)

Append-only: one row each time an admin confirms or withdraws a division's prelim order or re-rank
(R9, FR-019b, FR-019c).

| Field    | Meaning                                                                                       |
| -------- | --------------------------------------------------------------------------------------------- |
| meet     | the meet; deleted with it                                                                     |
| division | the division, as the meet names it                                                            |
| what     | the prelim order, or the re-rank                                                              |
| action   | confirmed, or withdrawn                                                                       |
| order    | on a confirmation: the teams in order with their rank, points and quizzes at that moment      |
| affected | on a withdrawal: the stored quizzes of later stages that were seated from the order withdrawn |
| by, at   | the admin, by account and by name as it was, and when                                         |

Rules:

* The confirmed order of a division is the `order` of its newest row of that `what`, when that row
  is a confirmation.
* A row is written by the same request that moves the division's state: to `stats_break` confirms
  the prelim order, back from it withdraws it; to `elim_running` confirms the re-rank where the
  division has intermediates, back from it withdraws that.
* A stored quiz is flagged as played under a withdrawn order while a withdrawal names it, it has no
  newer `kept` row, and its stage is not "not counted".

## division state (`division_states`, existing)

Unchanged in shape: one row per meet and division, updated in place. Its state gains one value.

```text
prelim_running → stats_break → elim_running → finals → division_done
```

Each move is one step, forward or back, by an admin, while the meet is live or in review. A
division's intermediates are played during `stats_break`.

## stats settings (`meet_stats_settings`, new)

Append-only: one row per save; the newest is the meet's settings, and a meet with no row has the
defaults (R10, FR-022).

| Field    | Meaning                                               |
| -------- | ----------------------------------------------------- |
| meet     | the meet; deleted with it                             |
| settings | the settings document, JSON, validated before storing |
| by, at   | the admin, by account and by name as it was, and when |

The document (a shared schema, so the API validates it and the portal's form is typed by it):

| Setting               | Values                                                              | Default         |
| --------------------- | ------------------------------------------------------------------- | --------------- |
| tie-break order       | head-to-head, points, errors; or points, errors                     | the first       |
| level teams           | the points of the shared place; or the reduced points               | the first       |
| prelims, no overtime  | yes or no                                                           | yes             |
| results, per stage    | shown from a moment or never; and places only, or places and scores | see below       |
| prelim standings live | yes or no                                                           | no              |
| quizzer standings     | shown from a moment or never; updated live or by stage              | meet done, live |

A moment is reached by the division's state or the meet's phase, and stays reached while they stay
there or beyond:

| Moment                  | Reached when                                                               |
| ----------------------- | -------------------------------------------------------------------------- |
| the start               | the meet is `live`, `review` or `done`                                     |
| prelims confirmed       | the division is at `stats_break` or beyond                                 |
| intermediates confirmed | the division is at `elim_running` or beyond, with or without intermediates |
| eliminations in         | the division is at `finals` or beyond                                      |
| Finals done             | the division is at `division_done`                                         |
| meet in review          | the meet is `review` or `done`                                             |
| meet done               | the meet is `done`                                                         |

Taking a division back a step un-reaches its moment. A stage's results cannot start before the stage
does. Defaults for results: prelims, intermediates and eliminations from the start of their stage,
places only; the Finals result once the Finals is done, places only (FR-018b).

## dismissed look-alike (`meet_name_dismissals`, new)

Two names an admin has said are different (R12, FR-032). Unique per meet, division, team and pair.

| Field    | Meaning                                                              |
| -------- | -------------------------------------------------------------------- |
| meet     | the meet; deleted with it                                            |
| division | the division the names are in                                        |
| team     | for two quizzers, their team's folded name; empty for two team names |
| names    | the two names, folded, in a fixed order                              |
| by, at   | the admin, by account and by name as it was, and when                |

## Derived, never stored

Computed on each read (R1) by pure functions in `packages/shared`, from each quiz's scored revision
(R2):

* **Quizzer line**: one quizzer in one quiz: points, errors, jumps, correct answers by type (R7).
* **Quizzer standings**: per division, with the consolation list apart: totals, the team's quizzes,
  average, place, and for admins the flags.
* **Prelim standings and re-rank**: with the meet's tie-break order and way of scoring level teams
  (R8).
* **Finals result**: the first three of a bracket's one decided Finals.
* **Roster match**: whether each team and quizzer name in a stored quiz is one of its division's
  teams and on that team's roster, where the meet has them; a matched team is shown under the
  roster's name, and a miss is a roster error (R12, R16).
* **What a viewer has**, and the state of standings (live preview, preview, locked in), from the
  settings, the division's state and the meet's phase (R11).

## Shared contract (`packages/shared`)

Additive; no change to `QuizFile` or `FILE_VERSION`.

* `DIVISION_STATES` gains `finals`.
* The stats settings schema, its defaults, the stages and the moments.
* Quizzer lines, quizzer standings, the re-rank, the tie-break order on the existing standings, and
  placement points worked out when stats are read (R6, R8).
* A scheduled quiz's stage, and whether a quiz file matches a scheduled quiz (R3, R4).
* What a viewer has, and the state of standings (R11).
* The stats response types the API sends and the portal reads
  ([contracts/stats-api.md](./contracts/stats-api.md)).
