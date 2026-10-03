import { drizzle } from 'drizzle-orm/d1'
import type { D1Database } from '@cloudflare/workers-types'
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'
import * as schema from '../db/schema'

export function createDb(d1: D1Database) {
  return drizzle(d1, { schema })
}

/** DB type compatible with both D1 (async) and sql.js (sync) drizzle instances */
export type Db = BaseSQLiteDatabase<'async' | 'sync', unknown, typeof schema>

/**
 * D1 caps bound parameters at 100 per statement
 * (https://developers.cloudflare.com/d1/platform/limits/), and a full meet's
 * schedule or a "count all" binds far more. Runs a statement over `rows` in
 * chunks that each fit, leaving a few params of headroom for any implicit binds
 * Drizzle might add.
 */
const D1_MAX_PARAMS = 90

export async function inChunks<TIn, TOut>(
  rows: TIn[],
  paramsPerRow: number,
  runChunk: (chunk: TIn[]) => Promise<TOut[]>,
): Promise<TOut[]> {
  if (rows.length === 0) return []
  const chunkSize = Math.max(1, Math.floor(D1_MAX_PARAMS / paramsPerRow))
  const out: TOut[] = []
  for (let i = 0; i < rows.length; i += chunkSize) {
    out.push(...(await runChunk(rows.slice(i, i + chunkSize))))
  }
  return out
}

/**
 * Run statements as one: in production a D1 batch, which is a transaction, so they all happen or
 * none do; on the test database, which has no batch, in turn. Answers each statement's result.
 */
export async function asOne(db: Db, statements: PromiseLike<unknown>[]): Promise<unknown[]> {
  const batch = (db as unknown as { batch?: (s: PromiseLike<unknown>[]) => Promise<unknown[]> })
    .batch
  if (batch) return batch.call(db, statements)
  const results: unknown[] = []
  for (const statement of statements) results.push(await statement)
  return results
}
