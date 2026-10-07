# Implementation Plan: Guest session lifecycle

**Branch**: `feat/guest-session-lifecycle` | **Date**: 2026-10-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/004-guest-session-lifecycle/spec.md`

## Summary

A guest session (a meet joined with a code, without an account) gets the rest of its life, in the
scoresheet and the portal alike: it is renewed when it runs out or its code changes, it grants
nothing once revoked, it upgrades the account when the user signs in, it is ended by signing out or
leaving the meet, and it never keeps a room code.

The technical approach (see [research.md](./research.md)):

* **API**: `sessionMiddleware` decides once per request whether a guest token is still current, by
  its code tag, and treats a revoked one as absent (R1). Viewer tokens gain a tag (R2). The guest
  join returns the room, and a guest send naming another room is refused (R3). No new routes.
* **`packages/ui`** (the guest session module both apps share): official sessions keep the room,
  never the code (R4); viewer sessions renew themselves inside the request wrapper, and official
  sessions renew around the actions that send or correct, through one dialog (R5); one upgrade at
  sign-in by code, through one dialog for rooms (R6); one sign-out clear for the device's guest data
  (R7); leaving one meet (R8).
* **Apps**: both call the upgrade and the sign-out clear; the scoresheet's meet picker and the
  portal home list guest meets with Leave (R8); portal links name the meet in `meetId`, and the
  scoresheet cleans `?meet=` from the address after joining (R9).
* **Docs**: `docs/roles-and-access.md` and `docs/auth.md` describe the result (R10).

## Technical Context

**Language/Version**: TypeScript 5 on Node >=22.12.0; Vue 3.

**Primary Dependencies**: Hono and Drizzle (API), `jose` for guest tokens, Better Auth (sessions),
Vite. No new dependencies.

**Storage**: no D1 changes ([data-model.md](./data-model.md)). Browser `localStorage` shared by the
two apps: the guest account (`qzr-guest-session`), plus the scoresheet's `qzr-team-names` and
`qzr-submit-meet`, which sign-out clears.

**Testing**: Vitest. API route and middleware specs on the in-memory D1 (`src/test-db.ts`); guest
session module specs (they live in the scoresheet's `composables/__tests__/guestSession.spec.ts`
since the module moved to `packages/ui`); scoresheet and portal component specs where the dialogs
and lists are wired.

**Target Platform**: Browser PWA and Tauri (scoresheet), browser (portal), Cloudflare Workers (API).

**Project Type**: pnpm monorepo: two web apps, a Workers API, shared contract and UI packages.

**Performance Goals**: renewing a refused official session takes one dialog and one retry (SC-001:
under 30 seconds). The middleware's currency check adds one indexed D1 read per guest request.

**Constraints**: the scoresheet works offline (principle I): a network failure is never a refused
session, and no dialog or upgrade blocks entering or saving a quiz. Released apps (desktop, Android,
installed PWAs) keep working: a guest send without a room, and old link forms.

**Scale/Scope**: a device holds a handful of guest sessions; a meet has a few rooms.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| #   | Principle                       | Gate                                                                                                                                                                                                                                  | Pass when                                          | Answer                                                                                                                                                                                                                                                                  |
| --- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I   | Offline, always                 | Can an official still score, auto-save, and save/load a quiz with the API down? Can any load path drop scores silently?                                                                                                               | yes, then no                                       | Yes: renewal, upgrade and dialogs run only around sends and sign-in, never around scoring or saving; network failures are not refusals (R5, R6). No: leaving or clearing a guest session never touches the quiz or auto-save (FR-024).                                  |
| II  | Rulebook is the spec            | Does the feature change scoring, scheduling, auth, roles, or the data model? If so, which doc in `docs/` is amended, and does any new rulebook departure arrive as an opt-in setting documented in `docs/scoring-rules-explained.md`? | doc named, or N/A                                  | Auth and roles: `docs/roles-and-access.md` and `docs/auth.md` (R10, FR-028). No scoring change.                                                                                                                                                                         |
| III | One pure scoring implementation | Does anything outside `packages/shared/src/scoring/` compute a score, validation, grey-out, visibility, overtime, or placement?                                                                                                       | no                                                 | No.                                                                                                                                                                                                                                                                     |
| IV  | Meet data gated per meet        | Does every new or changed API route touching a meet's data check membership, a guest token for that meet, or superuser? Is any new token or session scheme introduced?                                                                | yes, then no                                       | Yes: every route keeps its check; guest checks get stricter (a revoked token is absent, R1; a send for another room is refused, R3). No: viewer tokens gain a claim on the existing guest JWT; no new scheme, and guest tokens are never redeemed for memberships (R6). |
| V   | Contract versions               | Does it touch `packages/shared/src/`? If so, which semver level, is it bumped once in this PR, and does it change `FILE_VERSION`?                                                                                                     | level named, or N/A                                | N/A: `packages/shared` is untouched. The guest session module lives in `packages/ui`, which is bundled into each app.                                                                                                                                                   |
| VI  | Validate before merge           | Are scoring and validation changes covered by unit tests in `__tests__/`? Is every D1 schema change shipped as a migration from `db:generate`?                                                                                        | yes, or N/A                                        | N/A for scoring and schema (none). The middleware, join, send, and guest session changes get specs in `__tests__/` (quickstart, automated checks).                                                                                                                      |
| VII | Simplest design that works      | Does every decision or write path the feature adds have one owner in Reuse and Ownership? Does the design add a production export, option, or state that only a test reads, duplicate existing code, or restate a framework default?  | post-design: yes, then no (pre-research: deferred) | Yes, then no: see Reuse and Ownership. The currency check replaces two copies of the room tag check rather than adding a third.                                                                                                                                         |
| -   | Technology constraints          | Does it add a package or deployable, a cross-origin production client, or HTML5 drag?                                                                                                                                                 | no, or justified                                   | No.                                                                                                                                                                                                                                                                     |

Post-design re-check: unchanged; all gates pass.

## Project Structure

### Documentation (this feature)

```text
specs/004-guest-session-lifecycle/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── api.md
│   └── client.md
├── checklists/requirements.md
└── tasks.md              # /speckit-tasks
```

### Source Code (repository root)

```text
packages/api/src/
├── middleware/session.ts # calls the guest token currency check once per request (R1)
├── lib/jwt.ts # viewer code tag, one tag function for both kinds, the currency check (R1, R2)
├── lib/permissions.ts        # isOfficialOfRoom / officialRoomsOf lose their own tag check (R1)
└── routes/
    ├── join.ts               # guest join returns the room; viewer tokens tagged (R2, R3)
    └── results.ts            # guest send naming another room refused; guest "rejoin" branch gone (R1, R3)

