import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import type { ScheduledController, ExecutionContext } from '@cloudflare/workers-types'
import type { Bindings } from './bindings'
import type { SessionVariables } from './middleware/session'
import { sessionMiddleware } from './middleware/session'
import { health } from './routes/health'
import { meets } from './routes/meets'
import { join } from './routes/join'
import { memberships } from './routes/memberships'
import { churches } from './routes/churches'
import { phase } from './routes/phase'
import { schedule } from './routes/schedule'
import { createAuth } from './lib/auth'
import { createDb } from './lib/db'
import { autoAdvancePhases } from './scheduler'

const app = new Hono<{ Bindings: Bindings; Variables: SessionVariables }>()

// CORS needed for:
//   dev   — scoresheet :5173 and portal :5174 → api :8787
//   Tauri — production webview origins: tauri://localhost (macOS/Linux),
//           https://tauri.localhost (Windows with useHttpsScheme)
// Production web is same-origin — no CORS needed.
app.use(
  '*',
  cors({
    origin: (origin, c) => {
      const env = (c.env as Bindings).ENVIRONMENT
      const allowed =
        env === 'production'
          ? ['tauri://localhost', 'https://tauri.localhost']
          : ['http://localhost:5173', 'http://localhost:5174']
      return allowed.includes(origin) ? origin : null
    },
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
app.route('/api/meets', phase)
app.route('/api/meets', schedule)
app.route('/api/join', join)
app.route('/api/my-meets', memberships)
app.route('/api', churches)

export { app }

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Bindings, ctx: ExecutionContext) {
    ctx.waitUntil(
      autoAdvancePhases(createDb(env.DB)).then((res) => {
        if (res.promotedToBuild > 0 || res.promotedToLive > 0) {
          console.log('phase auto-advance', res)
        }
      }),
    )
  },
}
