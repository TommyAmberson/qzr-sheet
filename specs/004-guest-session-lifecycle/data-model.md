# Data model: Guest session lifecycle

No D1 table or column changes. What changes is the guest token's claims and the guest state the two
apps keep in the browser.

## Guest token (server, `packages/api/src/lib/jwt.ts`)

Unchanged: HS256, issuer `qzr-guest`, audience `qzr-api`, 24 hours, `meetId`, `role`.

| Claim     | Viewer token                    | Official token                         |
| --------- | ------------------------------- | -------------------------------------- |
| `label`   | absent                          | room name (kept for released clients)  |
| `roomId`  | absent                          | room id                                |
| `codeTag` | **new**: tag of the viewer code | tag of the room's code hash (as today) |

The two tags use different prefixes under the same server secret, so neither can stand in for the
other.

**Current** (research R1): a token is current only when its tag matches the code of what it was
issued for now: the meet's viewer code, or the hash of the room's code with the room still in that
meet. A token that isn't current is treated as absent, so the request is anonymous. A token without
a tag is never current.

## Guest join answer (`POST /api/join/guest`)

Adds `room` for a room code; see [contracts/api.md](./contracts/api.md).

## Guest account (browser, `localStorage` key `qzr-guest-session`, shared by both apps)

The device's guest sessions together, acting as a temporary account waiting for an upgrade.

```ts
{
  active: number | null      // meet whose token is sent when a request names no meet
  joined: GuestSession[]     // at most one per meet
}
```

### Guest session

| Field      | Viewer          | Official                     | Notes                                        |
| ---------- | --------------- | ---------------------------- | -------------------------------------------- |
| `token`    | yes             | yes                          | the guest token                              |
| `meetId`   | yes             | yes                          |                                              |
| `meetName` | yes             | yes                          |                                              |
| `role`     | `viewer`        | `official`                   |                                              |
| `code`     | the viewer code | **never**                    | kept so the session can renew and upgrade    |
| `room`     | absent          | `{ id, name }` from the join | **new**; shown in the meet picker and portal |

Validation on load: a session without `token`, `meetId`, or `meetName` is dropped, as today. An
official session saved by an earlier release loses its `code` and keeps the rest, and the cleaned
state is saved at once; its `room` is unknown until it next joins, and the apps fall back to the
role alone.

### Transitions

```
          join with code (not signed in)
(none) ───────────────────────────────► session
                                            │
 renew: viewer re-joins from its code;      │ token refused, or known expired
 official asked for the room code ◄─────────┤
                                            │
 Leave, sign out, a rejected renewal ───────┼──► removed
                                            │
 sign in: redeemed into the account ────────┴──► removed (now a membership)
```

## Device data cleared on sign-out

Besides the guest account: the scoresheet's team-name lists (`qzr-team-names`) and its remembered
meet to submit to (`qzr-submit-meet`). The apps' theme and the scoresheet's own quiz and meet
session (`qzr-theme`, `qzr-sheet`, `qzr-meet-session`) are untouched; the scoresheet's sign-out
already unlinks its meet session.
