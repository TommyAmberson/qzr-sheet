# API contract: ODS round trip

Additions and changes to `packages/api`. Everything not listed is unchanged. Access follows
`docs/roles-and-access.md`; "full-roster readers" are whoever the meet's roster routes admit
(`isViewerOf`: the meet's guests, officials among them, its members, and superusers).

## Meet template

### `GET /api/meets/:id/template`

Who: full-roster readers, the meet's officials (account or guest token), admins, superuser.

* `200` with the template's bytes,
  `Content-Type: application/vnd.oasis.opendocument.spreadsheet-template`, `Content-Disposition`
  naming its `fileName`, and `Last-Modified` from `uploadedAt`.
* `404 { error }` when the meet has no template (the client says an admin needs to upload one).
* `403 { error }` for anyone else.

`HEAD` (which Hono answers from the `GET` route) tells a client whether a template exists, and its
name and date, without the bytes.

### `PUT /api/meets/:id/template`

Who: the meet's admins, superuser. Body: the file's bytes; header `X-File-Name` gives its name.

* `200 { fileName, uploadedAt }`: stored, replacing any earlier one.
* `400 { error }`: not a scoring template (no Quiz sheet), or over 2 MB.
* `409 { error }` once the meet is `done`.
* `403 { error }` for anyone else.

## Results: identical uploads

### `POST /api/meets/:id/results` (changed)

Request body unchanged. New outcome, checked before the "already submitted" answer:

* `200 { id, revision, created: false, unchanged: true, link }` when the meet already has the quiz
  and the sent file is identical to its current revision. No revision is added, whatever
  `onExisting` says. `revision` is the current one.

Every other outcome (`201` created, `409` already submitted, `200` new or kept revision, phase and
room refusals) is as today.

## Roster import

### `POST /api/meets/:meetId/roster/import` (changed)

Request body and success response unchanged. Changes:

* Any roster size the meet can hold is imported in one request (at least 60 teams, 300 quizzers).
* The import is one transaction: on any failure nothing is added.
* A failure answers `4xx/5xx { error }` with a message an admin can act on; never a bare 500 page.
