import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import type { Bindings } from '../bindings'
import { createDb } from '../lib/db'
import { verifyToken } from '../lib/jwt'
import { accounts } from '../db/schema'

const me = new Hono<{ Bindings: Bindings }>()

me.get('/', async (c) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'unauthorized' }, 401)
  }

  let payload
  try {
    payload = await verifyToken(authHeader.slice(7), c.env.JWT_SECRET)
  } catch {
    return c.json({ error: 'invalid_token' }, 401)
  }

  const db = createDb(c.env.DB)
  const account = await db.query.accounts.findFirst({
    where: eq(accounts.id, payload.sub),
  })

  if (!account) return c.json({ error: 'not_found' }, 404)

  return c.json({ id: account.id, email: account.email, role: account.role })
})

export { me }
