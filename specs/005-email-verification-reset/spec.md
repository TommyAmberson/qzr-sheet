# Feature Specification: Email Verification and Password Reset

**Feature Branch**: `feat/email-verification-reset`

**Created**: 2026-10-31

**Status**: Draft

**Input**: User description: "Email verification, password reset and safe sign-in linking for qzr"
(TommyAmberson/qzr-sheet#93), ported from verse-vault spec 006 (TommyAmberson/verse-vault#171).

## Context

Email and password sign-up is open and never verified, and there is no password reset. Two
consequences:

* **No recovery.** Someone who forgets their password has no way back in.
* **Unverified addresses block linking.** A GitHub or Google sign-in refuses to join an existing
  account whose address isn't verified, which closes a pre-registration attack. Password accounts
  are never verified, so a password account can't later add GitHub or Google, and an address
  registered by someone who doesn't own it stays blocked for its real owner, who can't reset it
  either.

verse-vault solved the same problems in its spec 006, sending from the same address through the same
provider. This feature carries those decisions over, with the differences qzr needs: a second
provider (GitHub), two clients (the portal and the scoresheet, including its desktop build), and an
API that runs as an edge worker. Accounts here carry meet access rather than study progress.

The scoresheet must keep working offline and without an account (constitution principle I). Nothing
here may block entering, scoring or saving a quiz.

## Clarifications

### Session 2026-10-31

* Q: What happens to an account's meet access when "That's not me" takes it over? → A: All meet
  memberships and roles are removed; the new owner re-joins meets with codes.
* Q: Where do the code step and the choice happen for a desktop-app sign-in? → A: In the system
  browser, on the portal's pages, before the sign-in returns to the app. (The security review found
  the desktop app has no provider sign-in yet, so this applies when it's built; see edge case
  "Desktop build".)
