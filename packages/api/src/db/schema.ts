import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'
import { AccountRole, MEET_PHASES, DIVISION_STATES, RESULT_ACTIONS } from '@qzr/shared'

// ---- Better Auth core tables ----

export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  role: text('role', { enum: [AccountRole.Superuser, AccountRole.Normal] })
    .notNull()
    .default(AccountRole.Normal),
})

export const session = sqliteTable('session', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
})

export const account = sqliteTable('account', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp' }),
  refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp' }),
  scope: text('scope'),
  idToken: text('id_token'),
  password: text('password'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
})

export const verification = sqliteTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
})

// ---- Quiz meets ----

export const quizMeets = sqliteTable('quiz_meets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  dateFrom: text('date_from').notNull(), // ISO 8601 date string
  dateTo: text('date_to'), // ISO 8601 date string; null = single-day meet
  adminCodeHash: text('admin_code_hash').notNull(),
  viewerCode: text('viewer_code').notNull(), // admin-set human-readable slug
  divisions: text('divisions').notNull().default('[]'), // JSON string[]
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  phase: text('phase', { enum: MEET_PHASES }).notNull().default('registration'),
  registrationClosesAt: integer('registration_closes_at', { mode: 'timestamp' }),
  meetStartsAt: integer('meet_starts_at', { mode: 'timestamp' }),
})

// A named physical location within a meet (renamed from `official_codes`).
// codeHash is nullable so admins can create rooms in 'build' before issuing codes.
export const meetRooms = sqliteTable('meet_rooms', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  meetId: integer('meet_id')
    .notNull()
    .references(() => quizMeets.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  codeHash: text('code_hash'),
})

// ---- Meet memberships ----

