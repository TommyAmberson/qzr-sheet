# Research: Email Verification and Password Reset

verse-vault's spec 006 (`TommyAmberson/verse-vault`, `specs/006-email-verification-reset/`) worked
through the same problems, with two code reviews per phase and three security reviews. Its research
D1 to D19 is the source; this file records what carries over, why it still holds, and what qzr
changes (Q1 to Q5).

## D1. Sending email

**Decision**: Resend's HTTPS API from `VerseVault <no-reply@versevault.ca>`, key in the Worker
secret `RESEND_API_KEY` (already set on `qzr-api`). With no key, log the message instead (FR-021).

**Rationale**: same domain and sender as verse-vault; one `fetch`, no SMTP from a Worker.

## D2. Not delaying the response (Q1, qzr)

**Decision**: the email sender starts the send, hands its promise to the Worker's `waitUntil`, and
returns nothing, for Better Auth's sends and qzr's own routes alike; a failure is logged.

**Rationale**: an awaited send would make a known address answer slower than an unknown one
(FR-002); on a Worker, a promise not handed to `waitUntil` may be cancelled once the response
returns (FR-020). Because the sender returns at once, Better Auth's `advanced.backgroundTasks` has
nothing to defer, so it isn't used.

**Alternatives considered**: awaiting the send (timing leak); a queue (more infrastructure for a
handful of emails a day).

## D3. Codes, not links

**Decision**: Better Auth's `emailOTP` plugin: 6 digits, hashed at rest, 10 minutes, 3 tries, a
resend replaces the old code, each code tied to one purpose (verse-vault D15). Its unused routes
(sign-in by code, change email, the bare check route) are disabled.

**Rationale**: a code typed where it was asked can't be prefetched by mail scanners or opened on the
wrong device, and works in the desktop app, which has no deep links.

## D4. Email limits (Q2, qzr)

**Decision**: 3 per address per hour (reset, verification and the provider code step combined; the
sign-up email doesn't count here) and 10 per client per day (every email, sign-up included; over it,
the sign-up email is skipped rather than the sign-up refused), kept in one D1 table of counters
keyed by address or client address and window.

**Rationale**: verse-vault keeps these in memory in one Node process; a Worker has many short-lived
isolates, so the counts must live in D1. Better Auth's own rate limiter is per path and client, not
per address.

**Alternatives considered**: Workers KV (eventually consistent, so counts can be exceeded); Durable
Objects (more infrastructure).

## D5. Which provider sign-ins prove the inbox

**Decision**: Google proves the inbox only for an address it hosts: `@gmail.com` or
`@googlemail.com`, or a Workspace account (an `hd` claim), and only with `email_verified` true
(verse-vault D14). GitHub never proves it; only its primary verified address is used, and a sign-in
whose address the provider doesn't report verified is refused (FR-026) with a code the clients
explain.

**Rationale**: Google's guidance; the pre-hijacking study's "non-verifying IdP" route (Sudhodanan
and Paverd, USENIX Security 2022); the Nhost advisory GHSA-6g38-8j4p-j3pr on providers whose
verified flag was ignored.

## D6. The code step and the choice

**Decision**: as verse-vault D16: a refused sign-in onto an unverified password account creates a
pending row in `verification` (10 minutes), held by an HTTP-only cookie Better Auth issues on the
account routes' path; a code-step code goes to the address unless Google hosts it; then "That's me"
(password, then connect) or "That's not me" (warning, then takeover). A verified account is refused
with a message to connect from settings.

**Rationale**: OWASP: adding a sign-in method needs a session on the account; the study's
classic-federated merge needs current control of both sides.

## D7. Takeover

**Decision**: "That's not me", in one batch, connects the provider, removes the password, every
session, every other provider account the registrant linked, the account's meet memberships and
roles, returns its role to normal and verifies the address; then signs in (FR-015, FR-017). A
connection the unique index refuses (another link for that provider account won a race) fails the
whole batch, leaving the account untouched. It writes the tables directly, so no notice goes out.

**Rationale**: meet access came from codes the registrant entered; superuser must never transfer
(FR-027).

## D8. Connect and disconnect from settings

**Decision**: Better Auth's `linkSocial`, from a sign-in within the last day; the before hook
records the starting session in the OAuth state and the account create hook refuses a link whose
session has ended (verse-vault D19). Disconnect is our own route: password, a sign-in within the
last day, a password still left; it ends every other session.

**Rationale**: OWASP ASVS 5 re-authentication before linking; RFC 9700 §4.7.1 binds the state's
contents to the browser session.

## D9. What a reset does

**Decision**: in `emailAndPassword.onPasswordReset`, which runs after the password changes and
before Better Auth revokes sessions: end the sessions, disconnect every provider, cancel the
account's pending provider rows, then email the notice (FR-025, FR-028, FR-029). Each step is
guarded so a failure is logged and the reset still completes; the response tells the client when a
provider was disconnected. Signing in afterwards uses the normal password sign-in.

**Rationale**: the study's defence in depth (unlink by default, the owner keeps what is theirs by
connecting it again); OWASP's Forgot Password Cheat Sheet (notify, invalidate outstanding codes).

