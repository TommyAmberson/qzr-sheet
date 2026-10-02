import { legacyServiceWorker } from './legacySw'

export interface Env {
  ASSETS: Fetcher
}

const SCORESHEET_PREFIX = '/qzr/scoresheet/'

/** qzr's addresses from before it moved under /qzr/ (routes in wrangler.toml). */
function legacyResponse(url: URL): Response | null {
  const { pathname, search } = url
  if (pathname === '/scoresheet/sw.js') {
    return new Response(legacyServiceWorker, {
      headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' },
    })
  }
  if (pathname === '/scoresheet') return redirect(`${SCORESHEET_PREFIX}${search}`)
  if (pathname.startsWith('/scoresheet/') || pathname === '/roadmap') {
    return redirect(`/qzr${pathname}${search}`)
  }
  return null
}

// 308 keeps the method, so a POST to an old address isn't silently turned into a GET.
function redirect(location: string): Response {
  return new Response(null, { status: 308, headers: { Location: location } })
}

export default {
  // Assets are served before this runs (see wrangler.toml), so the script only
  // sees requests no file matched; the asset layer also adds trailing slashes
  // (`/qzr` -> `/qzr/`). The built-in SPA fallback would serve `/index.html`,
  // which does not exist here: both apps live under `/qzr/`, each with its own
  // shell. Shells are fetched by directory path, since asking for
  // `.../index.html` gets a redirect to the directory instead.
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const legacy = legacyResponse(url)
    if (legacy) return legacy

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } })
    }

    const shell = url.pathname.startsWith(SCORESHEET_PREFIX) ? SCORESHEET_PREFIX : '/qzr/'
    // Returned as-is: a reload revalidates with the shell's ETag, and the 304 that
    // earns must reach the browser, not be rewritten into an empty 200.
    return env.ASSETS.fetch(new Request(new URL(shell, url), request))
  },
} satisfies ExportedHandler<Env>
