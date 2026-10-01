# Contract: QuizFile versions

The `.json` quiz file and the auto-save in `localStorage` share this format. It is read by every
scoresheet install, including desktop builds that never update, so its versioning rule is a contract
with those installs.

## Rule: `version` is the version needed to read the file

A writer stamps each file with the **lowest** file version that can express its contents, not the
newest version the writer knows.

| Quiz contents    | Written as  | `quiz.format`             | Readable by                   |
| ---------------- | ----------- | ------------------------- | ----------------------------- |
| 20-question quiz | `version 2` | omitted                   | every install that reads v2   |
| 15-question quiz | `version 3` | `'15-question'`, required | installs with this feature on |

`FILE_VERSION` (3) is the newest version this build reads and writes. A future feature that adds
another field older readers would misinterpret raises it again and applies the same rule.

## Reading

| File                                 | Result                                                       |
| ------------------------------------ | ------------------------------------------------------------ |
| `version` 1 or 2                     | Loads as a 20-question quiz; one that names a `format` fails |
| `version` 3 with a known `format`    | Loads in that format                                         |
| `version` 3 without `format`         | Fails: the file is invalid                                   |
| `version` 3 with an unknown `format` | Fails, naming the unknown format                             |
| `version` above `FILE_VERSION`       | Asks to try anyway (below); otherwise nothing changes        |
| Not JSON, or fails schema validation | Fails with the schema message, as today                      |

Answers, no-jumps, timeouts, and question types are keyed by column key and interpreted under the
loaded format's columns, including enough overtime rounds to cover any saved overtime.

## Attempting a newer file (from this release onward)

When `version` is above `FILE_VERSION`, the reader asks before doing anything. If the official
agrees, it parses the file as the version needed for the contents this build understands (version 3
if it records a known format other than 20-question, otherwise version 2 with no format): unknown
fields are dropped, known fields must still validate, and an unknown `format` value still fails with
a message naming it. The quiz then shows a warning badge, which survives reloads and the tutorial,
until another quiz replaces it: a new quiz, or any file opened normally. Saving it writes what this
build understood, at the version needed to read that.

## Newer auto-save

A newer auto-save appears when a device goes back to an older build (a rolled-back install, or a
cached older web version). It is never attempted automatically and never deleted:

* On startup, an auto-save whose `version` is above `FILE_VERSION` is moved, unchanged, from
  `qzr-sheet:current` to its own key `qzr-sheet:newer-autosave:<ISO timestamp of the move>`, and the
  sheet starts empty. Each move gets a fresh key, so a kept auto-save is never overwritten.
* While any newer quiz is kept, set aside under `qzr-sheet:newer-autosave:*` or kept in place (see
  below), the sheet shows a notice (with the count when there are several) offering, for the first
  listed (quizzes kept in place first, then set-aside ones newest first): **Try to open it** (the
  attempt flow above, after the usual unsaved-changes confirmation; the kept original stays, since
  the opened copy has lost what this build can't read) and **Discard** (asks for confirmation, then
  removes its key). Only Discard removes a kept auto-save.
* Auto-saves of the empty sheet go to `qzr-sheet:current` as usual and never touch the kept keys.
* If the auto-save can't be moved (storage full), it stays under `qzr-sheet:current`, auto-save
  pauses so nothing overwrites it, and the notice says so. Starting a new quiz doesn't clear it;
  discarding it resumes auto-save.
* The tutorial's crash-recovery snapshot gets the same treatment: one from a newer version is set
  aside as a kept auto-save rather than deleted. If that fails it stays in place and is listed in
  the notice.
* While any newer quiz is kept in place, the tutorial won't start: those quizzes pin the slots its
  crash recovery and reset rely on. Only discarding it unblocks the tutorial; opening it doesn't,
  since the original stays kept. This is a deliberate trade-off (spec, Edge Cases).
* While auto-save is paused, crash recovery keeps its snapshot as the recovered quiz's copy until
  auto-save resumes and saves it. Otherwise it removes the snapshot after loading; a save that fails
  on a full disk isn't detected (#92).
* Discarding a kept quiz that was blocking auto-save saves the current sheet straight away, so work
  done while auto-save was paused survives a reload.

Other unreadable auto-saves (corrupt JSON, schema failures) are handled as today; this feature does
not change that path.

## Older installs (behaviour fixed in already-shipped builds)

* Open a version 2 file from a newer install exactly as before.
* Refuse a version 3 file with their schema error (their schema accepts only versions 1 and 2). They
  cannot show the friendlier newer-version message; installs from this feature onward can.

## Contract version

`@qzr/shared` 0.10.0 to **1.0.0** (MAJOR): readers of the old contract cannot read every file the
new contract writes. Commit marked breaking, `feat!:` (unscoped, as it also changes the scoresheet).
Consumers name `@qzr/shared@1.0.0` under `### Bundled contract` at their next release; this feature
releases the scoresheet and web with it.
