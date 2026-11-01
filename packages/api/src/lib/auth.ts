import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto'
import type { Bindings } from '../bindings'
import * as schema from '../db/schema'
import type { Db } from './db'
import { AccountRole } from '@qzr/shared'
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api'
import { emailOTP } from 'better-auth/plugins'
import {
  passwordResetEmail,
  resetCodeEmail,
  verificationCodeEmail,
  type ProviderName,
  type SendEmail,
} from './email'
import { and, eq, inArray, like, sql } from 'drizzle-orm'
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
        if (ctx.path !== '/email-otp/reset-password' || !ctx.request) return
        const disconnected = disconnectedByReset.get(ctx.request)
        if (disconnected) return ctx.json({ success: true, providersDisconnected: disconnected })
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
      },
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
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
        enabled: true,
        // Trusting GitHub/Google skips only the provider-side email check.
        // better-auth >= 1.6.11 still refuses to auto-link onto a local
        // account whose own email is unverified (`requireLocalEmailVerified`,
        // default true), which blocks pre-registering a victim's email with a
        // password (GHSA-g38m-r43w-p2q7). Email/password accounts are never
        // verified here, so they don't auto-link; don't turn that off.
        trustedProviders: ['github', 'google'],
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
