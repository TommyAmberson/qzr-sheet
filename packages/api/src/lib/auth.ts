import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { drizzle } from 'drizzle-orm/d1'
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto'
import type { Bindings } from '../bindings'
import * as schema from '../db/schema'
import { AccountRole } from '@qzr/shared'

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

// `basePath` is the entrance the request came in on (`/api/auth` or
// `/qzr/api/auth`): OAuth callbacks are built from it, so they return there.
export function createAuth(env: Bindings, basePath = '/api/auth') {
  const db = drizzle(env.DB, { schema })

  return betterAuth({
    // Bare origin: Better Auth appends `basePath`, and ignores it if baseURL has a path.
    baseURL: env.API_BASE_URL,
    basePath,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, { provider: 'sqlite', schema }),
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
      // sendResetPassword: TODO — wire up once email sending is configured
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
    advanced: {
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