## D10. Notices

**Decision**: email the address when a provider joins or leaves an account, except the person's own
takeover, a new provider sign-up, and a reset (whose own notice covers it).

**Rationale**: NIST SP 800-63B-4 on authenticator changes; OWASP on linked identities.

## D11. Where the pages live (Q3, qzr)

**Decision**: the code step and the choice are portal pages (`/account/provider`), for sign-ins
started from the portal or the scoresheet's web build alike; account settings is `/account` in the
portal. Both go before the `/:slug` meet route, and `account` becomes a reserved slug.

**Rationale**: one implementation; the portal already holds the signed-in experience. The desktop
app has no provider sign-in yet (FR-024).

## D12. Test harness (Q4, qzr)

**Decision**: an API test helper that builds `createAuth` over the sql.js test database with a fake
email sender that records messages and a stubbed provider token and profile endpoint, so tests can
drive sign-up, codes, reset, the provider callback and the account routes end to end. `createAuth`
takes the database and sender as arguments instead of reading `env.DB` itself.

**Rationale**: the auth flows are the feature's risk, and qzr has no auth tests beyond config;
verse-vault's equivalent caught most of its review findings.

## D13. Account settings

**Decision**: one portal page: the address and whether it is verified, with the warning and "Send
verification code" while it isn't; Connect or Disconnect for GitHub and Google; reached from the
sign-in menu.

## D14. Constraints in the database (Q5, qzr)

**Decision**: unique `verification.identifier` (the plugin replaces a code only when creating the
new row fails on it) and unique `account(provider_id, account_id)` (so two links racing for one
provider account can't both land), both through `db:generate`. Generation fails if duplicates exist,
which they shouldn't today.

**Rationale**: verse-vault's migrations 0030 and 0031, from the same reviews.

## D16. Rate limits on sign-in (security review, 2026-11-01)

**Decision**: turn Better Auth's rate limiter on in production explicitly, with database storage,
and a tighter rule for password sign-in than its defaults.

**Rationale**: Better Auth enables its limiter only when `NODE_ENV` is `production`, which the
Worker doesn't set, and its default memory storage is per isolate, so a Worker needs it set
explicitly and stored in the database.
"That's me" and disconnect rest on the password (OWASP: limit authentication attempts). D1 storage
holds across isolates; Better Auth prunes old rows itself.

**Alternatives considered**: Cloudflare rate-limiting rules (outside the repo, plan-dependent); KV
(eventually consistent).

## D17. Origin check on the account routes (security review, 2026-11-01)

**Decision**: the account routes refuse a state-changing request from an origin Better Auth doesn't
trust, as Better Auth's own routes do.

**Rationale**: takeover needs only the pending cookie. SameSite=Lax stops other sites but not a page
on another `versevault.ca` host, and the routes read JSON whatever the content type, so a form post
would reach them (OWASP CSRF Cheat Sheet: SameSite is defence in depth). verse-vault is served from
the same origin as qzr, so no origin check can tell its pages apart; the two apps trust each other's
pages by sharing the origin.

## D18. Breached passwords (security review, 2026-11-01)

**Decision**: check new passwords (sign-up, reset and change) against the Pwned Passwords range API
in the before hook, before Better Auth handles the request; the minimum length stays 8 (clarified
2026-11-01). Only the first 5 characters of the password's SHA-1 are sent, and when the service
can't be reached the request fails rather than accepting the password unchecked.

**Rationale**: NIST SP 800-63B-4 requires checking new passwords against compromised lists. An
outage only delays a sign-up or reset.

**Alternatives considered**: Better Auth's `haveIBeenPwned` plugin, which principle VII would
prefer, checks while hashing; a reset by code has spent its code by then, so a refused password
would cost the person a new code and one of their 3 emails an hour. The check is a dozen lines.

## D15. Known limits, accepted

* A Workspace account on a domain that changed hands counts as Google-hosted.
* Desktop GitHub and Google sign-in is out of scope (FR-024); when built it needs a loopback
  redirect on `127.0.0.1`, PKCE and `state`, the callback handled in the browser, and a one-time
  token for the app (RFC 8252).
* Emailed codes prove the inbox only; they are never a second factor (NIST SP 800-63B-4).
* A reset keeps the account's meet memberships and roles (decided 2026-11-01): clearing them on an
  unverified account would match "That's not me", but would also cost a real owner who forgot their
  password before verifying their meet access. Meet access came from codes, and the reset notice
  tells the owner what happened.
* The takeover checks the account is still unverified, then writes; someone verifying in between
  must also hold the inbox, so both have proven it.
* A connection the callback makes by hand stores no provider tokens; the app never uses them.
* Anyone can use up an address's 3 emails an hour by requesting resets for it from several networks,
  holding back the owner's code for that hour (decided 2026-11-01): the usual trade-off of a
  per-address limit, which also keeps the inbox from being flooded. A bot challenge on the forms
  (Cloudflare Turnstile) would make it costly; it's on the ROADMAP.
