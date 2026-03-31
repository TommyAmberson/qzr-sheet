# Auth Proposal

## Overview

Two account types. Access to meet data is granted via short-lived codes distributed by an admin, not
by permanent role assignment.

## Account Types

| Type     | Description                                                         |
| -------- | ------------------------------------------------------------------- |
| `admin`  | Global. Creates and manages all quiz meets.                         |
| `normal` | Default after OAuth signup. No meet access until a code is entered. |

Admins are provisioned out-of-band (e.g. seeded in the DB).

## Auth Implementation

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

## Quiz Meets

An admin creates a **QuizMeet** (e.g. a tournament meet). Each QuizMeet has codes for three roles:

| Code            | Multiplicity | Grants                                 |
| --------------- | ------------ | -------------------------------------- |
| `coach_code`    | One          | Head coach — manage teams and quizzers |
| `official_code` | Many         | Official — submit `QuizFile` results   |
| `viewer_code`   | One          | Viewer — read-only access to meet data |

### Coach code

One per meet. Server-generated random token. The admin can rotate it (invalidating the old one) or
revoke a specific account's `head_coach` membership directly.

### Official codes

Multiple per meet — one per quiz room is the typical setup. Each code is independently named (e.g.
`"Room A"`, `"Room B"`) and can be rotated individually without affecting other rooms. An admin can
create, rename, rotate, or delete any official code at any time.

### Viewer code

One per meet. **Admin-set human-readable slug** (e.g. `"grace-2025"`) chosen for easy verbal
sharing. The viewer code is **semi-public**: any authenticated meet participant (admin, head coach,
official, or viewer) can see and share it.

## Joining a Meet

A user can join a meet by entering a code in two ways:

* **In-app** — after signing in (or during signup), a prompt accepts a code and immediately grants
  the corresponding role.
* **Via link** — the admin can share a join link that encodes the code. Visiting the link takes the
  user through sign-in/signup and automatically applies the code on completion.

Join links are as secure as the code itself — anyone with the link can join with that role. Rotating
the code invalidates both the code and any previously shared links for that code.

> **Open question:** should join links be available for all three roles, or restricted to
> `viewer_code` only? A `coach_code` or `official_code` link is no less secure than the code, but a
> clickable link may feel easier to misshare than a short code typed manually.

## Meet-Scoped Roles

Roles are **not** permanent account properties — they are memberships scoped to a specific QuizMeet.
The same account can hold different roles at different meets simultaneously, and multiple roles
within the same meet.

* **Admins** automatically have all roles for all meets — no membership rows needed.
* An **official** can hold multiple official-role memberships within the same meet (e.g.
  credentialed for both Room A and Room B).

```
Account (normal)
  ├── meet:101  roles: [head_coach, official(Room A)]
  ├── meet:102  role: official(Room B)
  ├── meet:103  role: viewer
  └── meet:104  (no membership — no access)
```

### head_coach

* Granted by entering the meet's `coach_code`
* After joining, the coach creates one or more churches they are managing for this meet, setting the
  name and short name for each
* All teams they create are assigned to one of their churches
* Cannot access other meets unless separately joined
* Admin can revoke by removing the `CoachMembership` record directly

### official

