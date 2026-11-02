import { Hono, type MiddlewareHandler } from 'hono'
import { createHash } from 'node:crypto'
import { vi } from 'vitest'
import type { Bindings } from './bindings'
import type { SessionUser, SessionVariables } from './middleware/session'
import { app as workerApp } from './index'
import type { EmailMessage } from './lib/email'
import { createTestDb } from './test-db'
import type { GuestPayload } from './lib/jwt'
import type { Db } from './lib/db'
import { eq } from 'drizzle-orm'
import { AccountRole, type SocialProvider } from '@qzr/shared'

/** The one password the stubbed Pwned Passwords service reports breached. */
export const BREACHED_PASSWORD = 'breached-password-1'

// Pwned Passwords answers from here, so no test reaches the network: a range
// lists only BREACHED_PASSWORD's hash.
const networkFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const href = input instanceof Request ? input.url : String(input)
  if (!href.startsWith('https://api.pwnedpasswords.com/range/')) return networkFetch(input, init)
  const hash = createHash('sha1').update(BREACHED_PASSWORD).digest('hex').toUpperCase()
  return new Response(href.endsWith(`/${hash.slice(0, 5)}`) ? `${hash.slice(5)}:42\n` : '')
}) as typeof fetch

/**
 * Test-only middleware that injects user and/or guest directly into context,
 * bypassing Better Auth session lookup and guest JWT verification.
 */
export function mockSession(
  user: SessionUser | null,
  guest: GuestPayload | null = null,
): MiddlewareHandler<{ Bindings: Bindings; Variables: SessionVariables }> {
  return async (c, next) => {
    c.set('user', user)
    c.set('guest', guest)
    await next()
  }
}

/**
 * Test-only middleware that injects a drizzle DB instance into context.
 */
export function mockDb(
  db: Db,
): MiddlewareHandler<{ Bindings: Bindings; Variables: SessionVariables & { db: Db } }> {
  return async (c, next) => {
    c.set('db', db)
    await next()
  }
}

export const testSuperuser: SessionUser = {
  id: 'admin-001',
  email: 'admin@test.com',
  name: 'Test Admin',
  role: AccountRole.Superuser,
}

export const testUser: SessionUser = {
  id: 'user-001',
  email: 'user@test.com',
  name: 'Test User',
  role: AccountRole.Normal,
}

/** Typed wrapper around Response.json() for use in tests. */
export async function jsonOf<T>(res: Response): Promise<T> {
  return res.json() as Promise<T>
}

/** Bindings for tests that run the real `app`; `DB` is a stub for routes that never query it. */
export const testBindings = {
  ENVIRONMENT: 'test',
  API_BASE_URL: 'http://localhost:8787',
  WEB_BASE_URL: 'http://localhost:5174',
  BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
  DB: {} as D1Database,
} as unknown as Bindings

/** Bindings for the auth flow tests: placeholder OAuth apps whose provider
 *  endpoints the tests stub. */
export const authTestBindings = {
  ...testBindings,
  GITHUB_CLIENT_ID: 'test-github-id',
  GITHUB_CLIENT_SECRET: 'test-github-secret',
  GOOGLE_CLIENT_ID: 'test-google-id',
  GOOGLE_CLIENT_SECRET: 'test-google-secret',
} as unknown as Bindings

export interface AuthTestApp {
  app: Hono<{ Bindings: Bindings; Variables: SessionVariables }>
  db: Db
  /** Every email the app sent, oldest first. */
  emails: EmailMessage[]
}

/**
 * The real app over a fresh sql.js database, with a sender that records each
 * email, for tests that drive sign-up, codes, provider sign-ins and the
 * account routes end to end.
 */
