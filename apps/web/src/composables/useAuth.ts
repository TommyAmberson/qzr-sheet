import { createAppAuthClient } from '@qzr/shared'

declare const __API_URL__: string

export const { authClient, useAuth } = createAppAuthClient(__API_URL__ || window.location.origin)
