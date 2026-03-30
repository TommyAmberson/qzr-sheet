import { integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'
import { AccountRole, MeetRole } from '@qzr/shared'

// ---- Accounts ----

export const accounts = sqliteTable('accounts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  oauthProvider: text('oauth_provider').notNull(),
  oauthSubject: text('oauth_subject').notNull(),
  email: text('email').notNull(),
  role: text('role', { enum: [AccountRole.Admin, AccountRole.Normal] })
    .notNull()
    .default(AccountRole.Normal),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})

// ---- Quiz meets ----

export const quizMeets = sqliteTable('quiz_meets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  date: text('date').notNull(), // ISO 8601 date string
  coachCodeHash: text('coach_code_hash').notNull(),
  viewerCode: text('viewer_code').notNull(), // admin-set human-readable slug
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
    accountId: integer('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    meetId: integer('meet_id')
      .notNull()
      .references(() => quizMeets.id, { onDelete: 'cascade' }),
  },
  (t) => [unique().on(t.accountId, t.meetId)],
)

export const officialMemberships = sqliteTable(
  'official_memberships',
  {
    accountId: integer('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
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
    accountId: integer('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
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
  createdBy: integer('created_by')
    .notNull()
    .references(() => accounts.id),
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
  number: integer('number').notNull(), // per-church per-division
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

export type Account = typeof accounts.$inferSelect
export type QuizMeet = typeof quizMeets.$inferSelect
export type OfficialCode = typeof officialCodes.$inferSelect
export type Church = typeof churches.$inferSelect
export type Team = typeof teams.$inferSelect
export type QuizzerIdentity = typeof quizzerIdentities.$inferSelect
export type TeamRoster = typeof teamRosters.$inferSelect