export const adminMemberships = sqliteTable(
  'admin_memberships',
  {
    accountId: text('account_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    meetId: integer('meet_id')
      .notNull()
      .references(() => quizMeets.id, { onDelete: 'cascade' }),
  },
  (t) => [unique().on(t.accountId, t.meetId)],
)

export const coachMemberships = sqliteTable(
  'coach_memberships',
  {
    accountId: text('account_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    // churchId is the primary scope; meetId is denormalised for getMyMeets() queries
    churchId: integer('church_id')
      .notNull()
      .references(() => churches.id, { onDelete: 'cascade' }),
    meetId: integer('meet_id')
      .notNull()
      .references(() => quizMeets.id, { onDelete: 'cascade' }),
  },
  (t) => [unique().on(t.accountId, t.churchId)],
)

export const officialMemberships = sqliteTable(
  'official_memberships',
  {
    accountId: text('account_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    meetId: integer('meet_id')
      .notNull()
      .references(() => quizMeets.id, { onDelete: 'cascade' }),
    roomId: integer('room_id')
      .notNull()
      .references(() => meetRooms.id, { onDelete: 'cascade' }),
  },
  (t) => [unique().on(t.accountId, t.meetId, t.roomId)],
)

export const viewerMemberships = sqliteTable(
  'viewer_memberships',
  {
    accountId: text('account_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    meetId: integer('meet_id')
      .notNull()
      .references(() => quizMeets.id, { onDelete: 'cascade' }),
  },
  (t) => [unique().on(t.accountId, t.meetId)],
)

// ---- Churches, teams, quizzers ----

export const churches = sqliteTable('churches', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  meetId: integer('meet_id')
    .notNull()
    .references(() => quizMeets.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  shortName: text('short_name').notNull(),
  coachCodeHash: text('coach_code_hash').notNull(),
})

export const teams = sqliteTable('teams', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  meetId: integer('meet_id')
    .notNull()
    .references(() => quizMeets.id, { onDelete: 'cascade' }),
  churchId: integer('church_id')
    .notNull()
    .references(() => churches.id, { onDelete: 'cascade' }),
  division: text('division').notNull(),
  number: integer('number').notNull(), // per-church sequential (display derived: "{shortName} {number}")
  consolation: integer('consolation', { mode: 'boolean' }).notNull().default(false),
  // Roll Teams sorts by (lateness ASC, RAND ASC) so late teams land
  // in the highest-numbered letters — those play their first prelim
  // quiz in later rounds, giving a delayed bus more time to arrive.
  lateness: integer('lateness', { mode: 'boolean' }).notNull().default(false),
})

export const quizzerIdentities = sqliteTable('quizzer_identities', {
  id: integer('id').primaryKey({ autoIncrement: true }),
})

export const teamRosters = sqliteTable(
  'team_rosters',
  {
    teamId: integer('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    quizzerId: integer('quizzer_id')
      .notNull()
      .references(() => quizzerIdentities.id),
    name: text('name').notNull(),
  },
  (t) => [unique().on(t.teamId, t.quizzerId)],
)

// ---- Schedule ----

// Per-division state machine inside the `live` meet phase.
// Transitions: prelim_running → stats_break → elim_running → division_done.
export const divisionStates = sqliteTable(
  'division_states',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    meetId: integer('meet_id')
      .notNull()
      .references(() => quizMeets.id, { onDelete: 'cascade' }),
    division: text('division').notNull(),
    state: text('state', { enum: DIVISION_STATES }).notNull().default('prelim_running'),
    transitionedAt: integer('transitioned_at', { mode: 'timestamp' }).notNull(),
  },
  (t) => [unique().on(t.meetId, t.division)],
)

// A time-column row on the schedule grid. `kind='quiz'` hosts scheduledQuizzes
// across rooms; `kind='event'` spans all rooms (Breakfast, Stats Break, etc.).
export const meetSlots = sqliteTable('meet_slots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  meetId: integer('meet_id')
    .notNull()
    .references(() => quizMeets.id, { onDelete: 'cascade' }),
  startAt: integer('start_at', { mode: 'timestamp' }).notNull(),
  durationMinutes: integer('duration_minutes').notNull(),
  kind: text('kind', { enum: ['quiz', 'event'] }).notNull(),
  eventLabel: text('event_label'), // null for quiz slots
  sortOrder: integer('sort_order').notNull(),
})

// One 3-team quiz at (slot, room). Prelim or elim.
// `completedAt` is set by the result-linkage pipeline and gates immutability.
export const scheduledQuizzes = sqliteTable('scheduled_quizzes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  meetId: integer('meet_id')
    .notNull()
    .references(() => quizMeets.id, { onDelete: 'cascade' }),
  slotId: integer('slot_id')
    .notNull()
    .references(() => meetSlots.id, { onDelete: 'cascade' }),
  roomId: integer('room_id')
    .notNull()
    .references(() => meetRooms.id, { onDelete: 'cascade' }),
  division: text('division').notNull(),
  phase: text('phase', { enum: ['prelim', 'elim'] }).notNull(),
  lane: text('lane', { enum: ['main', 'consolation', 'intermediate'] }), // elim only
  label: text('label').notNull(), // e.g. "Div 1 Quiz 1", "Div 2 Quiz A"
  bracketLabel: text('bracket_label'), // elim only; e.g. "A", "D", "X"
  publishedAt: integer('published_at', { mode: 'timestamp' }),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
})

// Three seats per quiz. Holds only the def — letter (prelim) or seedRef (elim).
// The team binding lives in prelim_assignments or seed_resolutions.
export const scheduledQuizSeats = sqliteTable('scheduled_quiz_seats', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  quizId: integer('quiz_id')
    .notNull()
    .references(() => scheduledQuizzes.id, { onDelete: 'cascade' }),
  seatNumber: integer('seat_number').notNull(),
  letter: text('letter'), // 'A'–'U' for prelim seats
  seedRef: text('seed_ref'), // JSON for elim seats
})

// Resolution layer — prelim. (meetId, division, letter) → teamId.
// "Roll Teams" writes here; re-roll is a transactional UPDATE on the same rows.
export const prelimAssignments = sqliteTable(
  'prelim_assignments',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    meetId: integer('meet_id')
      .notNull()
      .references(() => quizMeets.id, { onDelete: 'cascade' }),
    division: text('division').notNull(),
    letter: text('letter').notNull(),
    teamId: integer('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    assignedAt: integer('assigned_at', { mode: 'timestamp' }).notNull(),
  },
  (t) => [unique().on(t.meetId, t.division, t.letter)],
)

// Resolution layer — elim. (meetId, seedRef) → teamId. Written by the
// result-linkage pipeline as prior quizzes complete.
export const seedResolutions = sqliteTable(
  'seed_resolutions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    meetId: integer('meet_id')
      .notNull()
      .references(() => quizMeets.id, { onDelete: 'cascade' }),
    seedRef: text('seed_ref').notNull(),
    teamId: integer('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    resolvedAt: integer('resolved_at', { mode: 'timestamp' }).notNull(),
  },
  (t) => [unique().on(t.meetId, t.seedRef)],
)

// ---- Results ----

