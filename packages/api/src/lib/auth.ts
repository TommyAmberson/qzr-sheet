import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto'
import type { Bindings } from '../bindings'
import * as schema from '../db/schema'
import { isUniqueViolation, type Db } from './db'
import {
  AccountRole,
  SOCIAL_PROVIDERS,
  isSocialProvider,
  tooManyRequestsMessage,
  type EmailLimit,
  type SocialProvider,
} from '@qzr/shared'
import {
  APIError,
  createAuthMiddleware,
  getIp,
  getOAuthState,
  getSessionFromCtx,
} from 'better-auth/api'
import { defineRequestState } from '@better-auth/core/context'
import { emailOTP } from 'better-auth/plugins'
import { isBreachedPassword } from './breachedPasswords'
import {
  passwordResetEmail,
  providerConnectedEmail,
  providerDisconnectedEmail,
  resetCodeEmail,
  verificationCodeEmail,
  type EmailMessage,
  type SendEmail,
} from './email'
import { and, eq, gt, inArray, like, ne, sql } from 'drizzle-orm'
import { PER_CLIENT, clientKey, takeAllowance, takeEmailLimits } from './emailLimits'
import {
  PENDING_PROVIDER_COOKIE,
  PENDING_PROVIDER_PREFIX,
  PENDING_TTL_MS,
  createPending,
  pendingCookiePath,
  sendPendingCode,
} from './pendingProvider'

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
 *  verification that codes replace (research D3), and the unlink route that
 *  the account routes' disconnect replaces (research D8). */
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
  '/unlink-account',
]

/** Code types the send route serves; the others belong to refused flows. */
const SENDABLE_TYPES = new Set(['email-verification', 'forget-password'])

/** Codes last 10 minutes; the plugin's defaults give 6 digits and 3 tries. */
const CODE_TTL_S = 10 * 60

/** Whether a session started within Better Auth's `freshAge` (seconds), "a
 *  recent sign-in", which connecting and disconnecting need (FR-018). */
export function isFreshSession(createdAt: Date | string, freshAgeS: number): boolean {
  return Date.now() - new Date(createdAt).getTime() <= freshAgeS * 1000
}

/** What the current provider callback learned: the provider's own claim that
 *  the address is verified, and whether that proves the inbox (research D5).
 *  Better Auth hands the after hook only a redirect, so it's kept here. */
const providerProfile = defineRequestState<{
  provider: SocialProvider
  id: string
  email: string
  verified: boolean
  proves: boolean
} | null>(() => null)

/** The providers the current reset disconnected, for its response. */
const disconnectedByReset = defineRequestState<SocialProvider[]>(() => [])

