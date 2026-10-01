import { Hono } from 'hono'
import { routePath } from 'hono/route'
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

type Env = { Bindings: Bindings; Variables: SessionVariables }

const app = new Hono<Env>()

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

// Every route lives on `api`, mounted at both `/qzr` and the root: qzr is served
// under `/qzr/` (specs/001-qzr-subpath), and the root mount keeps the old `/api/*`
// address working for the frozen root site, old app installs, and requests
// verse-vault forwards after switch day.
const api = new Hono<Env>()

api.route('/health', health)
// Better Auth's base path is the mount that matched (`/qzr/api/auth/*` -> `/qzr/api/auth`).
// Mounting leaves `c.req.raw` untouched, so Better Auth matches it against the real path.
api.on(['GET', 'POST', 'OPTIONS'], '/api/auth/*', (c) =>
  createAuth(c.env, routePath(c).replace(/\/\*$/, '')).handler(c.req.raw),
)

// Session middleware for all /api/* routes (except auth, handled above)
api.use('/api/*', sessionMiddleware())
// Mount order matters: phase/schedule register `use('*', requireAuth())`
// which short-circuits with 401 when a request lacks a signed-in user, even
// for paths those sub-apps don't handle (Hono falls through sub-apps when a
// handler doesn't match, but middleware still runs first). Mounting churches
// (guest-friendly) and join/my-meets ahead of them lets `GET /api/meets/:id/
// teams` reach its real handler in churches before phase eats the request.
api.route('/api/meets', meets)
api.route('/api/join', join)
api.route('/api/my-meets', memberships)
api.route('/api', churches)
api.route('/api/meets', phase)
api.route('/api/meets', schedule)

app.route('/qzr', api)
app.route('/', api)

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
