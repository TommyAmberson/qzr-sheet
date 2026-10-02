# Contract: meet results API

HTTP routes under `/api/meets/:meetId`, JSON bodies, errors as `{ error: string }` like the existing
routes. Every route authorises the caller for that meet (principle IV): **admin** means a meet admin
membership or superuser; **official** means an official guest token for this meet carrying a room
(R4), or a signed-in official membership for the named room.

Mounted so that guest tokens reach it (the schedule routers require an account session).

## Stored quizzes

### `POST /results` (official, or admin uploading from the portal)

Store a new quiz. Body: `{ quizFile, roomId? }`. `roomId` is required for a signed-in official,
ignored for a guest (the token's room is used), and absent for an admin upload. The scoresheet only
submits as an official; an admin saves from the scoresheet with `PUT`.

* 201 `{ id, revision: 1 }`. Action is `submitted` for an official, `uploaded` for an admin.
* 400 with the parser's message if the file is invalid; 422 "This file was saved by a newer version
  of the scoresheet" if it is newer than the API understands (R6).
* 401 / 403 if the caller isn't an official or admin of this meet; 403 "Rejoin with your room code"
  for an official token without a room.

### `PUT /results/:id` (official of its room, or admin)

Save a new revision of the quiz. Body: `{ quizFile, action? }`. `action` may be `merged` from an
admin, to label a merge (R10); otherwise the action is `submitted` for an official and `edited` for
an admin.

* 200 `{ id, revision }`.
* 400 / 422 as above. 403 if an official's room isn't the quiz's room. 404 if not in this meet.

### `POST /results/:id/restore` (admin)

Body: `{ revision }`. Copies that revision into a new `restored` revision (FR-005a).

* 200 `{ id, revision }`. 404 if the revision doesn't exist.

### `GET /results` (admin)

Every stored quiz of the meet with its current content:

```text
[{ id, roomId, roomName, counted, revision, savedAt,
   savedBy: { kind: 'account' | 'room', name },
   action, quizFile }]
```

The portal groups by the file's division and derives names and scores from the file.

### `GET /results/:id/revisions` (admin)

The quiz's history, newest first, interleaving saves and counting records:

```text
[{ kind: 'revision', revision, action, restoredFrom?, savedBy, savedAt }
 | { kind: 'counting', counted, changedBy, changedAt }]
```

### `GET /results/:id/revisions/:revision` (admin)

`{ revision, quizFile }` for viewing or opening an earlier version.

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

`POST /api/join` with an official code now returns a token whose payload includes the room's id
(R4). Its response is otherwise unchanged.
