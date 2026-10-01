# Quickstart: validating the /qzr move

Checks that prove the feature against [spec.md](spec.md) and
[contracts/routing.md](contracts/routing.md).

## 1. Local, before any deploy

```sh
pnpm test:unit      # API tests pass unchanged through the root mount; new tests cover the
                    # /qzr mount, per-request auth basePath, and the qzr-web script
pnpm type-check
pnpm lint
pnpm build:all      # then confirm the layout:
ls apps/web/dist/qzr/index.html apps/web/dist/qzr/scoresheet/index.html apps/web/dist/qzr/scoresheet/sw.js
```

Expected: no file in `apps/web/dist/` outside `qzr/`; built HTML references only `/qzr/...` assets.

```sh
pnpm dev:all        # portal http://localhost:5174/qzr/, scoresheet http://localhost:5173/qzr/scoresheet/
```

Sign in with email locally; open a meet's schedule; open a quiz in the scoresheet.

## 2. Parallel stage (production, before switch day)

Prerequisite: new OAuth callbacks registered (research R8).

1. `curl -sI https://www.versevault.ca/qzr` redirects to `/qzr/`, and
   `curl -s https://www.versevault.ca/qzr/api/meets` returns JSON from the API, not the portal's
   HTML.
2. Open `https://www.versevault.ca/qzr/` in a fresh profile: home renders, DevTools Network shows no
   request outside `/qzr/` (SC-001).
3. Sign in with Google, GitHub, and email; each returns to the starting page.
4. Open a meet, its schedule, a quiz in the scoresheet; open a guest link
   `/qzr/scoresheet/?meet=<viewer code>`.
5. Refresh on a deep page (`/qzr/<slug>/schedule`): renders.
6. Install the scoresheet PWA from `/qzr/scoresheet/`, go offline, score a quiz, reload: works.
7. `https://www.versevault.ca/` and `/scoresheet/` behave as before (SC-002).
8. Sign into verse-vault (`/vv/`) and qzr (`/qzr/`) in one browser; both stay signed in (SC-004).
9. New desktop and Android builds: sign in, load a quiz from a schedule.

## 3. Switch day (with the verse-vault cutover)

1. `curl -sI 'https://www.versevault.ca/scoresheet/?meet=X&quiz=Y'` gives `308` to
   `/qzr/scoresheet/?meet=X&quiz=Y`; same for `/scoresheet` and `/roadmap` (SC-003).
2. `curl -s https://www.versevault.ca/scoresheet/sw.js` returns the self-destroying worker.
3. Old installed PWA with a saved scoresheet: open offline (still scores), then online (lands on
   `/qzr/scoresheet/`, saved scoresheet present) (SC-005).
4. A real meet slug at the root redirects to `/qzr/<slug>` (verse-vault catch-all).
5. An old desktop build: guest viewer access works; sign-in fails (how it fails was recorded in
   T028); scoring offline works.

### What old app builds do after switch day (T028)

Read from the 0.10.x sources (`packages/shared/src/authClient.ts`, `packages/ui/src/SignInForm.vue`,
`packages/shared/src/apiClient.ts`). Old builds call `https://www.versevault.ca/api/...`, which then
belongs to verse-vault:

* **Email sign-in**: posts to verse-vault's Better Auth. With no matching verse-vault account,
  `SignInForm` shows the returned error message. No hang.
* **Social sign-in**: runs through verse-vault's OAuth client and returns to the app without a qzr
  session. No hang, but the user looks signed out.
* **Session check**: `get-session` is answered by verse-vault. If the webview holds a verse-vault
  session, an old build will think it is signed in, and its meet calls (forwarded to `qzr-api`)
  return 401, which `apiClient` surfaces as an `ApiError`.
* **Scoring**: unaffected; it needs no network.

Worth raising on the verse-vault side: its router could refuse `/api/auth/*` from Tauri origins so
old qzr builds fail plainly instead of half-signing into verse-vault.
