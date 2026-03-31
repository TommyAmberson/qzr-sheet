import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { drizzle } from 'drizzle-orm/d1'
import type { Bindings } from '../bindings'
import * as schema from '../db/schema'
import { AccountRole } from '@qzr/shared'

export function createAuth(env: Bindings) {
  const db = drizzle(env.DB, { schema })

  return betterAuth({
    baseURL: env.API_BASE_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, { provider: 'sqlite', schema }),
    trustedOrigins: [env.WEB_BASE_URL, 'http://localhost:5173', 'http://localhost:5174'],
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
        // GitHub and Google both verify email addresses — safe to auto-link
        trustedProviders: ['github', 'google'],
      },
    },
    advanced: {
      database: {
        generateId: () => crypto.randomUUID(),
      },
    },
  })
}

export type Auth = ReturnType<typeof createAuth>
