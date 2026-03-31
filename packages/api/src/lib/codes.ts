const CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const DEFAULT_CODE_LENGTH = 16

/** Generate a cryptographically random code string. */
export function generateCode(length = DEFAULT_CODE_LENGTH): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join('')
}

/** SHA-256 hash a code string, returning a hex digest. */
export async function hashCode(code: string): Promise<string> {
  const data = new TextEncoder().encode(code)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}
