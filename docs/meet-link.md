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

## Blank names

A new quiz has no names: three teams and fifteen seats, all blank, and no division or quiz number.
Nothing is written in for the room. A blank is empty wherever the name goes: on the sheet, in a
saved file, in an ODS export, and in what a meet is sent.

| Stored name   | Unlinked                    | Linked                                       |
| ------------- | --------------------------- | -------------------------------------------- |
| Team blank    | empty seat in the standings | no team yet: shown as "Pick team"            |
| Quizzer blank | empty seat, answers invalid | empty seat, filled from the roster on a pick |

Linked to a meet, teams are picked within the quiz's division, so a quiz with no division offers no
team to pick until one is chosen. A meet with a single division has it chosen for the quiz.

A saved file is named for the quiz, `D1Q3.json`, with `_` where the division or number is blank: a
new quiz saves as `D_Q_.json`. A division or quiz number of `_` is taken for blank wherever the
sheet checks one, so a value copied back off a file name isn't mistaken for a division.

An empty name box shows a prompt, "Team name" (or "Pick team") and "Seat 1" to "Seat 5", drawn small
and pale so it can't be taken for a name. The prompt is display only and is never stored.

An answer in a seat with no name is a scoring error (`ValidationCode.EmptySeat`), linked or not: the
sheet can't credit a quizzer nobody named. Like any scoring error it doesn't block a submission, and
the meet's portal shows it for an admin to put right.

Before 0.21.0 a new quiz came with `Team 1`–`Team 3` and `Quizzer 1`–`Quizzer 4` written in, and the
sheet treated those spellings as "not named yet". It no longer does. A file saved with them opens
with them, as names like any other: what was written stays as written.

## What sets a pick

* **Linking a meet** looks each typed team name up on the roster (`onMeetLoaded`). A blank name is
  skipped.
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

Errors and warnings differ in what the sheet knows:

* An **error** is wrong whatever the meet: a scoring rule broken, such as two quizzers answering one
  question or an answer in a seat with no name. The sheet shows it linked or not.
* A **warning** is only probably wrong, and only because it doesn't match what a linked meet says:
  its roster, its divisions. With no meet linked there is nothing to hold a name against, so there
  are no warnings, and a blank team name or division goes as typed.

Neither stops a quiz being sent.

A name that disagrees with the roster is underlined, with the reason on hover and a restore button
where there is a roster name to go back to. The same disagreements are listed as warnings beside the
quiz's status, where a click or tap on the count shows the list, and asked about once when the quiz
is submitted to the linked meet:

| Warning                                       | When                                             |
| --------------------------------------------- | ------------------------------------------------ |
| `Team 3: no team picked`                      | slot unpicked, name blank                        |
| `Lions: not picked from the meet's teams`     | slot unpicked, name typed                        |
| `Lyons: picked team is Lions 1`               | picked, name differs from the roster's full name |
| `Lions 1: picked team isn't in this division` | picked from another division                     |
| `Division: none chosen`                       | linked, quiz has no division                     |
| `Division 4: not one of the meet's divisions` | linked, meet doesn't list the quiz's division    |
| `Quiz: no number given`                       | linked, quiz number blank                        |
| `Lions 1, Sammy: roster has Sam Lee`          | seat linked to a roster quizzer of another name  |
| `Lions 1, Jo: not on the roster`              | seat with no roster quizzer left for it          |

Each seat of a picked team is tied to one roster quizzer. Typing a quizzer's exact roster name into
another seat moves them there: the two seats swap quizzers, once the name is typed in, unless the
seat they were tied to still bears their name (`relinkSeatByName`). So a team that sits in another
order than its roster can be typed in as it sits, and nothing is left disagreeing.

Team names are compared ignoring case and spacing, quizzer names exactly. A seat emptied of its
roster quizzer is an absence and gives no warning.

Neither warnings nor scoring errors block a submission: both are listed and asked about once before
it goes. Teams are only held against the roster when it has teams for the quiz's division. With no
meet linked there is no roster and so no name warnings: a blank team name is a warning only because
no roster team is called nothing. The division is held against the meet's the same way: blank, or
one the meet doesn't list, is a warning while linked and nothing otherwise. So is a blank quiz
number, since the meet files a quiz under its division and number.
