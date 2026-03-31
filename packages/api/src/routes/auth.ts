import { Hono } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import * as arctic from 'arctic'
import { eq, and } from 'drizzle-orm'
import type { Bindings } from '../bindings'
import { createDb } from '../lib/db'
import { signToken } from '../lib/jwt'
import { accounts, oauthAccounts } from '../db/schema'

type Variables = Record<string, never>

const auth = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// Redirect URL base — resolved from the request origin in handlers
// ---- Helpers ----

function callbackBase(env: Bindings) {
  return `${env.API_BASE_URL}/auth/callback`
}

function githubClient(env: Bindings) {
  return new arctic.GitHub(
    env.GITHUB_CLIENT_ID,
    env.GITHUB_CLIENT_SECRET,
    `${callbackBase(env)}/github`,
  )
}

function googleClient(env: Bindings) {
  return new arctic.Google(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    `${callbackBase(env)}/google`,
  )
}

/** Find or create an account for the given OAuth identity. Returns account id. */
async function upsertAccount(
  db: ReturnType<typeof createDb>,
  provider: string,
  providerSubject: string,
  providerEmail: string,
): Promise<{ id: number; role: string }> {
  // 1. Known identity — fast path
  const existing = await db.query.oauthAccounts.findFirst({
    where: and(
      eq(oauthAccounts.provider, provider),
      eq(oauthAccounts.providerSubject, providerSubject),
    ),
    with: { account: true },
  })
  if (existing) return { id: existing.accountId, role: existing.account.role }

  // 2. Email match — auto-link to existing account
  const emailMatch = await db.query.accounts.findFirst({
    where: eq(accounts.email, providerEmail),
  })

  let accountId: number
  let role: string

  if (emailMatch) {
    accountId = emailMatch.id
    role = emailMatch.role
  } else {
    // 3. New account
    const inserted = await db
      .insert(accounts)
      .values({ email: providerEmail, createdAt: new Date() })
      .returning({ id: accounts.id, role: accounts.role })
    accountId = inserted[0].id
    role = inserted[0].role
  }

  await db
    .insert(oauthAccounts)
    .values({ provider, providerSubject, accountId, email: providerEmail })

  return { id: accountId, role }
}

function redirectWithToken(token: string, env: Bindings) {
  const base =
    env.ENVIRONMENT === 'development' ? 'http://localhost:5173' : 'https://www.versevault.ca'
  return new Response(null, {
    status: 302,
    headers: { Location: `${base}/auth/done?token=${token}` },
  })
}

// ---- GitHub ----

auth.get('/github', (c) => {
  const github = githubClient(c.env)
  const state = arctic.generateState()
  setCookie(c, 'oauth_state', state, {
    httpOnly: true,
    secure: c.env.ENVIRONMENT !== 'development',
    sameSite: 'Lax',
    maxAge: 60 * 10,
    path: '/',
  })
  const url = github.createAuthorizationURL(state, ['user:email'])
  return c.redirect(url.toString())
})

auth.get('/github/callback', async (c) => {
  const storedState = getCookie(c, 'oauth_state')
  const { code, state } = c.req.query()
  deleteCookie(c, 'oauth_state')

  if (!code || !state || !storedState || state !== storedState) {
    return c.json({ error: 'invalid_state' }, 400)
  }

  const github = githubClient(c.env)
  let accessToken: string
  try {
    const tokens = await github.validateAuthorizationCode(code)
    accessToken = tokens.accessToken()
  } catch {
    return c.json({ error: 'invalid_code' }, 400)
  }

  const [userRes, emailsRes] = await Promise.all([
    fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'qzr-api' },
    }),
    fetch('https://api.github.com/user/emails', {
      headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'qzr-api' },
    }),
  ])

  if (!userRes.ok || !emailsRes.ok) return c.json({ error: 'github_api_error' }, 502)

  const githubUser = (await userRes.json()) as { id: number }
  const githubEmails = (await emailsRes.json()) as {
    email: string
    primary: boolean
    verified: boolean
  }[]
  const primaryEmail = githubEmails.find((e) => e.primary && e.verified)?.email

  if (!primaryEmail) return c.json({ error: 'no_verified_email' }, 400)

  const db = createDb(c.env.DB)
  const account = await upsertAccount(db, 'github', String(githubUser.id), primaryEmail)
  const token = await signToken(account.id, account.role, c.env.JWT_SECRET)

  return redirectWithToken(token, c.env)
})

// ---- Google ----

auth.get('/google', (c) => {
  const google = googleClient(c.env)
  const state = arctic.generateState()
  const codeVerifier = arctic.generateCodeVerifier()
  setCookie(c, 'oauth_state', state, {
    httpOnly: true,
    secure: c.env.ENVIRONMENT !== 'development',
    sameSite: 'Lax',
    maxAge: 60 * 10,
    path: '/',
  })
  setCookie(c, 'code_verifier', codeVerifier, {
    httpOnly: true,
    secure: c.env.ENVIRONMENT !== 'development',
    sameSite: 'Lax',
    maxAge: 60 * 10,
    path: '/',
  })
  const url = google.createAuthorizationURL(state, codeVerifier, ['openid', 'profile', 'email'])
  return c.redirect(url.toString())
})

auth.get('/google/callback', async (c) => {
  const storedState = getCookie(c, 'oauth_state')
  const codeVerifier = getCookie(c, 'code_verifier')
  const { code, state } = c.req.query()
  deleteCookie(c, 'oauth_state')
  deleteCookie(c, 'code_verifier')

  if (!code || !state || !storedState || state !== storedState || !codeVerifier) {
    return c.json({ error: 'invalid_state' }, 400)
  }

  const google = googleClient(c.env)
  let idToken: string
  try {
    const tokens = await google.validateAuthorizationCode(code, codeVerifier)
    idToken = tokens.idToken()
  } catch {
    return c.json({ error: 'invalid_code' }, 400)
  }

  const claims = arctic.decodeIdToken(idToken) as {
    sub: string
    email: string
    email_verified: boolean
  }

  if (!claims.email_verified) return c.json({ error: 'no_verified_email' }, 400)

  const db = createDb(c.env.DB)
  const account = await upsertAccount(db, 'google', claims.sub, claims.email)
  const token = await signToken(account.id, account.role, c.env.JWT_SECRET)

  return redirectWithToken(token, c.env)
})

export { auth }
