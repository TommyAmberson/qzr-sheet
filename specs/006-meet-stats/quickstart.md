# Quickstart: Meet stats

Validation scenarios proving [spec.md](./spec.md) end to end. API shapes are in
[contracts/stats-api.md](./contracts/stats-api.md); tables in [data-model.md](./data-model.md).

## Setup

```sh
pnpm install
pnpm --filter @qzr/api db:migrate:local
pnpm dev:all     # scoresheet :5173, portal :5174, API :8787
```

In the portal, sign in as a superuser, create a meet with divisions `1` and `2`, two rooms, churches
with teams and rosters in division `1`, and build and publish a schedule for it with prelims, an X
and Y intermediate, eliminations and a Finals. Leave division `2` with no teams and no schedule, as
a practice meet would be. Move the meet to `live`. Keep a second, private window joined with the
viewer code.

## Automated checks

```sh
pnpm test:unit && pnpm type-check && pnpm lint
```

Expect the shared specs for quizzer lines, quizzer standings, tie-break orders, the re-rank and what
a viewer has, including the run against the name-scrubbed reference meet (R14): every quizzer row,
every average and place, the prelim ranks and the re-ranked order as the workbook has them.

## Scenarios

1. **Linked quiz counts on its own (Story 2)**: Open the scoresheet from a scheduled prelim of
   division `1`, score it, submit. The results page shows it linked, stage prelim, counting, with
   nothing for the admin to do. Submit another by typing the same division, quiz number and team
   names without the schedule: it links itself.
2. **A link that disagrees (Story 2)**: Open a scheduled quiz, type over its quiz number, submit. It
   arrives linked, in error ("name differs from the schedule"), and does not count. Correct the
   number in the short form: it counts.
3. **Unlinked quiz (Story 2)**: In division `2`, submit quizzes with typed names. Each is listed
   with no stage. Select them and set the stage to prelim together.
4. **Accept as scored (Story 3)**: Submit a prelim with a validation error. Stats leave it out and
   name it; the viewer window lists it as under review with no places. Accept it: it counts, marked
   "accepted as scored" in both windows. Save a new revision that still has the error: it drops out
   until accepted again.
5. **Quizzer standings (Story 1)**: With division `1`'s prelims in, open its stats as the admin.
   Check one quizzer's points, errors, jumps and average by hand, a tie on average broken by errors,
   and that a quizzer missing from one sheet is flagged with both counts.
6. **Confirm prelims (Story 4)**: On the stats settings page division `1` shows as ready. With one
   prelim still missing, confirming warns and names it. Confirm. The viewer window now shows the
   prelim standings as locked in. Correct a prelim so the order changes: the admin sees both orders;
   the viewer still sees the confirmed one.
7. **Take a confirmation back (Story 4)**: Before any intermediate is stored, take the stats break
   back and confirm again. After submitting an intermediate, take it back: the warning names that
   quiz; go ahead; it is flagged until kept or set to not counted.
8. **What viewers see (Story 4)**: Set prelim results to places and scores, prelim standings to show
   live, quizzer standings by stage from the prelims being confirmed. Before saving, read what will
   change for viewers. Save, and follow division `1` through its day in the viewer window: each
   thing absent before its moment, quizzer standings changing only when a step is confirmed, marked
   preview until the meet is done and locked in after.
9. **Tie-break and level teams (Story 6)**: With two teams level on placement points, switch the
   tie-break order and see their ranks swap with the deciding criterion named, and the confirmed
   order untouched. With a prelim that ended level, switch how level teams are scored and see both
   teams' placement points change and return. Submit a quiz scored the other way: it carries a note;
   "Set them to match" gives it a new revision.
10. **Re-rank and Finals (Story 2)**: With X and Y in, the re-rank shows for their teams; confirm
    it. Move the division on to Finals, submit the Finals, mark the division done: its first three
    show. Marking the last division done offers moving the meet to review.
11. **The page and print (Story 5)**: Open division `1`'s stats on a phone-width window: place, name
    and ranking figure of each table fit. Print: one division on the sheet, quizzers with no jumps
    left off, the count of quizzers still including them.
12. **Check a number, and download (Story 8)**: As the viewer, open a quizzer and a team and add up
    the lines. As the admin, download the division's three files and open them in a spreadsheet.
13. **Rosters and names (Stories 2, 3 and 7)**: Submit a quiz with a quizzer under a nickname and a
    team left blank. The quiz is in error with two roster errors, each offering the roster's names,
    and adds nothing until they are fixed or the quiz accepted. Submit another with a roster team
    under its short name: it shows as one team with its full name. Merge the nickname into the
    roster name across the team's quizzes. Dismiss a look-alike flag for two real teams: it does not
    come back.
14. **Who may read (Story 4)**: With no code, the stats routes refuse. In `registration`, the viewer
    window shows nothing. As a room's official, quizzes of that room carry their problems; another
    room's do not.
15. **Scoresheet with the API down (principle I)**: Stop the API. Score, auto-save, save and load a
    quiz. Submit fails and says so, the sheet unchanged.
