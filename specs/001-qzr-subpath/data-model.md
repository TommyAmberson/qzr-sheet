# Data Model: Move qzr under /qzr

No database schema changes and no `packages/shared` changes. The "entities" here are the public
address map, the session cookie, and the scoresheet's installed-app identity.

## Public address map

| Address                        | Parallel stage                  | After switch day                                                      |
| ------------------------------ | ------------------------------- | --------------------------------------------------------------------- |
| `/qzr`                         | `qzr-web`: redirect to `/qzr/`  | same                                                                  |
| `/qzr/*`                       | `qzr-web`: portal assets + SPA  | same                                                                  |
| `/qzr/scoresheet/*`            | `qzr-web`: scoresheet PWA       | same                                                                  |
| `/qzr/api/*`                   | `qzr-api` (prefixed mount)      | same                                                                  |
| `/api/*`                       | `qzr-api` (root mount)          | verse-vault; qzr data paths forwarded to `qzr-api` by service binding |
| `/` and other root paths       | `versevault-www` Pages (frozen) | verse-vault; unknown paths to `/qzr/...`                              |
| `/scoresheet`, `/scoresheet/*` | `versevault-www` Pages (frozen) | `qzr-web`: 308 to `/qzr/scoresheet...`                                |
| `/scoresheet/sw.js`            | old service worker              | `qzr-web`: self-destroying worker                                     |
| `/roadmap`                     | `versevault-www` Pages (frozen) | `qzr-web`: 308 to `/qzr/roadmap`                                      |

Cloudflare picks the most specific matching route, so `/qzr/api/*` beats `/qzr/*`.

## Auth base path (per request)

| Request path prefix | Better Auth `basePath` | OAuth callback                                               |
| ------------------- | ---------------------- | ------------------------------------------------------------ |
| `/qzr/`             | `/qzr/api/auth`        | `https://www.versevault.ca/qzr/api/auth/callback/<provider>` |
| anything else       | `/api/auth`            | `https://www.versevault.ca/api/auth/callback/<provider>`     |

## Session cookie

* Name: `__Secure-qzr.session_token` (was `__Secure-better-auth.session_token`), plus the matching
  `session_data` and state cookies under the same prefix.
* Path `/`, host-only, unchanged. Existing sessions are not read after the change: one re-sign-in.

## Scoresheet installed-app identity

| Field                | Before                          | After                       |
| -------------------- | ------------------------------- | --------------------------- |
| manifest `id`        | (none, falls back to start_url) | `/qzr/scoresheet/`          |
| `start_url`, `scope` | `/scoresheet/`                  | `/qzr/scoresheet/`          |
| SW script URL        | `/scoresheet/sw.js`             | `/qzr/scoresheet/sw.js`     |
| Precache name        | contains `/scoresheet/`         | contains `/qzr/scoresheet/` |

`localStorage` keys (`qzr-sheet:current`, `qzr-guest-session`, `qzr-meet-session`, `qzr-theme`,
tutorial snapshots) are per origin and carry over unchanged.
