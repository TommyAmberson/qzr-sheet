# Implementation Plan: Practice meet results

**Branch**: `feat/practice-meet-results` | **Date**: 2026-10-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-practice-meet-results/spec.md`

## Summary

Officials submit quizzes from the scoresheet to a meet; the meet's admin lists them, counts the ones
that matter, and reads per-division standings with finalists, uploads saved files as a backup,
corrects quizzes with a full history and restore, merges look-alike team names, and may keep a team
list that the scoresheet offers.

The technical approach (see [research.md](./research.md)):

* Move the scoresheet's scoring, its types, and quiz file parsing into `packages/shared` first, as a
  behaviour-neutral refactor (R1, R2), so the portal can score stored files. Two pieces leave Vue
  code on the way: building the cell grid, and the placement gate with its timeout checks.
* Add the quiz outcome and the division standings as pure functions in `packages/shared` (R11, R12).
* Add results tables and routes to the API, with append-only revisions and counting records (R5 to
  R7), and a room claim on official guest tokens (R4).
* Add "Submit to meet" to the scoresheet (R8, R9), and results, standings, upload, history and
  team-list screens to the portal.

## Technical Context

**Language/Version**: TypeScript 5 on Node >=22.12.0; Vue 3.

**Primary Dependencies**: Hono and Drizzle (API), TypeBox (shared, already a dependency), Vite,
`jose` for guest tokens.

**Storage**: Cloudflare D1 (four new tables, [data-model.md](./data-model.md)); scoresheet
`localStorage` (the existing meet session only).

**Testing**: Vitest in each package; shared gains a vitest setup (R3); the API's in-memory D1
(`src/test-db.ts`) needs the new tables' DDL by hand.

**Target Platform**: Browser PWA and Tauri (scoresheet), browser (portal), Cloudflare Workers (API).

**Project Type**: pnpm monorepo: two web apps, a Workers API, a shared contract package.

**Performance Goals**: Standings for a meet of about 60 quizzes render without noticeable delay in
the portal (SC-001: finalists within a minute of the last submission).

**Constraints**: The scoresheet works offline (principle I); one origin for portal, scoresheet and
API; no HTML5 drag API (file upload uses a picker, R13).

**Scale/Scope**: A meet holds tens of quizzes of 10 to 50 KB each, a few divisions, a handful of
rooms.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| #   | Principle                       | Gate                                                                                                                                                                                                                                  | Pass when                                          | Answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I   | Offline, always                 | Can an official still score, auto-save, and save/load a quiz with the API down? Can any load path drop scores silently?                                                                                                               | yes, then no                                       | **Yes, then no.** Submit is an extra action; a failed submit says so and changes nothing (FR-004). Opening a stored quiz from the portal asks before replacing unsaved work and loads through the existing parser.                                                                                                                                                                                                                                                                                                                  |
| II  | Rulebook is the spec            | Does the feature change scoring, scheduling, auth, roles, or the data model? If so, which doc in `docs/` is amended, and does any new rulebook departure arrive as an opt-in setting documented in `docs/scoring-rules-explained.md`? | doc named, or N/A                                  | **Auth, roles and data model change; scoring rules don't.** Amend `docs/data-model.md` (new tables), `docs/auth.md` (room claim), `docs/roles-and-access.md` (results access, official submit). `docs/scoring-rules-explained.md` gains the standings rules, recorded as rules not in the rulebook: tie-breakers applied to every prelim tie, and what "fewest errors" counts. Standings exist only where an admin counts quizzes, so nothing changes for anyone who doesn't. `docs/architecture.md` updated for scoring in shared. |
| III | One pure scoring implementation | Does anything outside `apps/scoresheet/src/scoring/` (or `packages/shared`, once moved) compute a score, validation, grey-out, visibility, overtime, or placement?                                                                    | no                                                 | **No.** Scoring moves to `packages/shared` before any other package uses it, and the placement gate and timeout checks leave the composable for shared (R2). The portal only calls shared.                                                                                                                                                                                                                                                                                                                                          |
| IV  | Meet data gated per meet        | Does every new or changed API route touching a meet's data check membership, a guest token for that meet, or superuser? Is any new token or session scheme introduced?                                                                | yes, then no                                       | **Yes, then no.** Every results route checks admin or official of this meet ([contract](./contracts/results-api.md)); officials submit and upload only to their own meet, and read and change only the quizzes their rooms have saved, a name another room has saved joining after the "already submitted" warning (FR-003, FR-018). Official guest tokens gain a room claim, and the portal keeps the same guest tokens as the scoresheet; no new scheme.                                                                          |
| V   | Contract versions               | Does it touch `packages/shared/src/`? If so, which semver level, is it bumped once in this PR, and does it change `FILE_VERSION`?                                                                                                     | level named, or N/A                                | **Yes, MINOR in each PR that touches it**: the move adds exports; outcome and standings add more. `FILE_VERSION` unchanged.                                                                                                                                                                                                                                                                                                                                                                                                         |
| VI  | Validate before merge           | Are scoring and validation changes covered by unit tests in `__tests__/`? Is every D1 schema change shipped as a migration from `db:generate`?                                                                                        | yes, or N/A                                        | **Yes.** Moved specs move with their code and run from shared; outcome, standings and every route get specs; tables arrive through `db:generate`.                                                                                                                                                                                                                                                                                                                                                                                   |
| VII | Simplest design that works      | Does every decision or write path the feature adds have one owner in Reuse and Ownership? Does the design add a production export, option, or state that only a test reads, duplicate existing code, or restate a framework default?  | post-design: yes, then no (pre-research: deferred) | **Yes, then no.** See Reuse and Ownership. The move removes a duplicate (the cell grid in `fillOts`). Revision and counting rows are read by the history screen.                                                                                                                                                                                                                                                                                                                                                                    |
| -   | Technology constraints          | Does it add a package or deployable, a cross-origin production client, or HTML5 drag?                                                                                                                                                 | no, or justified                                   | **No.** Existing packages only; uploads use a file picker.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

Post-design re-check: unchanged after Phase 1.

## Project Structure

### Documentation (this feature)

```text
specs/003-practice-meet-results/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── results-api.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
packages/shared/
├── src/scoring/          # moved from apps/scoresheet/src/scoring/, plus quiz outcome and standings
├── src/types/            # moved scoresheet types and indices
├── src/quizFileCodec.ts  # parsing and (de)serialisation, moved in beside the schema
└── vitest.config.ts      # new (R3)

