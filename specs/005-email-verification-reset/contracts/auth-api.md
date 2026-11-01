# Contract: Auth API Additions

Base: `/qzr/api` in production, the root locally. Added to `docs/auth.md`.

## Better Auth routes (email-code plugin)

| Route                                             | Body                                    | Result                                                                                                         |
| ------------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `POST /api/auth/email-otp/request-password-reset` | `{ email }`                             | always `{ success: true }`; emails a reset code if the address has an account (FR-002)                         |
| `POST /api/auth/email-otp/reset-password`         | `{ email, otp, password }`              | `{ success: true }`, plus `providersDisconnected: [...]` when the reset disconnected GitHub or Google (FR-025) |
| `POST /api/auth/email-otp/send-verification-otp`  | `{ email, type: 'email-verification' }` | sends a verification code; signed in to that account only                                                      |
| `POST /api/auth/email-otp/verify-email`           | `{ email, otp }`                        | verifies the address; only for a session on that account (FR-007)                                              |
| `POST /api/auth/link-social`                      | `{ provider, callbackURL }`             | Better Auth's; needs a sign-in within the last day                                                             |

Sign-up with a password sends a verification code (FR-006). A new password found in a list of
breached passwords, at sign-up, reset or `/change-password`, is refused with `PASSWORD_COMPROMISED`,
or 503 when the check can't be made (FR-032). Sign-in, reset and code entry past their rate limits
answer 429 (FR-030). Code errors return the plugin's codes, which the shared error module maps to
messages (FR-010).

## Provider callback outcomes

The callback redirects to the client's error URL with `error=`:

* `provider_email_unverified`: the provider didn't report the address verified (FR-026).
* `account_not_linked`: refused onto a verified account; sign in with the password and connect from
  settings (FR-013).
* On an unverified password account: to the portal's `/account/provider` with a pending cookie
  instead (FR-015), with `?limited=address` or `?limited=network` when an email limit stopped the
  code-step email.

Connecting from settings (`/link-social`) comes back to account settings with `error=` instead:

* `verify_email_first`: the account is unverified and the provider doesn't prove the inbox.
* `account_already_linked_to_different_user`: that provider account belongs to another account.
* `email_doesn't_match`: the provider account uses another address.
* `provider_email_unverified`: as above.

## Account routes (new)

| Route                                 | Needs                                               | Result                                                      |
| ------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------- |
| `GET /api/account/provider`           | pending cookie                                      | the step (`code` or `choice`), the provider and the address |
| `POST /api/account/provider/confirm`  | pending cookie, `{ code }`                          | proves the inbox; then the choice                           |
| `POST /api/account/provider/resend`   | pending cookie                                      | a new code-step code, under the limits                      |
| `POST /api/account/provider/claim`    | pending cookie, session on that account             | "That's me": connects the provider                          |
| `POST /api/account/provider/takeover` | pending cookie, proven                              | "That's not me": FR-015, then signed in                     |
| `POST /api/account/disconnect`        | session from the last day, `{ provider, password }` | FR-018                                                      |

A request that changes anything from an origin Better Auth doesn't trust is refused with 403 and
changes nothing (FR-031).

Every route answers a used, expired or unknown pending cookie the same way, 400 with
`code: 'PENDING_INVALID'`, revealing nothing about the account (FR-016). The code step answers a
wrong code with `INVALID_OTP` and the third with `TOO_MANY_ATTEMPTS`, which ends the sign-in.
Disconnect answers `SESSION_NOT_FRESH`, `INVALID_PASSWORD` or `FAILED_TO_UNLINK_LAST_ACCOUNT`.
Limited requests answer 429 with a message to try later (FR-011).
