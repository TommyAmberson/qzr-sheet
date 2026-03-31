import { integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'
import { AccountRole } from '@qzr/shared'

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
  coachCodeHash: text('coach_code_hash').notNull(),
  viewerCode: text('viewer_code').notNull(), // superuser-set human-readable slug
  divisions: text('divisions').notNull().default('[]'), // JSON string[]
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})

export const officialCodes = sqliteTable('official_codes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  meetId: integer('meet_id')
    .notNull()
    .references(() => quizMeets.id, { onDelete: 'cascade' }),
  label: text('label').notNull(), // e.g. "Room A"
  codeHash: text('code_hash').notNull(),
})

// ---- Meet memberships ----

export const coachMemberships = sqliteTable(
  'coach_memberships',
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

export const officialMemberships = sqliteTable(
  'official_memberships',
  {
    accountId: text('account_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    meetId: integer('meet_id')
      .notNull()
      .references(() => quizMeets.id, { onDelete: 'cascade' }),
    officialCodeId: integer('official_code_id')
      .notNull()
      .references(() => officialCodes.id, { onDelete: 'cascade' }),
  },
  (t) => [unique().on(t.accountId, t.meetId, t.officialCodeId)],
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
  createdBy: text('created_by')
    .notNull()
    .references(() => user.id),
  name: text('name').notNull(),
  shortName: text('short_name').notNull(),
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
  number: integer('number').notNull(), // per-church (global across divisions)
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

// ---- Inferred types ----

export type User = typeof user.$inferSelect
export type Session = typeof session.$inferSelect
export type Account = typeof account.$inferSelect
export type Verification = typeof verification.$inferSelect
export type QuizMeet = typeof quizMeets.$inferSelect
export type OfficialCode = typeof officialCodes.$inferSelect
export type Church = typeof churches.$inferSelect
export type Team = typeof teams.$inferSelect
export type QuizzerIdentity = typeof quizzerIdentities.$inferSelect
export type TeamRoster = typeof teamRosters.$inferSelect
