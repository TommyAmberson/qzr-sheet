import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { AccountRole } from '@qzr/shared'
import * as schema from '../../db/schema'
import { createAuthTestApp, signUpWithPassword } from '../../test-utils'

async function roleSeen(verified: boolean) {
  const test = await createAuthTestApp()
  test.app.get('/api/role', (c) => c.json({ role: c.get('user')?.role }))
  const { cookie, userId } = await signUpWithPassword(test, 'super@example.com')
  await test.db
    .update(schema.user)
    .set({ role: AccountRole.Superuser, emailVerified: verified })
    .where(eq(schema.user.id, userId))
  const res = await test.app.request('/api/role', { headers: { cookie } })
  return ((await res.json()) as { role: AccountRole }).role
}

describe('superuser', () => {
  it('counts on a verified address', async () => {
    expect(await roleSeen(true)).toBe(AccountRole.Superuser)
  })

  it('counts as a normal account until the address is verified', async () => {
    expect(await roleSeen(false)).toBe(AccountRole.Normal)
  })
})
