import { integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'
import { AccountRole, MEET_PHASES, DIVISION_STATES } from '@qzr/shared'

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

// ---- Saves + results ----

// Append-only history of an official's in-progress QuizFile state. The
// scoresheet debounces edits and POSTs autosaves; a manual "Save to
// server" creates a `checkpoint` row. Admins scrub through this for
// audit / recovery; stats never read it directly (stats read from
// quiz_results, which is the frozen submit snapshot).
//
// Grouping for "the history of one quiz" is by
// (meetId, submittedBy*, scheduledQuizId | (division+round)). No
// uniqueness — every save is a new row.
export const quizSaves = sqliteTable('quiz_saves', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  meetId: integer('meet_id')
    .notNull()
    .references(() => quizMeets.id, { onDelete: 'cascade' }),
  // Nullable when the scoresheet wasn't loaded from the schedule.
  scheduledQuizId: integer('scheduled_quiz_id').references(() => scheduledQuizzes.id, {
    onDelete: 'set null',
  }),
  roomId: integer('room_id').references(() => meetRooms.id, { onDelete: 'set null' }),
  division: text('division').notNull(),
  round: text('round').notNull(),
  savedAt: integer('saved_at', { mode: 'timestamp' }).notNull(),
  kind: text('kind', { enum: ['autosave', 'checkpoint'] }).notNull(),
  // Optional checkpoint label ("end of Q15", "before re-check") — null for autosaves.
  label: text('label'),
  // Exactly one of these is set; null for the other.
  savedByAccountId: text('saved_by_account_id').references(() => user.id, {
    onDelete: 'set null',
  }),
  savedByGuestLabel: text('saved_by_guest_label'),
  quizFile: text('quiz_file').notNull(),
})

// Immutable submit snapshot. Created when an official marks the quiz
// "done" via the Submit button — the server snapshots the current
// QuizFile and stores it here. Stats read from this table.
//
// quizId is nullable for orphaned submissions (scoresheet wasn't
// loaded from the schedule). SQLite treats NULL as distinct in
// unique indexes, so orphans coexist freely; the (meetId, quizId)
// constraint only fires when quizId is set.
//
// Post-submit, the underlying quiz_saves history keeps growing —
// quiz_results stays frozen at submit-time. Admin can compare the
// snapshot against later saves to spot post-submit edits.
export const quizResults = sqliteTable(
  'quiz_results',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    meetId: integer('meet_id')
      .notNull()
      .references(() => quizMeets.id, { onDelete: 'cascade' }),
    quizId: integer('quiz_id').references(() => scheduledQuizzes.id, {
      onDelete: 'set null',
    }),
    roomId: integer('room_id').references(() => meetRooms.id, { onDelete: 'set null' }),
    division: text('division').notNull(),
    round: text('round').notNull(),
    submittedAt: integer('submitted_at', { mode: 'timestamp' }).notNull(),
    submittedByAccountId: text('submitted_by_account_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    submittedByGuestLabel: text('submitted_by_guest_label'),
    quizFile: text('quiz_file').notNull(),
  },
  (t) => [unique().on(t.meetId, t.quizId)],
)

// Flag a submitted result for admin review. Multiple disputes per
// result allowed. Officials raise; admins resolve.
export const quizDisputes = sqliteTable('quiz_disputes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  resultId: integer('result_id')
    .notNull()
    .references(() => quizResults.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  createdByAccountId: text('created_by_account_id').references(() => user.id, {
    onDelete: 'set null',
  }),
  createdByGuestLabel: text('created_by_guest_label'),
  reason: text('reason').notNull(),
  resolved: integer('resolved', { mode: 'boolean' }).notNull().default(false),
  resolvedAt: integer('resolved_at', { mode: 'timestamp' }),
  resolvedByAccountId: text('resolved_by_account_id').references(() => user.id, {
    onDelete: 'set null',
  }),
})

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
export type QuizSave = typeof quizSaves.$inferSelect
export type QuizResult = typeof quizResults.$inferSelect
export type QuizDispute = typeof quizDisputes.$inferSelect
