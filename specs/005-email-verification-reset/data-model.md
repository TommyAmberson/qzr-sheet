# Data Model: Email Verification and Password Reset

## Existing tables, new uses

* **user.email_verified**: false for password sign-ups, GitHub sign-ups, and Google sign-ups on an
  address Google doesn't host; true for Google-hosted sign-ups; set true by a verification code, a
  reset, or a proven provider step. A provider sign-up whose address the provider doesn't report
  verified creates no user (FR-026).
* **user.role**: returned to normal by a takeover; superuser only on a verified address (FR-027).
* **verification**: holds the plugin's codes (identifier per purpose and address) and pending
  provider sign-ins (identifier `pending-provider:<token>`, value JSON with the user id, provider,
  provider account id, address, whether the inbox is proven, and the code-step code's hash and
  tries; expires after 10 minutes). Constraint: `identifier` unique (research D14).
* **account**: a GitHub or Google row joins only by the rules in FR-013 and FR-018. Constraint:
  unique (`provider_id`, `account_id`) (research D14).
* **session**: all of a user's rows end on a reset, a takeover, and a disconnect (other sessions).
* **Memberships and meet roles**: removed for the user on a takeover (FR-015).

## New table: email limits

| Field          | Type    | Rules                                                         |
| -------------- | ------- | ------------------------------------------------------------- |
| `key`          | text    | `address:<lowercased email>` or `client:<IP>`                 |
| `window_start` | integer | start of the window, seconds; hour for addresses, day for IPs |
| `count`        | integer | emails counted in that window                                 |

Primary key (`key`, `window_start`). Rows from past windows are deleted by the existing cron.

## State: pending provider sign-in

created (code sent, or proven when Google hosts the address) → proven (code entered) → claimed
("That's me", password) or taken over ("That's not me") → deleted. Also deleted on expiry, after 3
wrong codes, and when the account's password is reset (FR-029).
