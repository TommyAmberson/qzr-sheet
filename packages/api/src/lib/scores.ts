import { sql } from 'drizzle-orm'
import { scoreStoredQuiz, type QuizFile, type ScoredQuiz } from '@qzr/shared'
import sharedPackage from '@qzr/shared/package.json'
import * as schema from '../db/schema'
import { inChunks, type Db } from './db'

/** The contract version doing the scoring: a kept score made by another version is made again */
export const SHARED_VERSION: string = sharedPackage.version

/**
 * Score revisions' quiz files and keep what scoring makes of each beside its revision, so that
 * reading a division's stats ranks without scoring (specs/006-meet-stats, research R2). Answers
 * the scores by revision id.
 */
export async function keepScores(
  db: Db,
  revisions: { id: number; quizFile: string }[],
): Promise<Map<number, ScoredQuiz>> {
  const scores = new Map(
    revisions.map(({ id, quizFile }) => [id, scoreStoredQuiz(JSON.parse(quizFile) as QuizFile)]),
  )
  const rows = [...scores].map(([revisionId, scored]) => ({
    revisionId,
    sharedVersion: SHARED_VERSION,
    scored: JSON.stringify(scored),
  }))
  await inChunks(rows, 3, (chunk) =>
    db
      .insert(schema.quizResultScores)
      .values(chunk)
      .onConflictDoUpdate({
        target: schema.quizResultScores.revisionId,
        set: { sharedVersion: sql`excluded.shared_version`, scored: sql`excluded.scored` },
      })
      .returning({ revisionId: schema.quizResultScores.revisionId }),
  )
  return scores
}
