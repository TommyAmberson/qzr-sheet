# Research: Guest session lifecycle

Decisions behind [plan.md](./plan.md), from the code at master `ad02dd9` and the access model in
`docs/roles-and-access.md` and `docs/auth.md`.

## R1. Where a revoked guest token is refused

* **Decision**: one function in `lib/jwt.ts`, beside the code tag it checks, decides whether a guest
  token is still current, and `sessionMiddleware` calls it once per request. After `verifyGuestJwt`
  accepts the signature, issuer, audience, and expiry, it compares the token's `codeTag` with the
  current code of what it was issued for: the room's code hash for an official token (the room must
  still exist in that meet), the meet's viewer code for a viewer token. A token that doesn't match,
  or has no tag, leaves `c.var.guest` null, so every route treats the request as anonymous (FR-009,
  FR-010).
* **Rationale**: one owner for "is this pass still good", ahead of every route, instead of a check
  in `isViewerOf`, another in `isOfficialOfRoom`, and any future helper. `isOfficialOfRoom` and
  `officialRoomsOf` then only compare the token's room, and the results route's "Rejoin with your
  room code" branch for guests becomes unreachable and goes. The cost is one indexed D1 read per
  guest request; signed-in requests are untouched.
* **Alternatives considered**: checking in `isViewerOf` and `isOfficialOfRoom` (two owners of one
  rule, and new routes could forget); a denylist of revoked tokens (state to keep and expire, when
  the current code already answers the question).

## R2. Viewer tokens carry a tag

* **Decision**: viewer tokens get `codeTag` like official tokens, an HMAC under the server secret of
  the viewer code, with a different prefix from the room tag so the two can never match each other.
  The existing room-tag function is generalized rather than copied.
* **Rationale**: lets R1 revoke viewer tokens when the admin changes the viewer code (FR-010)
  without storing anything new. The viewer code is plaintext, so the tag hides nothing; it only ties
  the token to the code's current value. If an admin changes the code and later changes it back,
  tokens issued under that value work again within their 24 hours: it is the same code again, which
  anyone holding it could redeem anyway.
* **Compatibility**: viewer tokens issued before the deploy have no tag, so R1 refuses them. A
  current client renews them from the kept viewer code without asking (FR-006). A released client
  keeps failing for that meet until its token's 24 hours run out or it opens the `?meet=` link
  again; at most a day, for viewers only.

## R3. Join returns the room

* **Decision**: `POST /api/join/guest` adds `room: { id, name }` to its answer for a room code.
  `label` stays for released clients. The guest session keeps the room (FR-018).
* **Rationale**: the meet picker and portal home can name the room (FR-019, FR-023) without another
  request. `GET /results/sender` already returns a guest official's room for the Submit step, so the
  Submit step's room comes from there as today.
* **Send rule**: a guest's send that names a room other than its token's room is refused with 403;
  one that names none uses the token's room (FR-020, FR-021). The scoresheet already sends the room
  `chooseRoom` returns from the sender's rooms.

## R4. Room codes leave the device

* **Decision**: a guest session keeps `code` only for a viewer. An official session keeps `room`
  instead. Loading the stored guest state drops `code` from official sessions saved by earlier
  releases (FR-015, FR-016).
* **Rationale**: nothing reads an official's code after joining. The `?meet=` reuse check only
  compares viewer codes, and renewing an official now asks (R5).

## R5. Renewing: viewers in the request wrapper, officials at the action

* **Decision**: two owners, by what renewal needs.
  * **Viewers** renew inside `withGuestToken`, the request wrapper both apps already use: before a
    request, a viewer session whose token is known to have expired is re-joined from its kept code;
    a request refused with 401 while carrying a viewer token is re-joined and retried once. A
    re-join the server rejects, or one that answers for a different meet, removes the session and
    reports it (FR-006).
  * **Officials** renew around the actions that need the room: submitting from the scoresheet, and
    uploading, correcting, restoring, and merging in the portal. One shared helper runs the action;
    if the official's session is known to have expired it asks for the code first (FR-002), and if
    the action is refused because the session isn't accepted (401, or the sender lookup returning no
    access for a meet the guest joined as an official) it asks for the code, re-joins, and runs the
    action once more (FR-001, FR-003). The dialog is one component in `packages/ui`, used by both
    apps, and reused with several rows by the sign-in upgrade (R6). A re-join stores the answer only
    when it is an official session for the same meet; a viewer code or another meet's code is
    reported on the dialog and changes nothing. Renewal isn't asked for while an account is signed
    in, since the account decides. A rejected viewer renewal is reported through one guest notice
    the module keeps and each app shows.
* **Rationale**: a viewer renewal needs no person, so it belongs where every request passes. An
  official renewal needs a dialog, which must not open from a background read (team names, a meet
  refresh) at app start. Tying it to the user's action keeps the prompt where the official expects
  it, and the retry keeps their choice about an existing quiz (FR-003), since the action is rerun
  with the same arguments.
