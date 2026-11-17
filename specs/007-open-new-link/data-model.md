# Data model: New, Open and Link on the scoresheet

No database table, API payload or quiz file changes. The only data this feature adds lives in the
scoresheet's meet session, in the browser.

## Meet session (browser `localStorage`, key `qzr-meet-session`)

`MeetSessionData` in `apps/scoresheet/src/composables/useMeetSession.ts`. Existing fields are
unchanged in name and meaning.

| Field           | Status   | Meaning                                                                        |
| --------------- | -------- | ------------------------------------------------------------------------------ |
| `meetId`        | existing | the linked meet                                                                |
| `meetName`      | existing | its name, for the linked display                                               |
| `slots`         | existing | the picks: per team slot, the roster team and each seat's roster quizzer       |
| `teamList`      | existing | the meet's roster teams, as last fetched                                       |
| `meetDivisions` | existing | the meet's divisions, as last fetched                                          |
| `quizId`        | existing | the linked scheduled quiz's id in the published schedule, or `null`            |
| `sender`        | existing | who the user is when sending to the meet                                       |
| scheduled quiz  | **new**  | the copy of the linked scheduled quiz the warnings are worked out from (below) |

### Scheduled quiz copy

Present only while `quizId` is set.

| Part            | Meaning                                                                             |
| --------------- | ----------------------------------------------------------------------------------- |
| label           | what the schedule calls the quiz, for the linked display                            |
| division        | the schedule's division for it                                                      |
| consolation     | whether the schedule has it as a consolation quiz                                   |
| quiz number     | the schedule's number for it                                                        |
| seats           | per team slot, in the schedule's seat order: the roster team's id, or none when the |
|                 | seat is undecided (research R3) or the quiz seats fewer teams                       |
| in the schedule | false once a fresh fetch finds the published schedule no longer has this quiz       |

Rules:

* Written by a link to a scheduled quiz and by every fresh fetch (FR-023). Never written from what
  is on the sheet.
* Cleared when the scheduled quiz is unlinked, the meet is unlinked, a plain New is started, or a
  file is opened (which unlinks the meet as well) (FR-003, FR-010, FR-016).
* A session saved by an earlier release has `quizId` and no copy. It is read as linked with nothing
  to compare until the reload fetch fills the copy in; no migration is needed.
* A seat's team id is looked up in `teamList` for its name. An id the list no longer has reads as
  undecided.

## Quiz on the sheet (unchanged shape)

`quizStore` and the quiz file are as they are. Two existing fields gain a writer:

* `Team.seatOrder`: swapped between two teams by "take the schedule's team" when that team is in
  another slot (research R4). The picks in `slots` are swapped with it.
* `Quiz.division`, `Quiz.consolation`, `Quiz.quizNumber`: set from the scheduled quiz when blank on
  a link, or when the official takes the schedule's value.

## Derived, not stored

* **Schedule warnings**: from the scheduled quiz copy, `teamList`, the picks and the quiz on the
  sheet. Recomputed on every edit; never saved or sent.
* **Which stored quiz a scheduled quiz has**: the stored quiz whose `resultKey` equals the scheduled
  quiz's (research R2), looked up in the list fetched for the dialog.

## State of the links

```text
unlinked ──link a meet──────────────▶ meet
unlinked ──link a scheduled quiz────▶ meet + quiz
meet ─────link a scheduled quiz─────▶ meet + quiz
meet + quiz ──unlink quiz───────────▶ meet            (picks kept)
meet + quiz ──plain New─────────────▶ meet            (picks dropped)
meet, meet + quiz ──open file───────▶ unlinked        (file shown as saved)
meet, meet + quiz ──unlink meet─────▶ unlinked        (picks dropped, names kept)
any ──link another meet's quiz──────▶ that meet + quiz (picks remade)
```
