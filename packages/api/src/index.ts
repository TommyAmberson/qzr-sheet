import { Hono } from 'hono'
import { routePath } from 'hono/route'
import { cors } from 'hono/cors'
import { csrf } from 'hono/csrf'
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
import { publishedSchedule, schedule } from './routes/schedule'
import { results } from './routes/results'
import { account } from './routes/account'
import { createAuth } from './lib/auth'
import { createDb } from './lib/db'
import { createEmailSender } from './lib/email'
import { pruneEmailSends } from './lib/emailLimits'
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
// One line per request with the path only: a query string can carry one-time
// values, such as a provider callback's `code` and `state`, that the app's
// log lines have no use for.
app.use('*', async (c, next) => {
  const start = Date.now()
  await next()
  console.log(`${c.req.method} ${c.req.path} ${c.res.status} ${Date.now() - start}ms`)
})

// Every route lives on `api`, mounted at both `/qzr` and the root. Production
// reaches it only under `/qzr/` (specs/001-qzr-subpath; the public `/api/*` belongs
// to verse-vault); the root mount is what local dev and the tests call.
const api = new Hono<Env>()

// The database and email sender every route uses; a test sets its own first.
api.use('*', async (c, next) => {
  if (!c.get('db')) c.set('db', createDb(c.env.DB))
  if (!c.get('sendEmail')) {
    c.set(
      'sendEmail',
      createEmailSender({
        apiKey: c.env.RESEND_API_KEY,
        waitUntil: (promise) => c.executionCtx.waitUntil(promise),
      }),
    )
  }
  await next()
})

api.route('/health', health)
// Better Auth's base path is the mount that matched (`/qzr/api/auth/*` -> `/qzr/api/auth`).
// Mounting leaves `c.req.raw` untouched, so Better Auth matches it against the real path.
api.on(['GET', 'POST', 'OPTIONS'], '/api/auth/*', (c) => {
  const basePath = routePath(c).replace(/\/\*$/, '')
  return createAuth(c.env, c.get('db'), c.get('sendEmail'), basePath).handler(c.req.raw)
})

// Session middleware for all /api/* routes (except auth, handled above)
api.use('/api/*', sessionMiddleware())
// A form post from another origin, even one on the same site, carries the
// session cookie, and the routes read JSON whatever the content type: refuse
// it unless the origin is one Better Auth trusts (FR-031). Better Auth checks
// its own routes, handled above; JSON from elsewhere already fails CORS.
// verse-vault shares this origin, so this can't tell its pages from ours.
api.use(
  '/api/*',
  csrf({ origin: async (origin, c) => (await c.get('auth').$context).isTrustedOrigin(origin) }),
)
// Mount order matters: phase/schedule register `use('*', requireAuth())`, which
// short-circuits with 401 (403 for a guest of that meet) when a request lacks a
// signed-in user, even for paths those sub-apps don't handle (Hono falls through
// sub-apps when a handler doesn't match, but middleware still runs first).
// Mounting churches (guest-friendly) and join/my-meets ahead of them lets
// `GET /api/meets/:id/teams` reach its real handler in churches before phase
// eats the request.
api.route('/api/meets', meets)
api.route('/api/join', join)
api.route('/api/my-meets', memberships)
// The account routes serve signed-out provider steps, so they go ahead of
// churches, whose `/api` mount requires an account or guest for every path.
api.route('/api/account', account)
api.route('/api', churches)
// Officials submit results with a guest token, so results mount ahead of the account-only routers
api.route('/api/meets', results)
// The published schedule admits guests too, so it mounts ahead of the account-only routers
api.route('/api/meets', publishedSchedule)
api.route('/api/meets', phase)
api.route('/api/meets', schedule)

app.route('/qzr', api)
app.route('/', api)

export { app }

export default {
  fetch: app.fetch,
  async scheduled(controller: ScheduledController, env: Bindings, ctx: ExecutionContext) {
    ctx.waitUntil(
      autoAdvancePhases(createDb(env.DB)).then((res) => {
        if (res.promotedToBuild > 0 || res.promotedToLive > 0) {
          console.log('phase auto-advance', res)
        }
      }),
    )
    // Email-limit windows that have ended (FR-011).
    // It deletes only windows that started a day ago or more, so the first
    // run of each hour is enough.
    if (new Date(controller.scheduledTime).getUTCMinutes() < 5) {
      ctx.waitUntil(pruneEmailSends(createDb(env.DB)))
    }
  },
}