packages/ui/src/
├── guestSession.ts           # session shape, renewal, upgrade, sign-out clear, leave (R4 to R8)
└── (dialog components)       # room code needed; add your rooms to your account (R5, R6)

apps/scoresheet/src/
├── api.ts                    # withGuestToken wired with the join call (R5)
├── App.vue / SignInWidget.vue  # upgrade on sign-in and start; sign-out clear (R6, R7)
├── components/Scoresheet.vue  # submit runs through the official renewal; link parameters (R5, R9)
├── components/MeetPickerDialog.vue  # Leave on guest rows; room name (R8)
└── composables/useTeamNames.ts, useSubmitToMeet.ts  # storage keys from packages/ui (R7)

apps/web/src/
├── api.ts                    # withGuestToken wired with the join call (R5)
├── App.vue / components/AppHeader.vue  # upgrade on sign-in and start; sign-out clear (R6, R7)
├── views/HomeView.vue        # guest account's meets with Leave (R8)
├── views/ResultsView.vue, ResultView.vue  # upload, correct, restore, merge through the official renewal (R5)
└── views/ScheduleView.vue, ResultView.vue  # scoresheet links use meetId (R9)

docs/roles-and-access.md, docs/auth.md  # (R10)
```

**Structure Decision**: no new package or deployable. The guest session's lifecycle lives where its
state already is, `packages/ui/src/guestSession.ts`, so both apps share one implementation; each app
only wires it to its own join calls, sign-in widget, and screens.

## Reuse and Ownership

| Decision or write path                                                     | Owner (existing symbol, or file and responsibility if new)                                                               | Existing code reused                                                        |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Whether a guest token is still current                                     | `currentGuest` in `packages/api/src/lib/jwt.ts`, beside the tag it checks; `sessionMiddleware` calls it once per request | `verifyGuestJwt`, the room tag in `lib/jwt.ts`, `createDb`                  |
| The code tag of a room or viewer code                                      | the existing room tag function in `lib/jwt.ts`, generalized to both kinds                                                | `roomCodeTag`, `importKey`                                                  |
| Which room a guest official sends for                                      | `POST /results` in `routes/results.ts`, using the token's room; refuses another                                          | `isOfficialOfRoom`                                                          |
| The guest join answer (token, meet, room)                                  | `join.post('/guest')` in `routes/join.ts`                                                                                | `signGuestJwt`, the existing room lookup                                    |
| What a guest session keeps                                                 | `guestSession.ts` (`GuestSessionData`, `joinByCode`, `loadFromStorage`)                                                  | the existing validation and legacy-shape loading                            |
| Renewing a viewer session                                                  | `withGuestToken` in `guestSession.ts`                                                                                    | `tokenIsFresh`, `joinByCode`, `addJoinedSession`                            |
| Renewing an official session around an action                              | new: one helper in `guestSession.ts` that runs an action and asks for the room code when refused                         | `tokenIsFresh`, `joinByCode`, `ApiError` from `@qzr/shared`                 |
| The room-code dialog (renewal: one row; sign-in upgrade: one row per room) | new: one component in `packages/ui`, used by both apps for both purposes                                                 | `ChoiceDialog`'s look and dialog pattern                                    |
| Telling the user a guest session or link no longer works                   | new: one guest notice in `guestSession.ts`, shown by each app's `App.vue`                                                | `guestStateRef`'s reactive pattern                                          |
| Upgrading the account at sign-in                                           | new: one function in `guestSession.ts`; each app calls it when signed in with guest sessions                             | each app's existing `joinMeet` (`POST /api/join`)                           |
| What sign-out clears                                                       | new: one function in `guestSession.ts`, owning the list of keys; both apps' sign-out handlers call it                    | `setGuestState(null)`; the keys move from `useTeamNames`, `useSubmitToMeet` |
| Leaving one meet                                                           | new: a setter beside `setActiveSession` in `guestSession.ts`                                                             | `persist`                                                                   |
| Listing the guest account's meets                                          | scoresheet `useMeetList` (already merges them); portal `HomeView.vue`                                                    | `guestStateRef`                                                             |
| Reading the scoresheet's link parameters                                   | `loadFromUrlParams` in `Scoresheet.vue` (quiz links) and `doInitGuestSession` (viewer link)                              | the existing `history.replaceState` clean-up                                |
| Building scoresheet links in the portal                                    | `ScheduleView.vue` and `ResultView.vue`, as today                                                                        | `__SCORESHEET_URL__`                                                        |

**Platform already provides**: `POST /api/join` is idempotent and turns any code into a membership
for a signed-in caller, so the upgrade needs no new route; the session cookie outranks a bearer
token in `sessionMiddleware`; `localStorage` is shared by the two apps on one origin; a social
sign-in returns through a page load, so the upgrade's "on start" run covers it.

**Releases**: two pull requests (research R11). PR 1: api MINOR (join answer, viewer token tag,
stricter guest checks). PR 2: scoresheet MINOR, web MINOR. `packages/shared` unchanged;
`packages/ui` is bundled into each app.

## Complexity Tracking

None: every gate passes.
