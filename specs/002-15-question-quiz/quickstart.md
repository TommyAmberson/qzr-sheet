# Quickstart: validating the 15-question quiz format

Run from the repository root of the feature worktree.

## Automated

```sh
pnpm test:unit     # scoring, rules, persistence, store specs (see plan.md, Testing)
pnpm type-check    # required QuizRules parameters surface any missed call site
pnpm lint
```

Expected: all pass, and the existing 20-question specs pass unmodified apart from the mechanical
`TWENTY` rules argument.

## Manual, in the scoresheet (`pnpm dev`, then open the printed URL)

1. **Start**: New menu, "New 15-question quiz". The header badge reads "15 Q"; columns run 1 to 10,
   then 11 to 15 with A/B; nothing past 15 while Overtime is off.
2. **Quiz-out**: give one quizzer 3 correct, no errors. They grey out for toss-ups; the team gets
   the quiz-out bonus.
3. **Bonus values**: team 1 errs on Q9, team 2 errs on the Q10 toss-up, team 3 answers the Q11
   bonus: +20. Then an error on Q12, an error on 12A, and 12B answered: +10.
4. **Error points**: a quizzer's first error on Q12 costs 10; a first error on Q5 costs nothing.
5. **Timeouts**: a timeout after Q11 is accepted; after Q12 the sheet refuses it with "Timeouts
   can't be called once error points begin".
6. **Overtime**: score all three teams level through Q15, switch Overtime on: Q16 to 18 appear for
   the tied teams only.
7. **Persistence**: reload the page: still "15 Q", same answers and totals. Save the file, open it:
   same. Inspect the JSON: `"version": 3` and `"format": "15-question"`.
8. **20-question files stay version 2**: New 20-question quiz, save: `"version": 2`, no `format`.
   Open it in a build from master before this feature: it loads.
9. **Older install and a 15-question file**: open the step 7 file in a pre-feature build: it refuses
   with an error rather than loading.
10. **Attempting a newer file**: edit a saved file to `"version": 99`, open it: the prompt appears.
    Decline: nothing changes. Accept: it loads with the "Opened from a newer file" badge.
11. **Resets**: on a 15-question quiz, Clear answers, Clear names, Load teams from meet or schedule,
    Ctrl+N: still "15 Q" each time. The tutorial runs on a 20-question sheet and returns to the
    15-question quiz.
12. **ODS**: on a 15-question quiz, the save menu's "Export ODS" is disabled with its tooltip.
    Importing an `.ods` produces a 20-question quiz.
13. **Newer auto-save**: in DevTools, set `localStorage['qzr-sheet:current']` to a saved quiz with
    `"version": 99` and reload. The sheet starts empty with the "auto-saved quiz from a newer
    version was kept" notice, and a `qzr-sheet:newer-autosave:<timestamp>` key holds the value
    unchanged. Score a question: the kept key is untouched. "Try to open it" runs the attempt flow,
    shows the "Opened from a newer file" warning (which survives a reload), and leaves the kept key
    in place; "Discard" removes the key after confirmation.
