# Roles and Access

## Overview

Access to meet data is granted via short-lived codes distributed by admins, not by permanent role
assignment. The same account can hold different roles at different meets simultaneously, and
multiple roles within the same meet.

```
Account (normal)
  ├── meet:101  roles: [admin, coach(Church A)]
  ├── meet:102  role: coach(Church B)
  ├── meet:103  role: official(Room 1)
  ├── meet:104  role: viewer
  └── meet:105  (no membership — no access)
```

Superusers have implicit full access to all meets — no membership rows needed.

## Meet-Scoped Roles

### admin

* Granted by entering a meet's `admin_code`
* Can create and manage churches and rooms for that meet, including generating and rotating codes
* Can view and manage all rosters within the meet
* Cannot access other meets unless separately joined
* A superuser can revoke by deleting the `AdminMembership` record

### coach

* Granted by entering a church's `coach_code`
* Can manage teams and rosters for that specific church only
* Cannot access other churches in the meet, or other meets, unless separately joined
* An admin can revoke by deleting the `CoachMembership` record

### official

* Granted by entering a room's `official_code`
* Can submit `QuizFile` results for that room
* Cannot manage teams or rosters
* **No account required** — a code or join link issues a short-lived guest JWT; see
  [auth.md § Guest JWTs](./auth.md#guest-jwts-officials-and-viewers-without-accounts)

### viewer

* Granted by entering the meet's `viewer_code`
* Read-only access to the meet's public data (standings, stats, schedules)
* Intended for quizzers, parents, and spectators
* **No account required** — same guest JWT mechanism as officials

## Resources and Codes

Each resource type carries exactly one code at a time. Codes are server-generated random strings,
stored hashed.

| Resource | Code field      | Grants           | Created by |
| -------- | --------------- | ---------------- | ---------- |
| Meet     | `admin_code`    | admin            | superuser  |
| Church   | `coach_code`    | coach            | admin      |
| Room     | `official_code` | official         | admin      |
| Meet     | `viewer_code`   | viewer (no acct) | admin      |

## Join Flow

A user joins by entering a code in-app or following a join link:

```
POST /api/join  { code }

1. Check viewer_code (plaintext slug match on quizMeets)
   → insert ViewerMembership, return { meet, role: viewer }

2. Hash the code, then check:
   a. quizMeets.adminCodeHash
      → insert AdminMembership, return { meet, role: admin }
   b. churches.coachCodeHash
      → insert CoachMembership(churchId), return { meet, church, role: coach }
   c. rooms.officialCodeHash
      → insert OfficialMembership(roomId), return { meet, room, role: official }

3. No match → 404 Invalid code
```

Join is idempotent — re-entering a code you already hold just returns the existing membership
without creating duplicates.

### Join links

Any participant with access to a code can share a join link that encodes the code:

```
https://versevault.ca/join?code=<code>
```

Visiting the link takes the user through sign-in/signup and automatically applies the code on
completion. Join links are as secure as the code itself — rotating the code invalidates all
previously shared links for that code.

## Code Rotation

All codes (admin, coach, official) support two rotation modes:

| Mode           | Effect                                                          |
| -------------- | --------------------------------------------------------------- |
| Rotate only    | Generates a new code. Existing members **keep** their access.   |
| Rotate + clear | Generates a new code. All existing memberships are **deleted**. |

The viewer code is a plain slug set by the admin — it doesn't have membership rows, so rotation
always just updates the slug.

### Who can rotate

* `admin_code` — superuser only
* `coach_code` — admin or superuser
* `official_code` — admin or superuser
* `viewer_code` — admin or superuser
