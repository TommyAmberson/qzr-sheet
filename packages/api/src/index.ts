import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import type { Bindings } from './bindings'
import { health } from './routes/health'
import { createAuth } from './lib/auth'

const app = new Hono<{ Bindings: Bindings }>()

app.use(
  '*',
  cors({
    origin: ['https://www.versevault.ca', 'http://localhost:5173', 'http://localhost:5174'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  }),
)
app.use('*', logger())

app.route('/health', health)
app.on(['GET', 'POST'], '/api/auth/*', (c) => createAuth(c.env).handler(c.req.raw))

export default app