const tooMany = (limit: EmailLimit) =>
  new APIError('TOO_MANY_REQUESTS', { message: tooManyRequestsMessage(limit) })

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
        // Only requests from outside; Better Auth's own calls pass.
        if (!ctx.request) return
        const body = (ctx.body ?? {}) as { email?: unknown; type?: unknown; password?: unknown }
        switch (ctx.path) {
          // The send route's types for refused flows. A verification code is
          // sent only for a session on that account (FR-009), so a stranger
          // can't have codes mailed to any address; sign-up's own send isn't
          // a request to this route.
          case '/email-otp/send-verification-otp': {
            if (typeof body.type !== 'string' || !SENDABLE_TYPES.has(body.type)) {
              throw new APIError('NOT_FOUND')
            }
            if (body.type === 'email-verification' && authPath(ctx.request) === ctx.path) {
              await requireSessionFor(
                ctx,
                body.email,
                'Sign in to this account to verify its email.',
              )
            }
            break
          }
          // Connecting a provider asks for a sign-in within the last day
          // (FR-018), and remembers which session started it: the link lands
          // only while that session lasts, so signing out or a password reset
          // cancels a connection started before it (FR-025).
          case '/link-social': {
            const session = await getSessionFromCtx(ctx)
            if (!session) return
            if (!isFreshSession(session.session.createdAt, ctx.context.sessionConfig.freshAge)) {
              throw new APIError('FORBIDDEN', {
                message: 'Sign in again to connect it.',
                code: 'SESSION_NOT_FRESH',
              })
            }
            const linkBody = ctx.body as { additionalData?: Record<string, unknown> }
            linkBody.additionalData = {
              ...linkBody.additionalData,
              linkSession: session.session.id,
            }
            return
          }
          // Verifying needs a session on that account (FR-007), checked before
          // the plugin compares the code: otherwise a signed-out guess would
          // spend a try and learn whether the code was right, and a code could
          // verify an address someone else registered.
          case '/email-otp/verify-email':
            await requireSessionFor(ctx, body.email, 'Sign in to this account to verify its email.')
            return
          // A new password, however it's set, that appears in a breach is
          // refused (FR-032), here rather than through Better Auth's
          // haveIBeenPwned plugin, which checks while hashing: by then a reset
          // has spent its code.
          case '/sign-up/email':
          case '/email-otp/reset-password':
            await refuseBreachedPassword(body.password)
            return
          case '/change-password':
            await refuseBreachedPassword((ctx.body as { newPassword?: unknown }).newPassword)
            return
        }
        if (!EMAILING_PATHS.has(ctx.path)) return
        if (typeof body.email !== 'string') return
        // Every address counts, an unknown or overlong one too, so no request
        // can send without limit.
        const refused = await takeEmailLimits(
          db,
          body.email,
          getIp(ctx.request, ctx.context.options),
        )
        if (refused) throw tooMany(refused)
      }),
      // A reset that disconnected providers says so, so the form can point to
      // connecting them again (FR-025).
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path === '/email-otp/reset-password') {
          const disconnected = await disconnectedByReset.get()
          if (disconnected.length > 0) {
            return ctx.json({ success: true, providersDisconnected: disconnected })
          }
          return
        }
        if (ctx.path === '/callback/:id') {
          await afterProviderCallback(ctx, {
            db,
            sendEmail,
            basePath,
            webBaseUrl: env.WEB_BASE_URL,
          })
        }
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
          const [profileRes, emailsRes] = await Promise.all([
            fetch('https://api.github.com/user', { headers }),
            fetch('https://api.github.com/user/emails', { headers }),
          ])
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
      onPasswordReset: async ({ user }) => {
        let disconnected: SocialProvider[] = []
        let stillConnected: SocialProvider[] = []
        try {
          await db.delete(schema.session).where(eq(schema.session.userId, user.id))
          const removed = await db
            .delete(schema.account)
            .where(
              and(
                eq(schema.account.userId, user.id),
                inArray(schema.account.providerId, [...SOCIAL_PROVIDERS]),
              ),
            )
            .returning({ providerId: schema.account.providerId })
          disconnected = removed.map((r) => r.providerId as SocialProvider)
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
        if (disconnected.length > 0) await disconnectedByReset.set(disconnected)
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
      // A provider sign-in whose address the provider doesn't report
      // verified creates no user and signs into none (FR-026); the callback's
      // after hook says why.
      user: {
        create: { before: async () => ((await providerVerified()) ? undefined : false) },
      },
      session: {
        create: { before: async () => ((await providerVerified()) ? undefined : false) },
      },
      account: {
        create: {
          // A connection from settings lands only while the session that
          // started it lasts; see the `/link-social` before hook.
          before: async (account) => {
            if (!isSocialProvider(account.providerId)) return
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
          // GitHub or Google joining an account that already has another way
          // in, by any route: tell the owner (FR-019). Not for a new provider
          // sign-up, which has nothing else, nor a takeover, which removes
          // the rest first. A reset and a takeover write the tables directly,
          // so they pass no hook here.
          after: async (account) => {
            const others = await db
              .select({ id: schema.account.id })
              .from(schema.account)
              .where(
                and(eq(schema.account.userId, account.userId), ne(schema.account.id, account.id)),
              )
              .catch(() => [])
            if (others.length > 0) await notifyOwner(db, sendEmail, account, providerConnectedEmail)
          },
        },
        delete: {
          // A provider disconnected while the account stays (FR-019).
          after: (account) => notifyOwner(db, sendEmail, account, providerDisconnectedEmail),
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
          if (ctx && request && !EMAILING_PATHS.has(authPath(request))) {
            const ip = getIp(request, ctx.context.options)
            if (ip && !(await takeAllowance(db, clientKey(ip), PER_CLIENT))) {
              console.warn(`[email] sign-up code skipped: daily limit reached for ${ip}`)
              return
            }
          }
          sendEmail(verificationCodeEmail(email, otp, CODE_TTL_S / 60))
        },
      }),
    ],
    // Better Auth turns its limiter on only when NODE_ENV is production, and
    // keeps counts in memory, which each isolate has its own of; so on
    // explicitly, in D1 (FR-030, research D16). Password
    // guessing gets a tighter rule than Better Auth's sign-in default.
    rateLimit: {
      enabled: env.ENVIRONMENT === 'production',
      storage: 'database',
      customRules: { '/sign-in/email': { window: 60, max: 5 } },
    },
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

/** Refuses a new password found in a breach, or any when the check can't be
 *  made, rather than accepting it unchecked (research D18). */
async function refuseBreachedPassword(password: unknown) {
  // One Better Auth refuses for its length (8 to 128) needs no outside call.
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) return
  const breached = await isBreachedPassword(password).catch((err) => {
    console.error('[auth] breached-password check failed:', err)
    throw new APIError('SERVICE_UNAVAILABLE', {
      message: "Couldn't check the password. Try again later.",
    })
  })
  if (breached) {
    throw new APIError('BAD_REQUEST', {
      message: 'This password has appeared in a data breach. Choose a different one.',
      code: 'PASSWORD_COMPROMISED',
    })
  }
}

