import { sql } from 'drizzle-orm'
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
  const out: TOut[] = []
  for (const chunk of chunksOf(rows, paramsPerRow)) out.push(...(await runChunk(chunk)))
  return out
}

/** `rows` split into chunks whose statements each fit D1's parameter cap, as `inChunks` runs them */
export function chunksOf<T>(rows: T[], paramsPerRow: number): T[][] {
  const chunkSize = Math.max(1, Math.floor(D1_MAX_PARAMS / paramsPerRow))
  const chunks: T[][] = []
  for (let i = 0; i < rows.length; i += chunkSize) chunks.push(rows.slice(i, i + chunkSize))
  return chunks
}

/**
 * Run statements as one, in a D1 batch, which is a transaction, so they all happen or none do. The
 * test database supplies a batch of its own (see `createTestDb`). Answers each statement's result.
 */
export function asOne(db: Db, statements: PromiseLike<unknown>[]): Promise<unknown[]> {
  return (db as unknown as { batch: (s: PromiseLike<unknown>[]) => Promise<unknown[]> }).batch(
    statements,
  )
}

/**
 * Whether a statement failed on a unique constraint, optionally one on `target`: a table, or the
 * name of a unique index on an expression. Only SQLite's own detail is matched, since the error
 * also quotes the failed SQL and its values, which name its table whatever the constraint and can
 * hold any text. The SQLite message can sit in `cause`, after the query, so the last detail wins.
 */
export function isUniqueViolation(e: unknown, target?: string): boolean {
  const text = e instanceof Error ? `${e.message}\n${String(e.cause ?? '')}` : String(e)
  const detail = [...text.matchAll(/UNIQUE constraint failed: ([^\n]*)/g)].at(-1)?.[1]
  if (detail === undefined) return false
  if (!target) return true
  // A column constraint names `table.column`s, comma-separated; an expression index `index 'name'`
  return detail.startsWith(`index '${target}'`) || new RegExp(`(^|, )${target}\\.`).test(detail)
}

/** Matches the meet whose viewer code is `code`, ignoring case as its unique index does */
export function viewerCodeIs(code: string) {
  return sql`lower(${schema.quizMeets.viewerCode}) = lower(${code})`
}
