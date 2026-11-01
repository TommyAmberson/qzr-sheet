import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto'
import type { Bindings } from '../bindings'
import * as schema from '../db/schema'
import type { Db } from './db'
import { AccountRole } from '@qzr/shared'
import { APIError, createAuthMiddleware, getOAuthState, getSessionFromCtx } from 'better-auth/api'
import { defineRequestState } from '@better-auth/core/context'
import { emailOTP } from 'better-auth/plugins'
import {
  passwordResetEmail,
  resetCodeEmail,
  verificationCodeEmail,
  type ProviderName,
  type SendEmail,
} from './email'
import { and, eq, gt, inArray, like, sql } from 'drizzle-orm'
import { PER_ADDRESS, PER_CLIENT, addressKey, clientKey, takeEmailSend } from './emailLimits'

// Better Auth defaults to pure-JS scrypt (@noble/hashes) which takes ~5s of CPU —
// way over CF Workers' 10ms free-tier limit. Use native node:crypto scryptSync instead
// (available via nodejs_compat). N=16384 is tuned to fit within the CPU budget.
const SCRYPT_PARAMS = { N: 16384, r: 16, p: 1, maxmem: 128 * 16384 * 16 * 2 }
const KEY_LENGTH = 64

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const key = scryptSync(password, salt, KEY_LENGTH, SCRYPT_PARAMS)
  return `${salt}:${key.toString('hex')}`
}

async function verifyPassword({
  hash,
  password,
}: {
  hash: string
  password: string
}): Promise<boolean> {
  const [salt, key] = hash.split(':')
  if (!salt || !key) return false
  const derived = scryptSync(password, salt, KEY_LENGTH, SCRYPT_PARAMS)
  return timingSafeEqual(Buffer.from(key, 'hex'), derived)
}

/** Requests that email an address a code, counted against the email limits
 *  on arrival, so whether the address has an account changes nothing. */
const EMAILING_PATHS = new Set([
  '/email-otp/request-password-reset',
  '/email-otp/send-verification-otp',
])

/** Routes this app doesn't use: the email-code plugin's sign-in by code,
 *  address change, deprecated reset alias and bare code check (which counts
 *  wrong guesses without spending the code), and the link-based reset and
 *  verification that codes replace (research D3). */
const REFUSED_PATHS = [
  '/sign-in/email-otp',
  '/email-otp/request-email-change',
  '/email-otp/change-email',
  '/forget-password/email-otp',
  '/email-otp/check-verification-otp',
  '/request-password-reset',
  '/reset-password',
  '/verify-email',
  '/send-verification-email',
]

/** Code types the send route serves; the others belong to refused flows. */
const SENDABLE_TYPES = new Set(['email-verification', 'forget-password'])

/** Codes last 10 minutes; the plugin's defaults give 6 digits and 3 tries. */
const CODE_TTL_S = 10 * 60

/** An address longer than this matches no account, so it isn't counted. */
const MAX_EMAIL_LENGTH = 254

/** Verification rows for a pending GitHub or Google sign-in (research D6). */
export const PENDING_PROVIDER_PREFIX = 'pending-provider:'

const PROVIDERS: ProviderName[] = ['github', 'google']

/** Better Auth's default for "a recent sign-in": linking needs one (FR-018). */
const FRESH_SESSION_MS = 24 * 60 * 60 * 1000

/** What the current provider callback learned: the provider's own claim that
 *  the address is verified, and whether that proves the inbox (research D5).
 *  Better Auth hands the after hook only a redirect, so it's kept here. */
const providerProfile = defineRequestState<{
  provider: ProviderName
  id: string
  email: string
  verified: boolean
  proves: boolean
} | null>(() => null)

/** The providers a reset just disconnected, by request, for its response. */
const disconnectedByReset = new WeakMap<Request, ProviderName[]>()

const tooMany = (what: string) =>
  new APIError('TOO_MANY_REQUESTS', { message: `Too many requests ${what}. Try again later.` })

