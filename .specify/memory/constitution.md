# qzr Constitution

## Core Principles

### I. The Scoresheet Works Offline, Always

* Scoring a quiz MUST work with no network, no account, and no API, in the browser PWA and in Tauri
  alike.
* Connected features (sign-in, loading a quiz from a schedule, guest viewer links, and future ones
  such as submitting results) MUST degrade to the standalone tool when the network or the API is
  unavailable, and MUST NOT block entering or saving a score.
* Auto-save to `localStorage` on every change, and explicit file save and load, MUST stay available
  in every mode.
* Loading a scoresheet MUST NOT silently discard scores. A `QuizFile` from an earlier `FILE_VERSION`
  loads with defaults for the fields that version lacked; a file that fails schema validation fails
  with a message that says why.

Rationale: meets run in church basements and gyms with unreliable Wi-Fi. An official mid-quiz cannot
wait for a server, and a lost scoresheet cannot be reconstructed after the quizzers go home.

### II. The Rulebook Is the Specification

* `docs/rules.md` (the official rulebook, transcribed) and `docs/scoring-rules-explained.md` define
  scoring. Under the default `Rules` placement formula and `Seat` bonus rule, where code and
  rulebook disagree, the code is the bug.
* Every deliberate departure from the rulebook (today the `Legacy` placement formula and the `Team`
  bonus rule) MUST be an opt-in setting on the quiz and MUST be documented in
  `docs/scoring-rules-explained.md`.
* The design decisions recorded in `docs/scheduling.md`, `docs/auth.md`, `docs/roles-and-access.md`,
  and `docs/data-model.md` outrank the code for the areas they cover. A change that contradicts one
  MUST arrive with the doc amendment that justifies it.
* `docs/architecture.md` and `docs/ods-format.md` describe the code rather than govern it; a change
  that alters what they describe MUST update them in the same pull request.
* `docs/example-winkler-2026.md` is an inspiration source for how meets run where the rulebook is
  silent, not a specification.

Rationale: officials and coaches trust the sheet because it matches the rulebook they already know.
A scoring rule that drifts from the book is a wrong result at a real meet, and nobody notices until
a placement is disputed.

### III. Scoring Has One Pure Implementation

* Scoring, validation, grey-out, column visibility, overtime, and placement are pure functions in
  `apps/scoresheet/src/scoring/` over `cells[teamIdx][seatIdx][colIdx]`. They MUST NOT import Vue,
  perform I/O, or read the store.
* `quizStore` owns the quiz data, `useScoresheet` derives every scoring result from it, and
  components MUST read those derived results rather than call scoring functions themselves.
* Other packages MUST NOT reimplement or approximate a scoring rule. The first consumer outside the
  scoresheet that needs a scoring result (the API or the portal) MUST move that function into
  `packages/shared` and import it, never copy it.

Rationale: pure functions are the only part of the system that can be exhaustively unit-tested
against the rulebook. A rule that leaks into a component or a route handler is tested less and can
disagree with its twin, and a placement computed two ways will eventually be computed two ways
differently.

### IV. Meet Data Is Gated per Meet

* Access to a meet's data is granted by meet-scoped codes, as described in
  `docs/roles-and-access.md`. Every API route that reads or writes a meet's data MUST authorise the
  caller for that meet: a membership, a guest token for that meet, or superuser. Being signed in is
  not authorisation.
* Account sessions MUST be Better Auth cookies. The only bearer tokens are the guest JWTs in
  `packages/api/src/lib/jwt.ts`, issued in exchange for a meet code and scoped to one meet and one
  role. Other token schemes MUST NOT be introduced.

Rationale: meets hold quizzers' names, church affiliations, and results. Codes are the whole access
model, so a route that checks only for a session hands every meet to every account.

### V. Contract Versions Are Promises

* `packages/shared` is the contract between the API, the portal, and the scoresheet, and its
  `package.json` version _is_ the contract version: equal `@qzr/shared` versions MUST mean identical
  wire and file behaviour.
* A pull request that changes `packages/shared/src/` MUST bump `packages/shared/package.json` once,
  with a dated changelog section that later commits in the same pull request extend.
  `tools/check-contract-versions.sh` enforces this at commit time against the point where the branch
  left master, and in CI against the pull request's base. The one exception is a refactor with no
  observable effect, which passes `--no-verify` instead of bumping. `--no-verify` MUST NOT be used
  for anything else.
* Semver is read strictly: MAJOR for a breaking change to the wire format, the `QuizFile` format
  (`FILE_VERSION`), or shared types consumers must adapt to; MINOR for additive changes consumers
  can ignore; PATCH for an observable fix that leaves the contract's shape unchanged. Breaking
  changes carry `!` in the commit type.
* Each consumer release MUST name the bundled shared version under `### Bundled contract` in its
  changelog; `tools/check-contract-versions.sh --ci` blocks the deploy otherwise.

Rationale: a scoresheet saved at one meet is opened in a later release at the next. The version
number is the only signal that two parts of the system agree on what a file means, and it is
worthless if it can drift from the behaviour. Every consumer is built from master, so the version is
bumped per pull request, the unit that reaches master; a commit in the middle of a branch never
ships.

### VI. Validate Before You Merge

* Tests live in `__tests__/` beside the code they cover and SHOULD be written before the feature.
  Scoring and validation changes MUST be covered by unit tests.
