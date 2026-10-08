# Contract: links and shared browser state

What the scoresheet and the portal agree on with each other, and with releases already installed.

## Scoresheet links

| Link                                        | Means                                | Who builds it             |
| ------------------------------------------- | ------------------------------------ | ------------------------- |
| `?meet=<viewer code>`                       | join the meet as a guest viewer      | admins, shared by hand    |
| `?meetId=<id>&quiz=<id>`                    | open a scheduled quiz (**new name**) | portal `ScheduleView.vue` |
| `?meetId=<id>&result=<id>&revision=<n>`     | open a stored quiz (**new name**)    | portal `ResultView.vue`   |
| `?meet=<id>&quiz=…` / `?meet=<id>&result=…` | the same, in links already shared    | earlier portal releases   |

* `meet` is read as a viewer code only when neither `quiz` nor `result` is present and the value
  isn't digits only.
* After a viewer link's join succeeds or the server rejects its code, `meet` is removed from the
  address without a reload; a network failure leaves it. Quiz links are cleared after loading, as
  today.

## Guest account in `localStorage`

Key `qzr-guest-session`, shape in
[data-model.md](../data-model.md#guest-account-browser-localstorage-key-qzr-guest-session-shared-by-both-apps).

* Both apps read and write it through the guest session module in `packages/ui`.
* Released scoresheets (desktop, Android, and installed PWAs not yet updated) may still write an
  official session with `code` and without `room`. Current apps strip the `code` on load and fall
  back to the role when `room` is missing.
* A released app reading a current official session finds no `code`, which it only ever used to
  reuse a `?meet=` session, so nothing breaks.

## Device data cleared on sign-out

`qzr-guest-session`, `qzr-team-names`, `qzr-submit-meet`, by whichever app signs out. The keys are
owned in `packages/ui` so both apps clear the same set.

## Dialogs both apps show

One component from `packages/ui`, the same in both apps, used two ways:

* **Room code needed**: names the meet and, when known, the room; a code field, Cancel, and a
  message on a wrong code or a code for another meet (FR-001 to FR-005).
* **Add your rooms to your account**: after sign-in, one row per guest official session (meet and
  room), each with a code field and Skip, and Done (FR-012).
