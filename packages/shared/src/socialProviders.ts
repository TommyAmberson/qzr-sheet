/** The sign-in providers besides email and password. */
export const SOCIAL_PROVIDERS = ['github', 'google'] as const

export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number]

export const SOCIAL_PROVIDER_LABEL: Record<SocialProvider, string> = {
  github: 'GitHub',
  google: 'Google',
}

export function isSocialProvider(value: unknown): value is SocialProvider {
  return SOCIAL_PROVIDERS.includes(value as SocialProvider)
}
