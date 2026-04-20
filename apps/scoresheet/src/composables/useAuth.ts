import { createAppAuthClient } from '@qzr/shared'

declare const __API_URL__: string
declare const __IS_TAURI__: boolean

export const IS_TAURI = __IS_TAURI__

export const { authClient, useAuth } = createAppAuthClient(__API_URL__ || window.location.origin)