// One quiz of a meet, whatever its history. Its content is its newest revision, and whether it
// counts in the standings is its newest counting record.
export const quizResults = sqliteTable(
  'quiz_results',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    meetId: integer('meet_id')
      .notNull()
      .references(() => quizMeets.id, { onDelete: 'cascade' }),
    // The room it was first submitted from; null for uploads. Unread: the first revision says where
    // a quiz came from, and survives the room's deletion. Dropping the column means rebuilding the
    // table, which on D1 would cascade-delete its revisions, so it waits for a safe migration.
    roomId: integer('room_id').references(() => meetRooms.id, { onDelete: 'set null' }),
    // The quiz's name (division, consolation, quiz number), folded for case and spaces; a quiz not
    // tied to the schedule is identified by it
    quizKey: text('quiz_key').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  },
  (t) => [unique().on(t.meetId, t.quizKey)],
)

// Append-only: one row per save, never updated or deleted while the meet exists
export const quizResultRevisions = sqliteTable(
  'quiz_result_revisions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    resultId: integer('result_id')
      .notNull()
      .references(() => quizResults.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    // A revision either carries a quiz file (JSON, validated before storing) or selects an earlier
    // revision of the same quiz that does, which makes that content current again
    quizFile: text('quiz_file'),
    restoredFrom: integer('restored_from'),
    action: text('action', { enum: RESULT_ACTIONS }).notNull(),
    savedByAccountId: text('saved_by_account_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    savedByRoomId: integer('saved_by_room_id').references(() => meetRooms.id, {
      onDelete: 'set null',
    }),
    // Who saved it, as named at the time, so the trail survives a renamed or deleted room or account
    savedByName: text('saved_by_name').notNull(),
    savedAt: integer('saved_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    unique().on(t.resultId, t.revision),
    check(
      'quiz_result_revisions_one_source',
      sql`(${t.quizFile} IS NULL) <> (${t.restoredFrom} IS NULL)`,
    ),
  ],
)

// Append-only: one row per count or uncount. A quiz counts when its newest row says so, and not
// until an admin first counts it.
export const quizResultCountChanges = sqliteTable(
  'quiz_result_count_changes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    resultId: integer('result_id')
      .notNull()
      .references(() => quizResults.id, { onDelete: 'cascade' }),
    counted: integer('counted', { mode: 'boolean' }).notNull(),
    changedByAccountId: text('changed_by_account_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    // Who changed it, as named at the time, so the trail survives a renamed or deleted account
    changedByName: text('changed_by_name').notNull(),
    changedAt: integer('changed_at', { mode: 'timestamp_ms' }).notNull(),
  },
  // A quiz's newest record is read for every quiz listed
  (t) => [index('quiz_result_count_changes_result_id_idx').on(t.resultId)],
)

// ---- Inferred types ----

export type User = typeof user.$inferSelect
export type Session = typeof session.$inferSelect
export type Account = typeof account.$inferSelect
export type Verification = typeof verification.$inferSelect
export type QuizMeet = typeof quizMeets.$inferSelect
export type MeetRoom = typeof meetRooms.$inferSelect
export type AdminMembership = typeof adminMemberships.$inferSelect
export type CoachMembership = typeof coachMemberships.$inferSelect
export type Church = typeof churches.$inferSelect
export type Team = typeof teams.$inferSelect
export type QuizzerIdentity = typeof quizzerIdentities.$inferSelect
export type TeamRoster = typeof teamRosters.$inferSelect
export type DivisionState = typeof divisionStates.$inferSelect
export type MeetSlot = typeof meetSlots.$inferSelect
export type ScheduledQuiz = typeof scheduledQuizzes.$inferSelect
export type ScheduledQuizSeat = typeof scheduledQuizSeats.$inferSelect
export type PrelimAssignment = typeof prelimAssignments.$inferSelect
export type SeedResolution = typeof seedResolutions.$inferSelect
export type QuizResult = typeof quizResults.$inferSelect
export type QuizResultRevision = typeof quizResultRevisions.$inferSelect

// Optional, per meet and division (Story 6): the team names the meet's scoresheets offer.
// Independent of churches and the teams table, for meets that have neither.
export const meetTeamNames = sqliteTable(
  'meet_team_names',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    meetId: integer('meet_id')
      .notNull()
      .references(() => quizMeets.id, { onDelete: 'cascade' }),
    division: text('division').notNull(),
    name: text('name').notNull(),
    // The name folded for case and spaces, so a division can't list one team twice
    nameKey: text('name_key').notNull(),
    // Display order across the meet's list: divisions in the order given, each one's names in turn
    sortOrder: integer('sort_order').notNull(),
  },
  (t) => [unique().on(t.meetId, t.division, t.nameKey)],
)
