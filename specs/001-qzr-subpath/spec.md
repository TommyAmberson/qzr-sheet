# Feature Specification: Move qzr under /qzr

**Feature Branch**: `feat/qzr-subpath`

**Created**: 2026-10-01

**Status**: Draft

**Input**: User description: "Move all of qzr-sheet from the root of www.versevault.ca to /qzr so
that verse-vault can take over the root. /scoresheet and every other old qzr address that
verse-vault does not need should redirect into /qzr. qzr goes first and is verified before
verse-vault moves."

## Context

Today www.versevault.ca serves the qzr portal at `/`, the scoresheet at `/scoresheet/`, and the qzr
API at `/api/`. verse-vault lives at `/vv/`. The site is changing hands: verse-vault moves to the
root, and everything qzr moves under `/qzr/`. This spec covers the qzr side only. The verse-vault
side (serving the root, redirecting `/vv/`) is tracked separately in the verse-vault repo and
depends on this feature being live and verified first.

The work happens in two stages:

* **Parallel stage**: qzr becomes fully usable at `/qzr/` while the current root site keeps working
  as before, apart from one forced sign-in. New desktop and Android builds ship pointing at the new
  address.
* **Switch day**: qzr gives up the root and `/api/`, and old qzr addresses start redirecting into
  `/qzr/`. This happens together with the verse-vault move.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Use qzr at its new address (Priority: P1)

A coach, quizmaster, or official opens www.versevault.ca/qzr/ and uses qzr exactly as before: browse
meets, sign in with Google, GitHub, or email, join a meet with a code, manage rosters and schedules,
and open the scoresheet at /qzr/scoresheet/, including loading a quiz from a schedule and using a
guest viewer link. During the parallel stage the old root addresses keep working too.

**Why this priority**: everything else depends on qzr being whole at the new address. It is also the
verification gate for the verse-vault move.

**Independent Test**: with the root site untouched, walk every portal page and the scoresheet at
`/qzr/`, sign in with each method, and confirm nothing loads from or links to the old root
addresses.

**Acceptance Scenarios**:

1. **Given** the parallel stage is deployed, **When** a visitor opens `/qzr/`, **Then** the portal
   home page loads with all styles, images, and icons, and every in-app link stays under `/qzr/`.
2. **Given** a visitor on `/qzr/`, **When** they sign in with Google, GitHub, or email, **Then**
   they return to the page they started from, signed in.
3. **Given** a signed-in coach on a meet's schedule page under `/qzr/`, **When** they open a quiz in
   the scoresheet, **Then** it opens at `/qzr/scoresheet/` with that meet and quiz loaded.
4. **Given** a guest viewer link of the form `/qzr/scoresheet/?meet=<code>`, **When** someone opens
   it, **Then** they get guest access to that meet as they do today.
5. **Given** the parallel stage is deployed, **When** a visitor uses the old root addresses (`/`,
   `/scoresheet/`), **Then** they behave as before, apart from asking signed-in users to sign in
   once more (FR-008).
6. **Given** a visitor who opens `/qzr/` directly at a deep page (a meet slug, its schedule),
   **When** the page loads or is refreshed, **Then** the correct page renders rather than a
   not-found error.

---

### User Story 2 - Sessions in qzr and verse-vault stay independent (Priority: P2)

Someone who uses both qzr and verse-vault in the same browser signs into one without being signed
out of the other.

**Why this priority**: both apps share one host. Today signing into one can silently end the session
in the other, and that keeps happening after the move unless it is fixed. Fixing it on the qzr side
costs qzr users one extra sign-in, so it belongs in the first deploy.

**Independent Test**: sign into qzr and verse-vault in one browser, use both, and confirm each stays
signed in.

**Acceptance Scenarios**:

1. **Given** a user signed into verse-vault, **When** they sign into qzr in the same browser,
   **Then** they remain signed into verse-vault, and vice versa.
2. **Given** a user signed into qzr before this change ships, **When** the change deploys, **Then**
   they are asked to sign in again once, and stay signed in after that.

---

### User Story 3 - Desktop and Android apps use the new address (Priority: P2)

A quizmaster using the desktop or Android scoresheet app updates to the new release, and its
connected features (sign-in, loading a quiz from a schedule, guest viewer access) keep working,
before and after switch day.

**Why this priority**: installed apps have the server address built in. Shipping the new address
before switch day, and giving people time to update, is what keeps switch day from breaking them.

