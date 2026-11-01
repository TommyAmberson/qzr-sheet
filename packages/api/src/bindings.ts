import type { D1Database } from '@cloudflare/workers-types'

export interface Bindings {
  DB: D1Database
  ENVIRONMENT: string
  API_BASE_URL: string
  WEB_BASE_URL: string
  GITHUB_CLIENT_ID: string
  GITHUB_CLIENT_SECRET: string
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  BETTER_AUTH_SECRET: string
  // Resend, for reset and verification codes. Unset, the API logs each email
  // instead of sending it (local dev).
  RESEND_API_KEY?: string
}
