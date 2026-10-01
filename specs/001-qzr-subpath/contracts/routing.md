# Contract: public routing for qzr on www.versevault.ca

This is the observable contract the feature commits to. Tests and the quickstart check against it.
Status codes are exact; `Location` values are exact including the query string.

## qzr-web Worker (`apps/web/worker/`)

Asset-first: a request whose path matches a built file is served directly. The script runs only on a
miss, and on the legacy paths.

### Parallel stage (routes `www.versevault.ca/qzr`, `www.versevault.ca/qzr/*`)

| Request                                  | Response                                                                    |
| ---------------------------------------- | --------------------------------------------------------------------------- |
| `GET /qzr`                               | redirect to `/qzr/`, query kept (the asset layer's trailing-slash handling) |
| `GET /qzr/<file that exists>`            | `200`, the file                                                             |
| `GET /qzr/scoresheet/<no such file>`     | `200`, `/qzr/scoresheet/index.html`                                         |
| `GET /qzr/<anything else, no such file>` | `200`, `/qzr/index.html` (portal router decides)                            |
| non-GET/HEAD reaching the script         | `405`                                                                       |

### Switch day (adds routes `/scoresheet`, `/scoresheet/*`, `/roadmap`)

| Request                      | Response                                                                                              |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| `GET /scoresheet/sw.js`      | `200`, `Content-Type: text/javascript`, `Cache-Control: no-cache`, the self-destroying service worker |
| `GET /scoresheet`            | `308`, `Location: /qzr/scoresheet/` (query kept)                                                      |
| `GET /scoresheet/<rest>?<q>` | `308`, `Location: /qzr/scoresheet/<rest>?<q>`                                                         |
| `GET /roadmap?<q>`           | `308`, `Location: /qzr/roadmap?<q>`                                                                   |

## qzr-api Worker

| Request                                          | Parallel stage                        | After switch day                            |
| ------------------------------------------------ | ------------------------------------- | ------------------------------------------- |
| `/qzr/api/<path>`                                | same handler as `/api/<path>`         | same                                        |
| `/qzr/api/auth/*`                                | Better Auth, basePath `/qzr/api/auth` | same                                        |
| `/api/<path>` (public)                           | served                                | not routed to qzr-api (verse-vault owns it) |
| `/api/<path>` (service binding from verse-vault) | n/a                                   | served for qzr data paths only              |
| `/api/auth/*`                                    | Better Auth, basePath `/api/auth`     | not reachable publicly                      |

Every route keeps its current authorisation (constitution IV). No new route, token, or session
scheme. Session cookies are named with the `qzr` prefix.

## Self-destroying service worker

On `activate`, in order:

1. Delete every Cache Storage entry whose name contains `/scoresheet/` and does not contain
   `/qzr/scoresheet/`.
2. `self.registration.unregister()`.
3. For each window client: `client.navigate('/qzr/scoresheet/' + new URL(client.url).search)`.

It never touches `localStorage`, IndexedDB, or caches belonging to `/qzr/scoresheet/`.

## Front-end build outputs

| Build                 | `base`             | Output directory                                                                  | API base                             |
| --------------------- | ------------------ | --------------------------------------------------------------------------------- | ------------------------------------ |
| portal (prod)         | `/qzr/`            | `apps/web/dist/qzr/`                                                              | `/qzr`                               |
| scoresheet web (prod) | `/qzr/scoresheet/` | `apps/scoresheet/dist/qzr/scoresheet/`, copied to `apps/web/dist/qzr/scoresheet/` | `/qzr`                               |
| scoresheet Tauri      | `/`                | `apps/scoresheet/dist/`                                                           | `https://www.versevault.ca/qzr`      |
| any dev server        | as prod            | n/a                                                                               | `http://localhost:8787` (root mount) |
