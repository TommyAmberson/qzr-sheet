# Data model: Each scoresheet tab keeps its own quiz, and recent quizzes are kept

Everything here is on the device, in the scoresheet's own storage. Nothing changes on the server, in
the quiz file format, or in `packages/shared`. Names given here are fixed because records outlive a
release: a later version must read what this one wrote.

## Storage at a glance

| Where                             | What                                                                       | Shared by   |
| --------------------------------- | -------------------------------------------------------------------------- | ----------- |
| IndexedDB `qzr-sheet`, `quizzes`  | quiz records: every tab's own quiz and every recent quiz                   | every tab   |
| IndexedDB `qzr-sheet`, `meta`     | bookkeeping: dropped unsaved quizzes not yet announced; migration done     | every tab   |
| `sessionStorage` `qzr-sheet:quiz` | the id of the record this tab shows                                        | one tab     |
| Web Lock `qzr-sheet:quiz:<id>`    | held by the tab showing record `<id>`; free means the record is recent     | the browser |
| Web Lock `qzr-sheet:migrate`      | held while one tab moves the previous version's keys into records          | the browser |
| `localStorage`, existing keys     | sign-in, guest sessions, team names, last meet submitted to, theme (as is) | every tab   |

Removed once moved (research R11): `qzr-sheet:current`, `qzr-meet-session`,
`qzr-sheet:opened-from-newer-file`, `qzr-sheet:newer-autosave:*`, `qzr-sheet:tutorial-snapshot`,
`qzr-sheet:tutorial-meet-snapshot` and the tutorial's newer-file flag.

## Quiz record (`quizzes`, keyed by `id`)

One quiz in the spec's sense (FR-022): one undo history, begun by New or by an Open that matched
nothing.

| Field           | Type                            | Meaning                                                                                                                                            |
| --------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`            | string                          | random, made when the record begins                                                                                                                |
| `current`       | state with undo and redo steps  | the quiz as last shown                                                                                                                             |
| `start`         | canonical quiz file             | the state the quiz began in, after names a link filled in before any edit by hand (R8)                                                             |
| `saved`         | state with undo steps, optional | the state last saved to a file in, or opened from a file in; absent when there is none                                                             |
| `submitted`     | state with undo steps, optional | the state last sent to, or opened from, the meet, with `meetId`, `quizId` (the scheduled quiz, or null) and `link`, the meet link it was sent with |
| `ahead`         | state with undo steps, optional | while the record is positioned behind its latest state (after Open or restore matched an earlier one): that latest state (R7)                      |
| `link`          | meet session, or null           | the meet link as `useMeetSession` keeps it today (`MeetSessionData`), moved here from `qzr-meet-session`                                           |
| `fromNewerFile` | boolean                         | the quiz came from a newer version's file and may be scored wrong (today `qzr-sheet:opened-from-newer-file`)                                       |
| `newerRaw`      | string, optional                | only for a newer version's auto-save that this version cannot read: its raw text; such a record has no `current`                                   |
| `unsaved`       | boolean                         | derived when written: `current` matches neither `saved` nor `submitted` (R4); kept so listing and the limits need not compare states               |
| `changedAt`     | number (ms since epoch)         | when `current` last changed; orders the list and the limits                                                                                        |
| `offered`       | boolean                         | already offered to a new tab, or replaced rather than left by a closed tab (R9)                                                                    |

**A state** is a canonical quiz file (research R4) with the undo steps that led to it, and for
`current` also its redo steps. Steps are oldest first, at most 1000 (FR-020).

**An undo step** records, for each part of the quiz an edit changed, its value before and after. The
parts are one answer, one no-jump, one team's timeouts, one question type, one field of a team or
quizzer, and one quiz setting; a part absent before or after is empty. Every change to these parts
after the quiz's start is in a step (FR-020): a visit to a typed field is one step, and Clear
answers and Clear names are one step each. Undo writes the before values, redo the after values.
What a step does outside the quiz (the meet picks a team swap moves) is not stored (research R5).

### Rules

* **Saved** (FR-009): `current`'s file equals `saved`'s, or equals `submitted`'s while `link` names
  the same meet and scheduled quiz. Unsaved otherwise.
* **Kept** (FR-008): a record is a recent quiz only while it has `saved` or `submitted`, its undo or
  redo steps are not empty, or `current`'s file differs from `start`. A tab writes its record either
  way, so a reload brings back the quiz and its link (FR-002); one that isn't kept is never listed,
  offered or matched, and is deleted once no tab holds it.
* **One per quiz** (FR-008): a record is written over in place; continuing it by Open or restore
  claims the same record.
* **Matching an Open** (FR-023): the opened file, canonical, equals `current`'s, `saved`'s or
  `submitted`'s file of a recent record (for `submitted`, from the meet and with the same scheduled
  quiz too). The most recent `changedAt` wins among records the tab can claim. The tab's own record,
  the one the Open replaces, is never a match.
* **Rows** (FR-013): a recent record lists one row for `current` and one each for `saved` and
  `submitted` when present; states with equal files show as one row. Restoring a `submitted` row
  sets the record's `link` from it; other rows keep the record's `link`.
* **Limits** (FR-009): among recent records, at most 80 with `unsaved` true and 40 with it false;
  the least recent `changedAt` beyond that is deleted. A record's rows count once.

## States of a record

```text
              New / Open (no match)                        tab closes or crashes
(none) ───────────────────────────────▶ in a tab ────────────────────────────────▶ recent
                                        (locked)  ◀──────────────────────────────── (unlocked)
                                           │  ▲   restore, Open match, reload, offer
         New / Open / restore replaces it  │  │
         (marked offered)                  ▼  │
                                         recent
```

* **In a tab ⇄ recent** is only the lock: nothing is written when a tab closes (research R2).
* **Not kept**: a record whose state is still its start, with no undo or redo steps and nothing
  saved or submitted, is written for its tab's reload only; once no tab holds it, the next pass that
  keeps the limits deletes it.
* **Positioned behind**: after Open or restore matches `saved` or `submitted` rather than `current`,
  the old `current` moves to `ahead` and the matched state becomes `current`, with the steps between
  as redo when the histories join. Redoing up to `ahead` clears it. The first edit while `ahead` is
  set (a Clear is an edit), which drops any redo steps, first writes `ahead`, with its history, its
  `saved` and `submitted` where they are not the matched one, and the same `link`, as a new recent
  record, then clears it (FR-023).
* **Duplicated**: a tab whose `sessionStorage` names a record it cannot lock within a second takes a
  new id's lock, writes a copy under it, `offered` false, and shows that (FR-004): the copy is a
  tab's own quiz, offered once its tab closes like any other (FR-010).
* **From a newer version**: a record whose `current` file a newer version wrote (a downgrade) is
  turned, when a tab reloads into it, lists it or offers it, into one holding that file as
  `newerRaw`, with no `current`, so it is listed and opened with a warning and never shown blank and
  written over (FR-016); the tab begins a new record.
* **Discarded**: deleted, from the list one at a time or all at once (FR-014). Records locked by a
  tab are never touched by "Discard all".

## Bookkeeping (`meta`)

| Key        | Type     | Meaning                                                                |
| ---------- | -------- | ---------------------------------------------------------------------- |
| `dropped`  | string[] | quiz names of unsaved quizzes dropped by the limits, not yet announced |
| `migrated` | boolean  | the previous version's keys were moved (R11)                           |
