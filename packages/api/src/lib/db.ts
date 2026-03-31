import { drizzle } from 'drizzle-orm/d1'
import type { D1Database } from '@cloudflare/workers-types'
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'
import * as schema from '../db/schema'

export function createDb(d1: D1Database) {
  return drizzle(d1, { schema })
}

/** DB type compatible with both D1 (async) and sql.js (sync) drizzle instances */
export type Db = BaseSQLiteDatabase<'async' | 'sync', unknown, typeof schema>
