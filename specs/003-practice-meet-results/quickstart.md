# Quickstart: Practice meet results

Validation scenarios proving [spec.md](./spec.md) end to end. API shapes are in
[contracts/results-api.md](./contracts/results-api.md).

## Setup

```sh
pnpm install
pnpm --filter @qzr/api db:migrate:local
pnpm dev:all     # scoresheet :5173, portal :5174, API :8787
```

In the portal, sign in, create a meet with divisions `1` and `2`, and two rooms. Note each room's
official code.

## Automated checks

```sh
pnpm test:unit && pnpm type-check && pnpm lint
```

Expect the moved scoring specs to pass unchanged from `packages/shared`, plus the new standings,
outcome, and results-route specs.

## Scenarios

1. **Submit (Story 1)**: In a private window, open the scoresheet, join with room 1's code, pick the
   meet, set division `1`, type three team names, score a quiz, and choose Submit. The portal's
   results list shows it as revision 1, submitted by room 1, not counted. Change an answer and
   submit again: warned that D1 Q1 was already submitted; save as new revision and it is still one
   quiz, now revision 2. Submit once more choosing to keep the current revision: revision 3 holds
   the submission, revision 4 restores revision 2, and the list still shows revision 2's scores.
   Choose New quiz, set quiz number 2 and submit: a second quiz.
2. **Offline submit**: Stop the API and submit. The scoresheet says it wasn't sent; the quiz is
   unchanged and Save as JSON still works.
3. **Standings (Story 2)**: Submit four quizzes in division `1` from both rooms, count them with
   select all, and open the standings. Totals, order, tie-break notes and the three finalists match
   a hand calculation. Uncount one: the standings drop it.
4. **Upload (Story 3)**: Save two quizzes as files from the scoresheet, one not yet submitted and
   one submitted in scenario 1, plus one file with its `version` edited to 99. Upload all three: the
   new one is stored as uploaded, the submitted one is reported as already submitted, with the same
   three choices, and the edited one is refused as too new.
5. **Edit and history (Story 4)**: Rename a team in the quick form; open the quiz in the scoresheet
   and fix an answer; then restore revision 1. The history lists every save with who, when and how,
   and nothing is lost.
6. **Overwritten correction**: After an admin edit, resubmit the same quiz from its room. The list
   shows the new revision number with the room as last editor; restoring the admin's revision brings
   the correction back.
7. **Merge (Story 5)**: Submit quizzes using `Calgary 1` and `Calgry 1`. The standings flag the
   pair; merge it. Each affected quiz gains a `merged` revision and the standings show one team.
8. **Team list (Story 6)**: Enter team names for division `1`. In a scoresheet joined to a room,
   those names are offered for division `1`, and a typed name is still accepted.
9. **Access**: With a viewer code, the results and standings routes refuse. An official of room 2
   submitting room 1's quiz name is warned before adding a revision. Rotating room 1's code stops
   its old token from submitting.