// `basePath` is the entrance the request came in on (`/api/auth` or
// `/qzr/api/auth`): OAuth callbacks are built from it, so they return there.
// The database and email sender are passed in: D1 and Resend in production,
// sql.js and a recording sender in tests.
export function createAuth(env: Bindings, db: Db, sendEmail: SendEmail, basePath = '/api/auth') {
  return betterAuth({
    // Bare origin: Better Auth appends `basePath`, and ignores it if baseURL has a path.
    baseURL: env.API_BASE_URL,
    basePath,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, { provider: 'sqlite', schema }),
    disabledPaths: REFUSED_PATHS,
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // The send route's types for refused flows, from outside only.
        if (ctx.request && ctx.path === '/email-otp/send-verification-otp') {
          const type = (ctx.body as { type?: unknown } | undefined)?.type
          if (typeof type !== 'string' || !SENDABLE_TYPES.has(type)) throw new APIError('NOT_FOUND')
        }
        // Connecting a provider asks for a sign-in within the last day
        // (FR-018), and remembers which session started it: the link lands
        // only while that session lasts, so signing out or a password reset
        // cancels a connection started before it (FR-025).
        if (ctx.request && ctx.path === '/link-social') {
          const session = await getSessionFromCtx(ctx)
          const age = session ? Date.now() - new Date(session.session.createdAt).getTime() : 0
          if (age > FRESH_SESSION_MS) {
            throw new APIError('FORBIDDEN', {
              message: 'Sign in again to connect it.',
              code: 'SESSION_NOT_FRESH',
            })
          }
          if (session && ctx.body && typeof ctx.body === 'object') {
            const body = ctx.body as { additionalData?: Record<string, unknown> }
            body.additionalData = { ...body.additionalData, linkSession: session.session.id }
          }
        }
        // Verifying needs a session on that account (FR-007), checked before
        // the plugin compares the code: otherwise a signed-out guess would
        // spend a try and learn whether the code was right, and a code could
        // verify an address someone else registered.
        if (ctx.request && ctx.path === '/email-otp/verify-email') {
          const email = (ctx.body as { email?: unknown } | undefined)?.email
          const session = await getSessionFromCtx(ctx)
          if (
            typeof email !== 'string' ||
            session?.user.email.toLowerCase() !== email.trim().toLowerCase()
          ) {
            throw new APIError('FORBIDDEN', {
              message: 'Sign in to this account to verify its email.',
            })
          }
        }
        if (!ctx.request || !EMAILING_PATHS.has(ctx.path)) return
        const email = (ctx.body as { email?: unknown } | undefined)?.email
        if (typeof email !== 'string' || email.length > MAX_EMAIL_LENGTH) return
        // The address first, so requests it refuses don't use up the client's
        // allowance (FR-011).
        if (!(await takeEmailSend(db, addressKey(email), PER_ADDRESS))) {
          throw tooMany('for this address')
        }
        const ip = clientIp(ctx.request)
        if (ip && !(await takeEmailSend(db, clientKey(ip), PER_CLIENT))) {
          throw tooMany('from this network')
        }
      }),
      // A reset that disconnected providers says so, so the form can point to
      // connecting them again (FR-025).
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path === '/email-otp/reset-password' && ctx.request) {
          const disconnected = disconnectedByReset.get(ctx.request)
          if (disconnected) return ctx.json({ success: true, providersDisconnected: disconnected })
          return
        }
        if (ctx.path === '/callback/:id') await afterProviderCallback(ctx)
      }),
    },
    // Local Vite origins only outside production, matching the CORS
    // allowlist in index.ts; production trusts only the web origin and Tauri.
    trustedOrigins: [
      env.WEB_BASE_URL,
      ...(env.ENVIRONMENT === 'production'
        ? []
        : ['http://localhost:5173', 'http://localhost:5174']),
      'tauri://localhost',
      'https://tauri.localhost',
    ],
    socialProviders: {
      github: {
        clientId: env.GITHUB_CLIENT_ID,
        clientSecret: env.GITHUB_CLIENT_SECRET,
        // Only the primary address, with GitHub's own verified flag: Better
        // Auth's default would fall back to any listed address (FR-026).
        // GitHub never proves the inbox here, so the user it describes is
        // unverified either way (FR-014).
        getUserInfo: async (token) => {
          const headers = { Authorization: `Bearer ${token.accessToken}`, 'User-Agent': 'qzr' }
          const profileRes = await fetch('https://api.github.com/user', { headers })
          const emailsRes = await fetch('https://api.github.com/user/emails', { headers })
          if (!profileRes.ok || !emailsRes.ok) return null
          const profile = (await profileRes.json()) as {
            id: number
            login: string
            name: string | null
            avatar_url?: string
          }
          const emails = (await emailsRes.json()) as {
            email: string
            primary: boolean
            verified: boolean
          }[]
          const primary = emails.find((e) => e.primary)
          if (!primary) return null
          await providerProfile.set({
            provider: 'github',
            id: String(profile.id),
            email: primary.email,
            verified: primary.verified,
            proves: false,
          })
          return {
            user: {
              id: String(profile.id),
              name: profile.name || profile.login,
              email: primary.email,
              image: profile.avatar_url,
              emailVerified: false,
            },
            data: profile,
          }
        },
      },
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        // Google speaks for an address only when it hosts the mail: Gmail,
        // or a Workspace account (an `hd` claim). For any other address
        // `email_verified` records a check made when the Google account was
        // created, and the address may since have changed hands (research D5).
        mapProfileToUser: async (profile) => {
          const proves =
            profile.email_verified &&
            (/@(gmail|googlemail)\.com$/i.test(profile.email) || Boolean(profile.hd))
          await providerProfile.set({
            provider: 'google',
            id: profile.sub,
            email: profile.email,
            verified: profile.email_verified,
            proves,
          })
          return { emailVerified: proves }
        },
      },
    },
    emailAndPassword: {
      enabled: true,
      password: { hash: hashPassword, verify: verifyPassword },
      // A reset by code ends every session; the plugin also verifies the
      // address, since the code proves the inbox (FR-005). Better Auth's
      // revoke runs after onPasswordReset, a backstop if its own fails.
      revokeSessionsOnPasswordReset: true,
      // A completed reset disconnects every GitHub and Google sign-in: one
      // added by whoever held the address before (a lapsed domain, say) must
      // not outlive the real owner's reset (FR-025, research D9). Sessions go
      // first, so a provider connection landing now finds the session that
      // started it gone. Each step is guarded: the password has already
      // changed, so a failure is logged rather than failing the reset.
      onPasswordReset: async ({ user }, request) => {
        let disconnected: ProviderName[] = []
        let stillConnected: ProviderName[] = []
        try {
          await db.delete(schema.session).where(eq(schema.session.userId, user.id))
          const removed = await db
            .delete(schema.account)
            .where(
              and(
                eq(schema.account.userId, user.id),
                inArray(schema.account.providerId, PROVIDERS),
              ),
            )
            .returning({ providerId: schema.account.providerId })
          disconnected = removed.map((r) => r.providerId as ProviderName)
        } catch (err) {
          console.error('[auth] disconnecting providers on reset failed:', err)
          stillConnected = await providersLeft(db, user.id)
        }
        try {
          // Recovery invalidates outstanding codes (OWASP): pending provider
          // sign-ins for the account go too (FR-029).
          await db
            .delete(schema.verification)
            .where(
              and(
                like(schema.verification.identifier, `${PENDING_PROVIDER_PREFIX}%`),
                sql`json_extract(${schema.verification.value}, '$.userId') = ${user.id}`,
              ),
            )
        } catch (err) {
          console.error('[auth] cancelling pending provider sign-ins on reset failed:', err)
        }
        if (request && disconnected.length > 0) disconnectedByReset.set(request, disconnected)
        // Tell the owner, whatever the reset did to their providers (FR-028).
        sendEmail(passwordResetEmail(user.email, { disconnected, stillConnected }))
      },
    },
    emailVerification: {
      // The email-code plugin sends this as a code (FR-006).
      sendOnSignUp: true,
    },
    user: {
      additionalFields: {
        role: {
          type: [AccountRole.Superuser, AccountRole.Normal] as [string, ...string[]],
          required: false,
          defaultValue: AccountRole.Normal,
          input: false,
        },
      },
    },
    account: {
      accountLinking: {
        // A provider sign-in joins an existing account only when both sides
        // have proven the address (FR-013): Better Auth checks the local side
        // (`requireLocalEmailVerified`, default true), which stops someone
        // pre-registering another person's address (GHSA-g38m-r43w-p2q7), and
        // with no trusted providers it checks the provider side too, which
        // the provider settings above narrow to a Google-hosted address.
        enabled: true,
      },
    },
    databaseHooks: {
      account: {
        create: {
          // A connection from settings lands only while the session that
          // started it lasts; see the `/link-social` before hook.
          before: async (account) => {
            if (!PROVIDERS.includes(account.providerId as ProviderName)) return
            // Outside an OAuth callback there's no state, and no connection.
            const state = await getOAuthState().catch(() => null)
            if (!state?.link) return
            const started = (state as { linkSession?: unknown }).linkSession
            if (typeof started !== 'string') return false
            const live = await db
              .select({ id: schema.session.id })
              .from(schema.session)
              .where(
                and(
                  eq(schema.session.id, started),
                  eq(schema.session.userId, state.link.userId),
                  gt(schema.session.expiresAt, new Date()),
                ),
              )
            if (live.length === 0) return false
          },
        },
      },
    },
    plugins: [
      emailOTP({
        expiresIn: CODE_TTL_S,
        storeOTP: 'hashed',
        // Sign-up sends a code instead of a link.
        overrideDefaultEmailVerification: true,
        // sendEmail starts the send and returns, so a known address answers
        // as fast as an unknown one, for which the plugin sends nothing.
        sendVerificationOTP: async ({ email, otp, type }, ctx) => {
          if (!SENDABLE_TYPES.has(type)) return
          if (type === 'forget-password') {
            sendEmail(resetCodeEmail(email, otp, CODE_TTL_S / 60))
            return
          }
          // The code sent at sign-up counts towards its client's daily limit
          // only, and over the limit it skips the email instead of refusing:
          // a group signing up on one network still gets in, and can send a
          // code later from settings. Requests to send one were counted on
          // arrival.
          const request = ctx?.request
          if (request && !EMAILING_PATHS.has(authPath(request))) {
            const ip = clientIp(request)
            if (ip && !(await takeEmailSend(db, clientKey(ip), PER_CLIENT))) {
              console.warn(`[email] sign-up code skipped: daily limit reached for ${ip}`)
              return
            }
          }
          sendEmail(verificationCodeEmail(email, otp, CODE_TTL_S / 60))
        },
      }),
    ],
    advanced: {
      // Workers see the client's address in CF-Connecting-IP.
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
      // verse-vault runs Better Auth on the same host with the default prefix;
      // sharing cookie names let each app overwrite the other's session.
      cookiePrefix: 'qzr',
      database: {
        generateId: () => crypto.randomUUID(),
      },
    },
  })
}