/** Refuses the request unless it comes with a session on the account for
 *  `email`. */
async function requireSessionFor(
  ctx: Parameters<Parameters<typeof createAuthMiddleware>[0]>[0],
  email: unknown,
  message: string,
) {
  const session = await getSessionFromCtx(ctx)
  if (
    typeof email !== 'string' ||
    session?.user.email.toLowerCase() !== email.trim().toLowerCase()
  ) {
    throw new APIError('FORBIDDEN', { message })
  }
}

/** A request's path under Better Auth's mount, as `ctx.path` names it. */
function authPath(request: Request): string {
  return new URL(request.url).pathname.replace(/^.*?\/api\/auth/, '')
}

/** False only inside a provider callback whose address the provider doesn't
 *  report verified. */
async function providerVerified(): Promise<boolean> {
  const profile = await providerProfile.get().catch(() => null)
  return profile?.verified !== false
}

async function ownerEmail(db: Db, userId: string): Promise<string | undefined> {
  const [owner] = await db
    .select({ email: schema.user.email })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
  return owner?.email
}

/** A link the unique index on account refused, because another link for
 *  the same provider account landed first; any other failure is thrown. */
export function refusedByUniqueIndex(e: unknown): null {
  if (isUniqueViolation(e)) return null
  throw e
}

/** Emails the account's owner a notice about a GitHub or Google account
 *  joining or leaving it (FR-019). A failure is logged: the change stands. */
async function notifyOwner(
  db: Db,
  sendEmail: SendEmail,
  account: { userId: string; providerId: string },
  notice: (to: string, provider: SocialProvider) => EmailMessage,
) {
  if (!isSocialProvider(account.providerId)) return
  try {
    const owner = await ownerEmail(db, account.userId)
    if (owner) sendEmail(notice(owner, account.providerId))
  } catch (err) {
    console.error('[auth] provider notice failed:', err)
  }
}

/** After a failed disconnect, the providers still on the account; if even
 *  that can't be read, both, so the notice tells the owner to check. */
async function providersLeft(db: Db, userId: string): Promise<SocialProvider[]> {
  try {
    const rows = await db
      .select({ providerId: schema.account.providerId })
      .from(schema.account)
      .where(
        and(
          eq(schema.account.userId, userId),
          inArray(schema.account.providerId, [...SOCIAL_PROVIDERS]),
        ),
      )
    return rows.map((r) => r.providerId as SocialProvider)
  } catch {
    return [...SOCIAL_PROVIDERS]
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
  deps: { db: Db; sendEmail: SendEmail; basePath: string; webBaseUrl: string },
) {
  const location = ctx.context.responseHeaders?.get('location')
  const profile = await providerProfile.get()
  if (!location || !profile) return
  const redirect = new URL(location)
  const error = redirect.searchParams.get('error')
  // The hooks below refused it, or Better Auth did: say why (FR-026).
  if (error && !profile.verified) {
    redirect.searchParams.set('error', 'provider_email_unverified')
    throw ctx.redirect(redirect.toString())
  }
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
      .catch(refusedByUniqueIndex)
    if (!linked) return
    throw ctx.redirect(state.callbackURL)
  }

  // A refused sign-in onto an unverified password account: prove the inbox
  // (a Google-hosted address already has; otherwise a code-step code), then
  // "That's me" or "That's not me", on the portal's page (FR-015). Onto a
  // verified account, or one without a password, the refusal stands (FR-013).
  if (error === 'account_not_linked') {
    if (found.user.emailVerified) return
    if (!found.accounts.some((a) => a.providerId === 'credential')) return
    const { token, row } = await createPending(deps.db, {
      userId: found.user.id,
      provider: profile.provider,
      accountId: profile.id,
      email: found.user.email,
      proven: profile.proves,
    })
    const cookie = ctx.context.createAuthCookie(PENDING_PROVIDER_COOKIE, {
      maxAge: PENDING_TTL_MS / 1000,
      path: pendingCookiePath(deps.basePath),
    })
    ctx.setCookie(cookie.name, token, cookie.attributes)
    // The portal's page, whichever client the sign-in started from.
    const page = new URL(`${deps.webBaseUrl}/qzr/account/provider`)
    if (!profile.proves) {
      const ip = ctx.request ? getIp(ctx.request, ctx.context.options) : null
      const sent = await sendPendingCode(deps.db, deps.sendEmail, row, ip)
      // Over a limit no code went out; the page says which.
      if (sent === 'address' || sent === 'network') page.searchParams.set('limited', sent)
    }
    throw ctx.redirect(page.toString())
  }

  if (!error && profile.proves && !found.user.emailVerified) {
    const linked = found.accounts.some(
      (a) => a.providerId === profile.provider && a.accountId === profile.id,
    )
    if (linked) await internal.updateUser(found.user.id, { emailVerified: true })
  }
}
