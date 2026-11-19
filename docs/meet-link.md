# Names and the meet link

How team and quizzer names behave in the scoresheet once a meet is linked, and how a quiz gets onto
the sheet and tied to a meet. The code is in `apps/scoresheet/src/composables/useMeetSession.ts` and
`Scoresheet.vue`.

## Two layers

* The **stored name** is what the sheet holds, saves to a file, and submits. It is always free text.
* A **pick** ties a team slot to a roster team, and each of its seats to a roster quizzer. Picks
  live in the meet session (`localStorage`, key `qzr-meet-session`). They drive the roster menu, the
  flags, and the restore buttons, and nothing else: a pick is never saved to a quiz file and never
  sent with a submission. The meet knows a quiz and its teams by name. A pick can always be made
  again from the names, so making or remaking one changes nothing anyone typed.

The sheet can be tied to a meet in two ways, both kept in the meet session: to the **meet**, which
gives it teams, rosters and divisions, and to one **scheduled quiz** of the meet's published
schedule, which says which quiz this is. A scheduled quiz link implies the meet link. The header
shows both in one place, with the menu that makes and removes them.

Linking to a meet, or loading a quiz from it, also sets the quiz's way of scoring teams level in a
quiz to the meet's, read from its stats settings, so the sheet's placement points match the meet's
tables (specs/006-meet-stats, FR-023b). It is kept in the meet session with the rest of the meet. A
sheet that can't read the settings keeps its own way.

## New, Open and Link

Three actions, each doing one thing. Only New and Open replace what is on the sheet, and they ask
first when it has unsaved changes: answers not yet saved, or names typed since the sheet was last
saved, started or opened. Names a link filled in when the quiz was started or opened are its own and
don't count. "Clear names" also unpicks the linked meet's teams, since a blank name names no team.

| Action                 | Does                                                                      |
| ---------------------- | ------------------------------------------------------------------------- |
| New (20 or 15)         | a blank quiz; keeps the meet link, drops the scheduled quiz and the picks |
| New from schedule…     | a blank 20-question quiz, then links the picked scheduled quiz            |
| Open ▸ From file…      | the file as saved; **unlinks** the meet and the scheduled quiz            |
| Open ▸ From the meet…  | a stored quiz, current version or an earlier one, then links the meet     |
| Open ▸ From the        | the scheduled quiz's stored quiz, then links the scheduled quiz; with     |
| schedule…              | nothing stored, offers New from schedule                                  |
| Link a meet…           | links the meet                                                            |
| Link a scheduled quiz… | links the scheduled quiz and its meet                                     |
| ⟳ (refresh)            | fetches the meet afresh and links again what is linked                    |
| Unlink quiz            | drops the scheduled quiz link; meet and picks stay                        |
| Unlink meet            | drops both links and the picks; everything typed stays                    |

The portal's links are two of these: `?meetId&quiz` is New from schedule, and
`?meetId&result&revision` opens that version of a stored quiz.

**Linking overwrites nothing.** It is one routine (`planLink`, then `applyLink`) whatever started
it, and it does exactly this:

* a slot picked against the same meet keeps its pick; linking another meet makes the picks again;
* a slot with a name is picked as the roster team its name names (below), never as the team the
  schedule seats there;
* a blank slot takes the team the scheduled quiz seats in it, unless that team is on the sheet
  already;
* a blank division, with its consolation flag, and a blank quiz number take the scheduled quiz's;
* blank seats of a newly picked team take its roster's quizzers.

No answer, timeout, no-jump mark, typed name, typed division or typed quiz number changes. New from
schedule is this over a blank sheet, the two server Opens are this over the opened quiz, and the
refresh symbol is this over the sheet as it is. A scheduled quiz doesn't say its format yet (#173),
so New from schedule starts a 20-question quiz.

A stored quiz and a scheduled quiz are the same quiz when they share a division, consolation flag
and quiz number (`resultKey`), which is how the meet names stored quizzes. New from schedule uses
that to say when the meet already holds a result for the quiz, and offers to open it instead.