* Q: After a reset, does the owner tick which provider sign-ins to keep, or are they all
  disconnected? → A: All disconnected, the owner connecting again any that are theirs, matching
  verse-vault (decided in the review against verse-vault's spec 006, 2026-10-31).

### Session 2026-11-01

* Q: Should new passwords be checked against breached-password lists (NIST SP 800-63B-4)? → A: Yes,
  on sign-up and reset (FR-032), in this feature.
* Q: Should the minimum password length rise to NIST's 15 for single-factor passwords? → A: No, it
  stays 8, with the breach check and sign-in rate limits (FR-030) instead.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Reset a forgotten password (Priority: P1)

A coach who forgot their password chooses "Forgot password?" on the sign-in form, enters their
address, receives a 6-digit code by email, enters it with a new password, and is signed in.

**Why this priority**: today a forgotten password locks the person out for good.

**Independent Test**: request a reset for an existing password account, enter the emailed code and a
new password; the new password works, the old one doesn't, and other sessions are signed out.

**Acceptance Scenarios**:

1. **Given** an account with a password, **When** its owner requests a reset and enters the emailed
   code with a new password, **Then** they are signed in, the old password stops working, and every
   other session on the account ends.
2. **Given** an address with no account, **When** someone requests a reset for it, **Then** the
   response reads and takes the same as for an address that has one, and no email is sent.
3. **Given** a reset code, **When** a wrong code is entered three times or ten minutes pass,
   **Then** the code stops working and the form offers to send a new one.
4. **Given** an account created with GitHub or Google only, **When** its owner completes a reset,
   **Then** the account gains its first password.
5. **Given** an account with GitHub or Google linked, **When** its owner completes a reset, **Then**
   every provider sign-in is disconnected, the form says so and points to connecting it again in
   account settings, and one email says the password was reset and the providers were disconnected.

---

### User Story 2 - Verify an address (Priority: P1)

After signing up with a password, a coach is asked for the code just emailed to them, with "Skip for
now". Skipping keeps them signed in with an unverified address, which they can verify later from
account settings in the portal.

**Why this priority**: a verified address is what lets GitHub or Google join the account later, and
what stops someone else claiming it.

**Independent Test**: sign up with a password, enter the code; the account shows as verified. Sign
up again with another address and skip; the account works and settings offer to send a code.

**Acceptance Scenarios**:

1. **Given** a new password sign-up, **When** the code from the email is entered, **Then** the
   address is marked verified.
2. **Given** a new password sign-up, **When** the person skips the code, **Then** they stay signed
   in and can use everything an account can, unverified.
3. **Given** an unverified account, **When** its owner opens account settings, **Then** they see
   that the address is unverified, a warning about what that allows, and a button to send a code.

---

### User Story 3 - Add GitHub or Google to an account safely (Priority: P2)

A coach signed in with a password connects their Google or GitHub account from account settings, so
they can sign in either way afterwards. They can also disconnect it, keeping their password.

**Why this priority**: it is the linking path that verification unblocks, without opening a way for
someone else to attach their own sign-in to the account.

**Independent Test**: from a verified password account, connect GitHub; sign out and sign in with
GitHub into the same account. Disconnect it with the password; GitHub no longer signs in.

**Acceptance Scenarios**:

1. **Given** a verified password account signed in within the last day, **When** its owner connects
   GitHub or Google with the same address, **Then** the provider joins the account and an email
   tells the address it was connected.
2. **Given** an unverified password account, **When** its owner connects a provider, **Then** they
   must first enter a code emailed to the address (or use a Google account Google hosts the address
   for), and doing so also verifies it.
3. **Given** an account with a password and a provider, **When** its owner disconnects the provider
   with their password, **Then** it no longer signs in, every other session ends, and an email says
   so.

---

### User Story 4 - Sign in with GitHub or Google onto an existing account (Priority: P2)

Someone signs in with GitHub or Google, signed out, and an account with that address already exists.

**Why this priority**: today this simply fails; it has to work for the real owner and never for
someone who merely shares a provider address.

**Independent Test**: create an unverified password account, then sign in with GitHub on the same
address: a code step appears; after it, the choice "That's me" / "That's not me".

**Acceptance Scenarios**:

1. **Given** a verified account, **When** a Google sign-in arrives for an address Google hosts
   (Gmail or a Workspace domain), **Then** it signs in to that account.
2. **Given** a verified account, **When** a GitHub sign-in, or a Google sign-in for an address
   Google doesn't host, arrives for its address, **Then** it is refused with "Sign in with your
   password, then connect it in account settings".
3. **Given** an unverified password account, **When** a GitHub sign-in or a Google sign-in for an
   address Google doesn't host arrives for its address, **Then** a code is emailed and asked for;
   only after it is entered does the person see the choice.
4. **Given** the choice, **When** they pick "That's me" and enter the password, **Then** the
   provider joins the account and they are signed in.
5. **Given** the choice, **When** they pick "That's not me" and confirm the warning, **Then** the
   password is removed, every session ends, the account's meet memberships and roles are removed,
   the provider joins, the address is verified, they are signed in, and they are told to re-join
   their meets with codes.

---

### User Story 5 - Do the same from the scoresheet, online or not (Priority: P3)

An official signs in from the scoresheet, in the browser or the desktop app. The forgot-password and
code steps work there too; when offline, scoring carries on as before and sign-in says it needs a
connection.

**Why this priority**: the scoresheet shares the sign-in form; it must not regress, and must never
block scoring.

**Independent Test**: reset a password from the scoresheet's sign-in form; then go offline and score
a quiz with no sign-in prompt in the way.

**Acceptance Scenarios**:

1. **Given** the scoresheet online, **When** an official uses "Forgot password?" or the code after
   sign-up, **Then** it works as in the portal.
2. **Given** the scoresheet offline, **When** an official scores and saves a quiz, **Then** nothing
   in this feature prompts or blocks them.

### Edge Cases

* **Codes cross purposes.** A code sent for verification can't reset a password, and neither passes
  the provider code step; each email says what its code is for.
* **A resend replaces the old code.** Only the newest code for a purpose works.
* **Too many sign-in attempts.** Password sign-in, reset and code entry past their rate limits are
  told to try again later (FR-030).
* **Breached password.** A new password found in a breached-password list is refused with a message
  to choose another; if the check can't be made, sign-up or reset says to try again later rather
  than accept the password unchecked (FR-032).
* **Limits reached.** A request that would send email past the limits is told to try again later;
  sign-up itself is never refused for it.
* **No email provider configured** (local development). The code is logged instead of sent and the
  request succeeds.
* **Email sending fails.** The failure is logged with enough detail to diagnose, never the code
  itself, and the person sees the same response as for a sent email.
* **Takeover of an account with meet access.** Meet access comes from codes whoever set the password
  entered, so it doesn't pass to the new owner: "That's not me" removes the account's meet
  memberships and roles, and the new owner re-joins with codes.
* **A superuser's address.** Superusers are provisioned out of band, and their address must be
  verified when they are; a takeover also returns the account's role to normal, so it can never
  inherit superuser.
* **An address the provider never verified.** GitHub lets an account list addresses it hasn't
  verified, and a provider that skips verification is how the "non-verifying IdP" pre-hijacking
  attack works (Sudhodanan and Paverd, USENIX Security 2022, §4.5). Such a sign-in is refused, so an
  attacker can only use an address they really controlled at the provider.
* **A provider linked before the real owner arrived.** If an address was once controlled by someone
  else (a lapsed domain, say), their provider link could outlive the real owner's password reset.
  The reset disconnects every provider sign-in, and the owner connects again any that are theirs:
  the paper's §6.2.2 defence in depth, unlinking by default and letting the owner choose what to
  keep. This matches verse-vault (its spec 006, FR-029 and research D19), which chose reconnecting
  over a tick-to-keep list: no held state or restore route, and someone who still uses a provider
  signs in with it rather than resetting. A provider connection started before the reset can't
  complete after it.
* **The provider changes its address.** Linking uses the address at the moment of sign-in; a GitHub
  account whose primary address later changes signs in through its existing link.
* **Desktop build.** The scoresheet's desktop app has no GitHub or Google sign-in today (the auth
  client only does the web redirect), so this feature gives it email and password with codes only.
  When desktop provider sign-in is built, its code step and choice happen in the system browser on
  the portal's pages, and the sign-in follows the native-app rules: a loopback redirect on
  `127.0.0.1` (not `localhost`), PKCE and `state`, the provider callback handled by the API in the
  browser, and a one-time token handed to the app (RFC 8252).