packages/ui/src/          # choice dialog and guest sessions, shared by scoresheet and portal

packages/api/src/
├── db/schema.ts          # new tables
├── lib/jwt.ts            # room claim
├── routes/join.ts        # sets the room claim
├── routes/results.ts     # new: results and team-name routes
└── test-db.ts            # DDL for the new tables

apps/scoresheet/src/
├── composables/useMeetSession.ts   # who may submit, and for which rooms; team-name dropdown source
├── composables/useScoresheet.ts    # placements from shared
├── stores/quizStore.ts             # cell grid from shared
├── export/fillOts.ts               # cell grid from shared
├── components/Scoresheet.vue       # Submit to meet; open a stored quiz from the link
└── api.ts                          # results and team-name calls

apps/web/src/
├── router/index.ts                 # the results route under /:slug, with the standings
├── views/                          # results list, standings, team names
└── api.ts                          # results and team-name calls

docs/  data-model.md, auth.md, roles-and-access.md, scoring-rules-explained.md, architecture.md
```

**Structure Decision**: No new package. Scoring and standings live in `packages/shared`, the only
place every consumer can import; storage and authorisation in the API; editing stays in the
scoresheet; listing, counting and standings screens in the portal.

## Reuse and Ownership

| Decision or write path                                                         | Owner                                                                                             | Existing code reused                                                                                 |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Scores, validation, grey-out, overtime, placements                             | The moved `scoring/` modules in `packages/shared`                                                 | All of `apps/scoresheet/src/scoring/`, unchanged                                                     |
| Cells grid from a quiz's teams, quizzers and answers                           | One shared function, called by `quizStore.cellGrid`, `fillOts` and the quiz outcome               | The logic in `quizStore.cellGrid`; removes the copy in `fillOts`                                     |
| Whether a quiz can be placed, its placements and placement points              | One shared function; `useScoresheet` derives `placements` and `placementPoints` from it           | The gate and timeout checks now inline in `useScoresheet.ts`                                         |
| Quiz outcome from a stored file                                                | Shared, beside placement                                                                          | `deserialize`, the cells grid, `scoreTeam` (`teamErrorCount`), the placement function                |
| Division standings, tie-breaks, finalists, warnings, look-alike names          | Shared, `scoring/` (new module)                                                                   | Quiz outcomes; nothing else ranks across quizzes today                                               |
| Parsing and validating quiz files                                              | The moved parser in `packages/shared/src/quizFile.ts`, used by scoresheet and API                 | `parseQuizFile`, `NewerFileVersionError`, `QuizFileSchema`                                           |
| Storing quizzes, revisions, counting records, team names                       | `packages/api/src/routes/results.ts`                                                              | Drizzle schema conventions, `inChunks` (`lib/db.ts`, for D1's parameter limit), `isAdminOrSuperuser` |
| Who may read or write a meet's results                                         | `routes/results.ts`, with an official-of-room check beside `lib/permissions.ts`'s helpers         | `isAdminOrSuperuser`, `isViewerOf` pattern, `getGuest`, `requireAuthOrGuest`                         |
| An official's authority over their rooms' quizzes                              | `routes/results.ts`, by the rooms its revisions were saved for, beside the official-of-room check | `isOfficialOfRoom`, revisions' `saved_by_room_id`, official memberships (`officialRoomsOf`)          |
| Who may send to a meet, and for which rooms                                    | `GET /results/sender` in `routes/results.ts`, read by both apps                                   | `isAdmin`, `officialRoomsOf`; the shared `Sender` type and `chooseRoom` in `packages/ui`             |
| Guest sessions from a room or viewer code, in both apps                        | The guest session module, moved from the scoresheet into `packages/ui` (R15)                      | `apps/scoresheet/src/composables/guestSession.ts`, the portal's `joinMeetGuest`                      |
| Who saved a revision and how                                                   | The API, from the caller (R7)                                                                     | Session and guest middleware                                                                         |
| The official's room                                                            | The room claim set in `routes/join.ts`, read in `routes/results.ts`                               | `signGuestJwt`, `verifyGuestJwt`                                                                     |
| Which stored quiz a submission belongs to                                      | The API, by the quiz's folded name (R8)                                                           | The quiz file's division, consolation and quiz number                                                |
| Submitting or saving to the meet (officials and admins alike, by name; R8, R9) | `Scoresheet.vue`'s Save menu, through `apps/scoresheet/src/api.ts`                                | `serialize`, `hasAnyErrors`, the guest token in `request()`                                          |
| Asking what to do with a quiz the meet already has                             | The choice dialog and its question in `packages/ui` (moved from the scoresheet by T023)           | The scoresheet's `ChoiceDialog`; `packages/ui`'s shared components                                   |
| Opening a stored quiz in the scoresheet                                        | The existing URL-parameter handling in `Scoresheet.vue`                                           | `loadFromUrlParams`, `confirmAction`, `loadFile`                                                     |
| Editing names, division and quiz number in a stored file                       | The portal's results view (also used by merge, R10)                                               | `deserialize` / `serialize` from shared                                                              |
| Team-name dropdown                                                             | `useMeetSession`'s team options                                                                   | `teamsForDivision`, the existing team picker                                                         |
| Results and standings screens                                                  | New views under the meet route in `apps/web`                                                      | `meetAccess.isAdminOrSuperuser`, the roster CSV file-input pattern, `confirm()`                      |

**Platform already provides**: TypeBox's `Value.Parse` validates and strips unknown fields (used by
the shared parser), and converts loose values, so the API checks strictly before storing (R6); D1
cascades meet-scoped rows on meet delete; same-origin cookies authenticate admins in both the portal
and the scoresheet; the browser file input reads several files at once.

**Releases**: shared MINOR in each PR that changes it (the move; the quiz outcome; standings;
look-alike names); api MINOR (routes, tables, token claim); scoresheet MINOR (Submit, team names);
web MINOR (results and standings). Each consumer names its bundled shared version. Version numbers
are set when each bump commit is written.

## Complexity Tracking

| Departure                                                    | Why                                                                                           | Simpler alternative rejected because                                                                                                                                |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `quiz_results.room_id` is written but unread (principle VII) | A quiz's rooms come from its revisions' rooms, and where it came from from its first revision | Dropping the column makes drizzle rebuild the table, and on D1 `DROP TABLE` cascades to every revision and counting record. It stays until a safe migration (#107). |