* `pnpm test:unit`, `pnpm type-check`, and `pnpm lint` MUST pass before a branch merges to master;
  CI runs them as the required `check` status.
* Database migrations MUST be generated from the Drizzle schema diff with `db:generate`, never
  hand-written or hand-edited. A migration that will not apply is fixed in the schema design.

Rationale: a scoring regression is invisible until a meet, and a migration applies to production D1
the moment an `api` version bump lands on master.

### VII. Simplest Design That Works

* A feature takes the simplest design that meets its spec. Existing code MUST be reused before a new
  helper, module, type, or test fixture is added, and each decision or write path the feature adds
  MUST have one owner.
* Every production export, option, reason code, or piece of state MUST have a production caller;
  nothing exists only for a test to read. Test fixtures and helpers fall under the reuse rule above
  instead. Behaviour the framework or a library already provides MUST NOT be restated or
  re-implemented.
* Plans record owners and reuse in a Reuse and Ownership table. Implementation tasks MUST describe
  the behaviour they add, and the test that proves it where Principle VI calls for one, pointing at
  those owners. They MUST NOT prescribe the names or signatures of new functions, types, or options,
  or split one change into per-layer files; implementation chooses those. Naming the file a change
  lands in is fine, and a name the spec, data-model.md, or contracts/ already fixes is not new:
  tasks may cite it. Complexity beyond this MUST be justified in the plan's Complexity Tracking or
  the pull request body.

Rationale: a plan or task list that prescribes structure gets built literally. On the first features
run through Spec Kit, the largest cleanups after implementation, and one real bug, came from
structure the plan or tasks had named: a writer copied a fifth time, one decision split across three
files with three rules, helpers with no caller, and framework defaults restated by hand. Not writing
that structure is cheaper than deleting it.

## Technology Constraints

* The stack is a pnpm workspace on Node `>=22.12.0`: `apps/scoresheet` (Vue 3 + Vite, shipped as a
  PWA and wrapped by Tauri 2 for desktop and Android), `apps/web` (Vue 3 + Vite portal),
  `packages/ui`, `packages/shared`, and `packages/api` (Hono + Drizzle on Cloudflare Workers with
  D1). A new package or deployable MUST carry its justification in the pull request body.
* In production the portal, the scoresheet PWA, and the API MUST stay on one origin so Better Auth
  cookies need no CORS. Tauri webviews are the only cross-origin clients and are allow-listed in
  `packages/api/src/index.ts`.
* Drag interactions MUST use pointer events; the HTML5 drag API crashes Tauri on Linux/X11.

## Development Workflow

* The hooks that `pnpm install` writes are the only local gates. A checkout without them is not a
  valid development environment.
* Work happens on `type/short-slug` branches. Pull requests merge with a merge commit and MUST NOT
  be squashed. Master MUST NOT be rewritten; feature branches may be, freely, before they merge.
* Commit subjects MUST pass `commitlint.config.js` (Conventional Commits, at most 50 characters),
  merge commits included.
* `scoresheet`, `web`, and `api` each carry their own version, changelog, and deploy workflow, and
  release by a version bump landing on master. `shared` carries a version and changelog and is
  tagged by the first consumer deploy that bundles it. Tags MUST NOT be created locally; CI creates
  them.
* A change records itself in its package's changelog as part of the change, not at release time. By
  default the pull request that changes a package also bumps it, so merging it is the release.
  Deferring the bump to ship several changes together is allowed but deliberate: the pull request
  body says so, and the entries wait under `## [Unreleased]`. Master SHOULD NOT hold unreleased
  changes for long, because an urgent fix then cannot ship without them.
* A pull request that bumps a package version MUST be rebased onto current master before it merges,
  so that CI's run of the deploy-time contract check reflects the master it will deploy from.
* Planned work lives in GitHub Issues ordered by `ROADMAP.md`, per `docs/issue-conventions.md`, and
  `apps/web/src/views/RoadmapView.vue` is kept in step with `ROADMAP.md` when features ship.
  Anything an agent writes on GitHub carries the attribution in `docs/issue-conventions.md` unless
  the maintainer waives it for that item.

## Governance

This constitution states principles. `CONTRIBUTING.md` holds the mechanics they compile down to, and
`CLAUDE.md` the runtime guidance for agents. Each rule has one home: where an operational file
disagrees with this document, this document decides the principle and the divergence MUST be fixed
in the operational file. Where this document is silent, `CONTRIBUTING.md` governs.

`.specify/templates/overrides/plan-template.md` turns each principle into a yes/no gate in every
plan's Constitution Check. Amending a principle MUST update its gate in the same pull request.

Amendments arrive as a pull request that changes this file, bumps the version below by semver (MAJOR
for a removed or redefined principle, MINOR for a new or materially expanded one, PATCH for
clarification), and updates the amendment date. The Sync Impact Report that `/speckit-constitution`
produces goes in that pull request's body, not in this file. The maintainer checks each plan's
Constitution Check and each merge against these principles; an exception MUST be justified in the
plan's Complexity Tracking or the pull request body, and an exception that outlives its
justification is a defect to be removed.

**Version**: 1.4.0 | **Ratified**: 2026-10-01 | **Last Amended**: 2026-10-01
