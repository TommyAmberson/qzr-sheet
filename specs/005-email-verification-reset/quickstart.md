# Quickstart: Email Verification and Password Reset

## Automated

```sh
pnpm test:unit     # API auth harness: codes, reset, provider rules, choice, takeover, limits
pnpm type-check
pnpm lint
pnpm --filter @qzr/api db:generate   # clean: no pending schema diff after the migrations
```

## Local, by hand

Run `pnpm dev:all` with no `RESEND_API_KEY`: codes are logged by the API instead of sent (FR-021).

1. **Reset**: in the portal's sign-in form, "Forgot password?", the logged code and a new password:
   signed in; the old password fails; other sessions are signed out; a "password was reset" email is
   logged.
2. **Unknown address**: a reset for an address with no account answers the same and logs nothing.
3. **Verify**: sign up with a password; enter the logged code (verified), or skip and send one later
   from `/account`.
4. **Provider onto an unverified account** (placeholder GitHub credentials, or a stubbed callback):
   a code step, then the choice; "That's me" with the password connects; "That's not me" takes over
   and clears meet access.
5. **Provider onto a verified account**: refused, pointing to settings; connect from `/account`
   works.
6. **Reset with GitHub linked**: the form says GitHub was disconnected; the notice says so;
   `/account` offers Connect GitHub.
7. **Scoresheet**: the same reset and code steps in its sign-in form; offline, scoring and saving
   are untouched.

## Production, after deploy

* A reset code arrives from `no-reply@versevault.ca` and passes SPF, DKIM and DMARC.
* A Gmail account signs into its verified account; GitHub onto a verified account is refused.