export type Auth = ReturnType<typeof createAuth>

function clientIp(request: Request): string | null {
  return request.headers.get('cf-connecting-ip')
}

/** A request's path under Better Auth's mount, as `ctx.path` names it. */
function authPath(request: Request): string {
  return new URL(request.url).pathname.replace(/^.*?\/api\/auth/, '')
}

/** After a failed disconnect, the providers still on the account; if even
 *  that can't be read, both, so the notice tells the owner to check. */
async function providersLeft(db: Db, userId: string): Promise<ProviderName[]> {
  try {
    const rows = await db
      .select({ providerId: schema.account.providerId })
      .from(schema.account)
      .where(and(eq(schema.account.userId, userId), inArray(schema.account.providerId, PROVIDERS)))
    return rows.map((r) => r.providerId as ProviderName)
  } catch {
    return PROVIDERS
  }
}

/**
 * After a provider callback, for connecting from settings (FR-018): Better
 * Auth refuses a link the provider doesn't prove the inbox for. A verified
 * account has proven it already, so link it; an unverified one proves it
 * first. A link Better Auth made where the provider proves the inbox verifies
 * the address.
 */
async function afterProviderCallback(
  ctx: Parameters<Parameters<typeof createAuthMiddleware>[0]>[0],
) {
  const location = ctx.context.responseHeaders?.get('location')
  const profile = await providerProfile.get()
  if (!location || !profile) return
  const redirect = new URL(location)
  const error = redirect.searchParams.get('error')
  const internal = ctx.context.internalAdapter
  const found = await internal.findUserByEmail(profile.email, { includeAccounts: true })
  if (!found) return

  if (error === 'unable_to_link_account') {
    const state = await getOAuthState()
    if (!state?.link || state.link.userId !== found.user.id) return
    if (!found.user.emailVerified) {
      redirect.searchParams.set('error', 'verify_email_first')
      throw ctx.redirect(redirect.toString())
    }
    const owner = await internal.findAccountByProviderId(profile.id, profile.provider)
    if (owner?.userId === found.user.id) throw ctx.redirect(state.callbackURL)
    if (owner) {
      redirect.searchParams.set('error', 'account_already_linked_to_different_user')
      throw ctx.redirect(redirect.toString())
    }
    // A refusing create hook (the session ended) returns null, and the unique
    // index refuses a link racing another: Better Auth's refusal then stands.
    const linked = await internal
      .linkAccount({ providerId: profile.provider, accountId: profile.id, userId: found.user.id })
      .then(
        (created) => Boolean(created),
        () => false,
      )
    if (!linked) return
    throw ctx.redirect(state.callbackURL)
  }

  if (!error && profile.proves && !found.user.emailVerified) {
    const linked = found.accounts.some(
      (a) => a.providerId === profile.provider && a.accountId === profile.id,
    )
    if (linked) await internal.updateUser(found.user.id, { emailVerified: true })
  }
}
