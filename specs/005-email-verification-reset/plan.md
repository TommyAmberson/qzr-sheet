# Implementation Plan: Email Verification and Password Reset

**Branch**: `feat/email-verification-reset` | **Date**: 2026-10-31 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-email-verification-reset/spec.md`

## Summary

Port verse-vault's spec 006 (phases 1, 2a, 2b and 2d) to qzr. The API worker gains email sending
through Resend, Better Auth's email-code plugin for reset and verification codes, and the provider
rules: a GitHub or Google sign-in joins an existing account only with inbox proof, an unverified
password account gets a code step and the "That's me" / "That's not me" choice, a reset disconnects
every provider, and every reset sends a notice. The portal gains account settings and the pages for
the code step and the choice; the shared sign-in form gains the reset and verification steps, used
by the portal and the scoresheet alike. Decisions are in [research.md](./research.md); most carry
over from verse-vault with the reason they hold here, and Q1 to Q5 are the qzr-only ones.

## Technical Context

**Language/Version**: TypeScript 5 (Cloudflare Worker API, Vue 3 portal and scoresheet)

**Primary Dependencies**: Hono 4, Better Auth 1.6.33 (`emailOTP` plugin, already a dependency),
Drizzle ORM 0.44 on D1, Vue 3, Tauri 2 (scoresheet desktop)

**Storage**: D1 (Better Auth's `user`, `account`, `session`, `verification` tables; one new table
for email limits); two unique indexes (research D14)

**Testing**: vitest in each package; the API runs its routes against an in-memory sql.js database
(`packages/api/src/test-db.ts`). Auth flows have no end-to-end tests today, so this feature adds a
harness that drives Better Auth's routes with a fake email sender and a stubbed provider callback
(research Q4)

**Target Platform**: Cloudflare Workers; browsers (portal, scoresheet PWA); Tauri desktop

**Project Type**: web service and two web clients in a pnpm monorepo

**Performance Goals**: sending never delays a response (FR-020); a reset or sign-in adds at most a
few D1 queries

**Constraints**: Worker CPU budget (password hashing is already tuned to it); responses must not
reveal whether an address has an account (FR-002); the scoresheet keeps working offline (principle
I)

**Scale/Scope**: one new table and two indexes; one lib for email, one for email limits and one for
pending provider sign-ins; auth config and hooks in `auth.ts` and one new route group in the API;
account settings and one provider page in the portal; reset and verification steps in the shared
sign-in form; docs.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle                       | Status | Notes                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Scoresheet works offline     | Pass   | Codes and settings are reached only from the sign-in form and the portal; nothing prompts while scoring, and the form's new steps fail as sign-in already does when offline (FR-022).                                                                                                                                                                     |
| II. Rulebook is the spec        | N/A    | No scoring or rules change.                                                                                                                                                                                                                                                                                                                               |
| III. One scoring implementation | N/A    |                                                                                                                                                                                                                                                                                                                                                           |
| IV. Meet data gated per meet    | Pass   | No route reads meet data. Sessions stay Better Auth cookies. The pending provider sign-in is held by a cookie Better Auth issues (`createAuthCookie`), HTTP-only and path-scoped, tied to a server row: it authorises nothing but the next step of that sign-in, so it is not a new token scheme. A takeover removes meet memberships and roles (FR-015). |
| V. Contract versions            | Pass   | `packages/shared` (auth client, sign-in error codes) bumps MINOR, additive; api and web bump; the scoresheet names the bundled shared version.                                                                                                                                                                                                            |
| VI. Validate before merge       | Pass   | Each behaviour gets an API test first through the new harness; migrations come from `db:generate` (research D14).                                                                                                                                                                                                                                         |
| VII. Simplest design            | Pass   | Better Auth's plugin, hooks and request state carry the flows; one owner per decision (table below).                                                                                                                                                                                                                                                      |

## Project Structure

### Documentation (this feature)

```text
specs/005-email-verification-reset/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/auth-api.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
packages/api/
├── src/bindings.ts           # RESEND_API_KEY
├── src/index.ts              # createAuth gets the db, sender and waitUntil; new route group
├── src/db/schema.ts          # email-limit table; unique indexes
├── migrations/               # from db:generate
├── src/lib/auth.ts           # plugin, provider rules, hooks
├── src/lib/                  # new: email (Resend sender, messages); email limits; pending provider sign-ins
└── src/routes/               # new: account provider routes (code step, choice, disconnect)
packages/shared/src/
├── authClient.ts             # code, reset and connect calls
└── socialSignInError.ts      # new error codes and messages
packages/ui/src/SignInForm.vue  # forgot password, codes, after-reset notice
apps/web/src/
├── router/index.ts           # /account, /account/provider (before /:slug)
└── views/                    # account settings; provider code step and choice
apps/scoresheet/              # uses the shared form; no own pages
docs/auth.md
```

**Structure Decision**: existing packages; new API modules under `src/lib/` and `src/routes/`, two
new portal views.

## Reuse and Ownership

| Decision or write path                                   | Owner                                                                                 | Existing code reused                                       |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Sending an email, and not delaying the response          | new: the email module in `packages/api/src/lib/` (Resend call, messages)              | the Worker's `waitUntil`                                   |
| Codes: issuing, hashing, checking, tries                 | Better Auth's `emailOTP` plugin                                                       | as is (`storeOTP: 'hashed'`, `allowedAttempts`)            |
| Email limits per address and per client                  | new: a limit module in `packages/api/src/lib/` over one D1 table                      | `CF-Connecting-IP`                                         |
| Which provider sign-ins prove the inbox, and refusals    | `createAuth` in `packages/api/src/lib/auth.ts` (provider `mapProfileToUser`, hooks)   | Better Auth's linking with `requireLocalEmailVerified`     |
| Pending provider sign-in, code step, choice, takeover    | new: account routes in `packages/api/src/routes/`                                     | `verification` table, `createAuthCookie`, internal adapter |
| What a reset does (sessions, providers, pending, notice) | `emailAndPassword.onPasswordReset` in `auth.ts`                                       | `revokeSessionsOnPasswordReset`                            |
| Connect or disconnect a provider from settings           | Better Auth's `linkSocial`, plus a hook binding it to its session; a disconnect route | `/link-social`                                             |
| Link and unlink notices                                  | `databaseHooks.account` in `auth.ts`                                                  |                                                            |
| Error codes the clients understand                       | `packages/shared/src/socialSignInError.ts`                                            | as is                                                      |
| The reset and verification steps                         | `packages/ui/src/SignInForm.vue`                                                      | as is, shared by portal and scoresheet                     |

**Platform already provides**: Better Auth's `emailOTP` plugin (codes, hashing, expiry, tries,
password reset), its OAuth state and request state, `requireLocalEmailVerified` on linking, its
session `freshAge`, and `getIp`, which reads the client address from `CF-Connecting-IP` as
`advanced.ipAddress` sets.

**Releases**: api MINOR, shared MINOR, web MINOR, scoresheet PATCH (it gains the form's steps
through `@qzr/ui` and names the bundled shared version).

## Complexity Tracking

None: no principle needs an exception.
