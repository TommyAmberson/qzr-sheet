# Authentication

## Account Types

| Type        | Description                                                        |
| ----------- | ------------------------------------------------------------------ |
| `superuser` | Global. Creates and manages all quiz meets.                        |
| `normal`    | Default for a new account. No meet access until a code is entered. |

Superusers are provisioned out-of-band (e.g. seeded in the DB). They have implicit full access to
all meets — no membership rows are needed. The role counts only once the account's address is
verified, so verify it before granting the role: an unverified address may belong to whoever
registered it first, and a takeover returns the role to normal.

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

### Email

Emails go through Resend's HTTPS API from `VerseVault <no-reply@versevault.ca>`, with the key in the
Worker secret `RESEND_API_KEY` (`packages/api/src/lib/email.ts`). Without a key, as in local dev,
each message is logged instead, so the flows can still be walked through. A send never delays the
response: it starts, goes to the Worker's `waitUntil`, and its failure is logged, so a known address
answers like an unknown one.

Every email carries a 6-digit code, never a link: a code typed where it was asked can't be opened by
a mail scanner or on the wrong device. Codes come from Better Auth's `emailOTP` plugin: hashed at
rest, 10 minutes, 3 tries, each for one purpose, and a resend replaces the old one. The plugin's
routes this app doesn't use (sign-in by code, changing the address, the bare code check) are
disabled, along with the link-based reset and verification routes and `/unlink-account`.

### Limits

Reset, verification and code-step emails count 3 per address per hour; every email a client's
requests send counts 10 per client address per day (`CF-Connecting-IP`). The counts live in D1's
`email_sends` table (`packages/api/src/lib/emailLimits.ts`), since a Worker's isolates share no
memory, and the cron deletes past windows. The sign-up email counts against the client only. A
request over a limit answers 429 with a message to try later; a reset request for an unknown address
counts the same as one for a real account.

Better Auth's own rate limiter covers its routes: password sign-in allows 5 attempts per client per
minute, the other routes Better Auth's defaults. It is on in production explicitly, since Better
Auth would otherwise enable it only when `NODE_ENV` is `production`, and it keeps its counts in D1's
`rate_limit` table rather than in memory, which each isolate has its own of.

### Breached passwords

A new password at sign-up, reset or change is refused when it appears in a data breach (NIST SP
800-63B-4), checked in the before hook (`packages/api/src/lib/breachedPasswords.ts`) so a refused
reset keeps its code. Only the first 5 characters of its SHA-1 go to the Pwned Passwords range API.
If that service can't be reached, the sign-up or reset fails and asks to try later, rather than
accepting the password unchecked. The minimum length stays 8.

### Password reset

"Forgot password?" on the sign-in form: the address, then the emailed code with a new password, then
a normal password sign-in. `request-password-reset` answers the same whether or not the address has
an account. A completed reset (`emailAndPassword.onPasswordReset`):

* ends every session;
* disconnects every GitHub and Google account, in case someone else had added one; the owner
  connects theirs again from settings, and the response lists what was disconnected so the form can
  say so;
* cancels the account's pending provider sign-ins;
* emails a notice saying what it did.

The code proves the inbox, so a reset also verifies the address.

### Email verification

Verification never blocks sign-in. A password sign-up emails a code, and the form asks for it with
"Skip for now". An unverified account can verify later from account settings (`/account` in the
portal), which warns that anyone with the inbox can take it over until then. Verifying needs a
session on that account.

### GitHub and Google sign-in

A provider sign-in joins an existing account with the same address only with current proof of the
inbox:

* **Google** proves it only for an address Google hosts, a Gmail address or a Workspace account (an
  `hd` claim), and only with `email_verified`. Such a sign-in signs into the matching account and
  verifies it. A sign-up on such an address starts verified.
* **GitHub** never proves it. Only the account's primary address is used.
* A sign-in whose address the provider doesn't report verified creates no user and signs into none
  (`provider_email_unverified`).
* Onto a **verified** password account without that proof, the sign-in is refused
  (`account_not_linked`): sign in with the password and connect from settings.
* Onto an account with **no password** (it signs in only with GitHub or Google), the sign-in is
  refused (`sign_in_with_provider`): sign in with that provider and connect this one, or set a
  password with "Forgot password?", since a reset by code adds one.
* Onto an **unverified password account**, the sign-in waits on a pending row and goes to the
  portal's `/account/provider` page, below.

### The code step and the choice

The pending row lives in Better Auth's `verification` table (`pending-provider:<token>`, 10
minutes), held by an HTTP-only cookie scoped to `/qzr/api/account/provider`, so a copied page
address carries nothing (`packages/api/src/lib/pendingProvider.ts`). Unless Google hosts the
address, a code-step code goes to it first; its email says a provider sign-in is waiting, and the
code works for that step only. Then the person chooses:

* **That's me:** sign in with the account's password, and the provider connects and the address is
  verified.
* **That's not me:** after a warning, the account becomes theirs: the password, every session, every
  other GitHub or Google account, the meet memberships and roles all go, the role returns to normal,
  the provider connects, the address is verified, and they are signed in. Meet access came from
  codes the registrant entered, so they join their meets again with codes.

A row's updates are compare-and-set on its stored value, so requests in different isolates can't
both spend a try or use the row.