* **Network failures** throw before any status, so neither path treats them as refusals (FR-008).
* **Alternatives considered**: prompting from the request wrapper for every refused official request
  (dialogs at startup and on background refreshes); marking the session refused and letting each
  call site check (the same decision copied into every action).

## R6. Signing in upgrades the account with codes

* **Decision**: one function in `packages/ui` runs the upgrade, called by each app whenever it finds
  a signed-in account and guest sessions together: after sign-in, and on start when already signed
  in. Viewer sessions are redeemed with the app's existing `POST /api/join` call and their kept
  code, then removed. Official sessions are collected into the one dialog the clarification chose
  (FR-012); each code entered is redeemed the same way, a skipped row removes its session. A network
  failure leaves the session for the next run (FR-014). A guest token is never sent to
  `POST /api/join` (FR-013).
* **Rationale**: no new API route: `POST /api/join` already turns a code into a membership for a
  signed-in caller, and is idempotent (an existing membership is returned, so the edge case "already
  a member" needs nothing). Social sign-in returns through a page load, so "on start when already
  signed in" is the path most sign-ins take; email sign-in changes the session in place, so the apps
  also run it when the session appears.
* **A code for a different room** entered in a row is still a valid code: it adds that room. The row
  is cleared and its session removed, since the account now decides.

## R7. Signing out ends the guest account

* **Decision**: one function in `packages/ui` clears the device's guest data: every guest session,
  the scoresheet's cached team-name lists, and its remembered meet to submit to. Both apps call it
  when the user signs out (FR-022). The storage keys of those two caches move to `packages/ui`, so
  the portal can clear what the scoresheet keeps on the same origin; the scoresheet's composables
  read the keys from there.
* **Rationale**: the two apps share `localStorage`, so signing out of either must clear both apps'
  guest data, and only one place should know what that data is.

## R8. Leaving a meet, and the portal's list of a guest's meets

* **Decision**: removing one guest session becomes a function next to the existing state setters in
  `guestSession.ts`. The scoresheet's meet picker shows Leave on guest rows; the portal home lists
  the guest account's meets (name, role, room) with Leave, beside or instead of the signed-in list
  (FR-023).
* **Portal links**: a guest official's row links to the meet's results, the one page the portal
  router admits guests to today (`meta.guestAccess`). A guest viewer's row has no portal page to
  link to yet: the meet, schedule, and team pages need an account, and opening them to guest viewers
  belongs with guest schedule reads (#79) and the phase rules (#96). So viewer rows show the meet
  and Leave, without a link. The spec's FR-023 is worded to match.

## R9. Meet links

* **Decision**: portal links to a scheduled or stored quiz name the meet in `meetId` instead of
  `meet` (`ScheduleView.vue`, `ResultView.vue`). The scoresheet reads `meetId`, and still accepts
  `meet` together with `quiz` or `result` so links already shared keep working (FR-027). The guest
  join from a link reads `meet` only when neither `quiz` nor `result` is present and the value isn't
  digits only (#120's rule), so a meet id is never posted as a viewer code.
* **Address bar** (FR-025, FR-026): after the link's join succeeds, or the server rejects the code
  (the join call returns null), the scoresheet removes `meet` from the address with
  `history.replaceState`, as it already does for quiz links. A thrown network error leaves it, so a
  reload tries again. A rejected link is reported through the same guest notice as a rejected viewer
  renewal (R5).

## R10. Docs

* **Decision**: `docs/roles-and-access.md` and `docs/auth.md` gain what this feature adds (FR-028):
  the sign-in upgrade by code and the guest account, revoked tokens granting nothing for officials
  and viewers, viewer token tags, no stored admin, coach, or room codes on clients, sign-out ending
  guest sessions, leaving a meet, join returning the room, and meet links.

## R11. Delivery in two pull requests

* **Decision**: PR 1 is the API alone: token currency (R1, R2), the join's room and the send rule
  (R3), with their docs and an api MINOR. PR 2 is the client lifecycle in `packages/ui` and both
  apps (R4 to R9), with the rest of the docs and scoresheet and web MINORs.
* **Rationale**: PR 1 closes access gaps on its own and is small to review; it shouldn't wait for
  the client work. Each PR releases the packages it changes (constitution, Development Workflow).
* **Between the two**: current apps meet PR 1's server as released apps do: a guest official whose
  code was rotated gets the existing "room code has expired" message (now from a 401 rather than a
  403), and a guest viewer holding a token issued before PR 1 is refused for that meet until the
  token's 24 hours run out or the viewer joins again with the code (a released app reuses an
  unexpired token when the link is opened again, so the link alone doesn't help). The join answer's
  new `room` is ignored by clients that don't read it yet.
