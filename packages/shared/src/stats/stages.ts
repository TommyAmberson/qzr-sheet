import type { ScheduleQuiz } from '../schedule/scheduleFile'

/** What a stored quiz counts for */
export const STAGES = ['prelim', 'intermediate', 'elimination', 'finals'] as const
export type Stage = (typeof STAGES)[number]

/** A stage an admin can give a stored quiz: one of the four, or that it counts for nothing */
export const STAGE_CHOICES = [...STAGES, 'notCounted'] as const
export type StageChoice = (typeof STAGE_CHOICES)[number]

/** The stage the schedule gives one of its quizzes: a bracket's deciding quiz is its Finals */
export function scheduledStage(quiz: Pick<ScheduleQuiz, 'phase' | 'line' | 'deciding'>): Stage {
  if (quiz.phase === 'prelim') return 'prelim'
  if (quiz.line !== undefined) return 'intermediate'
  return quiz.deciding ? 'finals' : 'elimination'
}

/** Where a stored quiz's stage comes from */
export type StageFrom = 'admin' | 'schedule' | 'counted'

/**
 * A stored quiz's stage: the admin's choice; else the stage of the scheduled quiz it is linked to;
 * else, for a quiz with no link that was counted before quizzes had stages, a prelim; else none, and
 * it counts for nothing.
 */
export function storedStage(quiz: {
  /** The admin's newest choice, if any */
  chosen: StageChoice | null
  /** The scheduled quiz it is linked to, if any */
  linked: Pick<ScheduleQuiz, 'phase' | 'line' | 'deciding'> | null
  /** Whether its newest counting record, from before stages, says it counts */
  counted: boolean
}): { stage: Stage | null; from: StageFrom | null } {
  if (quiz.chosen !== null) {
    return { stage: quiz.chosen === 'notCounted' ? null : quiz.chosen, from: 'admin' }
  }
  if (quiz.linked) return { stage: scheduledStage(quiz.linked), from: 'schedule' }
  return quiz.counted ? { stage: 'prelim', from: 'counted' } : { stage: null, from: null }
}
