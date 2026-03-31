# Data Model

The auth tables (`user`, `session`, `account`, `verification`) are owned by Better Auth and must not
be hand-edited. All app tables reference `user.id` (text UUID).

## Schema

```
# ---- Better Auth tables (managed — do not edit directly) ----

user
  id             text PK
  email          text unique
  emailVerified  bool
  name           text
  image          text
  role           'superuser' | 'normal'   -- additionalField, default: normal
  createdAt / updatedAt

session          -- one row per active session
  id, userId, token, expiresAt, ...

account          -- one row per linked OAuth provider per user
  providerId     -- e.g. 'github', 'google', 'credential'
  accountId      -- provider's stable user id
  userId         -- FK → user
  ...

verification     -- email verification / password reset tokens
  id, identifier, value, expiresAt

# ---- Quiz meets ----

QuizMeet
  id
  name
  dateFrom       -- ISO 8601 date
  dateTo         -- ISO 8601 date, null = single-day
  adminCodeHash  -- server-generated, hashed
  viewerCode     -- plain slug, admin-set, semi-public
  divisions      -- JSON string[] e.g. ["1","2","3"]
  createdAt

# ---- Memberships ----

AdminMembership        -- one per admin per meet
  accountId            -- FK → user
  meetId               -- FK → QuizMeet
  UNIQUE(accountId, meetId)

CoachMembership        -- one per coach per church
  accountId            -- FK → user
  churchId             -- FK → Church
  meetId               -- denormalised from church.meetId for getMyMeets() queries
  UNIQUE(accountId, churchId)

OfficialMembership     -- one per official per room
  accountId            -- FK → user
  roomId               -- FK → Room
  meetId               -- denormalised from room.meetId
  UNIQUE(accountId, roomId)

ViewerMembership       -- for accounts that joined as viewer
  accountId            -- FK → user
  meetId               -- FK → QuizMeet
  UNIQUE(accountId, meetId)

# ---- Churches ----

Church
  id
  meetId               -- FK → QuizMeet (cascade delete)
  name                 -- e.g. "Grace Community Church"
  shortName            -- e.g. "GCC" — used in team names and display
  coachCodeHash        -- server-generated when church is created, hashed

Team
  id
  meetId               -- FK → QuizMeet (cascade delete)
  churchId             -- FK → Church (cascade delete)
  division             -- e.g. "1", "2", "Open"
  number               -- per-church sequential integer (1, 2, 3...)
                       -- display name derived: "{church.shortName} {number}"

# ---- Rooms ----

Room
  id
  meetId               -- FK → QuizMeet (cascade delete)
  label                -- e.g. "Room A"
  officialCodeHash     -- server-generated when room is created, hashed

# ---- Quizzers ----

QuizzerIdentity        -- thin record; exists only for cross-meet stat linking
  id                   -- no other fields

TeamRoster             -- a quizzer's participation in a specific meet
  teamId               -- FK → Team (cascade delete)
  quizzerId            -- FK → QuizzerIdentity
  name                 -- display name for this meet
  UNIQUE(teamId, quizzerId)
```

## Notes

### Denormalised meetId on memberships

`CoachMembership.meetId` and `OfficialMembership.meetId` are redundant (derivable from the church or
room), but kept as a convenience column for the `getMyMeets()` query which needs to enumerate all
meets a user has any role in without joining through every resource table.

### Rooms vs OfficialCodes

The current implementation uses `officialCodes` / `officialMemberships` table names. These will be
renamed to `rooms` / `officialMemberships` (keeping the membership table name) when the next
migration is generated.

## Quizzer Identity and Roster Linking

Within a meet, a quizzer is fully defined by their `TeamRoster` row. The `QuizzerIdentity` record
has no fields — it exists only as a stable ID for cross-meet stat queries:

```sql
SELECT * FROM TeamRoster WHERE quizzer_id = ?
```

### Linking flow

When a coach adds a quizzer, they type a name. The server suggests matches from historical rosters,
ranked by recency and church affiliation. The coach can:

* **Link** a suggestion — points the new `TeamRoster` row to an existing `QuizzerIdentity`
* **Create new** — a fresh `QuizzerIdentity` is created automatically

If a coach skips linking, the two `QuizzerIdentity` records can be **merged** later by an admin.

### Warnings

The UI should warn and require confirmation when:

* The linked quizzer was on a **different church's team** at their most recent meet
* The linked quizzer is **already rostered** on another team at this meet
* The name match has **low confidence** (partial overlap only)
