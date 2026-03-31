import type { D1Database } from '@cloudflare/workers-types'

export interface Bindings {
  DB: D1Database
  ENVIRONMENT: string
  GITHUB_CLIENT_ID: string
  GITHUB_CLIENT_SECRET: string
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  JWT_SECRET: string
}