**Waiting on the meet.** A link is worked out in full before anything is written. While an action
the official started waits on the meet (New from schedule, the server Opens, a link, the refresh
symbol, and submitting while it fetches), the sheet shows that it is waiting and takes nothing but
Cancel; cancelling leaves it exactly as it was. Scoring, saving, a plain New, opening a file and
unlinking need no network.

**When the sheet fetches.** On a link, on the refresh symbol, once before the submit question, and
on reload. The last two only renew the copy of the roster and scheduled quiz that the warnings are
worked out from: they pick and fill nothing, and the reload fetch runs behind the sheet without
holding it up. There is no polling, and editing a name fetches nothing.

**On the meet's side.** The meet finds a quiz's roster and schedule problems again from its names,
with the same comparison of team names (`teamNamed` in `packages/shared`), and there they are
errors: a quiz with one counts for nothing until it is fixed or an admin accepts it as scored. A
submission from a sheet holding a scheduled quiz says which (`scheduleQuizId`), which links the
stored quiz to it; any other stored quiz is linked to the scheduled quiz of its name.

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

* **Linking** (`planLink`) looks each unpicked slot's typed team name up on the roster.
  1. A name a roster team has outright (`teamNamed`): full name before short name, case and spacing
     ignored, punctuation ignored last. The quiz's division is searched first and the rest of the
     meet after, and never a team another slot holds. An exact name wins whatever the quizzers say.
  2. Otherwise a misspelt name (`teamsNearName`, `quizzersConfirmTeam`): teams of the division
     within two edits of the full name, or one of the short name, are shortlisted, and one is picked
     only if it alone has every typed quizzer on its roster, at least two of them. The typed name is
     kept and flagged.
* **A blank slot** takes its scheduled team when a scheduled quiz is linked, as above.
* **Opening a file** (JSON, ODS, a kept auto-save) unlinks the sheet, so it has no picks until it is
  linked. The quiz stays as it was saved.
* **Picking from the roster menu** sets the slot's name to the roster's full name.
* **Taking the schedule's team** from a warning (below) moves or replaces a slot's team.
* **A new quiz** and **unlinking the meet** drop the picks. Unlinking leaves every name as it is.
* The sheet makes no pick without being asked: not on reload, and not before submitting.

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

### Against the scheduled quiz

While a scheduled quiz is linked, the sheet's quiz is held against it, slot by slot: the schedule's
first seat is the sheet's first team. These lines take the place of the plain division and quiz
number lines above, and a blank slot the schedule seats shows its schedule line and not "no team
picked" as well.

| Warning                                    | When                                             | Fix offered                  |
| ------------------------------------------ | ------------------------------------------------ | ---------------------------- |
| `Division 2 consolation: schedule has 1`   | division or consolation flag differs             | Set division to 1            |
| `Quiz 4: schedule has 7`                   | quiz number differs                              | Set quiz to 7                |
| `Team 1: Regina 1, schedule has Calgary 1` | another team sits where the schedule has Calgary | Move Calgary 1 to Team 1     |
|                                            |                                                  | (swaps with Regina 1), or    |
|                                            |                                                  | Replace Regina 1 with        |
|                                            |                                                  | Calgary 1 when Calgary isn't |
|                                            |                                                  | on the sheet                 |
| `Team 3: blank, schedule has Bears 1`      | slot blank where the schedule seats a team       | Put Bears 1 in Team 3        |
| `Quiz: no longer in the meet's schedule`   | the published schedule dropped the quiz          | Unlink quiz                  |

A seat the schedule hasn't decided (an elimination seat, until results fill it in) is held against
nothing. Clicking the warning count opens the list with each fix as a button that says what it will
do. A move swaps two whole teams, each with its name, quizzers, answers, timeouts and on-time mark
(`swapTeams`), so no score changes, and undo takes it back; so does a replacement. A replaced slot
keeps the quizzer names typed in it, held against the new team's roster.

Neither warnings nor scoring errors block a submission: both are listed and asked about once before
it goes. Teams are only held against the roster when it has teams for the quiz's division. With no
meet linked there is no roster and so no name warnings: a blank team name is a warning only because
no roster team is called nothing. The division is held against the meet's the same way: blank, or
one the meet doesn't list, is a warning while linked and nothing otherwise. So is a blank quiz
number, since the meet files a quiz under its division and number.
