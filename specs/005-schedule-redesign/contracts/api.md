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
* A meet with no `meet_schedules` row but with rows in the old schedule tables is converted first
  (research R5): every quiz pinned, placeholder elim seats empty, stored as both draft and
  published. Quiz ids keep the old row ids, so links already shared still resolve.
* A meet with neither: 200 with `draft: null`; the builder starts a schedule from the meet.

## `PUT /api/meets/:id/schedule/draft`

Admins and superusers.

* Body: `{ document, baseRevision }`.
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
* 200: `{ version, publishedAt }`.
* Publishing makes the meet's rooms match the schedule's (FR-047): new rooms are added without an
  official code, renamed rooms are renamed, and a room the schedule no longer uses is removed unless
  it has an official code, in which case it's kept and listed in the response as unused, so no
  official is locked out mid-meet.

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

* 200: `{ document, publishedAt, view }`, where `view` is `letters` or `teams`, set by the meet's
  phase for non-admins (FR-052): letters in `registration` and `build`, team names in `live`,
  `review` and `done`. In letters view the draw's team names are removed from the document before
  it's sent. Admins get `teams` and may ask for either.
* 404 when nothing is published.
* Replaces `GET /:id/slots`, `/:id/quizzes`, `/:id/prelim-assignments` and
  `/:id/quizzes/:quizId/teams` for the portal viewer and the scoresheet's picker (FR-050). The
  picker resolves a quiz's teams from the published document with the shared functions.

## Retired and kept

* `POST /api/meets/:id/schedule/sync` and the old editor's room `PATCH` stop being called once the
  builder ships, and are removed with the old tables after every meet has been converted (research
  R5).
* `GET /:id/rooms`, `/:id/slots`, `/:id/quizzes` and `/:id/quizzes/:quizId/teams` stay, answering
  from the newest published version in their current shapes, because installed scoresheets call them
  for their picker. They go once no supported scoresheet release calls them.