| Route                                 | Needs                                                   | Result                                           |
| ------------------------------------- | ------------------------------------------------------- | ------------------------------------------------ |
| `GET /api/account/provider`           | pending cookie                                          | the step (`code` or `choice`), provider, address |
| `POST /api/account/provider/confirm`  | pending cookie, `{ code }`                              | proves the inbox; then the choice                |
| `POST /api/account/provider/resend`   | pending cookie                                          | a new code, under the limits                     |
| `POST /api/account/provider/claim`    | pending cookie, a session on that account               | "That's me"                                      |
| `POST /api/account/provider/takeover` | pending cookie, proven                                  | "That's not me", then signed in                  |
| `POST /api/account/disconnect`        | a sign-in within the last day, `{ provider, password }` | disconnects; ends every other session            |

A used, expired or unknown cookie gets the same answer on every route.

### Connecting and disconnecting

Account settings connect GitHub or Google through Better Auth's `linkSocial`, from a sign-in within
the last day. The link lands only while the session that started it lasts, so signing out or a reset
cancels a connection started before it. An unverified account needs the proof above first; a
Google-hosted address gives it, and verifies the account. Disconnecting needs the password, a
sign-in within the last day, and a password left; it removes the provider and ends every other
session.

### Notices

The address is emailed when a provider joins an account that already had another way in, or leaves
one, saying how to undo it. A new provider sign-up and a takeover send none, and a reset's own
notice covers what it disconnected.

### Sessions

User sessions are stored as `HttpOnly` cookies set by Better Auth. No `localStorage` involvement for
user auth. Better Auth handles session creation, expiry, and rotation automatically.

The cookies carry the `qzr` prefix (`__Secure-qzr.session_token`, ...) via `advanced.cookiePrefix`.
verse-vault runs Better Auth on the same host with the default `better-auth` prefix, and sharing the
names let each app overwrite the other's session.

## OAuth redirects

The provider sends the user back to Better Auth's callback,
`https://www.versevault.ca/qzr/api/auth/callback/{github,google}`, which sets the session cookie and
returns to the page sign-in started on. Both callback URLs must be registered with the providers.
Local dev uses separate OAuth apps with `http://localhost:8787/api/auth/callback/...`.

### Desktop app

The scoresheet's desktop app offers email and password only: the shared sign-in form hides GitHub
and Google under Tauri. Provider sign-in there needs the system browser and a loopback redirect (RFC
8252): a redirect to `http://127.0.0.1:{port}` with PKCE and `state`, the callback handled by the
API in the browser, and a one-time token the app exchanges for its session. None of that is built
yet.

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
  digits, stored as is, and unique across meets ignoring case, as joining matches them. The API
  takes a value of digits only as a meet id and anything else as a viewer code, so the two can't be
  confused.
* **Rate-limit** the join endpoint. Cloudflare's built-in rate limiting can be applied per-route to
  prevent brute-forcing even short codes.
* **Rotation** invalidates the old code immediately. Optionally it also clears memberships; see
  [roles-and-access.md § Code Rotation](./roles-and-access.md#code-rotation).

### Credential lifecycle

| Credential  | Issued                                     | Renewed                  | Revoked                                                                      | Ends                            |
| ----------- | ------------------------------------------ | ------------------------ | ---------------------------------------------------------------------------- | ------------------------------- |
| Session     | signing in                                 | by Better Auth           | a password reset, a takeover, a disconnect (other sessions)                  | signing out, Better Auth expiry |
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
token of the meet it is about (`withGuestToken`). In the portal, "join with a code" keeps the
session, an official is taken to the meet's results, and the router admits a guest session to the
results pages only; other meet pages still need an account. A guest's meets are listed on the
portal's home page and in the scoresheet's meet picker, each with Leave.

**Keeping and renewing a guest session:** a viewer's session keeps its viewer code; an official's
keeps the room the join answered with, and never the room code. A viewer's session renews itself
from its code inside `withGuestToken`, for a request about its meet: before it once its token has
expired, and once after a 401. A route about a meet that needs an account answers a guest whose
accepted token is for that meet with 403, since renewing wouldn't change that. An official's session
is renewed around the actions that need its room (sending, uploading, correcting, restoring) by
`withRoomCode`, which asks for the room code in a dialog and runs the action again. Another room's
code is taken unless the action is for a quiz stored for the old room; another meet's code is
refused, except that the scoresheet's Submit offers to send to that meet instead (`otherMeet`). A
renewal the server refuses (a 4xx answer other than 401, 408, and 429) removes the session and says
so; a network failure, server error, or rate limit keeps it. Signing in upgrades the account with
the guest account's codes (`upgradeOnSignIn`); signing out in either app removes every guest session
and the meet data kept for them (`clearGuestData`).

**URL-shareable viewer access (scoresheet):** opening the scoresheet with `?meet=<viewer code>`
joins as a guest viewer:

```
https://www.versevault.ca/qzr/scoresheet/?meet=fall-2025
```

The scoresheet redeems the code at `/qzr/api/join/guest`, keeps the session, and removes the code
from the address bar (a rejected link says so; when the server can't be reached the code stays for a
reload). A value of digits only, or one beside a quiz link, is a meet id and never joined. The
meet's teams become selectable in "Load teams from meet" without signing in. Room codes are never
put in links: a link ends up in browser history, logs, and screenshots.

### Cross-site requests

Better Auth checks the `Origin` of requests to its own routes. The account routes (`/api/account/*`)
refuse a form-like request (`text/plain`, form-encoded or multipart, or no content type) unless its
`Origin` is one Better Auth trusts: SameSite=Lax cookies stop other sites, but not another page on
`versevault.ca`. A JSON request from another origin already fails CORS.

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
