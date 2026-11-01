---

description: "Task list for email verification and password reset"
---

# Tasks: Email Verification and Password Reset

**Input**: Design documents from `/specs/005-email-verification-reset/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Follow the constitution's testing principle. Where it calls for a test, the implementation task names the test task or existing test that covers it.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- API: `packages/api/src/` (tests in `__tests__/` beside the code)
- Shared contract: `packages/shared/src/`; shared components: `packages/ui/src/`
- Portal: `apps/web/src/`; scoresheet: `apps/scoresheet/`

<!--
  ============================================================================
  TASK WRITING RULES (project override; constitution principle VII)
  These rules and the constitution override the speckit-tasks skill's
  defaults: tests are not optional where the testing principle calls for
  them, and stories are not ordered Models -> Services -> Endpoints.
  Keep this comment in the generated tasks.md, so commands that add tasks
  later (/speckit-converge) see the same rules.

  - Describe the behaviour, and the test that proves it where the testing
    principle calls for one, not the code. Name a function, signature, option,
    or literal only when the task changes an existing one or the spec,
    data-model.md, or contracts/ already fixes it. Let implementation choose new names; naming the file a change
    lands in is fine.
  - Every decision or write path the feature adds has one owner, named in
    plan.md's "Reuse and Ownership" table. A task that touches it points at that
    owner; never split one rule's implementation across several tasks or files.
  - Reuse first. A task that adds a helper, module, type, or test fixture names
    the existing code it checked and why that doesn't fit. Test tasks extend
    existing fixtures and stubs rather than copying them.
  - No speculative surface: every new production export has a caller the
    constitution accepts, and no task adds an option, reason code, or counter
    that only a test reads.
  - Don't specify framework or library defaults; plan.md records what the
    platform already provides.
  - Name the packages a release bumps and the semver level of each, never the
    resulting version number. The number is set when the bump commit is
    written, from master at that time, and a hotfix landing first takes it.
  - Prefer one task per coherent change over one task per layer (model, then
    service, then endpoint). Split only where tasks can genuinely run or be
    reviewed apart.
  ============================================================================
-->


## Phase 1: Setup

- [X] T001 Add `RESEND_API_KEY` to `packages/api/src/bindings.ts` and as an optional secret in `packages/api/wrangler.toml`'s docs and `README.md`'s deploy notes (it is already set on `qzr-api`); with no key the API logs messages instead of sending (research D1, FR-021).

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T002 Test harness first (research D12): `createAuth` in `packages/api/src/lib/auth.ts` takes the database, an email sender and the Worker's `waitUntil` instead of reading `env.DB` itself, with `packages/api/src/index.ts` and `packages/api/src/middleware/session.ts` passing them; extend `packages/api/src/test-utils.ts` and `packages/api/src/test-db.ts` (reuse their sql.js database) so a test can sign up, call any `/api/auth/*` route, read the emails a fake sender recorded, and complete a GitHub or Google sign-in through stubbed provider endpoints (Google's token and user info; GitHub's token, `/user` and `/user/emails`, which Better Auth reads for the primary verified address). A first test in `packages/api/src/lib/__tests__/` signs up with a password and signs in.
- [X] T003 The email module in `packages/api/src/lib/` (plan's Reuse and Ownership): sends through Resend's HTTPS API from `VerseVault <no-reply@versevault.ca>`, logs instead with no key (FR-021), logs failures without the code (FR-021), and never delays or fails the request: every send goes to `waitUntil`, and Better Auth's own sends through `advanced.backgroundTasks` (research D2, FR-020). Messages per FR-012: the code shown prominently, why it was sent, how long it lasts, not to share it, what to do if unexpected. Tests beside it for the message content and the no-key path.
- [X] T004 Email limits (research D4, FR-011): the table in `packages/api/src/db/schema.ts` per data-model.md ("Primary key (`key`, `window_start`)"; `key` is "`address:<lowercased email>` or `client:<IP>`"), the migration from `pnpm --filter @qzr/api db:generate`, and the limit module in `packages/api/src/lib/`: 3 per address per hour (reset, verification, provider code step; the sign-up email not counted), 10 per client per day (sign-up and the provider code step included), client from `CF-Connecting-IP`; a limited request answers 429 with a message to try later, and sign-up is never refused. The existing cron in `packages/api/src/scheduler.ts` deletes past windows. Tests through the T002 harness.
- [X] T005 Unique `verification.identifier` and unique `account(provider_id, account_id)` in `packages/api/src/db/schema.ts`, migration from `db:generate`, and the same in `packages/api/src/test-db.ts` (research D14).
- [X] T006 Enable Better Auth's `emailOTP` plugin in `packages/api/src/lib/auth.ts`: hashed codes, 10 minutes, 3 tries, a resend replaces the old code; disable its unused routes (sign-in by code, change email, the bare check route) and refuse the link-based reset and verification routes (research D3); count email-sending requests against the T004 limits on arrival, the sign-up code against the client's limit only, skipping the email rather than refusing sign-up. The clients' message for the plugin's code errors ("not valid, send a new one", FR-010) comes with the form in T009.

**Checkpoint**: codes can be sent and checked; limits and constraints are in place.

---

## Phase 3: User Story 1 - Reset a forgotten password (Priority: P1) 🎯 MVP

**Goal**: "Forgot password?" sends a code; the code and a new password sign the person in.

**Independent Test**: spec User Story 1's scenarios through the harness, then the quickstart's reset step.

- [X] T007 [US1] Tests first in `packages/api/src/lib/__tests__/` (or a new auth spec beside them): a reset request answers the same for known and unknown addresses and sends nothing for unknown (FR-002); a valid code and new password sign in, the old password fails, other sessions end, the address is verified (FR-003 to FR-005); an account with only a provider gets its first password; a wrong code three times or after 10 minutes fails with the plugin's code.
- [X] T008 [US1] The reset in `packages/api/src/lib/auth.ts`'s `emailAndPassword.onPasswordReset`, before Better Auth revokes sessions (research D9): end the account's sessions, disconnect every GitHub and Google account (straight to the table, so no separate disconnect notice), cancel the account's pending provider rows (FR-029), then send the "password was reset" notice saying which providers were disconnected, or that disconnecting failed (FR-028); each step guarded so a failure is logged and the reset still completes (FR-025). The reset response reports the disconnected providers (contracts/auth-api.md). Tests first, extending T007: the notice with and without providers; providers removed; pending rows removed.
- [ ] T009 [US1] "Forgot password?" in `packages/ui/src/SignInForm.vue` with the calls in `packages/shared/src/authClient.ts`: address, then code and new password, then the normal password sign-in; after a reset that disconnected providers, a step that says so and points to account settings before continuing (FR-001, FR-025). Bump `packages/shared` MINOR with its changelog (principle V).

**Checkpoint**: a forgotten password can be reset from the portal.

---

## Phase 4: User Story 2 - Verify an address (Priority: P1)

**Goal**: sign-up asks for a code with "Skip for now"; account settings verify later.

**Independent Test**: spec User Story 2's scenarios.

- [ ] T010 [US2] Tests first: a password sign-up sends a verification code unless the client's daily limit is reached, and the account works unverified (FR-006, FR-008); a verification code verifies only for a session on that account and signs no one in (FR-007). Then the plugin's sign-up send and a before hook on its verify route in `packages/api/src/lib/auth.ts` that refuses a code without that account's session.
- [ ] T011 [US2] After sign-up in `packages/ui/src/SignInForm.vue`: the code step with "Skip for now".
- [ ] T012 [US2] Account settings at `/account` in the portal (`apps/web/src/router/index.ts`, before the `/:slug` meet route; `account` refused as a viewer code by `viewerCodeProblem` in `packages/api/src/routes/meets.ts`, with a test in `packages/api/src/routes/__tests__/meets.spec.ts`; a new view in `apps/web/src/views/`), reached from `apps/web/src/components/SignInMenu.vue`: the address, verified or not, the warning next to an unverified one (FR-009), and "Send verification code" with the code field (research D13).

**Checkpoint**: addresses can be verified at sign-up or later.

---

## Phase 5: User Story 3 - Add GitHub or Google to an account safely (Priority: P2)

**Goal**: connect and disconnect from settings.

**Independent Test**: spec User Story 3's scenarios.

- [ ] T013 [US3] Tests first: connecting from settings needs a sign-in within the last day; the provider's address must match; an unverified account needs the inbox proof first (a code, or a Google-hosted address), which verifies it; a connection started and then outlived by its session (sign-out, reset) is refused with an error (FR-018, FR-025). Then in `packages/api/src/lib/auth.ts`: a before hook on `/link-social` checking the sign-in age and recording the starting session in the OAuth state, and an account create hook refusing a link whose session has ended (research D8).
- [ ] T014 [US3] Tests first: disconnecting needs the password, a sign-in within the last day, and a password left; it ends every other session. Then the disconnect route in the new account routes in `packages/api/src/routes/` mounted in `packages/api/src/index.ts`; Better Auth's `/unlink-account` disabled (research D8).
- [ ] T015 [US3] Notices (FR-019, research D10): `databaseHooks.account` in `packages/api/src/lib/auth.ts` emails the address when a provider joins or leaves an account, except the person's own takeover, a new provider sign-up and a reset. Tests through the harness.
- [ ] T016 [US3] Connect and Disconnect for GitHub and Google in the `/account` view from T012, with the calls in `packages/shared/src/authClient.ts`.

**Checkpoint**: providers can be added and removed safely.

---

## Phase 6: User Story 4 - Sign in with GitHub or Google onto an existing account (Priority: P2)

**Goal**: the provider rules, the code step and the choice.

**Independent Test**: spec User Story 4's scenarios through the harness's stubbed callback.

- [ ] T017 [US4] Tests first: a Google sign-in for a Gmail or Workspace address with `email_verified` signs into its verified account; a GitHub sign-in, or a Google one for an address Google doesn't host, onto a verified account is refused with `account_not_linked`; a sign-in whose address the provider doesn't report verified is refused with `provider_email_unverified` and creates no user; GitHub uses only the primary verified address; sign-ups start verified only when Google hosts the address (FR-013, FR-014, FR-026). Then the providers' `mapProfileToUser`, a user create hook and the callback after hook in `packages/api/src/lib/auth.ts` (research D5), and the messages in `packages/shared/src/socialSignInError.ts`.
- [ ] T018 [US4] Tests first: a refused sign-in onto an unverified password account creates a pending row and sets the pending cookie; Google-hosted goes straight to the choice, otherwise a code-step code is sent under the limits and must be entered first; a used, expired or unknown cookie answers the same way; the code step's code passes nothing else (FR-015, FR-016, FR-012). Then the pending row, cookie and the `GET`, `confirm` and `resend` account routes in `packages/api/src/routes/` (contracts/auth-api.md, data-model.md's "State: pending provider sign-in", research D6).
- [ ] T019 [US4] Tests first: "That's me" connects the provider for a session on that account and verifies the address; "That's not me" removes the password, every session, the registrant's provider accounts, the account's meet memberships and roles, returns its role to normal, connects the provider, verifies and signs in (FR-015, FR-017, FR-027, research D7). Then the `claim` and `takeover` routes.
- [ ] T020 [US4] The portal page `/account/provider` in `apps/web/src/views/` and `apps/web/src/router/index.ts`: the code step (code field, resend), then "That's me" (the shared sign-in form, then claim) or "That's not me" (warning, confirm, takeover, then the note that meet access was cleared and to re-join with codes) (research D11).
- [ ] T021 [US4] Superuser only on a verified address (FR-027): superusers are seeded by hand, so enforce it where the role is read: in `packages/api/src/lib/permissions.ts` the superuser role counts only when the account's address is verified, with tests in `packages/api/src/lib/__tests__/`; `docs/auth.md`'s provisioning note says to verify the address first.

**Checkpoint**: provider sign-ins never join an account without inbox proof.

---

## Phase 7: User Story 5 - Do the same from the scoresheet, online or not (Priority: P3)

- [ ] T022 [US5] The scoresheet uses the updated `@qzr/ui` sign-in form (`apps/scoresheet`), its provider sign-ins in the web build land on the portal's `/account/provider` when a step is needed, and offline scoring and saving are untouched (FR-022, principle I). In the desktop build the shared form doesn't offer GitHub or Google, through one switch in `packages/ui/src/SignInForm.vue` that the scoresheet sets when running under Tauri (FR-024). Check `apps/scoresheet`'s existing tests still pass; add one only if the sign-in wiring changes.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T023 [P] `docs/auth.md`: the reset, verification, provider rules, code step, choice, takeover, connect, disconnect, notices and limits, matching contracts/auth-api.md (FR-023); account linking section rewritten (it still says linking is safe because providers verify addresses).
- [ ] T024 Releases: api MINOR, web MINOR, scoresheet PATCH naming the bundled `@qzr/shared` version, with changelogs (`pnpm bump`; principle V).
- [ ] T025 Run quickstart.md: the automated checks, then the local walkthrough (user-side for the provider steps with real credentials) and the production checks after deploy.

---

## Dependencies & Execution Order

- T001, then T002 (blocks every test), then T003 to T006.
- US1 (T007 to T009) and US2 (T010 to T012) need only Phase 2. US3 needs T012's view for T016. US4 needs T004 (limits) and T015's notice exceptions. US5 needs T009 and T020.
- T023 can run alongside US3 and US4 once the contracts settle; T024 last.

## Parallel Example

```text
After Phase 2: US1 (T007-T009) and US2 (T010-T012) in parallel; T023 docs alongside later stories.
```

## Implementation Strategy

MVP is US1: password reset alone fixes the "no way back in" problem. US2 then makes accounts
verifiable, which US3 and US4 rely on for safe linking. One pull request, or two if it grows: phase 2
and US1 to US2 first, then US3 to US5.
