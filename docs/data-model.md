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

# ---- Results ----

QuizResult             -- one quiz of a meet; its content is its newest revision, and whether
                          it counts in the standings is its newest QuizResultCountChange
  id
  meetId               -- FK → QuizMeet (cascade delete)
  roomId               -- FK → Room the quiz was first submitted from; null for uploads
                          (set null if the room is deleted). Unread: the first revision's
                          saver says where a quiz came from and outlives the room. Dropping
                          it means a table rebuild, which on D1 would cascade to revisions
  quizKey              -- division, consolation and quiz number, folded for case and spaces;
                          identifies a quiz not tied to the schedule; UNIQUE(meetId, quizKey)
  createdAt

QuizResultRevision     -- append-only: one row per save, never updated or deleted
  id
  resultId             -- FK → QuizResult (cascade delete)
  revision             -- 1, 2, 3, … per result
  quizFile             -- the full QuizFile JSON, validated before storing; null when the
                          revision restores another
  action               -- submitted | uploaded | edited | merged | restored
  restoredFrom         -- for a revision with no file, the revision whose file it makes
                          current (always one with a file); exactly one of quizFile and
                          restoredFrom is set. The newest revision is the current one
  savedByAccountId     -- FK → User when signed in (set null if deleted)
  savedByRoomId        -- FK → Room when an official saved it (set null if deleted)
  savedByName          -- who saved it, as named then, so the trail outlives renames and deletions
  savedAt
  UNIQUE(resultId, revision)

QuizResultCountChange  -- append-only: one row per count or uncount; a quiz counts when its
                          newest row says so, and not until an admin first counts it
  id
  resultId             -- FK → QuizResult (cascade delete)
  counted              -- the new value
  changedByAccountId   -- FK → User (set null if deleted)
  changedByName        -- who changed it, as named then
  changedAt

MeetTeamName           -- optional team names per division, which the meet's scoresheets offer;
                          independent of churches and Team, for meets that have neither
  id
  meetId               -- FK → QuizMeet (cascade delete)
  division             -- as quizzes write it
  name
  nameKey              -- the name folded for case and spaces; UNIQUE(meetId, division, nameKey)
  sortOrder            -- display order across the meet's list
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
