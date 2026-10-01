export interface Env {
  ASSETS: Fetcher
}

const SCORESHEET_PREFIX = '/qzr/scoresheet/'

export default {
  // Assets are served before this runs (see wrangler.toml), so the script only
  // sees requests no file matched; the asset layer also adds trailing slashes
  // (`/qzr` -> `/qzr/`). The built-in SPA fallback would serve `/index.html`,
  // which does not exist here: both apps live under `/qzr/`, each with its own
  // shell. Shells are fetched by directory path, since asking for
  // `.../index.html` gets a redirect to the directory instead.
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } })
    }

    const url = new URL(request.url)
    const shell = url.pathname.startsWith(SCORESHEET_PREFIX) ? SCORESHEET_PREFIX : '/qzr/'
    // Returned as-is: a reload revalidates with the shell's ETag, and the 304 that
    // earns must reach the browser, not be rewritten into an empty 200.
    return env.ASSETS.fetch(new Request(new URL(shell, url), request))
  },
} satisfies ExportedHandler<Env>
