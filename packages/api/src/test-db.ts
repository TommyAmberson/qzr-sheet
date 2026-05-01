import initSqlJs from 'sql.js'
import { drizzle } from 'drizzle-orm/sql-js'
import type { Db } from './lib/db'
import * as schema from './db/schema'

/**
 * Create a fresh in-memory SQLite database with all tables.
 * Returns a drizzle instance compatible with the Db type.
 */
export async function createTestDb(): Promise<Db> {
  const SQL = await initSqlJs()
  const sqlite = new SQL.Database()

  sqlite.run('PRAGMA foreign_keys = ON')

  // Create all tables from the final schema state
  sqlite.run(`
    CREATE TABLE user (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      email_verified INTEGER NOT NULL DEFAULT 0,
      image TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'normal'
    );

    CREATE TABLE session (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE account (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      account_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      access_token TEXT,
      refresh_token TEXT,
      access_token_expires_at INTEGER,
      refresh_token_expires_at INTEGER,
      scope TEXT,
      id_token TEXT,
      password TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE verification (
      id TEXT PRIMARY KEY NOT NULL,
      identifier TEXT NOT NULL,
      value TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER,
      updated_at INTEGER
    );

    CREATE TABLE quiz_meets (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      name TEXT NOT NULL,
      date_from TEXT NOT NULL,
      date_to TEXT,
      admin_code_hash TEXT NOT NULL,
      viewer_code TEXT NOT NULL,
      divisions TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      phase TEXT NOT NULL DEFAULT 'registration',
      registration_closes_at INTEGER,
      meet_starts_at INTEGER
    );

    CREATE TABLE meet_rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      meet_id INTEGER NOT NULL REFERENCES quiz_meets(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      code_hash TEXT
    );

    CREATE TABLE admin_memberships (
      account_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      meet_id INTEGER NOT NULL REFERENCES quiz_meets(id) ON DELETE CASCADE,
      UNIQUE(account_id, meet_id)
    );

    CREATE TABLE coach_memberships (
      account_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      church_id INTEGER NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
      meet_id INTEGER NOT NULL REFERENCES quiz_meets(id) ON DELETE CASCADE,
      UNIQUE(account_id, church_id)
    );

    CREATE TABLE official_memberships (
      account_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      meet_id INTEGER NOT NULL REFERENCES quiz_meets(id) ON DELETE CASCADE,
      room_id INTEGER NOT NULL REFERENCES meet_rooms(id) ON DELETE CASCADE,
      UNIQUE(account_id, meet_id, room_id)
    );

    CREATE TABLE viewer_memberships (
      account_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      meet_id INTEGER NOT NULL REFERENCES quiz_meets(id) ON DELETE CASCADE,
      UNIQUE(account_id, meet_id)
    );

    CREATE TABLE churches (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      meet_id INTEGER NOT NULL REFERENCES quiz_meets(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      short_name TEXT NOT NULL,
      coach_code_hash TEXT NOT NULL
    );

    CREATE TABLE teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      meet_id INTEGER NOT NULL REFERENCES quiz_meets(id) ON DELETE CASCADE,
      church_id INTEGER NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
      division TEXT NOT NULL,
      number INTEGER NOT NULL,
      consolation INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE quizzer_identities (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL
    );

    CREATE TABLE team_rosters (
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      quizzer_id INTEGER NOT NULL REFERENCES quizzer_identities(id),
      name TEXT NOT NULL,
      UNIQUE(team_id, quizzer_id)
    );

    CREATE TABLE division_states (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      meet_id INTEGER NOT NULL REFERENCES quiz_meets(id) ON DELETE CASCADE,
      division TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'prelim_running',
      transitioned_at INTEGER NOT NULL,
      UNIQUE(meet_id, division)
    );

    CREATE TABLE meet_slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      meet_id INTEGER NOT NULL REFERENCES quiz_meets(id) ON DELETE CASCADE,
      start_at INTEGER NOT NULL,
      duration_minutes INTEGER NOT NULL,
      kind TEXT NOT NULL,
      event_label TEXT,
      sort_order INTEGER NOT NULL
    );

    CREATE TABLE scheduled_quizzes (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      meet_id INTEGER NOT NULL REFERENCES quiz_meets(id) ON DELETE CASCADE,
      slot_id INTEGER NOT NULL REFERENCES meet_slots(id) ON DELETE CASCADE,
      room_id INTEGER NOT NULL REFERENCES meet_rooms(id) ON DELETE CASCADE,
      division TEXT NOT NULL,
      phase TEXT NOT NULL,
      lane TEXT,
      label TEXT NOT NULL,
      bracket_label TEXT,
      published_at INTEGER,
      completed_at INTEGER
    );

    CREATE TABLE scheduled_quiz_seats (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      quiz_id INTEGER NOT NULL REFERENCES scheduled_quizzes(id) ON DELETE CASCADE,
      seat_number INTEGER NOT NULL,
      letter TEXT,
      seed_ref TEXT
    );

    CREATE TABLE prelim_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      meet_id INTEGER NOT NULL REFERENCES quiz_meets(id) ON DELETE CASCADE,
      division TEXT NOT NULL,
      letter TEXT NOT NULL,
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      assigned_at INTEGER NOT NULL,
      UNIQUE(meet_id, division, letter)
    );

    CREATE TABLE seed_resolutions (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      meet_id INTEGER NOT NULL REFERENCES quiz_meets(id) ON DELETE CASCADE,
      seed_ref TEXT NOT NULL,
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      resolved_at INTEGER NOT NULL,
      UNIQUE(meet_id, seed_ref)
    );
  `)

  // Seed test users so FK constraints on membership tables are satisfied
  const now = Date.now()
  sqlite.run(
    `INSERT INTO user (id, name, email, email_verified, created_at, updated_at, role)
     VALUES ('admin-001', 'Test Admin', 'admin@test.com', 1, ${now}, ${now}, 'superuser'),
            ('user-001', 'Test User', 'user@test.com', 1, ${now}, ${now}, 'normal')`,
  )

  return drizzle(sqlite, { schema }) as unknown as Db
}
