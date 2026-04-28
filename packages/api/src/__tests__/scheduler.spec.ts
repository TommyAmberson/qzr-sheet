import { describe, it, expect, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import * as schema from '../db/schema'
import { autoAdvancePhases } from '../scheduler'
import { createTestDb } from '../test-db'
import type { Db } from '../lib/db'

async function seedMeet(
  db: Db,
  name: string,
  opts: {
    phase?: 'registration' | 'build' | 'live' | 'done'
    registrationClosesAt?: Date | null
    meetStartsAt?: Date | null
  } = {},
) {
  const [meet] = await db
    .insert(schema.quizMeets)
    .values({
      name,
      dateFrom: '2026-01-01',
      adminCodeHash: 'x',
      viewerCode: name.toLowerCase().replace(/\s+/g, '-'),
      createdAt: new Date(),
      phase: opts.phase ?? 'registration',
      registrationClosesAt: opts.registrationClosesAt ?? null,
      meetStartsAt: opts.meetStartsAt ?? null,
    })
    .returning()
  return meet!
}

describe('autoAdvancePhases', () => {
  let db: Db

  beforeEach(async () => {
    db = await createTestDb()
  })

  it('does nothing when no timestamps set', async () => {
    await seedMeet(db, 'Quiet')
    const res = await autoAdvancePhases(db)
    expect(res).toEqual({ promotedToBuild: 0, promotedToLive: 0 })
  })

  it('promotes registration → build when registrationClosesAt has passed', async () => {
    const past = new Date(Date.now() - 60_000)
    const meet = await seedMeet(db, 'Past', { registrationClosesAt: past })

    const res = await autoAdvancePhases(db)
    expect(res.promotedToBuild).toBe(1)

    const [updated] = await db
      .select({ phase: schema.quizMeets.phase })
      .from(schema.quizMeets)
      .where(eq(schema.quizMeets.id, meet.id))
    expect(updated?.phase).toBe('build')
  })

  it('does not promote when registrationClosesAt is in the future', async () => {
    const future = new Date(Date.now() + 60_000)
    await seedMeet(db, 'Future', { registrationClosesAt: future })

    const res = await autoAdvancePhases(db)
    expect(res.promotedToBuild).toBe(0)
  })

  it('promotes build → live when meetStartsAt has passed', async () => {
    const past = new Date(Date.now() - 60_000)
    const meet = await seedMeet(db, 'Starting', {
      phase: 'build',
      meetStartsAt: past,
    })

    const res = await autoAdvancePhases(db)
    expect(res.promotedToLive).toBe(1)

    const [updated] = await db
      .select({ phase: schema.quizMeets.phase })
      .from(schema.quizMeets)
      .where(eq(schema.quizMeets.id, meet.id))
    expect(updated?.phase).toBe('live')
  })

  it('does not skip from registration directly to live in one tick', async () => {
    const past = new Date(Date.now() - 60_000)
    const meet = await seedMeet(db, 'Both', {
      registrationClosesAt: past,
      meetStartsAt: past,
    })

    const res = await autoAdvancePhases(db)
    expect(res.promotedToBuild).toBe(1)
    expect(res.promotedToLive).toBe(0)

    const [updated] = await db
      .select({ phase: schema.quizMeets.phase })
      .from(schema.quizMeets)
      .where(eq(schema.quizMeets.id, meet.id))
    expect(updated?.phase).toBe('build')

    // Second tick brings it to live
    const res2 = await autoAdvancePhases(db)
    expect(res2.promotedToLive).toBe(1)

    const [final] = await db
      .select({ phase: schema.quizMeets.phase })
      .from(schema.quizMeets)
      .where(eq(schema.quizMeets.id, meet.id))
    expect(final?.phase).toBe('live')
  })

  it('is idempotent — re-running does nothing once caught up', async () => {
    const past = new Date(Date.now() - 60_000)
    await seedMeet(db, 'Caught Up', {
      phase: 'live',
      registrationClosesAt: past,
      meetStartsAt: past,
    })

    const res = await autoAdvancePhases(db)
    expect(res).toEqual({ promotedToBuild: 0, promotedToLive: 0 })
  })

  it('handles multiple meets in one pass', async () => {
    const past = new Date(Date.now() - 60_000)
    await seedMeet(db, 'M1', { registrationClosesAt: past })
    await seedMeet(db, 'M2', { registrationClosesAt: past })
    await seedMeet(db, 'M3', { phase: 'build', meetStartsAt: past })

    const res = await autoAdvancePhases(db)
    expect(res.promotedToBuild).toBe(2)
    expect(res.promotedToLive).toBe(1)
  })
})
