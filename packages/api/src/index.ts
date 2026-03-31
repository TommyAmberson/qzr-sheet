import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import type { Bindings } from './bindings'
import { health } from './routes/health'
import { createAuth } from './lib/auth'

const app = new Hono<{ Bindings: Bindings }>()

// CORS only needed for local dev (api :8787 ← web :5174).
// In production the Worker is served at www.versevault.ca/api/* — same origin.
app.use(
  '*',
  cors({
    origin: ['http://localhost:5173', 'http://localhost:5174'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  }),
)
app.use('*', logger())

app.route('/health', health)
app.on(['GET', 'POST', 'OPTIONS'], '/api/auth/*', (c) => createAuth(c.env).handler(c.req.raw))

export default app
