# Contract: what the scoresheet shows and keeps

This feature exposes nothing to other systems: no route, no file format and no shared type changes.
It changes the scoresheet's own interface and its on-device storage. The storage layout is fixed in
[data-model.md](../data-model.md), because later versions read it. The interface is fixed here, so
tasks and tests can cite it.

## Menus

| Menu | Item            | Does                                                     | Needs network |
| ---- | --------------- | -------------------------------------------------------- | ------------- |
| Open | Recent quizzes… | opens the recent quizzes dialog in its list form (below) | no            |

Every other item stays as 007 left it, with two changes in behaviour:

* **New, Open (all sources) and restoring never ask about unsaved changes** (FR-019). The quiz they
  replace goes to the recent quizzes first.
* **Open continues a recent quiz** whose state matches what is opened, with its link and undo
  history (FR-023). Otherwise it opens as today.
* **Undo and redo cover every change to the quiz** (FR-020): names, on-time marks, quizzer order,
  question types and the quiz's settings join answers, no-jumps, timeouts and team swaps. A visit to
  a typed field undoes as one step. Clear answers and Clear names are undoable and no longer empty
  the history.

## The recent quizzes dialog

One dialog, in two forms.

| Form  | Opened by                                        | Lists                                        | Other actions                               |
| ----- | ------------------------------------------------ | -------------------------------------------- | ------------------------------------------- |
| Offer | a new tab with unsaved quizzes to offer (FR-010) | unsaved recent quizzes not yet offered       | **Start a blank quiz** (closes it, offered) |
| List  | Open ▸ Recent quizzes…, or a notice's link       | every recent quiz: unsaved first, then saved | **Discard all**; **Close**                  |

**A row** names the quiz as files and the meet do (`quizName`: division and number), its teams, its
number of answers, and when it was last changed, as "today 14:02", "yesterday 09:15" or a date. Then
its kind:

* the current state of an unsaved quiz: **Unsaved**, marked so it stands out;
* the current state of a saved quiz: no mark;
* a saved state that differs from the current one: **As saved to a file**;
* a submitted state that differs from the current one: **As submitted to `<meet>`**;
* a newer version's quiz: **From a newer version**.

A quiz's rows sit together, its current state first. Each row has **Restore** and **Discard**.

| Action      | Asks first                                                                         | Then                                                                                                                                  |
| ----------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Restore     | only for a newer version's quiz: as today, that it may be scored wrong             | the tab shows it in that state, with the link it had there (as submitted: the link it was sent with); the tab's quiz goes to the list |
| Discard     | "Discard `<quiz>`? All its states go, and this cannot be undone."                  | the quiz is gone                                                                                                                      |
| Discard all | "Discard every recent quiz? Quizzes open in tabs are kept. This cannot be undone." | every recent quiz is gone                                                                                                             |

With no recent quizzes, the list form says **"No recent quizzes."** An offer whose quizzes were all
taken by other tabs meanwhile says **"Nothing left to restore."**

## Notices

Shown in the notice row under the header, as notices are today, each closable.

| When                                                                                        | Says                                                                     |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| a tab opened by a link, with unsaved quizzes not yet offered (FR-011), which stay unoffered | "`<n>` unsaved quizzes from closed tabs." with a link **See them**       |
| unsaved quizzes were dropped to stay within 80 (FR-009), once                               | "`<quiz>`, `<quiz>` were removed from recent quizzes to make room."      |
| Open matched a quiz open in another tab (FR-023)                                            | "This quiz is open in another tab. It opened here as a separate quiz."   |
| restore found the quiz taken by another tab meanwhile                                       | "That quiz was just opened in another tab." and the list stays open      |
| the device refused a write for lack of room, after dropping saved recent quizzes (R10)      | "This quiz can't be kept on this device: it is full. Save it to a file." |
| any other write of the tab's quiz failed                                                    | "This quiz couldn't be kept on this device. Save it to a file."          |

The header notice for a newer version's kept auto-save goes; such quizzes are rows (FR-016).

## Not changed

* Quiz files, submissions and every route read or written: undo history is never in them (FR-021).
* The questions 007 asks that are not about unsaved changes (a stored result exists, nothing stored,
  the newer-file prompt).
