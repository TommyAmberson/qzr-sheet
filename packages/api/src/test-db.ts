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
      coach_code_hash TEXT NOT NULL,
      viewer_code TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE official_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      meet_id INTEGER NOT NULL REFERENCES quiz_meets(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      code_hash TEXT NOT NULL
    );

    CREATE TABLE coach_memberships (
      account_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      meet_id INTEGER NOT NULL REFERENCES quiz_meets(id) ON DELETE CASCADE,
      UNIQUE(account_id, meet_id)
    );

    CREATE TABLE official_memberships (
      account_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      meet_id INTEGER NOT NULL REFERENCES quiz_meets(id) ON DELETE CASCADE,
      official_code_id INTEGER NOT NULL REFERENCES official_codes(id) ON DELETE CASCADE,
      UNIQUE(account_id, meet_id, official_code_id)
    );

    CREATE TABLE viewer_memberships (
      account_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      meet_id INTEGER NOT NULL REFERENCES quiz_meets(id) ON DELETE CASCADE,
      UNIQUE(account_id, meet_id)
    );

    CREATE TABLE churches (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      meet_id INTEGER NOT NULL REFERENCES quiz_meets(id) ON DELETE CASCADE,
      created_by TEXT NOT NULL REFERENCES user(id),
      name TEXT NOT NULL,
      short_name TEXT NOT NULL
    );

    CREATE TABLE teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      meet_id INTEGER NOT NULL REFERENCES quiz_meets(id) ON DELETE CASCADE,
      church_id INTEGER NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
      division TEXT NOT NULL,
      number INTEGER NOT NULL
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
  `)

  // Seed test users so FK constraints on membership tables are satisfied
  const now = Date.now()
  sqlite.run(
    `INSERT INTO user (id, name, email, email_verified, created_at, updated_at, role)
     VALUES ('admin-001', 'Test Admin', 'admin@test.com', 1, ${now}, ${now}, 'admin'),
            ('user-001', 'Test User', 'user@test.com', 1, ${now}, ${now}, 'normal')`,
  )

  return drizzle(sqlite, { schema }) as unknown as Db
}
