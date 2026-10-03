# Contract: meet results API

HTTP routes under `/api/meets/:meetId`, JSON bodies, errors as `{ error: string }` like the existing
routes. Every route authorises the caller for that meet (principle IV): **admin** means a meet admin
membership or superuser; **official** means an official guest token for this meet carrying a room
(R4), or a signed-in official membership for the named room. A stored quiz's **room official** is an
official of any room a revision of it was saved for; an account may officiate several rooms, and
saving a quiz's name for a room, after the 409, makes that room's officials its room officials too.

Mounted so that guest tokens reach it (the schedule routers require an account session).

## Stored quizzes

### `POST /results` (official, or admin)

Submit or upload a quiz. Body: `{ quizFile, roomId?, onExisting?, upload? }`. `roomId` is required
for a signed-in official and must be one of their rooms; it is ignored for a guest (the token's room
is used); an admin may name any room of the meet, or none. `upload: true` marks a file sent without
being opened. The scoresheet's Submit and Save to meet send a quiz this way, by name, for officials
and admins alike, so the scoresheet never needs to remember which stored quiz it opened (R8). The
room it is sent for gets access to the stored quiz.

A quiz not tied to the schedule is identified by its name: division, consolation and quiz number,
folded for case and spaces.

* 201 `{ id, revision: 1, created: true }` for a name the meet doesn't have yet. Action is
  `uploaded` with `upload`; otherwise `submitted` when sent for a room, and `edited` for an admin
  sending it for no room. An admin sending for a room is saved as "Pat, Room 2".
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

### `PUT /results/:id` (admin, or the room official)

Edit a stored quiz in place: save a new revision of it. Only the portal's short form and merge use
it, because they change a quiz's name or details; the scoresheet saves by name through `POST`. Body:
`{ quizFile, action? }`. `action` may be `merged`, to label a merge (R10); otherwise it is `edited`.
A room official's edit is recorded for one of their rooms the quiz already has, the first by room
order, so an edit never gives the quiz a new room.

* 200 `{ id, revision }`.
* 400 / 422 as above. 409 if the edit renames it to another stored quiz's name. 404 if not in this
  meet.

### `POST /results/:id/restore` (admin, or the room official)

Body: `{ revision }`. Adds a `restored` revision restoring that one (FR-005a); no file is copied.
Restoring a revision that itself restores another points the new revision at the file it restores,
so content is never more than one step away. Restoring the content that is already current adds
nothing and answers with the current revision. A room official's restore is recorded for a room as
an edit is (`PUT`). The quiz takes the restored content's name again, as an edit would, so a
restored name finds it.

* 200 `{ id, revision }`. 404 if the revision doesn't exist. 409 if another quiz has since taken the
  restored content's name.

### `GET /results` (admin, or official)

Every stored quiz of the meet with its current content; for an official, only the quizzes with a
revision saved for a room they officiate:

```text
[{ id, origin: { action, name }, counted, revision, savedAt,
   savedBy: { name }, action, quizFile }]
```

`origin` is the first revision's action and saver, so a quiz still says where it came from after its
room is deleted. `counted` is the quiz's newest counting record, false when it has none. The portal
groups by the file's division and derives names and scores from the file.

### `GET /results/sender` (admin, or official)

Who the caller is when sending to the meet, as the routes above decide it, so neither app works it
out for itself: `{ admin, rooms: [{ id, name }] }`, with every room of the meet for an admin and the
caller's own rooms for an official (a guest official's token room). 401 / 403 for anyone else.

### `GET /results/:id/revisions` (admin, or the room official)

The quiz's history, newest first, interleaving saves and counting records:

```text
[{ kind: 'revision', revision, action, restoredFrom?, savedBy: { name }, savedAt, current,
   quizFile }
 | { kind: 'counting', counted, changedBy: { name }, changedAt }]
```

Each save carries its file (a restoring revision's is the file it restores), so the history needs no
further requests, and `current` marks the saves showing the quiz's current content. Times are to the
millisecond; a count made in the same millisecond as a save is taken as the newer of the two, as
counting a quiz follows saving it.

### `GET /results/:id/revisions/:revision` (admin, or the room official)

`{ quizFile }`, for the scoresheet to open a revision. A revision that restores another gives the
file it restores.

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
