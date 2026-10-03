# Contract: meet results API

HTTP routes under `/api/meets/:meetId`, JSON bodies, errors as `{ error: string }` like the existing
routes. Every route authorises the caller for that meet (principle IV): **admin** means a meet admin
membership or superuser; **official** means an official guest token for this meet carrying a room
(R4), or a signed-in official membership for the named room.

Mounted so that guest tokens reach it (the schedule routers require an account session).

## Stored quizzes

### `POST /results` (official, or admin uploading from the portal)

Submit a quiz. Body: `{ quizFile, roomId?, onExisting? }`. `roomId` is required for a signed-in
official, ignored for a guest (the token's room is used), and absent for an admin upload. The
scoresheet only submits as an official; an admin saves from the scoresheet with `PUT`.

A quiz not tied to the schedule is identified by its name: division, consolation and quiz number,
folded for case and spaces.

* 201 `{ id, revision: 1, created: true }` for a name the meet doesn't have yet. Action is
  `submitted` for an official, `uploaded` for an admin.
* 409
  `{ error: "D1 Q3 was already submitted", existing: { id, name, revision, savedBy: { name }, savedAt } }`
  for a name the meet already has, whichever room sent it.
* 200 `{ id, revision, created: false, keptCurrent }` when sent again with `onExisting`:
  `"newRevision"` makes the submission the new current revision; `"keepCurrent"` stores it as
  `revision`, then adds a revision restoring what was current, which stays current. Any other value
  is answered with the 409 again.
* 400 with the parser's message if the file is invalid; 422 "This file was saved by a newer version
  of the scoresheet" if it is newer than the API understands (R6).
* 401 / 403 if the caller isn't an official or admin of this meet; 403 "Rejoin with your room code"
  for an official token without a room, or from a room code since rotated.

### `PUT /results/:id` (admin)

Edit a stored quiz: save a new revision of it. Officials resubmit by name through `POST`. Body:
`{ quizFile, action? }`. `action` may be `merged`, to label a merge (R10); otherwise it is `edited`.

* 200 `{ id, revision }`.
* 400 / 422 as above. 409 if the edit renames it to another stored quiz's name. 404 if not in this
  meet.

### `POST /results/:id/restore` (admin)

Body: `{ revision }`. Adds a `restored` revision restoring that one (FR-005a); no file is copied.
Restoring a revision that itself restores another points the new revision at the file it restores,
so content is never more than one step away. Restoring the content that is already current adds
nothing and answers with the current revision.

* 200 `{ id, revision }`. 404 if the revision doesn't exist.

### `GET /results` (admin)

Every stored quiz of the meet with its current content:

```text
[{ id, origin: { action, name }, counted, revision, savedAt,
   savedBy: { name }, action, quizFile }]
```

`origin` is the first revision's action and saver, so a quiz still says where it came from after its
room is deleted. `counted` is the quiz's newest counting record, false when it has none. The portal
groups by the file's division and derives names and scores from the file.

### `GET /results/:id/revisions` (admin)

The quiz's history, newest first, interleaving saves and counting records:

```text
[{ kind: 'revision', revision, action, restoredFrom?, savedBy: { name }, savedAt }
 | { kind: 'counting', counted, changedBy, changedAt }]
```

### `GET /results/:id/revisions/:revision` (admin)

`{ revision, quizFile, restoredFrom? }` for viewing or opening an earlier revision. A revision that
restores another returns the file it restores, with `restoredFrom` naming that revision.

## Counting

### `PATCH /results/counted` (admin)

Body: `{ ids: number[], counted: boolean }`. Sets each listed quiz of this meet; writes a counting
record only for quizzes whose value changes (data model).

* 200 `{ changed: number[] }`. 404 if any id isn't in this meet (nothing is changed).

## Team names (Story 6)

### `GET /team-names` (any member or guest of the meet)

`[{ division, names: string[] }]` in sort order. Officials read it to fill the scoresheet's
dropdown.

### `PUT /team-names` (admin)

Body: `[{ division, names: string[] }]`. Replaces the meet's list.

* 200 with the saved list. 400 if a division repeats a name after case and space folding.

## Guest join

`POST /api/join` with an official code now returns a token whose payload includes the room's id and
a tag of the room's current code (R4), so rotating the code or deleting the room revokes it. Its
response is otherwise unchanged.
