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
  viewerCode     -- plain slug, admin-set, semi-public; unique ignoring case
  divisions      -- JSON string[] e.g. ["1","2C","Junior"]: bare, the prefix (Div, D) is only
                    shown; one saved as "Div 1" shows as such until renamed
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

QuizResult             -- one quiz of a meet; its content is its newest revision, and what it
                          counts for is its stage, from its QuizResultChange rows
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

QuizResultScore        -- what scoring makes of a revision's quiz file, kept so a division's
                          stats are ranked without scoring anything; holds only what the file
                          determines (no placement points, stage or ranking). Written when the
                          revision is saved, and written again when read if it is missing or
                          another @qzr/shared version made it
  revisionId           -- PK, FK → QuizResultRevision (cascade delete); a revision that restores
                          another has no row and uses the row of the revision it restores
  sharedVersion        -- the @qzr/shared version that scored it
  scored               -- JSON, a `ScoredQuiz`: the quiz's name and own placement formula; per
                          team its name, score, score before overtime, errors and place by
                          score; per named quizzer the points, errors, correct answers and
                          correct answers by question type; and every scoring problem

QuizResultChange       -- append-only: one row per decision about a stored quiz; its current
                          value of each kind is its newest row of that kind
  id
  resultId             -- FK → QuizResult (cascade delete)
  kind                 -- stage | link | acceptance | kept
  stage                -- for `stage`: prelim | intermediate | elimination | finals | notCounted,
                          an admin's choice of what the quiz counts for; null removes the choice.
                          A quiz's stage is this, else the stage of the scheduled quiz it is
                          linked to, else prelim where its newest QuizResultCountChange says it
                          counts, else none
  scheduleQuizId       -- for `link`: the quiz's id in the published schedule document, or null
                          when the link is removed. At most one stored quiz is linked to a
                          scheduled quiz
  how                  -- for `link`: sheet (the scoresheet named it on submitting) | hand. A
                          quiz with no such row is linked, when read, to the scheduled quiz of
                          its name; that link is not recorded. An unlink by hand stays unlinked
  revision, accepted   -- for `acceptance`: the revision whose content an admin accepted as
                          scored, or no longer accepts. A quiz in error counts only while its
                          current content is that of an accepted revision
                          (`kept` has no fields of its own: an admin kept the quiz as it is after
                          an order it was seated from was withdrawn, clearing that flag)
  changedByAccountId   -- FK → User (set null if deleted)
  changedByRoomId      -- FK → Room, for an official's link (set null if deleted)
  changedByName        -- who made it, as named then
  changedAt

QuizResultCountChange  -- read-only since stored quizzes have stages: no row is written any
                          more. One row per count or uncount made before; still shown in a quiz's
                          history, and still makes a quiz with no stage of its own and no link a
                          prelim when its newest row says it counts
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

# ---- Stats ----

MeetStatsSettings      -- append-only: one row per save; the newest is the meet's stats settings,
                          and a meet with none has the defaults
  id
  meetId               -- FK → QuizMeet (cascade delete)
  settings             -- the settings document, JSON, validated by the shared schema before
                          storing: tie-break order, how teams level in a quiz are scored, whether
                          prelims are played without overtime, and what viewers see and when
  savedByAccountId     -- FK → User (set null if deleted)
  savedByName          -- who saved it, as named then
  savedAt

DivisionConfirmation   -- append-only: one row each time an admin confirms or withdraws a
                          division's prelim order or re-rank, by moving its state
  id
  meetId               -- FK → QuizMeet (cascade delete)
  division             -- as the meet spells it
  what                 -- prelims | rerank
  confirmed            -- true for a confirmation, false for a withdrawal. A division's confirmed
                          order is the teams of its newest row of that `what`, when that row
                          confirms
  teams                -- on a confirmation: the teams in order as they stood, JSON
  affected             -- on a withdrawal: the stored quizzes of later stages seated from the
                          order withdrawn, JSON ids. Each is flagged as played under a withdrawn
                          order until a newer `kept` QuizResultChange, or its stage is not counted
  byAccountId          -- FK → User (set null if deleted)
  byName               -- who did it, as named then
  at

MeetNameDismissal      -- two names an admin said are different, so their look-alike flag is
                          not raised again; UNIQUE(meetId, division, team, nameA, nameB)
  id
  meetId               -- FK → QuizMeet (cascade delete)
  division             -- folded, as a result key holds it
  team                 -- for two quizzers, their team's folded name; empty for two team names
  nameA, nameB         -- the two names, folded, in sorted order, so either way round is one pair
  byAccountId          -- FK → User (set null if deleted)
  byName               -- who did it, as named then
  at

DivisionState          -- one row per meet and division the admin has moved, updated in place
  id
  meetId               -- FK → QuizMeet (cascade delete)
  division             -- as the meet spells it; UNIQUE(meetId, division)
  state                -- prelim_running | stats_break | elim_running | finals | division_done;
                          a division with no row is running its prelims
  transitionedAt

# ---- Schedules ----

MeetSchedule           -- a meet's linked schedule: the draft the builder saves, one per meet
  id
  meetId               -- FK → QuizMeet (cascade delete); UNIQUE
  draft                -- the schedule document, JSON, validated before storing
  draftRevision        -- increments on every save; a save names the revision it read, and a
                          stale one is refused with the newer draft
  draftSavedAt

MeetScheduleVersion    -- append-only: one row per publish, never updated or deleted while the
                          meet exists, unlinking included; the newest is the published schedule
  id
  meetId               -- FK → QuizMeet (cascade delete)
  version              -- 1, 2, 3, … per meet; UNIQUE(meetId, version)
  document             -- the schedule document as published
  publishedAt
  publishedByAccountId -- FK → User (set null if deleted)
  publishedByName      -- who published it, as named then
```

The schedule document's shape is in `specs/005-schedule-redesign/data-model.md`. The old schedule
tables (`meet_slots`, `scheduled_quizzes`, `scheduled_quiz_seats`, `prelim_assignments`,
`seed_resolutions`) are no longer written; see `docs/scheduling.md` §8.

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
