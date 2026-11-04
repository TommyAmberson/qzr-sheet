# Contract: API changes

Linked schedules only; a standalone schedule never calls the API. Access terms are in
`docs/roles-and-access.md`. Every route below takes `:id`, the meet id, and authorises the caller
for that meet before reading or writing (Principle IV).

## `GET /api/meets/:id/schedule`

Admins and superusers (FR-051).

* 200: `{ draft, draftRevision, draftSavedAt, published, publishedAt, version, results }`. `draft`
  and `published` (the newest version, with its number) are schedule documents
  ([schedule-file.md](./schedule-file.md)); `published` is null before the first publish. `results`
  lists the result names (`quizKey`) that have submitted results, so the builder can protect them
  (H-20).
* A meet that never had a schedule document but has rows in the old schedule tables is converted
  first (research R5): every quiz pinned, placeholder elim seats empty, stored as both draft and
  published. Quiz ids keep the old row ids, so links already shared still resolve. The builder
  passes its time zone as `?timeZone=`, which places the old slots' instants on the meet's days.
* A meet with neither: 200 with `draft: null`; the builder starts a schedule from the meet.

## `PUT /api/meets/:id/schedule/draft`

Admins and superusers.

* Body: `{ document, baseRevision, replace }`. 400 when the draw names a team that isn't the meet's.
  Revisions start again after an unlink, so a save over a different draft (another document id) is
  refused with the 409 below even at a matching revision, unless `replace` is true, which the
  builder sends when the director keeps their own draft.
* 200: `{ draftRevision, draftSavedAt }`.
* 409 when `baseRevision` isn't the current revision: `{ error, draft, draftRevision }`, so the
  builder can show the newer draft in the page (FR-007).
* 400 when the document fails validation, with the reason.
* A draft may differ from the meet's registration and rooms; the builder shows where (FR-042,
  FR-046). The meet's divisions, teams and rooms come from the existing `GET /api/meets/:id`,
  `/teams` and `/rooms` routes.

## `POST /api/meets/:id/schedule/publish`

Admins and superusers.

* Body: `{ baseRevision, confirmConflicts }`.
* Adds the draft as the next version (FR-049a). With hard conflicts and `confirmConflicts` not true:
  409 `{ conflicts }`, so the builder can list them and ask in the page (FR-049); with it true, or
  with only warnings, it publishes. Never refused for conflicts alone.
* 200: `{ version, publishedAt, draftRevision, draftSavedAt, rooms, unusedRooms }`. Publishing fills
  in each room's `meetRoomId`, so the draft is saved with them and `rooms` carries them back.
* Publishing makes the meet's rooms match the schedule's (FR-047): new rooms are added without an
  official code, renamed rooms are renamed, and a room the schedule no longer uses is removed unless
  it has an official code, officials or results, in which case it's kept and listed in the response
  as unused, so no official is locked out mid-meet.

## `GET /api/meets/:id/schedule/versions`

Admins and superusers. 200: `[{ version, publishedAt, publishedBy }]`, newest first, with the
admin's name for `publishedBy`.

## `GET /api/meets/:id/schedule/versions/:version`

Admins and superusers. 200: `{ version, publishedAt, publishedBy, document }`; 404 if there's no
such version.

## `POST /api/meets/:id/schedule/versions/:version/restore`

Admins and superusers. Body `{ baseRevision }`. Copies the version into the draft, as a draft save
does (same 409 on a stale revision); publishes nothing. 200: `{ draftRevision, draftSavedAt }`.

## `DELETE /api/meets/:id/schedule`

Admins and superusers. Unlinks (FR-048): removes the meet's draft row. Published versions stay, so
the record of what was out isn't lost; the builder keeps its copy as a standalone schedule.

## `GET /api/meets/:id/schedule/published`

Anyone with access to the meet: a membership, a guest token for the meet, or superuser.

* 200: `{ document, publishedAt, view, meetName }`, where `view` is `letters` or `teams`, set by the
  meet's phase for non-admins (FR-052): letters in `registration` and `build`, team names in `live`,
  `review` and `done`. In letters view the draw keeps only its letters, in letter order: team names,
  team ids and late or absent marks are removed before it's sent. The old `/prelim-assignments` and
  `/quizzes/:quizId/teams` routes follow the same view. Admins get `teams` and may ask for either.
* A meet still on the old schedule tables, which no admin has opened in the builder yet, is read as
  the conversion would read it, in the time zone the reader passes as `?timeZone=`, and nothing is
  stored.
* 404 when nothing is published.
* Replaces `GET /:id/slots`, `/:id/quizzes`, `/:id/prelim-assignments` and
  `/:id/quizzes/:quizId/teams` for the portal viewer and the scoresheet's picker (FR-050). The
  picker resolves a quiz's teams from the published document with the shared functions.

## Retired and kept

* `POST /api/meets/:id/schedule/sync` is removed with the old editor, its only caller. The old
  editor's room `PATCH` stops being called, and is removed with the old tables after every meet has
  been converted (research R5).
* `GET /:id/rooms`, `/:id/slots`, `/:id/quizzes`, `/:id/quizzes/:quizId/teams` and
  `/:id/prelim-assignments` stay, answering from the newest published version in their current
  shapes (a meet not yet converted still reads the old tables), because installed scoresheets call
  them for their picker. They go once no supported scoresheet release calls them.
