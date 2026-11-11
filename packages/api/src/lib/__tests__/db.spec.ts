import { describe, it, expect } from 'vitest'
import { asOne, isUniqueViolation } from '../db'
import * as schema from '../../db/schema'
import { createTestDb } from '../../test-db'
import { seedMeet } from '../../test-utils'

describe('isUniqueViolation', () => {
  const failed = (detail: string, sql = 'insert into "quiz_meets" ...') =>
    new Error(`Failed query: ${sql}`, { cause: new Error(`UNIQUE constraint failed: ${detail}`) })

  it('matches a column constraint by its table', () => {
    const e = failed('quiz_result_revisions.result_id, quiz_result_revisions.revision')
    expect(isUniqueViolation(e)).toBe(true)
    expect(isUniqueViolation(e, 'quiz_result_revisions')).toBe(true)
    expect(isUniqueViolation(e, 'quiz_results')).toBe(false)
  })

  it('matches an expression index by its name', () => {
    const e = failed("index 'quiz_meets_viewer_code_unique'")
    expect(isUniqueViolation(e, 'quiz_meets_viewer_code_unique')).toBe(true)
  })

  it('ignores a table the failed SQL names when the constraint is elsewhere', () => {
    const e = failed(
      'quiz_results.meet_id, quiz_results.name',
      'insert into "quiz_result_revisions"',
    )
    expect(isUniqueViolation(e, 'quiz_result_revisions')).toBe(false)
  })

  it('reads the detail SQLite gave, not one quoted in the query', () => {
    const e = failed(
      'quiz_results.meet_id, quiz_results.name',
      'insert into "quiz_results" params: UNIQUE constraint failed: quiz_result_revisions.x',
    )
    expect(isUniqueViolation(e, 'quiz_result_revisions')).toBe(false)
  })

  it('needs the whole table name', () => {
    expect(isUniqueViolation(failed('quiz_meets.viewer_code'), 'meets')).toBe(false)
  })

  it('is false for other errors', () => {
    expect(isUniqueViolation(new Error('FOREIGN KEY constraint failed'))).toBe(false)
  })
})

describe('asOne on the test database', () => {
  it('undoes every statement when one fails', async () => {
    const db = await createTestDb()
    const { id: meetId } = await seedMeet(db)
    const quiz = { meetId, roomId: null, quizKey: 'a', createdAt: new Date() }
    const error = await asOne(db, [
      db.insert(schema.quizResults).values(quiz),
      db.insert(schema.quizResults).values({ ...quiz, quizKey: 'b' }),
      db.insert(schema.quizResults).values(quiz),
    ]).catch((e: unknown) => e)
    // The third insert clashes with the first, so the first two did run before being undone
    expect(isUniqueViolation(error, 'quiz_results')).toBe(true)
    expect(await db.select().from(schema.quizResults)).toEqual([])
  })
})
