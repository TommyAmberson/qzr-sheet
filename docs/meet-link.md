# Names and the meet link

How team and quizzer names behave in the scoresheet once a meet is linked. The code is in
`apps/scoresheet/src/composables/useMeetSession.ts` and the name cells of `Scoresheet.vue`.

## Two layers

* The **stored name** is what the sheet holds, saves to a file, and submits. It is always free text.
* A **pick** ties a team slot to a roster team, and each of its seats to a roster quizzer. Picks
  live in the meet session (`localStorage`, key `qzr-meet-session`). They drive the roster menu, the
  flags, and the restore buttons, and nothing else: a pick is never saved to a quiz file and never
  sent with a submission. The meet knows a quiz and its teams by name.

Linking overwrites nothing. It may fill a seat that is empty and tidy a name to the roster's
spelling, but text someone typed stays as typed. The sheet records what happened in the room; a
roster that is wrong is the admin's to fix afterwards.

## Default and blank names

| Stored name             | Unlinked                       | Linked                                       |
| ----------------------- | ------------------------------ | -------------------------------------------- |
| Team `Team 1`–`Team 3`  | a name like any other          | no team yet: shown as "Pick team"            |
| Team blank              | empty seat in the standings    | no team yet: shown as "Pick team"            |
| Quizzer `Quizzer 1`–`4` | a quizzer, whose answers count | blanked when the slot's team is picked       |
| Quizzer blank           | empty seat, answers invalid    | empty seat, filled from the roster on a pick |

A new sheet starts with `Team 1`–`Team 3` and `Quizzer 1`–`Quizzer 4`; the fifth seat is blank. The
"Pick team" prompt is display only: the stored name is still `Team N` until a team is picked or a
name typed.

## What sets a pick

* **Linking a meet** looks each typed team name up on the roster (`onMeetLoaded`). An untouched
  `Team N` is skipped.
  1. A name a roster team has outright (`teamNamed`): full name before short name, case and spacing
     ignored, punctuation ignored last. The quiz's division is searched first and the rest of the
     meet after, and never a team another slot holds. An exact name wins whatever the quizzers say.
  2. Otherwise a misspelt name (`teamsNearName`, `quizzersConfirmTeam`): teams of the division
     within two edits of the full name, or one of the short name, are shortlisted, and one is picked
     only if it alone has every typed quizzer on its roster, at least two of them. The typed name is
     kept and flagged.
* **Opening a quiz** (file, ODS, kept auto-save, stored quiz from the portal) while linked drops the
  picks and makes none: the quiz stays as it was saved, its teams unpicked until picked by hand.
* **Picking from the roster menu** sets the slot's name to the roster's full name.
* **Loading a scheduled quiz** picks each seat's team; a seat with no team yet is left alone.
* **A new quiz** and **unlinking** drop the picks. Unlinking leaves every name as it is.

Editing a name never changes a pick, and a pick never stops a name being edited.

## Seating quizzers on a pick

A pick seats the team's roster around the names already typed (`matchQuizzers`), in four passes:
same name, same first name, then each typed name left over to the closest quizzer left on the
roster, then empty seats filled in roster order. Typed names keep their seats and their spelling;
only empty seats are written. The third pass has no limit on how far apart two names may be. That is
deliberate: the link only says which roster name the restore button offers.

## Flags and warnings

A name that disagrees with the roster is underlined, with the reason on hover and a restore button
where there is a roster name to go back to. The same disagreements are listed as warnings beside the
quiz's status, and asked about once when the quiz is submitted:

| Warning                                       | When                                             |
| --------------------------------------------- | ------------------------------------------------ |
| `Team 3: no team picked`                      | slot unpicked, name default or blank             |
| `Lions: not picked from the meet's teams`     | slot unpicked, name typed                        |
| `Lyons: picked team is Lions 1`               | picked, name differs from the roster's full name |
| `Lions 1: picked team isn't in this division` | picked from another division                     |
| `Lions 1, Sammy: roster has Sam Lee`          | seat linked to a roster quizzer of another name  |
| `Lions 1, Jo: not on the roster`              | seat with no roster quizzer left for it          |

Team names are compared ignoring case and spacing, quizzer names exactly. A seat emptied of its
roster quizzer is an absence and gives no warning.

Neither warnings nor scoring errors block a submission: both are listed and asked about once before
it goes. Teams are only held against the roster when it has teams for the quiz's division. With no
meet linked, the only warning is for a team still called `Team N` when the quiz is sent to a meet.