* Granted by entering any of the meet's `official_code`s (typically one per quiz room)
* Can submit `QuizFile` results for this meet
* Cannot manage teams or quizzers
* **No account required** — a code or join link issues a short-lived guest JWT instead; see
  [Quiz Ingest](#quiz-ingest)

### viewer

* Granted by entering the meet's `viewer_code`
* Read-only access to that meet's public data (standings, stats, schedules)
* Intended for quizzers, parents, and spectators
* **No account required** — a code or join link issues a guest JWT valid for the duration of the
  meet; see [Viewer Access](#viewer-access)

## Quiz Ingest

Completed `QuizFile` submissions require `official` (or `admin`) access for the meet.

Officials without an account can enter an `official_code` directly or follow a join link. Either way
the server issues a short-lived signed JWT (valid for 24h or until the meet ends) that grants submit
access without any persistent identity.

```
POST /meets/{id}/guest-session  { code: "abc123" }
  → 200 { token: "<signed JWT>", role: "official", meet_id, expires_at }

POST /quizzes  Authorization: Bearer <token>
  → 201
```

Guest sessions are stateless — the server only validates the signature and expiry on each request.
An optional `submitter_name` field on the request body provides a lightweight audit trail if needed.

## Live Meet Data

> **Future idea:** the server could support a publish model where stats and schedule draws are
> pushed to viewers. An admin presses a button to publish updated stats or results. Schedule draws
> could auto-update to show which teams are assigned to which rooms. This would make the viewer
> experience much richer.

## Viewer Access

Viewers without an account can enter the `viewer_code` directly or follow a join link. Either way
the server issues a guest JWT valid for the duration of the meet.

> **Future idea:** viewers could follow specific churches, teams, or quizzers. This would let
> quizzers track when they and a friend are quizzing together, coaches see when their teams are up,
> and parents follow their kids. Requires an account to persist preferences across sessions — guest
> JWT viewers would not get this feature.

## App Architecture

Three deployable units in a single monorepo (pnpm workspaces):

```
qzr/
├── apps/
│   ├── scoresheet/        # existing Vue 3 + Tauri 2 app (offline-first tool)
│   └── web/               # portal: coach, admin, viewer, official schedule
├── packages/
│   ├── shared/            # QuizFile schema, API types, role enums
│   └── api/               # Hono + D1 + Drizzle (Cloudflare Workers)
└── src-tauri/             # Tauri 2 Rust backend
```

### Scoresheet app (`apps/scoresheet`)

The scoresheet is a standalone offline-first tool. No router, no pages — a single-page scoring
interface. Phase 4 adds a thin optional API client (sign-in, load quiz, submit result) but no
portal-style views. When not signed in, the app works exactly as it does today.

Connected-mode additions:

* **Sign-in button** — OAuth popup (web) or system browser flow (Tauri). Stores a JWT.
* **Load Quiz** — modal/drawer to pick a meet and select an assigned quiz. Fetches teams and
  quizzers from the API and pre-populates the store.
* **Submit** — POSTs the serialized `QuizFile` to the API. Appears when authenticated and the quiz
  has data.
* **Connected status** in the meta bar — signed-in name, current quiz info, sign-out action.

The scoresheet's API surface is minimal:

```
1. Sign in        →  OAuth flow → JWT
2. Load quiz      →  GET  /quizzes/{id}         → { teams, quizzers, room }
3. Submit result   →  POST /quizzes/{id}/result  → QuizFile body
```

### Portal (`apps/web`)

A separate web app for everything that isn't live scoring: admin dashboard, coach roster management,
official schedule, and viewer standings. Uses Vue 3 + vue-router (or Nuxt for SSR if viewer pages
need to be indexable/shareable).

The portal links into the scoresheet with context. An official viewing their schedule clicks a quiz
and is taken to `/scoresheet/?quiz=abc123`. The scoresheet reads the JWT from `localStorage` (shared
via same origin) and the quiz ID from the URL, then auto-fetches and pre-populates.

Two entry points to the same result:

| Path                             | Flow                                                  |
| -------------------------------- | ----------------------------------------------------- |
| Portal → click quiz              | Opens `/scoresheet/?quiz=abc`, JWT already stored     |
| Scoresheet → sign in → load quiz | OAuth flow, pick from list in a modal, same end state |

### API (`packages/api`)

Hono on Cloudflare Workers with D1 and Drizzle. Serves both the scoresheet and the portal from the
same endpoints.

| Concern   | Tech               | Rationale                                                               |
| --------- | ------------------ | ----------------------------------------------------------------------- |
| Runtime   | Cloudflare Workers | Already deploying to CF, free tier, zero cold start                     |
| Framework | Hono               | Lightweight, TS-native, CF Workers first-class                          |
| Database  | Cloudflare D1      | Managed SQLite at the edge, binding-only access                         |
| ORM       | Drizzle            | Type-safe, SQLite/D1 support, auto-generated migrations                 |
| Auth      | `better-auth`      | OAuth + email/password + sessions + account linking out of the box      |
| Sessions  | Cookie-based       | Better Auth manages session cookies — no hand-rolled JWTs for user auth |

#### Hono

[Hono](https://hono.dev) is a lightweight TypeScript web framework built on Web Standards
(`Request`/`Response`). Cloudflare recommends it as the default framework for Workers. Express-like
routing and middleware, but fully typed — route handlers, environment bindings, and middleware all
participate in TypeScript inference.

The `hono/tiny` preset is under 14KB with zero dependencies. Built-in middleware covers CORS, JWT
validation, logging, and more. Cloudflare injects environment bindings (D1 databases, secrets, KV
stores) into the request context as `c.env`, and the `Bindings` generic makes them type-safe.

#### Cloudflare D1

[D1](https://developers.cloudflare.com/d1/) is Cloudflare's managed SQLite database. It runs at the
edge alongside the Worker — same network, minimal latency.

* **No public endpoint.** D1 is only accessible through a Worker binding. There is no host, port, or
  connection string. If a route doesn't query it, there is no network path to the data.
* **SQLite.** The auth-proposal data model is straightforward relational. SQLite handles it without
  the operational weight of Postgres.
* **Free tier.** 5M reads/day, 100K writes/day, 5 GB storage. Quiz meets are bursty weekend events —
  this will likely never be exceeded.
* **Same infra.** Already deploying to Cloudflare. D1 is one binding in `wrangler.toml`, not a
  separate service to provision or maintain.
* **Local dev.** `wrangler dev` runs a real local SQLite instance that behaves identically to
  production. No remote database needed during development.

Setup is `wrangler d1 create qzr-db` + a binding in `wrangler.toml`. After that, `c.env.DB` in any
Hono route is a live D1 connection.

#### Drizzle ORM

[Drizzle](https://orm.drizzle.team) is a TypeScript ORM with first-class D1 support. Tables are
defined as TypeScript objects that map directly to the data model sketch below. Queries are
type-safe end-to-end — return types are inferred from the schema with no manual annotations or
casting.

Migrations are auto-generated: `drizzle-kit generate` diffs the schema against the previous snapshot
and emits SQL migration files. Apply locally with `wrangler d1 migrations apply --local`, apply to
production with `--remote`. No hand-written SQL.

#### How they connect

```
Request
  → Cloudflare Worker (V8 isolate at the edge)
    → Hono (routing, CORS, JWT middleware)
      → Drizzle (typed query builder)
        → D1 (SQLite, same-network binding)
      ← typed result
    ← c.json(result)
  ← Response
```

The entire stack is TypeScript from route handler to database row. Since `packages/shared` exports
the same types the scoresheet uses, the API validates and returns data the frontend can consume
without casting or mapping.

### Shared package (`packages/shared`)

Types and schemas consumed by both frontend apps and the API:

* `QuizFile` TypeBox schema (extracted from `src/persistence/quizFile.ts`)
* API request/response types
* Role and code enums
* Shared validation logic

### Deployment

| URL                             | App              | Infra      |
| ------------------------------- | ---------------- | ---------- |
| `www.versevault.ca/scoresheet/` | Scoresheet PWA   | CF Pages   |
| `www.versevault.ca/`            | Portal + landing | CF Pages   |
| `www.versevault.ca/api/`        | API              | CF Workers |

The Worker is served at `www.versevault.ca/api/*` — same origin as the frontend, so no CORS headers
are needed in production.

### Tauri desktop

The Tauri build bundles the scoresheet only — portal views are web-only. An official using the
native app can either:

* Sign in and load a quiz directly from within the scoresheet (system browser OAuth + quiz picker
  modal)
* Browse the portal in a regular browser, click a quiz, and open the scoresheet PWA in another tab

Deep links (`versevault://quiz/abc123`) from the portal to the native app are a future nice-to-have.

## OAuth in Tauri

OAuth sign-in works in both web and Tauri contexts, but the redirect mechanism differs.

### Web (PWA in browser)

Standard OAuth popup. The provider redirects back to `www.versevault.ca/auth/callback`, the page
extracts the authorization code, sends it to the API to exchange for a JWT, and stores the JWT in
`localStorage`.

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
6. Frontend sends code to the API to exchange for a JWT
7. JWT stored in localStorage (or tauri-plugin-store for encrypted storage)
```

The user signs in in their **real browser**, not an in-app webview — better UX and avoids
platform-specific webview restrictions.

### Platform-aware auth client

The scoresheet already has this pattern — `fileIO.ts` detects Tauri via `__TAURI_INTERNALS__` and
branches between native dialogs and web APIs. The auth client follows the same approach:

```
signIn()
  ├── isTauri?  →  tauri-plugin-oauth (localhost redirect)
  └── isWeb?    →  window.open() popup (standard OAuth)

  both  →  send auth code to API  →  receive JWT  →  store in localStorage
```

The API's OAuth configuration must allow **both** redirect URIs: the production callback URL and
`http://localhost` (Google and GitHub both support localhost redirects for native apps).

### Token storage

`localStorage` works identically in both contexts and keeps the code simple. For Tauri,
`tauri-plugin-store` or the OS keychain can provide encrypted storage as a future security upgrade.

## Security

### Infrastructure defaults

The Workers + D1 stack is secure by default in ways a traditional VPS + database setup is not:

* **No exposed database.** D1 has no public endpoint — no host, no port, no connection string to
  leak. The only code path to the data is through Worker bindings. A traditional database needs
  firewall rules, VPC configuration, and credential management; D1 needs none of these.
* **V8 isolates.** Each Worker request runs in its own V8 isolate with no shared memory, no
  filesystem, and no process access. Smaller attack surface than a container or VPS running Node.
* **Managed runtime.** Cloudflare maintains the runtime, patches the engine, and handles DDoS
  protection at the network level. No OS to patch, no `node_modules` audit on the server.
* **Secrets management.** OAuth client secrets and JWT signing keys are stored as Worker secrets
  (encrypted at rest, injected at runtime via `c.env`). They never appear in source code, logs, or
  the frontend.

### OAuth

The authorization code exchange always happens server-side in the Worker. The frontend receives only
the finished JWT — OAuth client secrets never leave the server.

The API's OAuth configuration must allow two redirect URIs: the production callback URL
(`www.versevault.ca/auth/callback`) and `http://localhost` for Tauri desktop. Google and GitHub both
support localhost redirects for native apps.

### Sessions and tokens

* **User sessions** are cookie-based, managed by Better Auth. No JWTs are issued for user auth.
  Better Auth handles session creation, expiry, and rotation automatically.
* **Guest JWTs** (officials and viewers without accounts) remain custom — short-lived, scoped to a
  single meet, expire after 24 hours or when the meet ends. No refresh — re-enter the code to get a
  new token.

### Token storage

User sessions are stored as `HttpOnly` cookies set by Better Auth — no `localStorage` involvement
for user auth. Guest JWTs (officials/viewers) will use `localStorage` when implemented.

### Join codes

* **Coach and official codes** are secrets. Store them hashed (bcrypt or scrypt) so a database leak
  does not expose valid codes. Codes should be long enough (12+ random characters) to make brute
  force impractical.
* **Viewer codes** are semi-public by design (meant to be shared verbally). Hashing is optional but
  reasonable.
* **Rate-limit** the `POST /meets/{id}/guest-session` endpoint. Cloudflare has built-in rate
  limiting that can be applied per-route. This prevents brute-forcing codes even if they are short.
* **Rotation** invalidates the old code and any previously shared join links immediately.

### CORS

No CORS configuration is needed in production — the Worker is served at `www.versevault.ca/api/*`,
the same origin as the frontend. The API only sets CORS headers for local development (`:8787` ←
`:5174`).

### Tauri localhost OAuth

`tauri-plugin-oauth` spins up a temporary localhost server on a random port to capture the OAuth
redirect. Any local process could theoretically hit that port during the brief window it is open.
This is the same trade-off VS Code, Slack, and every Electron/Tauri app makes for desktop OAuth.
Mitigations:

* The authorization code is single-use — the provider rejects replays.
* The localhost server shuts down immediately after capturing the code.
* The code exchange requires the OAuth client secret, which is on the Worker, not locally.
  Intercepting the code alone is not sufficient.

### SQL injection

Drizzle uses parameterized queries by default. Even raw D1 queries use `.bind()` for
parameterization. SQL injection requires deliberately concatenating user input into query strings.

### Comparison to traditional stacks

| Concern               | Traditional (VPS + Postgres)        | This stack (Workers + D1)              |
| --------------------- | ----------------------------------- | -------------------------------------- |
| DB network exposure   | Public or VPC, needs firewall rules | No network path — binding only         |
| Server attack surface | Full OS, Node process, filesystem   | V8 isolate, no OS access               |
| Secrets management    | `.env` files, SSH access            | CF Worker secrets, encrypted at rest   |
| DDoS                  | Self-managed or paid protection     | Cloudflare network handles it for free |
| SQL injection         | Depends on ORM discipline           | Drizzle parameterizes by default       |
| Runtime patching      | Manual OS and Node updates          | Cloudflare maintains the runtime       |

The main trade-off is flexibility — no raw filesystem, no long-running processes, no WebSockets
without Durable Objects. None of that is needed for this API.

## Data Model Sketch

The auth tables (`user`, `session`, `account`, `verification`) are owned by Better Auth and should
not be hand-edited. App tables reference `user.id` (text UUID).

```
# Better Auth tables (managed — do not edit directly)
user
  id             # text UUID
  email
  emailVerified
  name
  image
  role: 'admin' | 'normal'   # additionalField, default: normal
  createdAt / updatedAt

session          # one row per active session
  id, userId, token, expiresAt, ...

account          # one row per linked provider per user
  providerId     # e.g. 'github', 'google', 'credential'
  accountId      # provider's stable user id
  userId         # FK → user
  ...

verification     # email verification / password reset tokens
  id, identifier, value, expiresAt

QuizMeet
  id
  name
  date
  coach_code        # server-generated token
  viewer_code       # plain slug, admin-set, semi-public
  official_codes[]  # one-to-many via OfficialCode

OfficialCode        # one row per quiz room
  id
  label             # e.g. "Room A"
  code              # server-generated token

Church              # created by a coach after joining a meet; coach can manage multiple
  id
  meet_id
  created_by        # account_id of the coach who created it
  name              # e.g. "Grace Community Church"
  short_name        # e.g. "GCC" — used in team names and display

ViewerMembership    # for accounts that joined as viewer (optional — viewers can also use guest JWTs)
  account_id
  meet_id

CoachMembership     # one per coach per meet
  account_id
  meet_id

OfficialMembership  # one per official code per official per meet
  account_id
  meet_id
  official_code_id

QuizzerIdentity     # thin record — exists only to link a quizzer across meets for career stats
  id                # no other fields

Team
  id
  meet_id
  church_id
  division
  number            # per-church per-division (1, 2, 3...)
  # display name derived: "{church.short_name} {number}"

TeamRoster          # a quizzer's participation in a specific meet
  team_id
  quizzer_id        # references QuizzerIdentity — always set, new identity created if unlinked
  name              # name for this meet

# Officials and viewers without accounts use stateless guest JWTs issued via /meets/{id}/guest-session
# Admins have implicit access to everything — no membership rows needed
```

## Quizzer Identity and Roster Linking

Within a meet, a quizzer's name and church are fully defined by their `TeamRoster` row. The
`QuizzerIdentity` record has no fields — it exists only as a stable ID for cross-meet stat queries:

```sql
SELECT * FROM TeamRoster WHERE quizzer_id = ?
```

### Linking flow

When a coach adds a quizzer, they type a name. The server suggests matches from historical rosters,
ranked by recency and church affiliation. The coach can:

* **Link** a suggestion — points the new `TeamRoster` row to an existing `QuizzerIdentity`
* **Create new** — a fresh `QuizzerIdentity` is created automatically

If a coach skips linking (creates new for someone who has history), the two `QuizzerIdentity`
records can be **merged** later by an admin.

### Warnings

The UI should warn and require confirmation when:

* The linked quizzer was on a **different church's team** at their most recent meet
* The linked quizzer is **already rostered** on another team at this meet
* The name match has **low confidence** (partial overlap only)