**Independent Test**: install the new desktop and Android builds during the parallel stage, use
every connected feature, then repeat after switch day.

**Acceptance Scenarios**:

1. **Given** the new app release, **When** a user signs in and loads a quiz from a schedule,
   **Then** it works during the parallel stage and after switch day.
2. **Given** an old app release after switch day, **When** a user loads meet data that does not need
   sign-in (guest viewer access, public meet information), **Then** it keeps working for the grace
   period.
3. **Given** an old app release after switch day, **When** a user tries to sign in, **Then** sign-in
   fails, and scoring keeps working offline. How the failure looks is fixed in the released build
   and is checked before switch day (FR-010).

---

### User Story 4 - Old links keep working (Priority: P3)

After switch day, anyone following an old qzr link (a bookmark, a printed meet sheet, a link in an
email or chat) lands on the same thing at its new address.

**Why this priority**: shared and printed links outlive any migration. This matters from switch day
onward, not before.

**Independent Test**: after switch day, open a list of old addresses and confirm each lands on the
matching `/qzr/` page with the same query string.

**Acceptance Scenarios**:

1. **Given** switch day has happened, **When** someone opens `/scoresheet/?meet=<code>&quiz=<id>`,
   **Then** they land on `/qzr/scoresheet/?meet=<code>&quiz=<id>`.
2. **Given** switch day has happened, **When** someone opens `/scoresheet` without a trailing slash,
   **Then** they land on `/qzr/scoresheet/`.
3. **Given** switch day has happened, **When** someone opens `/roadmap`, **Then** they land on
   `/qzr/roadmap`.
4. **Given** switch day has happened, **When** someone opens an old meet address such as
   `/fall-2025` or `/fall-2025/schedule`, **Then** they land on `/qzr/fall-2025` or
   `/qzr/fall-2025/schedule`.
5. **Given** switch day has happened, **When** someone opens a multi-level address that matches
   neither app, **Then** they see a not-found page rather than a blank screen. A single-level
   unknown address is treated as a possible meet and asks for sign-in, as meet links do today.

---

### User Story 5 - Installed scoresheet web app moves over without losing work (Priority: P3)

An official who installed the scoresheet as a web app (added to home screen or desktop) from
`/scoresheet/` keeps their saved scoresheet and is guided to the app at its new address.

**Why this priority**: the installed web app is tied to its old address and cannot follow a redirect
by itself. Without handling, it would keep serving a stale copy that talks to the wrong server.

**Independent Test**: install the web app from `/scoresheet/` before switch day, enter scores, then
open it after switch day, online and offline.

**Acceptance Scenarios**:

1. **Given** an installed old web app with an auto-saved scoresheet, **When** it is opened online
   after switch day, **Then** the stale copy removes itself, the user lands on `/qzr/scoresheet/`,
   and the auto-saved scoresheet is still there.
2. **Given** an installed old web app, **When** it is opened offline after switch day (for example
   mid-meet in a gym), **Then** scoring still works from the cached copy and nothing is lost; the
   clean-up happens the next time it is online.
3. **Given** a user on `/qzr/scoresheet/`, **When** they install it as a web app, **Then** it
   installs, works offline, and opens at `/qzr/scoresheet/`.

---

### Edge Cases

* A user is mid-quiz in the old web app when switch day happens: scoring continues offline and the
  auto-save survives the move (same site, so saved data carries over).
* A guest viewer token issued before the move is used after it: still valid for its meet.
* A sign-in started on the old address and completed after the switch: the user may need to sign in
  again, but no error page is left behind.
* `/qzr` without a trailing slash: lands on `/qzr/`.
* Someone opens `/qzr/api/...` in a browser: API response, not the portal.
* A new meet slug that happens to match a future verse-vault page name: the verse-vault page wins at
  the root; the meet is still reachable at `/qzr/<slug>`.
* Search engines and link previews follow the permanent redirects to the new addresses.

## Requirements _(mandatory)_

### Functional Requirements

**At the new address (parallel stage onward)**

* **FR-001**: The qzr portal MUST be served at `/qzr/`, with every page, asset, and in-app link
  under `/qzr/`.
* **FR-002**: The scoresheet web app MUST be served at `/qzr/scoresheet/`, and portal links to it
  MUST point there, including links that open a specific meet and quiz.
* **FR-003**: The qzr API MUST be reachable at `/qzr/api/`, and the portal and scoresheet web app
  MUST use it there.
* **FR-004**: Sign-in with Google, GitHub, and email MUST work at the new address, returning the
  user to where they started.