export async function createAuthTestApp(overrides: Partial<Bindings> = {}): Promise<AuthTestApp> {
  const db = await createTestDb()
  const app = new Hono<{ Bindings: Bindings; Variables: SessionVariables }>()
  const emails: EmailMessage[] = []
  app.use('*', mockDb(db))
  app.use('*', async (c, next) => {
    c.set('sendEmail', (message) => emails.push(message))
    await next()
  })
  app.route('/', workerApp)
  const request = app.request.bind(app)
  // Every request carries the auth bindings, as the Worker's would.
  app.request = ((input: RequestInfo | URL, init?: RequestInit) =>
    request(input, init, { ...authTestBindings, ...overrides })) as typeof app.request
  return { app, db, emails }
}

/** The code in the newest email to `to`. */
export function codeFor(test: AuthTestApp, to: string): string {
  const email = test.emails.findLast((e) => e.to === to)
  const code = email && /\b(\d{6})\b/.exec(email.text)?.[1]
  if (!code) throw new Error(`no code emailed to ${to}`)
  return code
}

/** POST a JSON body to a Better Auth route, `path` relative to `/api/auth/`. */
export function postAuth(test: AuthTestApp, path: string, body: unknown, cookie?: string) {
  return test.app.request(`/api/auth/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  })
}

/** The cookies a response set, as one `Cookie` header for the next request. */
export function cookiesFrom(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
}

/** Signs up with a password; returns the session cookie and the user id. */
export async function signUpWithPassword(
  test: AuthTestApp,
  email: string,
  password = 'correct-horse-battery',
) {
  const res = await postAuth(test, 'sign-up/email', { email, password, name: email })
  if (res.status !== 200) throw new Error(`sign-up failed: ${res.status} ${await res.text()}`)
  const { user } = (await res.json()) as { user: { id: string } }
  return { cookie: cookiesFrom(res), userId: user.id }
}

/** The password the auth test helpers sign up with. */
export const TEST_PASSWORD = 'correct-horse-battery'

/** A password account whose address is verified with its sign-up code. */
export async function verifiedAccount(test: AuthTestApp, email: string, password = TEST_PASSWORD) {
  const account = await signUpWithPassword(test, email, password)
  await postAuth(
    test,
    'email-otp/verify-email',
    { email, otp: codeFor(test, email) },
    account.cookie,
  )
  return account
}

/** The account's sign-in methods, sorted. */
export async function providersOf(test: AuthTestApp, userId: string): Promise<string[]> {
  const rows = await test.db.select().from(schema.account).where(eq(schema.account.userId, userId))
  return rows.map((a) => a.providerId).sort()
}

/** Makes the user's sessions older than a recent sign-in. */
export async function ageSessions(test: AuthTestApp, userId: string) {
  await test.db
    .update(schema.session)
    .set({ createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) })
    .where(eq(schema.session.userId, userId))
}

/** Calls an account route, `path` relative to `/api/account/`: GET without a
 *  body, POST with one. */
export function accountRequest(test: AuthTestApp, path: string, cookie: string, body?: unknown) {
  return test.app.request(`/api/account/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

/** What the stubbed provider says about the account signing in. */
export interface ProviderProfile {
  id: string
  email: string
  verified: boolean
  /** Google only: the Workspace domain, for a Workspace account. */
  hd?: string
}

/**
 * Runs a GitHub or Google sign-in through Better Auth's real callback with the
 * provider's endpoints stubbed: Google's token endpoint answers with an
 * unsigned ID token (Better Auth decodes it without verifying); GitHub's token,
 * `/user` and `/user/emails` answer for `profile`, the address as its primary.
 * `start` is the response of `/sign-in/social` or `/link-social`.
 */
export async function providerCallback(
  test: AuthTestApp,
  provider: SocialProvider,
  start: Response,
  profile: ProviderProfile,
): Promise<Response> {
  if (start.status !== 200) throw new Error(`sign-in start failed: ${start.status}`)
  const { url } = (await start.json()) as { url: string }
  const state = new URL(url).searchParams.get('state')!
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const idToken = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({
    sub: profile.id,
    email: profile.email,
    email_verified: profile.verified,
    name: profile.email,
    ...(profile.hd ? { hd: profile.hd } : {}),
  })}.`
  const realFetch = globalThis.fetch
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const href = input instanceof Request ? input.url : String(input)
    if (href.startsWith('https://oauth2.googleapis.com/token')) {
      return Response.json({
        access_token: 'test-token',
        id_token: idToken,
        token_type: 'Bearer',
        expires_in: 3600,
      })
    }
    if (href.startsWith('https://github.com/login/oauth/access_token')) {
      return Response.json({
        access_token: 'test-token',
        token_type: 'bearer',
        scope: 'user:email',
      })
    }
    if (href === 'https://api.github.com/user') {
      return Response.json({
        id: Number(profile.id) || 1,
        login: 'tester',
        name: null,
        email: null,
      })
    }
    if (href === 'https://api.github.com/user/emails') {
      return Response.json([{ email: profile.email, primary: true, verified: profile.verified }])
    }
    return realFetch(input, init)
  })
  try {
    return await test.app.request(`/api/auth/callback/${provider}?code=test-code&state=${state}`, {
      headers: { cookie: cookiesFrom(start) },
    })
  } finally {
    spy.mockRestore()
  }
}

/** Connects a provider from settings for the account `cookie` is signed in
 *  to: starts `/link-social`, then completes the callback (unless `between`
 *  is given, which runs first, to change things mid-connection). */
export async function providerLink(
  test: AuthTestApp,
  cookie: string,
  provider: SocialProvider,
  profile: ProviderProfile,
  between?: () => unknown,
): Promise<Response> {
  const start = await postAuth(
    test,
    'link-social',
    { provider, callbackURL: 'http://localhost:5174/qzr/account' },
    cookie,
  )
  if (start.status !== 200) return start
  await between?.()
  return providerCallback(test, provider, start, profile)
}

/** A signed-out GitHub or Google sign-in; returns the callback's response. */
export async function providerSignIn(
  test: AuthTestApp,
  provider: SocialProvider,
  profile: ProviderProfile,
): Promise<Response> {
  const start = await postAuth(test, 'sign-in/social', {
    provider,
    callbackURL: 'http://localhost:5174/qzr/',
    errorCallbackURL: 'http://localhost:5174/qzr/',
  })
  return providerCallback(test, provider, start, profile)
}

/** Build a JSON-bodied request init for use with `app.request(...)`. */
export function jsonRequest(method: string, body: unknown) {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

/**
 * Insert a minimal `quiz_meets` row for tests. Use for any new spec; the older
 * specs (join, memberships, churches) have their own copies that include
 * different return shapes and aren't worth migrating.
 */
import * as schema from './db/schema'
import type { MeetPhase } from '@qzr/shared'
// Viewer codes are unique, so each seeded meet gets its own even when names repeat
let seededMeets = 0

export async function seedMeet(
  db: Db,
  name = 'Test Meet',
  opts: { phase?: MeetPhase; registrationClosesAt?: Date | null; meetStartsAt?: Date | null } = {},
) {
  const [meet] = await db
    .insert(schema.quizMeets)
    .values({
      name,
      dateFrom: '2026-01-01',
      adminCodeHash: 'x',
      viewerCode: `${name.toLowerCase().replace(/\s+/g, '-')}-${++seededMeets}`,
      createdAt: new Date(),
      phase: opts.phase ?? 'registration',
      registrationClosesAt: opts.registrationClosesAt ?? null,
      meetStartsAt: opts.meetStartsAt ?? null,
    })
    .returning()
  return meet!
}

/** An account with the given id, for tests that need memberships to point at a real user */
export async function seedUser(db: Db, id: string) {
  const now = new Date()
  await db.insert(schema.user).values({
    id,
    name: id,
    email: `${id}@test.com`,
    emailVerified: false,
    createdAt: now,
    updatedAt: now,
  })
}
