import { describe, it, expect } from 'vitest'
import { createTestDb } from '../../test-db'
import * as schema from '../../db/schema'
import { PER_ADDRESS, PER_CLIENT, addressKey, pruneEmailSends, takeAllowance } from '../emailLimits'

describe('email limits', () => {
  it('allows 3 emails to an address per hour, whatever its case', async () => {
    const db = await createTestDb()
    const now = 1_800_000_000 - (1_800_000_000 % 3600)
    const results = []
    for (const email of ['A@example.com', 'a@example.com', 'a@EXAMPLE.com', 'a@example.com']) {
      results.push(await takeAllowance(db, addressKey(email), PER_ADDRESS, now))
    }
    expect(results).toEqual([true, true, true, false])
    // The next hour starts afresh.
    expect(await takeAllowance(db, addressKey('a@example.com'), PER_ADDRESS, now + 3600)).toBe(true)
  })

  it('allows 10 emails per client per day', async () => {
    const db = await createTestDb()
    const now = 1_800_000_000
    const allowed = []
    for (let i = 0; i < 11; i++)
      allowed.push(await takeAllowance(db, 'client:1.2.3.4', PER_CLIENT, now))
    expect(allowed.filter(Boolean)).toHaveLength(10)
  })

  it('prunes windows that have ended', async () => {
    const db = await createTestDb()
    const now = 1_800_000_000
    await takeAllowance(db, 'client:old', PER_CLIENT, now - 3 * 24 * 3600)
    await takeAllowance(db, 'client:new', PER_CLIENT, now)
    await pruneEmailSends(db, now)
    const keys = (await db.select().from(schema.emailSends).all()).map((r) => r.key)
    expect(keys).toEqual(['client:new'])
  })
})