* **FR-005**: Deep links and refreshes under `/qzr/` MUST render the right page.
* **FR-006**: The scoresheet web app MUST be installable from `/qzr/scoresheet/` and work offline
  from there, as required by the constitution's offline principle.
* **FR-007**: During the parallel stage, the existing root addresses (`/`, `/scoresheet/`, `/api/`)
  MUST keep working as before, except that signed-in users sign in again once (see FR-008).
* **FR-008**: qzr's sign-in session MUST be stored so that it cannot overwrite or be overwritten by
  verse-vault's on the same host.

**Apps**

* **FR-009**: New desktop and Android releases MUST use the API at `/qzr/api/` and MUST be released
  before switch day.
* **FR-010**: Old app releases MUST keep scoring offline after switch day. They do, because scoring
  needs no network. How their connected features fail cannot be changed after release; it is checked
  before switch day, and a hang is raised as its own issue.

**Switch day**

* **FR-011**: qzr MUST stop serving the root and `/api/`, leaving them to verse-vault.
* **FR-012**: `/scoresheet` and `/scoresheet/*` MUST permanently redirect to the matching
  `/qzr/scoresheet/` address, keeping the query string.
* **FR-013**: `/roadmap` MUST permanently redirect to `/qzr/roadmap`, keeping the query string. Old
  meet addresses (`/<slug>` and pages beneath them) MUST lead to the matching `/qzr/` address with
  the query string kept. Slugs cannot be listed in advance, so verse-vault's app sends addresses it
  does not recognise to `/qzr/`: a redirect in the browser, not a permanent HTTP redirect.
* **FR-014**: Old installed scoresheet web apps MUST remove their stale copy and move the user to
  `/qzr/scoresheet/` the next time they are opened online, without deleting saved scoresheets.
* **FR-015**: For a grace period after switch day, old app releases MUST still be able to reach qzr
  meet data that does not need sign-in at the old API address (provided by verse-vault's router
  forwarding those requests to qzr).

**Documentation**

* **FR-016**: `docs/auth.md`, `docs/architecture.md`, `docs/roles-and-access.md`, `README.md`, and
  `CLAUDE.md` MUST describe the new addresses in the same pull request that changes them.

### Key Entities

* **Public address map**: the set of qzr addresses (portal, scoresheet, API, sign-in return
  addresses) and, after switch day, the old-to-new redirects.
* **Installed web app identity**: the scoresheet web app's install identity and its offline copy,
  which change with its address.
* **Sign-in provider registrations**: the return addresses registered with Google and GitHub, which
  must include the new ones before the new address goes live.

## Success Criteria _(mandatory)_

### Measurable Outcomes

* **SC-001**: During the parallel stage, every portal page, the scoresheet, and all three sign-in
  methods work at `/qzr/`, and a full walkthrough finds zero requests to the old root addresses.
* **SC-002**: During the parallel stage, the existing root site behaves as before, apart from one
  forced sign-in.
* **SC-003**: After switch day, 100% of a test list of old addresses (scoresheet with and without
  query, roadmap, three real meet slugs and their sub-pages) land on the matching `/qzr/` page in
  one redirect hop from qzr's side.
* **SC-004**: A user signed into both qzr and verse-vault stays signed into both across a full
  session of switching between them.
* **SC-005**: No saved scoresheet is lost by the move: an auto-saved scoresheet from before switch
  day opens afterwards in both the old installed web app and `/qzr/scoresheet/`.
* **SC-006**: The new desktop and Android releases are published at least one week before switch
  day, with users who are known to rely on them told to update.

## Assumptions

* The site stays on the same host (www.versevault.ca), so data saved in the browser and the
  one-origin rule for portal, scoresheet, and API in the constitution both still hold.
* The apex `versevault.ca` keeps redirecting to `www`.
* The maintainer adds the new Google and GitHub sign-in return addresses before the parallel stage
  goes live, and removes the old ones after the grace period.
* The grace period for old app releases is a few weeks; the user base is small enough that
  maintainers can reach the people who use the desktop and Android apps.
* Old installed web apps must be reinstalled from the new address; the browser does not carry the
  install over.
* qzr gets a new hosting target for `/qzr/` so it can go live alongside the current root site; the
  old Pages project is retired after switch day.
* Forwarding old-app API requests (FR-015) and the catch-all for unknown root addresses (FR-013) are
  implemented in verse-vault; this feature only depends on them.
