# Authentication

## Account Types

| Type        | Description                                                         |
| ----------- | ------------------------------------------------------------------- |
| `superuser` | Global. Creates and manages all quiz meets.                         |
| `normal`    | Default after OAuth signup. No meet access until a code is entered. |

Superusers are provisioned out-of-band (e.g. seeded in the DB). They have implicit full access to
all meets — no membership rows are needed.

## Implementation

Auth is handled by [Better Auth](https://better-auth.com) mounted at `/api/auth/*` in Hono.

### Sign-in methods

* **GitHub OAuth** — `signIn.social({ provider: 'github' })`
* **Google OAuth** — `signIn.social({ provider: 'google' })`
* **Email + password** — `signIn.email()` / `signUp.email()`

All flows use cookie-based sessions managed by Better Auth. No JWTs are issued or stored on the
client for user auth.

### Account creation

First login (any method) creates a `user` row with `role: 'normal'`. The `role` field is an
`additionalField` on the Better Auth `user` table — server-managed, not user-settable.

### Account linking

Account linking is enabled for GitHub and Google. If an OAuth sign-in arrives with an email that
matches an existing `user`, Better Auth automatically links the provider to the existing account.
Both providers verify email addresses, making this safe.

### Sessions

User sessions are stored as `HttpOnly` cookies set by Better Auth. No `localStorage` involvement for
user auth. Better Auth handles session creation, expiry, and rotation automatically.

## OAuth in Tauri

OAuth sign-in works in both web and Tauri contexts, but the redirect mechanism differs.

### Web (PWA in browser)

Standard OAuth popup. The provider redirects back to `www.versevault.ca/auth/callback`, the page
extracts the authorization code, sends it to the API to exchange for a session cookie.

### Tauri (native desktop)

The Tauri webview can't receive an `https://` redirect directly.
[`tauri-plugin-oauth`](https://github.com/FabianLars/tauri-plugin-oauth) solves this by spinning up
a temporary localhost server on a random port:

```
1. User clicks "Sign in"
2. Plugin starts http://localhost:{port}, opens system browser to provider
3. User consents in their real browser (with saved passwords, extensions, etc.)
4. Provider redirects to http://localhost:{port}/callback?code=xyz
5. Plugin captures the code, emits event to Tauri frontend, shuts down server
6. Frontend sends code to the API to complete the auth flow
```

The user signs in in their **real browser**, not an in-app webview — better UX and avoids
platform-specific webview restrictions.

### Platform-aware auth client

The scoresheet already uses this pattern — `fileIO.ts` detects Tauri via `__TAURI_INTERNALS__` and
branches between native dialogs and web APIs. The auth client follows the same approach:

```
signIn()
  ├── isTauri?  →  tauri-plugin-oauth (localhost redirect)
  └── isWeb?    →  window.open() popup (standard OAuth)
```

The API's OAuth configuration must allow both redirect URIs: the production callback URL and
`http://localhost` (Google and GitHub both support localhost redirects for native apps).

### Token storage

`localStorage` works identically in both contexts. For Tauri, `tauri-plugin-store` or the OS
keychain can provide encrypted storage as a future security upgrade.

## Security

### Infrastructure defaults

* **No exposed database.** D1 has no public endpoint — no host, no port, no connection string to
  leak. The only code path to the data is through Worker bindings.
* **V8 isolates.** Each Worker request runs in its own V8 isolate with no shared memory, no
  filesystem, and no process access.
* **Managed runtime.** Cloudflare maintains the runtime, patches the engine, and handles DDoS
  protection at the network level.
* **Secrets management.** OAuth client secrets and the `BETTER_AUTH_SECRET` are stored as Worker
  secrets — encrypted at rest, injected at runtime via `c.env`, never in source code or logs.

### OAuth

The authorization code exchange always happens server-side in the Worker. The frontend receives only
the finished session cookie — OAuth client secrets never leave the server.

### Join codes

* **Admin and coach codes** are secrets. Stored hashed (SHA-256) so a database leak does not expose
  valid codes. Codes are 16 random characters — brute force is impractical.
* **Official codes** are also hashed.
* **Viewer codes** are semi-public plain slugs (meant to be shared verbally).
* **Rate-limit** the join endpoint. Cloudflare's built-in rate limiting can be applied per-route to
  prevent brute-forcing even short codes.
* **Rotation** invalidates the old code and all previously shared join links immediately. Optionally
  also clears existing memberships — see [roles-and-access.md](./roles-and-access.md).

### Guest JWTs (officials and viewers without accounts)

Short-lived signed JWTs issued server-side. Scoped to a single meet, expire after 24 hours or when
the meet ends. No refresh — re-enter the code to get a new token. Stored in `localStorage`.

### SQL injection

Drizzle uses parameterized queries by default. SQL injection requires deliberately concatenating
user input into query strings.

### Tauri localhost OAuth

`tauri-plugin-oauth` spins up a temporary localhost server on a random port to capture the OAuth
redirect. Any local process could theoretically hit that port during the brief window it is open —
the same trade-off VS Code, Slack, and every Electron/Tauri app makes. Mitigations:

* The authorization code is single-use — the provider rejects replays.
* The localhost server shuts down immediately after capturing the code.
* The code exchange requires the OAuth client secret, which is on the Worker — intercepting the
  redirect code alone is not sufficient.
