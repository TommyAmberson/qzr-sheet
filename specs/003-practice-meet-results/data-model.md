# Data model: Practice meet results

New D1 tables for [spec.md](./spec.md), following the schema's conventions (snake_case plural
tables, integer autoincrement ids, `*_at` timestamps, meet-scoped rows cascading on meet delete).
`docs/data-model.md` is amended to match (principle II).

## stored quiz (`quiz_results`)

One quiz of a meet, whatever its history.

| Field      | Meaning                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------- |
| id         | identity                                                                                          |
| meet       | the meet; deleted with it                                                                         |
| room       | the room it was first submitted from; unread, since a quiz's rooms come from its revisions (#107) |
| quiz key   | its name, division, consolation and quiz number, folded for case and spaces; unique in the meet   |
| created at | first save                                                                                        |

Rules:

* Whether a quiz counts is its newest counting record, and it doesn't count until an admin first
  counts it (FR-013): nothing in this feature links a quiz to a schedule slot, so nothing is counted
  automatically.
* A quiz not tied to the schedule is identified by its quiz key (FR-003): a submission or upload
  with a key the meet already has is reported, and on the submitter's choice adds to that quiz's
  revisions, whichever room sent it.
* A quiz's rooms are those its revisions were saved for (`saved by room`), so a quiz can belong to
  several; their officials may read and change it (FR-018). Schedule linkage (#16) will tie a quiz
  to its slot's room instead.

## quiz version (`quiz_result_revisions`)

Append-only: one row per save; rows are never updated or deleted while the meet exists.

| Field         | Meaning                                                                                                                                 |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| stored quiz   | the stored quiz; deleted with it                                                                                                        |
| revision      | 1, 2, 3, … per stored quiz; unique within it                                                                                            |
| quiz file     | the full quiz file as the scoresheet saves it, validated before storing (R6); empty when the revision restores another                  |
| action        | submitted, uploaded, edited, merged, or restored                                                                                        |
| restored from | for a revision with no file, the earlier revision whose file it makes current; always one that carries a file                           |
| saved by      | the account, when signed in                                                                                                             |
| saved by room | the room, when an official saved it                                                                                                     |
| saved by name | who saved it as named then ("Room 1", "Alice, Room 1", or the admin's name), so the trail survives a renamed or deleted room or account |
| saved at      | when                                                                                                                                    |

Rules:

* Each revision has exactly one of a quiz file or `restored from` (a `CHECK` constraint). The newest
  revision is the stored quiz's current one, and its content is its own file or the file of the
  revision it restores. Its number is read from the revisions themselves, so no second row can fall
  out of step with them.
* Restoring adds a revision restoring the chosen one, pointing past any restoring revision to the
  file it restores (FR-005a); newer rows stay, and no file is copied. Restoring what is already
  current adds no row.
* Keeping the current revision on a resubmission adds two revisions in one statement: the submitted
  file, then one restoring what was current before it.
* A revision takes the next number in the same statement that stores it. Two saves racing for the
  same number: the second fails the uniqueness check and is retried by the API with the next number,
  so newest wins (spec edge cases) and neither is lost.
* Who and how come from the caller, never the request body (R7).

## counting record (`quiz_result_count_changes`)

Append-only: one row per count or uncount (FR-013).

| Field           | Meaning                                                                     |
| --------------- | --------------------------------------------------------------------------- |
| stored quiz     | the stored quiz                                                             |
| counted         | the new value                                                               |
| changed by      | the admin's account                                                         |
| changed by name | the admin as named then, so the trail survives a renamed or deleted account |
| changed at      | when                                                                        |

A select all or deselect all writes one row for each quiz whose value actually changes, in as few
statements as D1's parameter limit allows. The newest row is the quiz's current value, so a quiz and
its record agree even if a large change is cut short.

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

Official guest tokens gain the room's id and a tag of the room's current code (R4), so rotating the
code or deleting the room revokes them. `docs/auth.md` and `docs/roles-and-access.md` are amended.
Viewer tokens are unchanged.
