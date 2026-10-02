# Data model: Practice meet results

New D1 tables for [spec.md](./spec.md), following the schema's conventions (snake_case plural
tables, integer autoincrement ids, `*_at` timestamps, meet-scoped rows cascading on meet delete).
`docs/data-model.md` is amended to match (principle II).

## stored quiz (`quiz_results`)

One quiz of a meet, whatever its history.

| Field            | Meaning                                                                                 |
| ---------------- | --------------------------------------------------------------------------------------- |
| id               | identity                                                                                |
| meet             | the meet; deleted with it                                                               |
| room             | the room it was first submitted from; empty for uploads; cleared if the room is deleted |
| current revision | number of the newest revision                                                           |
| counted          | whether it counts in the standings; starts false                                        |
| created at       | first save                                                                              |

Rules:

* `counted` starts false for every quiz (FR-013): nothing in this feature links a quiz to a schedule
  slot, so nothing is counted automatically.
* An official may save only a stored quiz whose room is theirs (R7).

## quiz version (`quiz_result_revisions`)

Append-only: one row per save; rows are never updated or deleted while the meet exists.

| Field         | Meaning                                                                      |
| ------------- | ---------------------------------------------------------------------------- |
| stored quiz   | the stored quiz; deleted with it                                             |
| revision      | 1, 2, 3, … per stored quiz; unique within it                                 |
| quiz file     | the full quiz file as the scoresheet saves it, validated before storing (R6) |
| action        | submitted, uploaded, edited, merged, or restored                             |
| restored from | for `restored`, the revision copied                                          |
| saved by      | the account, when signed in                                                  |
| saved by room | the room, when an official saved it                                          |
| saved at      | when                                                                         |

Rules:

* The newest revision is the stored quiz's content; its number equals `current revision`.
* Restoring copies an earlier revision's file into a new revision (FR-005a); newer rows stay.
* Two saves racing for the same number: the second fails the uniqueness check and is retried by the
  API with the next number, so newest wins (spec edge cases) and neither is lost.
* Who and how come from the caller, never the request body (R7).

## counting record (`quiz_result_count_changes`)

Append-only: one row per count or uncount (FR-013).

| Field       | Meaning             |
| ----------- | ------------------- |
| stored quiz | the stored quiz     |
| counted     | the new value       |
| changed by  | the admin's account |
| changed at  | when                |

A select all or deselect all writes one row for each quiz whose value actually changes.

## team name (`meet_team_names`)

Optional, per meet and division (Story 6). Independent of churches and the `teams` table.

| Field      | Meaning                          |
| ---------- | -------------------------------- |
| meet       | the meet; deleted with it        |
| division   | division text, as quizzes use it |
| name       | the team name                    |
| sort order | display order in the division    |

Unique on meet, division and folded name.

## Derived, never stored

* **Quiz outcome** (shared, from a quiz file): each team's name, score, place, placement points and
  error count, or "can't be placed" (R2, R12).
* **Division standings** (shared, from the counted quizzes' outcomes): per division, each team's
  total placement points, quiz count, rank, the criterion that broke its tie, finalist marking, and
  the warnings of FR-012, FR-014 and R12, plus look-alike name pairs (R11).

## Guest token claim

Official guest tokens gain the room's id (R4). `docs/auth.md` and `docs/roles-and-access.md` are
amended. Viewer tokens are unchanged.
