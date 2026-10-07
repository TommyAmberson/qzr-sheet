# Quickstart: Guest session lifecycle

Validation scenarios proving [spec.md](./spec.md) end to end. API changes are in
[contracts/api.md](./contracts/api.md); links and shared browser state in
[contracts/client.md](./contracts/client.md).

## Setup

```sh
pnpm install
pnpm --filter @qzr/api db:migrate:local
pnpm dev:all     # scoresheet :5173, portal :5174, API :8787
```

In the portal, sign in as an admin, create a meet with viewer code `test-meet`, two rooms, and the
phase advanced to Live. Note each room's code. Keep a second, private browser window for the guest:
the two apps share its storage, as they do in production.

## Automated checks

```sh
pnpm test:unit && pnpm type-check && pnpm lint
```

Expect new specs for: the session middleware refusing tokens that aren't current (rotated room code,
deleted room, changed viewer code, untagged token); the guest join returning the room; a guest send
naming another room refused; the guest session module (official sessions keep no code, earlier
sessions stripped on load, leave, clear on sign-out, viewer renewal, the sign-in upgrade, the
official renewal around an action); and the scoresheet's link parameters.

## Scenarios

1. **Renew after rotation (Story 1)**: As the guest, join with room 1's code in the scoresheet and
   submit a quiz. As the admin, rotate room 1's code. As the guest, submit again: the app asks for
   room 1's code, naming the meet and room. Enter the old code: refused on the dialog. Enter the new
   code: the quiz is stored without pressing Submit again. Repeat with Cancel: nothing sent, the
   quiz unchanged.
2. **Renew in the portal**: As the guest, open the meet's results in the portal (from the portal
   home's list), rotate the code as admin, then correct a quiz with the quick form: the same dialog,
   then the correction is saved.
3. **Revoked means nothing**: With a token from before a rotation, request the meet's teams
   (`GET /api/meets/:id/teams` with the old Bearer token): 401. Change the meet's viewer code as
   admin; a guest viewer's next request is refused, the app removes the session and says the code is
   no longer valid.
4. **Viewer renewal (FR-006)**: As a guest viewer, edit the stored session's token to an expired one
   (or wait it out); the next request renews from the kept code with no prompt.
5. **No room codes kept (Story 4)**: After joining with a room code in each app, inspect
   `localStorage` `qzr-guest-session`: the official session has `room` and no `code`; the viewer
   session keeps its `code`. Put an old-style official session with a `code` in storage and reload:
   the `code` is gone, the session kept.
6. **Room shown (Story 3)**: The scoresheet's meet picker and the portal home list the meet as
   official, room 1. Re-join with room 2's code: both show room 2, and the next submit is stored for
   room 2.
7. **Sign-in upgrade (Story 2)**: As a guest, join one meet as a viewer and another with a room
   code, then sign in to a normal account in either app. The viewer meet appears among the account's
   meets with no prompt. One dialog lists the official's room: a wrong code shows on its row; the
   right code adds the room to the account. Repeat with Skip: the session is gone and the meet can
   be joined again with the code. Sign in with Google (a page load): the same happens on return.
8. **Sign out (Story 5)**: With guest sessions, submit once (so a meet is remembered and team names
   are cached), then sign in and out in the portal. Neither app lists a guest meet, and
   `qzr-team-names` and `qzr-submit-meet` are gone. Leave one of two guest meets from the portal
   home, then from the scoresheet's picker: only that meet goes; the sheet's scores stay.
9. **Links (Story 6)**: Open `/scoresheet/?meet=test-meet`: joined, and the address bar shows the
   plain address. Open `?meet=not-a-code`: a message, address cleaned. Open it with the API stopped:
   the address keeps the code. Open a stored quiz from the portal: the link uses `meetId`, the quiz
   opens, and no guest join is attempted. Open an old `?meet=<id>&result=…&revision=…` link: it
   still opens the quiz.
10. **Released apps (FR-021)**: Send a guest official submission without `roomId` (as released apps
    do): stored for the token's room. Send one naming another room: 403.
11. **Offline (FR-008)**: Stop the API and submit as a guest official: a network error, no code
    prompt, the quiz unchanged and Save as JSON still works.
