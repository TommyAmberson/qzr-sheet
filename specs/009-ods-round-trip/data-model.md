# Data model: ODS round trip for meet results

One new table. Everything else this feature touches is stored as it is today: quiz results and their
revisions (`docs/data-model.md`), and the roster tables the import writes.

## Meet template (new)

The scoring template a meet admin uploaded for the meet (spec FR-013). One per meet; uploading again
replaces it.

| Field          | Type              | Rule                                                                                        |
| -------------- | ----------------- | ------------------------------------------------------------------------------------------- |
| `meetId`       | integer, key      | The meet; one row per meet. Deleted with the meet.                                          |
| `fileName`     | text              | As uploaded, for display ("Scoresheet.ots")                                                 |
| `bytes`        | blob              | The template, as uploaded. Refused unless it holds a Quiz sheet (research R3), or over 2 MB |
| `uploadedAt`   | timestamp         | When it was last uploaded                                                                   |
| `uploadedById` | account, nullable | Who uploaded it; kept null if that account goes                                             |

Lifecycle: absent until an admin uploads one; replaced by each upload; gone with the meet. Files
already downloaded from an earlier template are not tracked.

`docs/data-model.md` gains this table in the same pull request (Principle II).

## Upload batch (browser only, not stored)

What the upload review (spec Story 3) holds between picking files and sending them.

| Field          | Meaning                                                                           |
| -------------- | --------------------------------------------------------------------------------- |
| file name      | As picked                                                                         |
| quiz file      | Read from `.json` or `.ods`; absent when the file can't be read (reason kept)     |
| quiz name      | The quiz's `resultKey`, from its division, consolation flag and number            |
| scheduled quiz | The published schedule's quiz of that name, one the uploader picked, or none      |
| room           | The scheduled quiz's room (admin batch), or the uploader's chosen room            |
| duplicate      | Another file in the batch has the same quiz name                                  |
| outcome        | After sending: stored, new revision, kept current, unchanged, skipped, or refused |

Picking a scheduled quiz for a file rewrites the file's division, consolation flag and number to
that quiz's before it is sent (research R7). Nothing else in the file changes.

## Reading rule: bonus to an empty seat

When a sheet marks `mb` on a seat with no quizzer, the read quiz has a no-jump on that question's
column instead (spec FR-005). Recorded here because it changes what a read quiz holds, though not
the `QuizFile` format.
