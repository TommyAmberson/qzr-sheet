import { describe, it, expect, vi, beforeEach } from 'vitest'
import { upsertAccount } from '../../lib/upsertAccount'
import type { Db } from '../../lib/db'
import { AccountRole } from '@qzr/shared'

// Minimal in-memory store to simulate D1 across calls
function makeDb(
  initial: {
    oauthAccounts?: Array<{
      provider: string
      providerSubject: string
      accountId: number
      email: string
    }>
    accounts?: Array<{ id: number; email: string | null; role: string; createdAt: Date }>
  } = {},
): Db {
  let nextId = (initial.accounts?.length ?? 0) + 1
  const oauthRows = [...(initial.oauthAccounts ?? [])]
  const accountRows = [...(initial.accounts ?? [])]

  return {
    query: {
      oauthAccounts: {
        findFirst: vi.fn(({ where, with: _with }) => {
          // Extract provider and providerSubject from the `and(eq(...), eq(...))` structure
          // For tests we resolve by checking all rows
          const row = oauthRows.find((r) => {
            const conditions = where?.conditions ?? []
            const providerMatch = conditions.find(
              (c: { value: string }) => r.provider === c.value || r.providerSubject === c.value,
            )
            return providerMatch !== undefined
          })
          if (!row) return Promise.resolve(undefined)
          const account = accountRows.find((a) => a.id === row.accountId)
          return Promise.resolve(account ? { ...row, account } : undefined)
        }),
      },
      accounts: {
        findFirst: vi.fn(({ where: _where }) => {
          // Resolve by email — tests pass specific emails
          return Promise.resolve(undefined)
        }),
      },
    },
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => {
          const id = nextId++
          const row = { id, role: AccountRole.Normal }
          accountRows.push({ id, email: null, role: AccountRole.Normal, createdAt: new Date() })
          return Promise.resolve([row])
        }),
      })),
    })),
  } as unknown as Db
}

describe('upsertAccount', () => {
  describe('known identity (fast path)', () => {
    it('returns existing account without inserting', async () => {
      const db = makeDb({
        accounts: [
          { id: 1, email: 'user@example.com', role: AccountRole.Normal, createdAt: new Date() },
        ],
        oauthAccounts: [
          { provider: 'github', providerSubject: '42', accountId: 1, email: 'user@example.com' },
        ],
      })
      // Patch findFirst to return the linked row directly
      ;(db.query.oauthAccounts.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        provider: 'github',
        providerSubject: '42',
        accountId: 1,
        email: 'user@example.com',
        account: { id: 1, email: 'user@example.com', role: AccountRole.Normal },
      })

      const result = await upsertAccount(db, 'github', '42', 'user@example.com')

      expect(result).toEqual({ id: 1, role: AccountRole.Normal })
      expect(db.insert).not.toHaveBeenCalled()
    })
  })

  describe('new provider, matching email (auto-link)', () => {
    it('links to existing account without creating a new one', async () => {
      const db = makeDb({
        accounts: [
          { id: 1, email: 'user@example.com', role: AccountRole.Normal, createdAt: new Date() },
        ],
      })
      ;(db.query.oauthAccounts.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
      ;(db.query.accounts.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 1,
        email: 'user@example.com',
        role: AccountRole.Normal,
      })

      // Patch insert to just record the call without returning an account row
      const insertMock = vi.fn(() => ({
        values: vi.fn(() => ({ returning: vi.fn(() => Promise.resolve([])) })),
      }))
      db.insert = insertMock

      const result = await upsertAccount(db, 'google', '99', 'user@example.com')

      expect(result).toEqual({ id: 1, role: AccountRole.Normal })
      // Only one insert — the new oauth_accounts row, no new account row
      expect(insertMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('new provider, no email match (new account)', () => {
    it('creates a new account and oauth row', async () => {
      const db = makeDb()
      ;(db.query.oauthAccounts.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
      ;(db.query.accounts.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)

      let insertCount = 0
      const insertMock = vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn(() => {
            insertCount++
            if (insertCount === 1) return Promise.resolve([{ id: 1, role: AccountRole.Normal }])
            return Promise.resolve([])
          }),
        })),
      }))
      db.insert = insertMock

      const result = await upsertAccount(db, 'github', '123', 'new@example.com')

      expect(result).toEqual({ id: 1, role: AccountRole.Normal })
      // Two inserts: accounts row + oauth_accounts row
      expect(insertMock).toHaveBeenCalledTimes(2)
    })
  })
})
