# Contract: API changes

No new routes. The access model's terms are in `docs/roles-and-access.md`.

## Guest tokens on every route

A guest token that isn't current is treated as absent (research R1): the request is anonymous.

* **Current** means the token's `codeTag` matches the code it was issued for: the meet's viewer code
  for a viewer token; the room's current code, with the room still in the token's meet, for an
  official token.
* A route that admits guests answers a request with a token that isn't current as it answers one
  with no token: 401 where it requires a caller (`requireAuthOrGuest`), or the route's own refusal.
* An official token from before `roomId` existed has no tag and is never current, so its holder now
  gets 401 rather than 403 "Rejoin with your room code".
* A request with a session cookie ignores any guest token, as today.

## `POST /api/join/guest`

Body unchanged: `{ code }`.

* **Viewer code**, 200: `{ token, meet: { id, name }, role: "viewer" }`. The token now carries
  `codeTag`.
* **Room code**, 200: `{ token, meet: { id, name }, role: "official", label, room: { id, name } }`.
  `room` is new; `label` (the room's name) stays for released clients.
* No match, 404 `{ error: "Invalid code" }`, unchanged. Coach and admin codes still need an account.

## `POST /api/join`

Unchanged, and the only way a membership is created: a signed-in caller redeems a code. The apps
call it to upgrade the account at sign-in (research R6). A guest token in `Authorization` doesn't
change what it does: the session cookie decides.

## `POST /api/meets/:id/results`

* A guest official's send that names a `roomId` other than the token's room: **403**
  `{ error: "Not an official of this room" }`. Today the token's room silently wins.
* A guest send without `roomId` uses the token's room, unchanged, so released apps keep working
  (FR-021).
* Signed-in callers and admins: unchanged.

## `GET /api/meets/:id/results/sender`

Unchanged. A guest whose token isn't current gets 401, as any caller without access; the apps treat
that, for a meet they joined as an official, as a refused session (research R5).
