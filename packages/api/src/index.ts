import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import type { Bindings } from './bindings'
import type { SessionVariables } from './middleware/session'
import { sessionMiddleware } from './middleware/session'
import { health } from './routes/health'
import { meets } from './routes/meets'
import { join } from './routes/join'
import { memberships } from './routes/memberships'
import { churches } from './routes/churches'
import { createAuth } from './lib/auth'

const app = new Hono<{ Bindings: Bindings; Variables: SessionVariables }>()

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

// Session middleware for all /api/* routes (except auth, handled above)
app.use('/api/*', sessionMiddleware())
app.route('/api/meets', meets)
app.route('/api/join', join)
app.route('/api/my-meets', memberships)
app.route('/api', churches)

export default app