* **Old clients.** A scoresheet or portal build from before this feature keeps signing in as before;
  it just lacks the new steps.

## Requirements _(mandatory)_

### Functional Requirements

* **FR-001**: The sign-in form MUST offer "Forgot password?", which asks for an address and requests
  a reset.
* **FR-002**: The response to a reset request MUST NOT reveal whether an account exists for the
  address, in wording or in a measurably different response time.
* **FR-003**: A reset email MUST contain a single-use 6-digit code that expires after 10 minutes and
  stops working after 3 wrong attempts. For an account without a password, completing the reset sets
  its first password.
* **FR-004**: Entering a valid reset code MUST let the person choose a new password under the
  sign-up rules, after which the old password stops working and they are signed in.
* **FR-005**: Completing a reset MUST end every other session on the account and mark the address
  verified.
* **FR-025**: Completing a reset MUST disconnect every GitHub and Google sign-in on the account, and
  the app MUST then say so and offer to connect them again from account settings. When the reset
  completes, every session MUST have ended and the providers MUST be gone, with no provider sign-in
  or connection able to land in between; a provider connection started before the reset MUST NOT
  complete after it and is refused with an error. If the disconnect fails, the failure is logged and
  the reset still completes, since the password has already changed.
* **FR-028**: Completing a password reset MUST email the address that the password was reset, and
  what to do if it wasn't them. When the reset disconnected a provider, the email MUST say so; when
  the disconnect failed, it MUST say which provider is still connected and to disconnect it in
  account settings (OWASP Forgot Password Cheat Sheet).
* **FR-029**: Completing a password reset MUST cancel the account's pending provider sign-ins (the
  code step and the choice), as OWASP asks recovery to invalidate outstanding codes.
* **FR-006**: Creating a password account MUST send a verification code to its address (unless the
  daily limit is reached), and the account MUST be usable immediately, unverified.
* **FR-007**: A verification code MUST expire after 10 minutes and stop working after 3 wrong
  attempts. Entering it MUST verify the address only for a session on that account, and MUST NOT
  sign anyone in.
* **FR-008**: Signing in MUST NOT require a verified address.
* **FR-009**: The portal MUST have account settings showing whether the address is verified, a
  warning next to an unverified one that until it is verified anyone with access to the inbox can
  take the account over, and a way to send a new code. Only a session on that account can ask for a
  verification code to be sent; the code sent at sign-up is the exception.
* **FR-010**: A wrong, expired or used code MUST be answered with a message that it isn't valid and
  an offer to send a new one.
* **FR-011**: Requests that send email MUST be limited to 3 per address per hour (reset,
  verification and the provider code step combined; the sign-up email not counted) and 10 per client
  per day (sign-up included, and the provider code step counted per client too). A limited request
  is told to try again later; sign-up is never refused.
* **FR-012**: All email MUST come from `VerseVault <no-reply@versevault.ca>`, show the code
  prominently, say why it was sent, how long it lasts, not to share it, and what to do if the reader
  didn't ask for it. Each code MUST work only for the purpose its email names. The code for the
  provider code step MUST say that a GitHub or Google account is being connected, and to enter it
  only if the reader did that themselves.
* **FR-013**: A Google or GitHub sign-in MUST join an existing account with the same address only
  with proof that the person controls the inbox now: a Google sign-in for an address Google hosts (a
  Gmail address, or a Workspace domain claim), or, for an unverified password account only, a code
  emailed to the address. GitHub never counts as proof on its own. A verified account is never
  joined on a code alone: such sign-ins are refused with a message to sign in with the password and
  connect from account settings. Without proof, nothing joins, verifies or takes over.
* **FR-026**: A Google or GitHub sign-in MUST be refused when the provider doesn't report its
  address as verified. For GitHub, only the account's primary verified address is used. The person
  MUST be told why, and offered to confirm the address with the provider or sign up with email.
