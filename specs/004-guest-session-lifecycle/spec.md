# Feature Specification: Guest session lifecycle

**Feature Branch**: `feat/guest-session-lifecycle`

**Created**: 2026-10-02

**Status**: Draft

**Input**: User description: "Guest session lifecycle in the scoresheet, for people who join a meet
with a code instead of an account (officials and viewers). When a guest official's access has
expired or been revoked, submitting asks for the room code again, re-joins, and retries; the quiz is
never lost. The scoresheet no longer keeps an official's room code after joining. Joining with an
official code returns the room, which the sheet shows and always sends. Signing out clears guest
sessions, and a guest can leave a meet. A `?meet=` link's code is removed from the address bar after
use. The guest-token docs are corrected."

## Context

Anyone with a meet code can use qzr with that meet without an account. A viewer code (also shared as
a `?meet=` link) lets them follow the meet; a room's code also lets an official send and correct
that room's quizzes (spec 003). Joining gives the device a guest session for the meet, which lasts
24 hours. Guest sessions are shared by the scoresheet and the portal, which run on one origin, so a
code joined in either app works in both.

The access model these sessions live in is defined in `docs/roles-and-access.md` and `docs/auth.md`:
a code is redeemed once to create a grant, a code upgrades an account when redeemed signed in, and a
guest token is only ever a short-lived pass. This feature brings the guest session in line with that
model across its whole life: joining, using, renewing, upgrading, and ending.

