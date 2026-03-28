# Auth Proposal

## Overview

Two account types. Access to meet data is granted via short-lived codes distributed by an admin, not
by permanent role assignment.

## Account Types

| Type     | Description                                                         |
| -------- | ------------------------------------------------------------------- |
| `admin`  | Global. Creates and manages all quiz meets.                         |
| `normal` | Default after OAuth signup. No meet access until a code is entered. |

Admins are provisioned out-of-band (e.g. seeded in the DB).

## OAuth Signup

Users sign in via a third-party OAuth provider (Google, GitHub, etc.). On first login a `normal`
account is created. No meet access is granted until the user joins a meet with a code.

## Quiz Meets

An admin creates a **QuizMeet** (e.g. a tournament meet). Each QuizMeet has codes for three roles:

| Code            | Multiplicity | Grants                                 |
| --------------- | ------------ | -------------------------------------- |
| `coach_code`    | One          | Head coach — manage teams and quizzers |
| `official_code` | Many         | Official — submit `QuizFile` results   |
| `viewer_code`   | One          | Viewer — read-only access to meet data |

### Coach code

One per meet. Server-generated random token. The admin can rotate it (invalidating the old one) or
revoke a specific account's `head_coach` membership directly.

### Official codes

Multiple per meet — one per quiz room is the typical setup. Each code is independently named (e.g.
`"Room A"`, `"Room B"`) and can be rotated individually without affecting other rooms. An admin can
create, rename, rotate, or delete any official code at any time.

### Viewer code

One per meet. **Admin-set human-readable slug** (e.g. `"grace-2025"`) chosen for easy verbal
sharing. The viewer code is **semi-public**: any authenticated meet participant (admin, head coach,
official, or viewer) can see and share it.

## Joining a Meet

A user can join a meet by entering a code in two ways:

* **In-app** — after signing in (or during signup), a prompt accepts a code and immediately grants
  the corresponding role.
* **Via link** — the admin can share a join link that encodes the code. Visiting the link takes the
  user through sign-in/signup and automatically applies the code on completion.

Join links are as secure as the code itself — anyone with the link can join with that role. Rotating
the code invalidates both the code and any previously shared links for that code.

> **Open question:** should join links be available for all three roles, or restricted to
> `viewer_code` only? A `coach_code` or `official_code` link is no less secure than the code, but a
> clickable link may feel easier to misshare than a short code typed manually.

## Meet-Scoped Roles

Roles are **not** permanent account properties — they are memberships scoped to a specific QuizMeet.
The same account can hold different roles at different meets simultaneously, and multiple roles
within the same meet.

* **Admins** automatically have all roles for all meets — no membership rows needed.
* An **official** can hold multiple official-role memberships within the same meet (e.g.
  credentialed for both Room A and Room B).

```
Account (normal)
  ├── meet:101  roles: [head_coach, official(Room A)]
  ├── meet:102  role: official(Room B)
  ├── meet:103  role: viewer
  └── meet:104  (no membership — no access)
```

### head_coach

* Granted by entering the meet's `coach_code`
* After joining, the coach creates one or more churches they are managing for this meet, setting the
  name and short name for each
* All teams they create are assigned to one of their churches
* Cannot access other meets unless separately joined
* Admin can revoke by removing the `CoachMembership` record directly

### official

* Granted by entering any of the meet's `official_code`s (typically one per quiz room)
* Can submit `QuizFile` results for this meet
* Cannot manage teams or quizzers
* **No account required** — a code or join link issues a short-lived guest JWT instead; see
  [Quiz Ingest](#quiz-ingest)

### viewer

* Granted by entering the meet's `viewer_code`
* Read-only access to that meet's public data (standings, stats, schedules)
* Intended for quizzers, parents, and spectators
* **No account required** — a code or join link issues a guest JWT valid for the duration of the
  meet; see [Viewer Access](#viewer-access)

## Quiz Ingest

Completed `QuizFile` submissions require `official` (or `admin`) access for the meet.

Officials without an account can enter an `official_code` directly or follow a join link. Either way
the server issues a short-lived signed JWT (valid for 24h or until the meet ends) that grants submit
access without any persistent identity.

```
POST /meets/{id}/guest-session  { code: "abc123" }
  → 200 { token: "<signed JWT>", role: "official", meet_id, expires_at }

POST /quizzes  Authorization: Bearer <token>
  → 201
```

Guest sessions are stateless — the server only validates the signature and expiry on each request.
An optional `submitter_name` field on the request body provides a lightweight audit trail if needed.

## Live Meet Data

> **Future idea:** the server could support a publish model where stats and schedule draws are
> pushed to viewers. An admin presses a button to publish updated stats or results. Schedule draws
> could auto-update to show which teams are assigned to which rooms. This would make the viewer
> experience much richer.

## Viewer Access

Viewers without an account can enter the `viewer_code` directly or follow a join link. Either way
the server issues a guest JWT valid for the duration of the meet.

> **Future idea:** viewers could follow specific churches, teams, or quizzers. This would let
> quizzers track when they and a friend are quizzing together, coaches see when their teams are up,
> and parents follow their kids. Requires an account to persist preferences across sessions — guest
> JWT viewers would not get this feature.

## Data Model Sketch

```
Account
  id
  oauth_provider
  oauth_subject
  email
  role: 'admin' | 'normal'

QuizMeet
  id
  name
  date
  coach_code        # server-generated token
  viewer_code       # plain slug, admin-set, semi-public
  official_codes[]  # one-to-many via OfficialCode

OfficialCode        # one row per quiz room
  id
  label             # e.g. "Room A"
  code              # server-generated token

Church              # created by a coach after joining a meet; coach can manage multiple
  id
  meet_id
  created_by        # account_id of the coach who created it
  name              # e.g. "Grace Community Church"
  short_name        # e.g. "GCC" — used in team names and display

ViewerMembership    # for accounts that joined as viewer (optional — viewers can also use guest JWTs)
  account_id
  meet_id

CoachMembership     # one per coach per meet
  account_id
  meet_id

OfficialMembership  # one per official code per official per meet
  account_id
  meet_id
  official_code_id

QuizzerIdentity     # thin record — exists only to link a quizzer across meets for career stats
  id                # no other fields

Team
  id
  meet_id
  church_id
  division
  number            # per-church per-division (1, 2, 3...)
  # display name derived: "{church.short_name} {number}"

TeamRoster          # a quizzer's participation in a specific meet
  team_id
  quizzer_id        # references QuizzerIdentity — always set, new identity created if unlinked
  name              # name for this meet

# Officials and viewers without accounts use stateless guest JWTs issued via /meets/{id}/guest-session
# Admins have implicit access to everything — no membership rows needed
```

## Quizzer Identity and Roster Linking

Within a meet, a quizzer's name and church are fully defined by their `TeamRoster` row. The
`QuizzerIdentity` record has no fields — it exists only as a stable ID for cross-meet stat queries:

```sql
SELECT * FROM TeamRoster WHERE quizzer_id = ?
```

### Linking flow

When a coach adds a quizzer, they type a name. The server suggests matches from historical rosters,
ranked by recency and church affiliation. The coach can:

* **Link** a suggestion — points the new `TeamRoster` row to an existing `QuizzerIdentity`
* **Create new** — a fresh `QuizzerIdentity` is created automatically

If a coach skips linking (creates new for someone who has history), the two `QuizzerIdentity`
records can be **merged** later by an admin.

### Warnings

The UI should warn and require confirmation when:

* The linked quizzer was on a **different church's team** at their most recent meet
* The linked quizzer is **already rostered** on another team at this meet
* The name match has **low confidence** (partial overlap only)
