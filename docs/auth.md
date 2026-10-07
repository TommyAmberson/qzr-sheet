# Authentication

## Account Types

| Type        | Description                                                         |
| ----------- | ------------------------------------------------------------------- |
| `superuser` | Global. Creates and manages all quiz meets.                         |
| `normal`    | Default after OAuth signup. No meet access until a code is entered. |

Superusers are provisioned out-of-band (e.g. seeded in the DB). They have implicit full access to
all meets — no membership rows are needed.

## Implementation

Auth is handled by [Better Auth](https://better-auth.com) mounted at `/qzr/api/auth/*` in Hono. The
app is also mounted at the root, which local dev uses (`http://localhost:8787/api/auth/*`); in
production the public `/api/*` belongs to verse-vault. The auth handler passes Better Auth the base
path of the mount that matched (Hono's `routePath`): OAuth callbacks are built from it, so each
entrance gets callbacks that come back to it.

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

The cookies carry the `qzr` prefix (`__Secure-qzr.session_token`, ...) via `advanced.cookiePrefix`.
verse-vault runs Better Auth on the same host with the default `better-auth` prefix, and sharing the
names let each app overwrite the other's session.

## OAuth in Tauri

OAuth sign-in works in both web and Tauri contexts, but the redirect mechanism differs.

### Web (PWA in browser)

Standard OAuth redirect. The provider sends the user back to Better Auth's callback,
`https://www.versevault.ca/qzr/api/auth/callback/{github,google}`, which sets the session cookie and
returns to the page sign-in started on. Both callback URLs must be registered with the providers.
Local dev uses separate OAuth apps with `http://localhost:8787/api/auth/callback/...`.

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

What each code grants, and who may redeem it, is defined in
[roles-and-access.md](./roles-and-access.md#codes). How they are kept:

* **Admin, coach, and room codes** are secrets: 16 random characters, stored hashed (SHA-256) so a
  database leak does not expose valid codes. Brute force is impractical. Each is shown to the admin
  once, when created or rotated.
* **Viewer codes** are public slugs the admin chooses: letters, digits, and hyphens, never all
  digits, stored as is and unique across meets. The API takes a value of digits only as a meet id
  and anything else as a viewer code, so the two can't be confused.
* **Rate-limit** the join endpoint. Cloudflare's built-in rate limiting can be applied per-route to
  prevent brute-forcing even short codes.
* **Rotation** invalidates the old code immediately. Optionally it also clears memberships; see
  [roles-and-access.md § Code Rotation](./roles-and-access.md#code-rotation).

### Credential lifecycle

| Credential  | Issued                                     | Renewed                  | Revoked                                                                      | Ends                            |
| ----------- | ------------------------------------------ | ------------------------ | ---------------------------------------------------------------------------- | ------------------------------- |
| Session     | signing in                                 | by Better Auth           | n/a                                                                          | signing out, Better Auth expiry |
| Admin code  | creating the meet                          | n/a                      | rotation                                                                     | deleting the meet               |
| Coach code  | creating the church                        | n/a                      | rotation                                                                     | deleting the church             |
| Room code   | creating the room                          | n/a                      | rotation                                                                     | deleting the room               |
| Viewer code | creating the meet; the admin may change it | n/a                      | changing it                                                                  | deleting the meet               |
| Membership  | redeeming a code while signed in           | n/a (it lasts)           | removed by an admin; rotate-and-clear                                        | deleting its church, room, meet |
| Guest token | redeeming a viewer or room code            | redeeming the code again | its code changes (room rotated, viewer code changed), or its room is deleted | 24 hours after issue            |

A viewer code keeps working after the meet is `done`, so viewers can come back for results and
stats; tokens do not end with the meet.

### Guest tokens (officials and viewers without accounts)

Short-lived signed JWTs issued by `POST /api/join/guest` for a viewer or room code. Each is scoped
to one meet and one role, and lasts 24 hours. There is no refresh endpoint: the holder redeems the
code again. The scoresheet keeps them in `localStorage`.

**Format:** HS256, issuer `qzr-guest`, audience `qzr-api`, signed with the server secret
(`packages/api/src/lib/jwt.ts`). Claims: `meetId`, `role` (`viewer` or `official`), `codeTag`, and
for an official the room's name as `label` and its id as `roomId`. `codeTag` is an HMAC under the
server secret of the code the token was issued for: the room's code hash for an official, the meet's
viewer code for a viewer, each kind with its own prefix. The join answer for a room code also
carries `room: { id, name }`.

**Wire format:** the client attaches the token as `Authorization: Bearer <jwt>`. `sessionMiddleware`
checks the Better Auth session first; if one is present the account is the principal and the bearer
token is ignored.

**Current:** `sessionMiddleware` admits a token only through `currentGuest`
(`packages/api/src/lib/jwt.ts`), which, after verifying the signature, issuer, audience, and expiry,
checks that the token's `codeTag` still matches its code: the meet's viewer code, or the room's code
hash with the room in the token's meet. A token that doesn't, or has no tag, is treated as absent,
so changing a code or deleting a room revokes its tokens on every route at once.

**Checks:** `isViewerOf(c, db, meetId)` admits superusers, members of the meet (any role), and
guests whose token is for that meet. `isOfficialOfRoom(c, db, meetId, roomId)` admits a guest whose
official token names that room, or a signed-in official of it. `officialRoomsOf(c, db, meetId)`
lists the rooms the caller officiates there: a guest official's room, or a signed-in account's
rooms. A guest official's send is stored for their token's room; one that names another room is
refused, and one that names none uses the token's room. Writes require an account (`requireAuth()`),
except submitting results, where officials use their guest token; reads use `requireAuthOrGuest()`.
Every check also applies the meet's phase
([roles-and-access.md § Access by phase](./roles-and-access.md#access-by-phase)).

**In both apps:** the guest session module lives in `packages/ui`, and each app passes it its own
join call. The scoresheet and the portal share an origin, so they share the stored sessions: a code
joined in either works in both. There is one guest session per meet, and each request carries the
token of the meet its path names (`guestTokenFor`). In the portal, "join with a code" keeps the
session, an official is taken to the meet's results, and the router admits a guest session to the
results pages only; other meet pages still need an account.

**URL-shareable viewer access (scoresheet):** opening the scoresheet with `?meet=<viewer code>`
joins as a guest viewer:

```
https://www.versevault.ca/qzr/scoresheet/?meet=fall-2025
```

The scoresheet redeems the code at `/qzr/api/join/guest` and keeps the session. The meet's teams
become selectable in "Load teams from meet" without signing in. Room codes are never put in links: a
link ends up in browser history, logs, and screenshots.

### Password hashing

Better Auth defaults to pure-JS scrypt (`@noble/hashes`), which takes ~5 seconds of CPU on
Cloudflare Workers — far over the 10ms free-tier limit
([better-auth#8860](https://github.com/better-auth/better-auth/issues/8860)). We override with
native `node:crypto` scryptSync (available via the `nodejs_compat` compatibility flag):

* **Algorithm:** scrypt with N=16384, r=16, p=1, keyLength=64
* **Why scrypt over PBKDF2:** scrypt is memory-hard — GPU/ASIC brute-force attacks require large
  amounts of RAM per guess, making them ~1000x more expensive than attacking
  [PBKDF2](https://en.wikipedia.org/wiki/PBKDF2) (which only requires CPU time). See
  [Password Hashing Guide: Argon2 vs Bcrypt vs Scrypt vs PBKDF2](https://guptadeepak.com/the-complete-guide-to-password-hashing-argon2-vs-bcrypt-vs-scrypt-vs-pbkdf2-2026/)
  for a detailed comparison.
* **Why native over pure-JS:** `node:crypto` scryptSync is compiled C++ running inside the Workers
  runtime. The pure-JS fallback from `@noble/hashes` does the same math in JavaScript, hitting the
  CPU limit. See
  [Hashing passwords on Cloudflare Workers](https://lord.technology/2024/02/21/hashing-passwords-on-cloudflare-workers.html)
  for background on password hashing in the Workers runtime.
* **Parameters:** N=16384 (2^14) is lower than the typical recommendation of 2^15–2^17, tuned to fit
  within the Workers CPU budget. Still memory-hard and well above the minimum security threshold.
* **Format:** `salt:hash` where salt is 16 random bytes (hex) and hash is 64 bytes (hex).
* **Constant-time comparison:** `timingSafeEqual` prevents timing side-channel attacks on
  verification.

OAuth sign-ins (GitHub, Google) bypass password hashing entirely — no hash is computed or stored.

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