Today both apps handle the start of a guest session but not the rest. When an official's session has
run out, sending or correcting fails with a bare error and nothing says what to do. The room an
official joined is known to the server but not to the apps, which send it differently for guests
than for signed-in officials (#105). And signing in to an account that doesn't have the meet leaves
the meet listed but unusable, because the account takes precedence over the guest session.

## Clarifications

### Session 2026-10-06

* Q: What happens to guest sessions when the user signs in? → A: A code is an upgrade code: redeemed
  signed in, it adds a membership to the account. So signing in upgrades the account with the guest
  sessions' codes. Viewer sessions are upgraded automatically with their kept viewer code. Official
  sessions ask once for each room's code, since room codes are never kept; skipping drops the
  session. A guest token itself is never redeemable for a membership.
* Q: What does a token for a rotated room code or a changed viewer code grant? → A: Nothing, reads
  included.
* Q: Does this cover the portal? → A: Yes. Guest sessions are shared by both apps, so every rule
  here applies in both.
* Q: When someone signs in while holding guest official sessions, how should the app ask for the
  room codes? → A: One dialog right after sign-in, listing each guest room (meet and room name) with
  a code field and Skip per row, plus Done.
* Q: Where does someone who isn't signed in see and leave their meets in the portal? → A: The
  device's guest sessions act as a temporary account waiting for an upgrade, so the apps treat it
  like a signed-in account: the portal home lists its meets (name, role, room) the way it lists an
  account's, each with a link and Leave, and the scoresheet's meet picker has Leave on the same
  rows.
* Q: Should signed-in users also be able to leave a meet themselves? → A: Not in this feature.
  Self-leave for account memberships is filed as #123 (let members leave a meet themselves), since
  it needs its own rules, such as the last admin not leaving.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Keep working after the room code changed or the session ran out (Priority: P1)

An official joined Room 2 with its code in the morning. In the afternoon the admin rotated Room 2's
code (or the session simply ran out the next day). The official finishes a quiz and submits it.
Instead of an error, the app explains that the room's code is needed again and asks for it. The
official types the new code, the app re-joins, and the submit goes through. The quiz on screen and
in auto-save is untouched throughout. The same happens in the portal when the official corrects or
uploads one of their room's quizzes.

**Why this priority**: it is the failure an official is most likely to meet at a real meet, in the
middle of the day, with quizzers waiting. Today it ends in an error with no way forward.

**Independent Test**: join a meet as a guest official, rotate the room's code, then submit a quiz.
The app asks for the code, and after the new code is entered the quiz is stored.

**Acceptance Scenarios**:

1. **Given** a guest official whose session the meet no longer accepts, **When** they submit,
   upload, or correct a quiz, **Then** the app asks for the room code, naming the meet and room, and
   does not show a bare error.
2. **Given** that prompt, **When** the official enters a valid code for the same meet, **Then** the
   app re-joins, replaces the old session, and retries the action without the official starting it
   again.
3. **Given** that prompt, **When** the official cancels, **Then** nothing is sent, the quiz is
   unchanged, and the action remains available to try again.
4. **Given** that prompt, **When** the official enters a code that is wrong or belongs to another
   meet, **Then** the app says so, nothing is sent, and the prompt stays open.
5. **Given** a guest official whose session is known to have expired, **When** they submit, **Then**
   the app asks for the code before sending the quiz rather than after a refusal.
6. **Given** a guest viewer whose session expired, **When** the app next talks to that meet,
   **Then** it renews the session from the viewer code without asking.
7. **Given** an admin rotated a room's code, **When** a guest holding a token for the old code asks
   for any of the meet's data, **Then** the meet refuses it as it would a stranger's request; a
   background read shows its error as today, and the official's next send or correction asks for the
   room code.
8. **Given** an admin changed the viewer code, **When** a guest viewer holding a token for the old
   code asks for the meet's data, **Then** the meet refuses it, and the app removes the session and
   says the code is no longer valid.

---

### User Story 2 - Signing in upgrades the account (Priority: P1)

A parent followed the meet as a guest viewer on their phone, and an official sent quizzes for Room 3
as a guest on the gym laptop. Each later signs in to their own account. The parent's account gains
the meet as a viewer without any prompt. The official is asked for Room 3's code in one dialog;
entering it adds Room 3 to their account. Neither ends up with a meet that is listed but unusable.

**Why this priority**: today signing in silently breaks every guest meet on the device, because the
account takes precedence and has no access to them.

**Independent Test**: join a meet as a guest viewer and another as a guest official, then sign in.
The viewer meet appears as a membership at once; the official meet appears after the room code is
entered at the prompt.

**Acceptance Scenarios**:

1. **Given** a guest viewer session, **When** the user signs in, **Then** the account is upgraded
   with the kept viewer code, the meet appears among the account's meets, and the guest session is
   removed.
2. **Given** one or more guest official sessions, **When** the user signs in, **Then** one dialog
   lists each room by meet and room name, each with a code field and Skip, and Done.
3. **Given** that dialog, **When** the user enters a room's code, **Then** the account becomes an
   official of that room and its guest session is removed; a wrong code is reported on its row
   without closing the dialog.
4. **Given** that dialog, **When** the user skips a room, **Then** its guest session is removed and
   the meet stays available by joining with the code again.
5. **Given** the app starts with the user already signed in and guest sessions present, **When** it
   loads, **Then** it upgrades them the same way.
6. **Given** a viewer code that no longer works, **When** the upgrade tries it, **Then** the session
   is removed and the user is told the code is no longer valid.

---

### User Story 3 - The official sees which room they send for (Priority: P2)

An official joins with Room 3's code. The meet picker lists the meet as "Official, Room 3", and the
Submit step names Room 3 as the room the quiz goes to, the same way it does for a signed-in
official. If the official later re-joins with a different room's code, the room shown changes with
it.

**Why this priority**: an official who typed a code from a sheet of codes has no way today to check
that it was the right room before results go in under it.

**Independent Test**: join with a room's code and check that the meet picker and Submit step both
name that room.

**Acceptance Scenarios**:

1. **Given** an official who joined with a room's code, **When** they open the meet picker, **Then**
   the meet's row names the room.
2. **Given** a guest official, **When** they submit, **Then** the Submit step names the room the
   quiz will be stored for, and the submission names that room.
3. **Given** an official re-joins the same meet with another room's code, **When** they submit next,
   **Then** the new room is shown and used.

---

### User Story 4 - Room codes are not kept on the device (Priority: P2)

An official joins with a room code on a borrowed laptop, in either app. Once the join succeeds, the
app keeps the session it was given but not the code itself. Viewer codes are still kept: they aren't
secret, and they let the app renew a viewer session and upgrade an account without asking.

**Why this priority**: a room code lets anyone holding it send for that room until the admin rotates
it. The apps need it only for the moment of joining.

**Independent Test**: join with a room code and with a viewer code, then inspect what either app has
saved on the device. The viewer code is there; the room code is not.

**Acceptance Scenarios**:

1. **Given** an official joins with a room code in either app, **When** the join finishes, **Then**
   the device keeps no copy of that code.
2. **Given** a device that saved a room code before this change, **When** either app starts,
   **Then** the saved code is removed and the session otherwise kept.
3. **Given** a viewer joins with a viewer code or link, **When** the join succeeds, **Then** the
   viewer code is kept with the session.

---

### User Story 5 - Ending a guest session (Priority: P2)

A family shares a tablet. One person followed a meet with a `?meet=` link, then someone signs in to
the portal to check their own meet and signs out at the end of the day. Signing out ends every guest
session on the device, and the meet data cached for them, in both apps. Separately, a parent who
joined two meets as a viewer removes the one they no longer follow.

**Why this priority**: shared devices are common at meets. Signing out should leave nothing of a
meet behind for the next person, and the joined list shouldn't only ever grow.

**Independent Test**: join a meet as a guest, sign in and out in either app, and check that neither
app lists the meet or keeps its cached team names. Join two meets as a guest, leave one, and check
that only the other remains.

**Acceptance Scenarios**:

1. **Given** a device with guest sessions, **When** the user signs out in either app, **Then** every
   guest session is removed, along with the meet data kept for guest use (the team-name lists and
   the remembered meet to submit to).
2. **Given** a guest who has joined a meet, **When** they choose Leave on it in the portal home or
   the scoresheet's meet picker, **Then** that meet's session is removed and the others are kept.
3. **Given** a guest who isn't signed in, **When** they open the portal home, **Then** it lists the
   meets they joined with a code (name, role, and room for an official), as it lists a signed-in
   user's meets, an official's linking to its results.
4. **Given** the sheet is loaded from a meet the guest just left, **When** the session is removed,
   **Then** the scores on screen are kept.

---

### User Story 6 - Meet links (Priority: P3)

A parent opens `…/scoresheet/?meet=fall-2025` from a group message. Once the scoresheet has joined
the meet, the address bar shows the scoresheet's plain address, so a bookmark or a link copied from
the address bar doesn't carry the viewer code along. Links from the portal that open a stored quiz
or a scheduled quiz name the meet by id in their own parameter, so a meet id is never taken for a
viewer code.

**Why this priority**: tidy and low risk: viewer codes should be shared deliberately, and each link
parameter should mean one thing.

**Independent Test**: open the scoresheet with a `?meet=` link and check the address bar after the
meet has loaded; open a stored quiz from the portal and check that no join is attempted.

**Acceptance Scenarios**:

1. **Given** a `?meet=` link with a valid viewer code, **When** the join succeeds, **Then** the code
   is removed from the address bar without reloading the page.
2. **Given** a `?meet=` link whose code the server rejects, **When** the join fails, **Then** the
   code is removed and the scoresheet says the link isn't valid.
3. **Given** a `?meet=` link opened with no network, **When** the join cannot reach the server,
   **Then** the code stays, so reloading once online tries again.
4. **Given** a portal link to a stored or scheduled quiz, **When** the scoresheet opens it, **Then**
   it reads the meet id from the link's meet-id parameter and never treats it as a viewer code.

---

### Edge Cases

* The official is offline when they send. Nothing is refused, so no code is asked for; the send
  fails as a network error, the quiz stays saved, and it can be tried again later.
* The official enters a code for a different room of the same meet at the prompt. The new room
  becomes the session's room, the Submit step shows it, and the quiz is sent for that room.
* The official enters a viewer code at the prompt. It is refused for sending: the prompt says a room
  code is needed.
* An official joined before rooms were on tokens has a session without a known room. The server
  refuses its sends (spec 003); it is handled like any other refused session.
* A signed-in official is never asked for a room code to send; their account decides.
* The user signs in on a device with guest sessions while offline. The upgrade waits until the app
  can reach the server; nothing is dropped meanwhile.
* An account that already holds the membership a guest session would add: the upgrade changes
  nothing, and the guest session is removed.
* Leaving the meet the sheet is linked to keeps the scores; the sheet stays linked to the meet's
  team names, and the next request that needs access asks for a code or fails as for any meet not
  joined.
* Portal links already shared with the old `?meet=<id>&quiz=` form keep opening the quiz.
* An admin changes the viewer code and later changes it back: tokens issued under that code work
  again within their 24 hours, since it is the same code.

## Requirements _(mandatory)_

### Functional Requirements

**Renewing a session** (the prompt below is the room-code dialog, shared by both apps)

* **FR-001**: When the meet refuses a guest official's send or correction because their session is
  no longer accepted (expired, from a rotated code, for a deleted room, or without a room), the app
  MUST ask for the room's code instead of showing the refusal as an error. The prompt MUST name the
  meet and, when known, the room. This applies in both apps.
* **FR-002**: When the official's session is known to have expired before sending, the app MUST ask
  for the code before sending.
* **FR-003**: A valid room code for the same meet entered at the prompt MUST re-join, replace the
  old session, and retry the action once, with the same choice about an existing quiz the official
  had already made (spec 003, FR-003).
* **FR-004**: A code that is invalid, for another meet, or not a room code MUST be refused at the
  prompt with a message saying which, without sending.
* **FR-005**: Cancelling the prompt MUST leave the quiz unchanged and the action available.
* **FR-006**: A viewer session that has expired MUST be renewed from its kept viewer code without
  asking. If the code is no longer valid, the session MUST be removed and the app MUST say why.
* **FR-007**: A session that has been replaced or removed MUST NOT stay in the list of joined meets.
* **FR-008**: None of this MAY block entering, auto-saving, or saving a quiz to a file (constitution
  principle I). A network failure MUST NOT be treated as a refused session.

**Revocation**

* **FR-009**: A guest token for a room whose code has since been rotated, or whose room has been
  deleted, MUST grant nothing: the meet MUST refuse it for reads as well as writes.
* **FR-010**: A viewer guest token MUST stop granting anything once the meet's viewer code is
  changed.

**Signing in**

* **FR-011**: When a user signs in, or an app starts already signed in, each guest viewer session on
  the device MUST be redeemed into the account with its kept viewer code, as a normal join, and then
  removed.
* **FR-012**: Guest official sessions MUST lead to one dialog right after sign-in, listing each
  guest room by meet and room name with a code field and Skip per row, and Done. A code entered for
  a row MUST be redeemed into the account as a normal join and that session removed; a skipped row
  MUST remove its session. A wrong code MUST be reported on its row without closing the dialog.
* **FR-013**: A guest token MUST NOT be accepted in place of a code for adding a membership.
* **FR-014**: An upgrade that can't reach the server MUST wait and try again later, without dropping
  the session.

**Room codes and rooms**

* **FR-015**: Neither app MAY keep a room code on the device once joining has finished, whether it
  succeeded or failed.
* **FR-016**: On start, both apps MUST remove any room code saved by an earlier release, keeping the
  rest of that session.
* **FR-017**: Viewer codes MAY be kept with their session.
* **FR-018**: Joining with a room code MUST return the room it belongs to (id and name), and the
  guest session MUST keep it.
* **FR-019**: The meet picker MUST name a guest official's room, and the Submit step MUST name the
  room the quiz will be stored for, for guest and signed-in officials alike.
* **FR-020**: Both apps MUST name the room in every send, for guest and signed-in officials alike.
  The meet MUST accept a guest's send only for the room their session was issued for.
* **FR-021**: The meet MUST keep accepting a guest send that names no room, using the room the
  session was issued for, so apps released before this change keep working.

**Ending a session**

* **FR-022**: Signing out in either app MUST remove every guest session on the device, and the meet
  data kept for guest use: the team-name lists and the remembered meet to submit to.
* **FR-023**: The portal home MUST list a guest's meets (name, role, and room for an official), as
  it lists a signed-in account's meets. A guest official's meet MUST link to its results; a guest
  viewer's meet is listed without a portal link until the portal has pages for guest viewers (#79,
  #96). Both the portal home and the scoresheet's meet picker MUST let a guest leave any of those
  meets, removing only that meet's session. A guest who joins from the portal home stays there with
  the meet listed, rather than being sent to a page they can't open.
* **FR-024**: Removing a guest session MUST NOT change the quiz on screen or in auto-save.

**Meet links**

* **FR-025**: After a `?meet=` link's join succeeds or is rejected by the server, the scoresheet
  MUST remove the code from the address bar without reloading. When the server can't be reached, the
  code MUST stay.
* **FR-026**: A rejected `?meet=` link MUST produce a message saying the link isn't valid.
* **FR-027**: Links from the portal to a stored or scheduled quiz MUST name the meet by id in a
  parameter other than `meet`, and the scoresheet MUST NOT treat a meet id as a viewer code. Links
  in the old form already shared MUST keep opening their quiz.

**Docs**

* **FR-028**: `docs/roles-and-access.md` and `docs/auth.md` MUST describe what this feature adds:
  signing in upgrades the account with the guest sessions' codes, and a guest token is never
  redeemable; revoked tokens grant nothing, reads included, for officials and viewers; clients keep
  no admin, coach, or room codes; signing out ends guest sessions; join returns the room; and meet
  links carry only the viewer code.

### Key Entities

* **Guest account**: the device's guest sessions taken together, acting as a temporary account
  waiting for an upgrade. Codes redeemed without signing in go onto it; signing in upgrades the real
  account with its codes; signing out discards it. The apps show it like a signed-in account.
* **Guest session**: the device's record of one meet joined with a code, shared by both apps: the
  meet (id and name), the role (viewer or official), the session token and when it expires, for a
  viewer the viewer code, and for an official the room (id and name). At most one per meet. One may
  be active, as today.
* **Room**: a room of the meet that a room code belongs to, identified by id and shown by name.

## Success Criteria _(mandatory)_

### Measurable Outcomes

* **SC-001**: A guest official whose room code was rotated gets their quiz stored by entering the
  new code once, with no other steps, in under 30 seconds.
* **SC-002**: In no case covered by this spec does a quiz's content change or disappear because a
  session was refused, renewed, upgraded, or removed.
* **SC-003**: After joining with a room code, no copy of the code is found anywhere either app saves
  data on the device, including after upgrading from an earlier release.
* **SC-004**: After signing out in either app, neither app lists a meet joined with a code.
* **SC-005**: After signing in, no meet is listed that the account can't use.
* **SC-006**: Every guest official can tell which room a quiz will be stored for before sending it.
* **SC-007**: Apps released before this change can still send as guest officials.

## Assumptions

* "Known to have expired" uses the expiry the session carries. The server still decides; the client
  check only saves a round trip.
* A signed-in request that also carries a guest token still acts as the account. Upgrading at
  sign-in means no guest session is left for that to hide.
* Leaving a meet keeps the sheet linked to that meet's team names; unlinking the sheet is a separate
  action that already exists.
* #105 asked for the server's guest-only room branch to go. FR-021 keeps it as a fallback for
  released apps (desktop and Android installs update late); the apps stop relying on it. Removing it
  later needs its own decision once old releases are gone.
* Viewer tokens carry a tag of the viewer code they were issued for, as official tokens do for their
  room's code. A viewer token issued before this change is renewed from the kept code.
* Out of scope: signed-in users leaving a meet themselves (#123), guest access to schedule reads
  (#79), phase checks (#96), the `review` phase (#117), rate limiting, a separate signing key for
  guest tokens, and putting room codes in links.
