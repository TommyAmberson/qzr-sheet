/**
 * Where to go once signed in, from the `next` query a signed-out deep link was sent home with. Only
 * a page of this portal: a path starting with one `/`, never one that a browser reads as another
 * site (`//host`, `/\host`), and never the home page it is already on.
 */
export function returnPath(next: unknown): string | null {
  if (typeof next !== 'string' || !next.startsWith('/') || next === '/') return null
  if (next.startsWith('//') || next.startsWith('/\\')) return null
  return next
}
