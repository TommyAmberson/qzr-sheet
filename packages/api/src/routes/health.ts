import { Hono } from 'hono'
import type { Bindings } from '../bindings'

const health = new Hono<{ Bindings: Bindings }>()

health.get('/', (c) => {
  return c.json({ status: 'ok', environment: c.env.ENVIRONMENT })
})

export { health }
