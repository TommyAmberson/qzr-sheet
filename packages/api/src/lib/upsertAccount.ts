import { eq, and } from 'drizzle-orm'
import type { Db } from './db'
import { accounts, oauthAccounts } from '../db/schema'

export async function upsertAccount(
  db: Db,
  provider: string,
  providerSubject: string,
  providerEmail: string,
): Promise<{ id: number; role: string }> {
  // 1. Known identity — fast path
  const existing = await db.query.oauthAccounts.findFirst({
    where: and(
      eq(oauthAccounts.provider, provider),
      eq(oauthAccounts.providerSubject, providerSubject),
    ),
    with: { account: true },
  })
  if (existing) return { id: existing.accountId, role: existing.account.role }

  // 2. Email match — auto-link to existing account
  const emailMatch = await db.query.accounts.findFirst({
    where: eq(accounts.email, providerEmail),
  })

  let accountId: number
  let role: string

  if (emailMatch) {
    accountId = emailMatch.id
    role = emailMatch.role
  } else {
    // 3. New account
    const inserted = await db
      .insert(accounts)
      .values({ email: providerEmail, createdAt: new Date() })
      .returning({ id: accounts.id, role: accounts.role })
    accountId = inserted[0].id
    role = inserted[0].role
  }

  await db
    .insert(oauthAccounts)
    .values({ provider, providerSubject, accountId, email: providerEmail })

  return { id: accountId, role }
}
