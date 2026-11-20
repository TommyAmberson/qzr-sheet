# Roles and Access

This document defines who can do what with a meet's data, and when. It governs the code
(constitution principle II): where a route and this document disagree, the route is the bug. How
credentials are issued, stored, and verified is in [auth.md](./auth.md#join-codes); the phases
themselves are in [scheduling.md](./scheduling.md#2-meet-phases).

## Overview

Access to meet data is granted by codes that admins hand out, not by permanent role assignment. The
same account can hold different roles at different meets, and several roles within one meet.

```
Account (normal)
  ├── meet:101  roles: [admin, coach(Church A)]
  ├── meet:102  role: coach(Church B)
  ├── meet:103  role: official(Room 1)
  ├── meet:104  role: viewer
  └── meet:105  (no membership: no access)

Guest (no account, on one device)
  ├── meet:104  viewer token
  └── meet:106  official token (Room 2)
```

Superusers have implicit full access to all meets; no membership rows are needed.

## Terms

* **Principal**: who a request acts as. Exactly one of:
  * **anonymous**: the request carries no valid credential
  * **account**: the request carries a Better Auth session cookie. An account's _account role_ is
    `normal` or `superuser` (see [auth.md § Account Types](./auth.md#account-types)).
  * **guest**: the request carries a valid guest token as `Authorization: Bearer`
* **Precedence**: when a request carries both a session and a guest token, the principal is the
  account and the token is ignored. An invalid or expired token makes a request anonymous rather
  than failing it.
* **Code**: a value an admin hands out so people can join: a random secret for admins, coaches, and
  rooms, and a slug for viewers. Redeeming a code creates a grant. Many people may redeem the same
  code, and redeeming it again renews a guest token. A code is never sent on any other request.
* **Grant**: what a principal holds for one meet. One of:
  * a **membership**: an account bound to a meet and a role, plus a church (coach) or room
    (official). It lasts until removed.
  * a **guest token**: a signed claim binding its bearer to a meet and a role, plus a room
    (official). It lasts 24 hours unless revoked.
  * **superuser**: an implicit grant to every meet.
* **Scope**: the object a grant is bound to: the meet for admin and viewer, a church for a coach, a
  room for an official.
* **Phase**: where the meet is in its lifecycle: `registration`, `build`, `live`, `review`, or
  `done`. A grant says who; the phase says when. Access is decided by role, action, and phase
  together. Grants never change with the phase.
* **Guest account**: the guest tokens one device holds, taken together. It acts as a temporary
  account waiting for an upgrade: signing in upgrades the real account with the codes behind it, and
  signing out ends it.

## Roles

| Role      | Scope  | Granted by  | Account needed | Adds to viewer                                                                   |
| --------- | ------ | ----------- | -------------- | -------------------------------------------------------------------------------- |
| viewer    | meet   | viewer code | no             | (base) read the meet's data, as the phase allows                                 |
| official  | room   | room code   | no             | send quizzes for its room, and read and correct its room's quizzes               |
| coach     | church | coach code  | yes            | manage its church's teams and roster                                             |
| admin     | meet   | admin code  | yes            | everything in the meet, except creating or deleting it and removing other admins |
| superuser | all    | provisioned | yes            | create, list, and delete meets; remove admins                                    |

The coach role is `head_coach` in `MeetRole`.

* **Any grant implies viewer.** Holding any grant for a meet makes the principal a viewer of that
  meet.
* **Official and coach are siblings.** Each adds its own scoped powers on top of viewer. Admin
  includes both, for every church and room of the meet.
* **Several roles per meet.** An account may hold several memberships in one meet, such as admin and
  coach of a church. A guest holds at most one token per meet.
* **One role per code.** Each code grants exactly one role at one scope. No grant can be turned into
  a different role.

Who each role is for:

* **viewer**: quizzers, families, and anyone at the event. A viewer code is not a secret: it may be
  posted at the venue or online, as meet listings do. Anyone with it sees what viewers see. Viewers
  can follow a meet after it ends, such as for personal stats.
* **official**: whoever runs a room's scoresheet. Typically a guest on the room's device.
* **coach**: registers a church's teams and quizzers before the meet.
* **admin**: runs the meet: churches, rooms, codes, schedule, and results.

## Access by phase

`-` none, R read, W write. "Own" is the grant's church or room. Admin includes coach and official
throughout; superuser includes admin.

| Resource                         | registration | build       | live             | review          | done           |
| -------------------------------- | ------------ | ----------- | ---------------- | --------------- | -------------- |
| Meet info, phase, team counts    | V: R         | V: R        | V: R             | V: R            | V: R           |
| Viewer code                      | V: R         | V: R        | V: R             | V: R            | V: R           |
| Own church's teams and roster    | C: RW        | C: R; A: RW | C: R; A: RW      | C: R; A: RW     | C: R           |
| All churches, teams, and rosters | A: RW        | O: R; A: RW | V: R; A: RW      | V: R; A: RW     | V: R           |
| Rooms and their codes            | A: RW        | A: RW       | A: RW            | A: RW           | A: R           |
| The meet's scoring template      | V: R; A: RW  | V: R; A: RW | V: R; A: RW      | V: R; A: RW     | V: R; A: R     |
| Published schedule               | A: RW        | A: RW       | V: R; A: RW      | V: R; A: RW     | V: R           |
| Draft schedule                   | A: RW        | A: RW       | A: RW            | A: RW           | A: R           |
| Send a quiz (submit or upload)   | -            | -           | own O: W; A: W   | A: W            | -              |
| Own rooms' quizzes and history   | -            | -           | O: RW            | O: R            | O: R           |
| All stored quizzes and history   | -            | -           | A: RW            | A: RW           | A: R           |
| A quiz's stage                   | -            | -           | own O: R; A: RW  | own O: R; A: RW | own O: R; A: R |
| A quiz's link to the schedule    | -            | -           | own O: RW; A: RW | own O: R; A: RW | own O: R; A: R |
| Accepting a quiz as scored       | -            | -           | own O: R; A: RW  | own O: R; A: RW | own O: R; A: R |
| What needs attention             | -            | -           | A: R             | A: R            | A: R           |
| Merging names, dismissing flags  | -            | -           | A: RW            | A: RW           | -              |
| Results and standings, as set    | -            | -           | V: R; A: R       | V: R; A: R      | V: R; A: R     |
| Stats settings                   | A: RW        | A: RW       | V: R; A: RW      | V: R; A: RW     | V: R; A: R     |
| The meet's team-name list        | A: RW        | A: RW       | V: R; A: RW      | V: R; A: RW     | V: R           |
| Members: list, remove            | A: RW        | A: RW       | A: RW            | A: RW           | A: R           |
| Meet phase                       | A: RW        | A: RW       | A: RW            | A: RW           | A: RW          |
| Division state                   | -            | -           | A: RW            | A: RW           | A: R           |
| Redeem a code (join)             | anyone       | anyone      | anyone           | anyone          | anyone         |

* **Before `live`**, a meet's teams, rosters, and schedule are private to the admin and, for its own
  church, the coach. Others see the meet's details and team counts only, except that its officials,
  guests among them, read every roster from `build` on, so rooms can get ready for the quizzers.
* **`review`** follows the last quiz, so the admin can check results while they stay put. Only
  admins change anything: they keep every power they have in `live`. Everyone else keeps read
  access; an official who spots a mistake tells the admin.
* **The scoring template** is the blank `Scoresheet.ots` a room scores in when it falls back to
  LibreOffice, and the sheet `.ods` downloads fill. It holds no meet data, so anyone the meet's
  roster routes admit downloads it in every phase, from the meet page's Roster tab (admins from
  Setup); only admins upload or replace it, until `done`.
* **`done`** locks the meet, admins included. A late correction moves the meet back to `review`.
  Moving the phase is the one write allowed in `done`.
* Completed quizzes are immutable in the schedule in every phase
  ([scheduling.md § 4](./scheduling.md#4-rules-and-invariants)).
* An admin sends a quiz for any room of the meet, recorded as from that room, or for none, recorded
  as their own edit.
* An official's rooms' quizzes are those a revision was saved for one of their rooms. Until quizzes
  are tied to schedule slots (#16), a quiz not tied to the schedule belongs to every room a revision
  was saved for, so sending another room's quiz name, after the warning, gives this room access to
  it. A correction or restore is recorded for one of the official's rooms the quiz already has, so
  it never adds a room. An account may officiate several rooms and sees all of theirs.
* Officials see what their rooms' quizzes count for and what is wrong with each, and may link one of
  their rooms' quizzes to its scheduled quiz, since they know which quiz they scored. They don't set
  a stage, accept a quiz as scored, or see the standings.
* A quiz in error (a scoring error, a name not on the roster of its division, or a difference from
  its scheduled quiz) counts for nothing until it is fixed or an admin accepts it as scored.
* What viewers, coaches and officials see of results and standings is the meet's stats settings' to
  say (specs/006-meet-stats, FR-018): each thing from a moment reached by its division's state or
  the meet's phase, and each stage's quiz results with places only or places and scores. Before
  `live` they see nothing of either. The API cuts each response to what the caller may see before
  answering, so nothing reaches them early by any route. Admins see everything.
* Prelim standings and the re-rank show as the order the admin confirmed, locked in, from the move
  that confirmed them; quizzer standings are locked in only once the meet is `done`, and a preview
  before that. Each table says which state it is in: live preview, preview or locked in.
* No one but admins sees warnings or flags. An official also sees, on their own rooms' quizzes, what
  is wrong with each, whether its question types are incomplete, and whether it was seated from an
  order since withdrawn. Nobody below admin sees a full scoresheet of a quiz not their own.
* A division's state now matters within `live`: moving it on confirms the order a step ends with,
  and moving it back withdraws it (see [scheduling.md](./scheduling.md)). Stats settings change
  while the meet is not `done`.
* A meet's page has five tabs (specs/010-meet-day). Schedule, Quizzes and Standings are for everyone
  who may read the meet, guests included; Roster is for its members, and Setup for its admins, a
  guest who opens either being shown the Schedule. Each tab gives a reader exactly what the rules
  above give them: the schedule's results and the Quizzes list come from the meet day
  (`GET /api/meets/:id/day`), which cuts each quiz as a division's stats do, so a stage a reader may
  not see yet shows every quiz of it as not shown yet, in or not, and a bench's team shows only once
  the reader may see where it comes from. Admins and officials also have the stored quizzes behind
  the list, as above; viewers and coaches share one copy of the meet day, kept 20 seconds, since it
  is the same for all of them.

## Actions by credential

Which principal can perform each action, given the role and phase allow it.

| Action                                                          | Performed as      |
| --------------------------------------------------------------- | ----------------- |
| Read what the phase allows a viewer                             | account or guest  |
| Read the meet day (`GET /api/meets/:id/day`), cut to the caller | account or guest  |
| Send, read, and correct a room's quizzes, as its official       | account or guest  |
| Coach and admin actions                                         | account           |
| Create, list, or delete meets                                   | superuser account |
| Redeem any code for a membership (`POST /api/join`)             | account           |
| Redeem a viewer or room code for a guest token (`/join/guest`)  | anyone            |
| List one's own memberships                                      | account           |

## Invariants

Every route keeps these, and a new route must too. The first two restate constitution principle IV.

* **Per-meet authorization.** Every route that reads or writes a meet's data authorizes the
  principal for that meet. Being signed in is not authorization.
* **Scope containment.** Every id in a request (church, team, quizzer, room, slot, quiz) belongs to
  the meet the route authorizes, and to the church or room the grant is scoped to. A grant never
  reaches another meet's objects.
* **Guest ceiling.** A guest can do what a viewer can and, as an official, send, read, and correct
  its room's quizzes. Nothing else.
* **One bearer scheme.** Guest tokens are the only bearer credential, each scoped to one meet and
  one role.
* **Codes are redeemed, not presented.** Admin, coach, and room codes appear only in the body of a
  join request. The viewer code also names its meet in a `?meet=` link.
* **Precedence.** A session outranks a guest token on the same request.
* **Revoked is revoked.** A guest token whose code has changed, or whose room is gone, grants
  nothing, reads included: the request is treated as having no token.
* **Missing looks like forbidden.** A route answers the same for an object that doesn't exist as for
  one the principal may not see, so ids reveal nothing about other meets.
* **No stored secrets on clients.** A client keeps its session cookie and guest tokens. It doesn't
  keep admin, coach, or room codes once they are redeemed; viewer codes may be kept, since they
  renew a viewer's token.
* **No codes below admin.** A response never gives a code or code hash to a principal below admin,
  except the viewer code to viewers, guests included.
* **Phase is checked on the server.** Every read and write the table above limits by phase is
  refused by the API in the other phases, not only hidden in the UI.

## Codes

Each scope carries exactly one code at a time.

| Scope  | Code        | Grants   | Created by | Form                                                                                                                |
| ------ | ----------- | -------- | ---------- | ------------------------------------------------------------------------------------------------------------------- |
| Meet   | admin code  | admin    | superuser  | random, stored hashed                                                                                               |
| Church | coach code  | coach    | admin      | random, stored hashed                                                                                               |
| Room   | room code   | official | admin      | random, stored hashed                                                                                               |
| Meet   | viewer code | viewer   | admin      | slug set by the admin: letters, digits, and hyphens, not all digits; stored as is, unique and matched ignoring case |

A room's code is `official_code` in older text and in the API's `official-codes` routes.

## Join Flow

A user joins by entering a code in the scoresheet or the portal, or by opening a viewer `?meet=`
link.

**With an account**, `POST /api/join { code }` creates a membership:

```
1. Check the viewer code (plain slug match, ignoring case)
   → insert ViewerMembership, return { meet, role: viewer }

2. Hash the code, then check:
   a. the meet's admin code      → insert AdminMembership
   b. a church's coach code      → insert CoachMembership(church)
   c. a room's code              → insert OfficialMembership(room)

3. No match → 404 Invalid code
```

Joining is idempotent: entering a code you already hold returns the existing membership.

**Without an account**, `POST /api/join/guest { code }` accepts a viewer or room code and returns a
guest token, plus for a room code the room (`room: { id, name }`). Coach and admin codes need an
account.

**Signing in with a guest account** upgrades the account with its codes, as joining with each code
while signed in would. A viewer's token is upgraded with the viewer code the device kept, without
asking. Room codes aren't kept, so one dialog lists each room the device joined as a guest official
and asks for its code; a skipped room is dropped. A guest token is never accepted in place of a
code.

### Meet links

The scoresheet accepts `?meet=<viewer code>`, which joins as a guest viewer
([auth.md § Guest tokens](./auth.md#guest-tokens-officials-and-viewers-without-accounts)) and is
then removed from the address bar. No other code is ever put in a link. The portal's links to a
scheduled or stored quiz name the meet by id as `meetId`.

## Code Rotation

Admin, coach, and room codes support two rotation modes:

| Mode           | Effect                                                                      |
| -------------- | --------------------------------------------------------------------------- |
| Rotate only    | Generates a new code. Existing memberships **keep** their access.           |
| Rotate + clear | Generates a new code. Every membership the old code granted is **deleted**. |

Either mode revokes the guest tokens issued for a room's old code, at once.

The viewer code is a slug the admin sets. It has no rotation modes: changing it leaves viewer
memberships in place and revokes the viewer guest tokens issued for the old code.

### Who can rotate

* Admin code: an admin; rotate-and-clear, which removes the other admins, needs a superuser
* Coach code: an admin
* Room code: an admin
* Viewer code: an admin (by editing the meet)

Superusers can do anything an admin can.

## Revoking access

* **A membership** ends when an admin removes it (an admin membership: a superuser), when its code
  is rotated and cleared, or when its church, room, or meet is deleted.
* **A guest token** ends 24 hours after it was issued, or at once when the code it was issued for
  changes (the room's code, or the meet's viewer code) or its room is deleted. Ending a guest
  official's token stops their scoring, not their watching: every viewer of a meet, guest officials
  included, is given its viewer code, so they can rejoin as a viewer. Changing the viewer code is
  what ends watching.
* **A session** ends when the user signs out, which also ends the guest account on that device.
* **A guest's own meet** can be left from the scoresheet's meet picker or the portal's home page,
  which removes that meet's guest token from the device.
