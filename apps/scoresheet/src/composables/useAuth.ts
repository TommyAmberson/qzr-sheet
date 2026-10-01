import { createAppAuthClient } from '@qzr/shared'

declare const __API_URL__: string
declare const __IS_TAURI__: boolean

export const IS_TAURI = __IS_TAURI__

// Better Auth needs an absolute URL, and uses one with a path as-is, so pass the
// full auth endpoint: /qzr/api/auth on the web, the dev API's /api/auth locally.
export const { authClient, useAuth } = createAppAuthClient(
  new URL(`${__API_URL__}/api/auth`, window.location.origin).href,
)
