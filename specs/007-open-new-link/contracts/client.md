# Contract: what the scoresheet offers and reads

This feature exposes nothing new to other systems. It changes the scoresheet's own interface, and
reads server routes that already exist. Both are fixed here so tasks and tests can cite them.

## Menus

| Menu | Item                   | Does                                                               | Needs network |
| ---- | ---------------------- | ------------------------------------------------------------------ | ------------- |
| New  | New 20-question quiz   | blank quiz; keeps the meet link, drops the scheduled quiz link     | no            |
| New  | New 15-question quiz   | the same, 15 questions                                             | no            |
| New  | New from schedule…     | pick a scheduled quiz; blank 20-question quiz linked to it, filled | yes           |
| New  | Clear answers          | as today                                                           | no            |
| New  | Clear names            | blanks every name; unpicks a linked meet's teams                   | no            |
| Open | From file…             | as today (Ctrl+O); unlinks the meet and the scheduled quiz         | no            |
| Open | From the meet…         | pick a stored quiz; open it, then link the meet                    | yes           |
| Open | From the schedule…     | pick a scheduled quiz; open its stored quiz, then link it          | yes           |
| Link | Link a meet…           | pick a meet; link it                                               | yes           |
| Link | Link a scheduled quiz… | pick a scheduled quiz; link it and its meet                        | yes           |
| Link | Unlink quiz            | drop the scheduled quiz link; keep meet and picks                  | no            |
| Link | Unlink meet            | drop both links and the picks; keep everything typed               | no            |

Removed: "Load teams from meet…" and "Load from schedule…".

## Linked display

One place in the header: the linked meet's name, then the linked scheduled quiz's label when there
is one, then the refresh symbol (a circling arrow) with tooltip and accessible label **"Refetch
names from the meet and schedule"**. It opens the Link menu. Unlinked, it offers the Link menu
without a name or the symbol.

## Questions asked

| When                                                        | Asked                                             | Choices                          |
| ----------------------------------------------------------- | ------------------------------------------------- | -------------------------------- |
| New or Open with unsaved changes                            | that unsaved changes will be lost                 | go on, cancel                    |
| New from schedule, quiz has a stored result the person sees | that a result is stored for it                    | open it, start a new one, cancel |
| Open from the schedule, nothing stored                      | that nothing is stored for it                     | start it as a new quiz, cancel   |
| Open from the schedule, person may not see stored quizzes   | that nothing is stored for it that they can open  | start it as a new quiz, cancel   |
| Open from the meet, person may not see stored quizzes       | told so; nothing to choose                        | close                            |
| Any network action that fails                               | told the meet can't be reached; nothing to choose | close                            |

"Unsaved changes" means answers not yet saved, or names typed since the sheet was last saved,
started or opened. Names a link filled in when the quiz was started or opened don't count.

While any of these actions, a link, or the refresh symbol waits on the meet, the sheet shows that it
is waiting, with Cancel as the only thing that can be done. Cancelling leaves the sheet, the picks
and both links as they were. No question is asked before linking, including linking another meet.

## Warning lines added

Listed and counted with the roster warnings of `docs/meet-link.md`, in the warnings dialog and in
the submit question. Each offers the fix named beside it; none blocks.

| Line                                     | When                                               | Fix offered                                      |
| ---------------------------------------- | -------------------------------------------------- | ------------------------------------------------ |
| `Division 1: schedule has 2`             | division differs from the scheduled quiz's         | Set division to 2                                |
| `Quiz 4: schedule has 3`                 | quiz number differs                                | Set quiz to 3                                    |
| `Team 2: Lions 1, schedule has Tigers 2` | slot's team isn't the scheduled seat's             | Move Tigers 2 to Team 2 (swaps with Lions 1), or |
|                                          |                                                    | Replace Lions 1 with Tigers 2 when Tigers 2 is   |
|                                          |                                                    | not on the sheet                                 |
| `Team 3: blank, schedule has Bears 1`    | slot blank where the schedule seats a team         | Put Bears 1 in Team 3, or the move               |
| `Quiz: no longer in the meet's schedule` | the published schedule has dropped the linked quiz | Unlink quiz                                      |

A consolation flag that differs is reported and fixed with the division, as one line. A blank slot
the schedule seats shows its schedule line only, not the roster's "no team picked" as well. An
undecided seat raises nothing. With no scheduled quiz linked there are no schedule lines.

## Portal links (unchanged)

| Link                                    | Now means                                     |
| --------------------------------------- | --------------------------------------------- |
| `?meetId=<id>&quiz=<id>`                | New from schedule for that quiz               |
| `?meetId=<id>&result=<id>&revision=<n>` | Open from the meet, that version              |
| `?meet=<id>&…`                          | the same, in links shared by earlier releases |

The parameters are removed from the address after use, as today.

## Server routes read (all existing)

| Route                                                      | Used for                                  | Refuses                               |
| ---------------------------------------------------------- | ----------------------------------------- | ------------------------------------- |
| `GET /api/meets/:id/schedule/published`                    | schedule pickers, the scheduled quiz copy | 404 when nothing is published         |
| `GET /api/meets/:id/teams`                                 | roster teams and divisions                | anyone who may not view the meet      |
| `GET /api/teams/:id/quizzers`                              | a team's roster                           | the same                              |
| `GET /api/meets/:id/results`                               | stored quizzes with their current files   | 403 unless admin or a room's official |
| `GET /api/meets/:id/results/:resultId/revisions`           | a stored quiz's earlier versions          | the same                              |
| `GET /api/meets/:id/results/:resultId/revisions/:revision` | one version's file                        | the same                              |

The scoresheet adds client calls for the two it doesn't call yet (the list and a quiz's versions). A
403 from the list is how the sheet learns the person may not see stored quizzes; it does not
second-guess the server's rule.
