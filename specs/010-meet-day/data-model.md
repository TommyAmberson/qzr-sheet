# Data model: Meet day

Nothing new is stored. Every entity here is worked out on each read from what the schedule and meet
stats already hold (`specs/006-meet-stats/data-model.md`).

## Bench resolution

What `resolveBenches` gives for one bench of one scheduled quiz, keyed by `<quizId>:<benchIndex>`.

| Field | Meaning                                                                                              |
| ----- | ---------------------------------------------------------------------------------------------------- |
| team  | the team's name as the meet's roster spells it, when settled                                         |
| tied  | the source quiz has teams level across this bench's place, which the admin settles away from the app |

A bench is absent from the result while its source is unsettled. Its source, by bench kind:

| Bench kind        | Settled when                                             | Team                                                                                            |
| ----------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `letter`          | the draw has the letter                                  | the drawn team                                                                                  |
| `rank n`          | the division's prelim order is confirmed                 | rank `n` of the confirmed order                                                                 |
| `new n`           | the division's re-rank is confirmed                      | rank `n` of the confirmed re-rank                                                               |
| `place {quiz, p}` | quiz `quiz` counts (its teams check aside)               | the team placed `p` in it                                                                       |
| `points {p}`      | every quiz of the holding quiz's lane round robin counts | place `p` across them, ranked as the prelims are (placement points, then the meet's tie-breaks) |
| `empty`           | never                                                    | none                                                                                            |

A confirmed order withdrawn makes its benches, and the benches fed by quizzes filled from it,
unsettled again. A bench is never settled from live standings.

## Scheduled quiz on the day

One entry per quiz of the published schedule, in the day response.

| Field    | Meaning                                                                                                                                                                                    |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| id       | the schedule quiz id                                                                                                                                                                       |
| status   | `played`, `attention`, `underReview`, `notCounted`, `hidden` or `notIn`                                                                                                                    |
| teams    | the stored quiz's teams, named as it names them and in its order: place, and score where the reader may see the stage's scores; names alone when under review; empty when not in or hidden |
| storedId | the stored quiz's id, for admins and for the official of its room                                                                                                                          |
| problems | what is wrong, for admins and the official of its room, as meet stats words it                                                                                                             |

Status:

| Status        | When                                                                                                                   |
| ------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `notIn`       | no stored quiz is linked to it, or for anyone but an admin and its room's official, the one linked is set not to count |
| `hidden`      | its stage's results aren't shown to this reader yet, whether a quiz is in or not                                       |
| `played`      | its stored quiz counts (no errors, or accepted)                                                                        |
| `attention`   | its stored quiz is in error and not accepted, read by an admin or its room's official                                  |
| `underReview` | the same, read by anyone else                                                                                          |
| `notCounted`  | its stored quiz is set not to count, read by an admin or its room's official, with its team names                      |

Every quiz of a stage whose results the reader may not see yet is `hidden`, in or not, with no
teams, places or scores, so the page never tells them a quiz has been played before the settings
would (FR-024, SC-007); it shows as "result not shown yet". For anyone but an admin, that covers
every stage in registration and build. Statuses, places and scores are the same cut a division's
stats make for this reader (`viewerHas`, `cutTo`); an official also gets their own room's quizzes
with status and problems whatever the stage, as the results list gives them today.

A result's teams follow the stored quiz's order, which a quiz matched to the schedule by name may
not share with the schedule's benches, so the Schedule tab benches each by the team's folded name.

## Not on the schedule

Stored quizzes the schedule doesn't match: in a meet with a published schedule, those linked to no
scheduled quiz; with none published, every stored quiz. Each with its name, division, stage, status
and teams, cut as a scheduled quiz's are. Admins see all of them, officials their rooms', and
everyone else only those with a stage whose results they may see, so a meet without a schedule still
lists its quizzes for viewers, as a division's stats do today.

## Division on the page

The division picker's value: a division the meet lists, or every division. In the page's address as
`?division=`; never remembered between visits.