* **FR-014**: A provider sign-up that matches no account MUST start verified only when Google hosts
  the address; GitHub sign-ups and other Google sign-ups start unverified.
* **FR-015**: When a signed-out provider sign-in with proof (FR-013) matches an unverified password
  account, the app MUST say that an unverified account with this address exists and ask whether it
  is theirs. "That's me" MUST ask for its password and then connect the provider. "That's not me"
  MUST warn that whoever set the password will lose access, require confirmation, then remove the
  password, end every session, remove any GitHub or Google accounts the registrant had linked,
  remove the account's meet memberships and roles, return its account role to normal, connect the
  provider, verify the address and sign the person in.
* **FR-016**: The choice in FR-015 MUST only be reachable within 10 minutes of the proof for that
  exact address, from the browser that started the sign-in, which holds a single-use token issued by
  the server that page scripts can't read, and MUST reveal nothing about the account otherwise.
* **FR-017**: After a takeover, the app MUST tell the person their meet access was cleared and that
  they re-join meets with codes.
* **FR-024**: The scoresheet's desktop app MUST offer email and password with codes; GitHub and
  Google sign-in there are out of scope (see edge case "Desktop build").
* **FR-027**: An account MUST NOT be given the superuser role unless its address is verified.
* **FR-018**: Account settings MUST let someone signed in with a password connect GitHub or Google
  with the same address, from a sign-in within the last day; an unverified account needs the proof
  in FR-013 first, which also verifies it. Settings MUST let them disconnect a provider with their
  password, from a sign-in within the last day, while a password remains; disconnecting ends every
  other session.
* **FR-019**: When a provider joins or leaves an account by any route other than the person's own
  takeover or a new provider sign-up, the account's address MUST be emailed a notice saying so and
  how to undo it; when a password reset disconnects it, the reset's own notice (FR-028) says so
  instead.
* **FR-020**: Email sending MUST NOT delay or fail the request that triggers it, and MUST still
  complete after the response is sent.
* **FR-021**: When no email provider is configured, the code MUST be logged instead and the request
  MUST succeed. Send failures MUST be logged without the code.
* **FR-022**: The scoresheet MUST offer the same reset and verification steps through the shared
  sign-in form, and nothing in this feature may prompt or block while scoring, online or offline.
* **FR-023**: The design docs (`docs/auth.md`) MUST describe these flows and rules, updated with the
  behaviour.
* **FR-030**: Password sign-in, password reset and code entry MUST be rate limited per client, with
  limits that hold across every server instance; a limited request is told to try again later. The
  password check on disconnect MUST be limited per account too. "That's me" and disconnecting rest
  on the password, so guessing it must not be free.
* **FR-031**: The account routes (the code step, the choice and disconnect) MUST accept requests
  that change anything only from the app's own origins, so a page on another origin, even one on the
  same site, can't submit them with the person's cookies.
* **FR-032**: A new password, at sign-up, reset or change, MUST be refused when it appears in a list
  of breached passwords, with a message to choose another; the check MUST NOT send the password or
  its full hash anywhere. The minimum length stays 8.

### Key Entities

* **Account address**: an account's email address with a verified flag: false for password sign-ups
  and GitHub or non-hosted Google sign-ups, true for sign-ups on an address Google hosts, and set
  true by a code or a reset.
* **Email code**: a 6-digit, single-use code for one purpose (reset, verification, provider code
  step) and one address, valid 10 minutes, 3 tries.
* **Pending provider sign-in**: a provider sign-in waiting on the code step or the choice, tied to
  one address and one browser, valid 10 minutes.

## Success Criteria _(mandatory)_

### Measurable Outcomes

* **SC-001**: Someone who forgot their password is signed back in within 5 minutes of choosing
  "Forgot password?", given a working inbox.
* **SC-002**: A password account can add GitHub or Google, and the real owner of an address
  registered by someone else can take it over, in every case FR-013 allows; in no other case does a
  provider sign-in join, verify or take over an account.
* **SC-003**: No response, message or timing distinguishes an address with an account from one
  without, for reset requests.
* **SC-004**: Scoring and saving a quiz in the scoresheet work exactly as before, offline and with
  no account.

## Assumptions

* Resend is the provider, through its HTTPS API; its key is already a secret on the API worker.
* Emailed codes only prove control of the inbox, for verification, reset and linking. They are never
  a second factor: NIST SP 800-63B-4 rules email out as an out-of-band authenticator.
* The same sender, limits and code lifetimes as verse-vault keep both apps consistent for people
  using both.
* Out of scope: Reset account and Delete all progress, verse-vault's reset counter, requiring
  verification to sign in, and GitHub or Google sign-in in the desktop app.
