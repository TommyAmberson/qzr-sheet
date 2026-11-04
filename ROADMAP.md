# Roadmap

Active work and planning happens in
[GitHub Issues](https://github.com/TommyAmberson/qzr-sheet/issues). This file is a high-level
pointer in suggested build order. See `CHANGELOG.md` for what has shipped, and the user-facing
`apps/web/src/views/RoadmapView.vue` for the public feature-status page.

## Suggested order

1. [#7 Results submission](https://github.com/TommyAmberson/qzr-sheet/issues/7) — officials submit
   completed scoresheets to the server; standalone, foundational for stats and schedule linkage.
   Practice meet results have shipped (specs/003-practice-meet-results): submitting and uploading,
   standings, corrections with history, merging names, and team lists. Scheduled meets' results
   follow with #16
2. [#9 Schedule — generation, management, and views](https://github.com/TommyAmberson/qzr-sheet/issues/9)
   — admin-driven schedule builder per [docs/scheduling.md](./docs/scheduling.md), broken into
   sub-issues:
   * [#12 Schedule schema + rooms/slots CRUD](https://github.com/TommyAmberson/qzr-sheet/issues/12)
     (foundational)
   * [#13 Schedule view (read-only)](https://github.com/TommyAmberson/qzr-sheet/issues/13)
   * [#14 Schedule editor (direct manipulation)](https://github.com/TommyAmberson/qzr-sheet/issues/14)
   * [#39 Prelim draw utility](https://github.com/TommyAmberson/qzr-sheet/issues/39)
   * [#40 Schedule rule engine](https://github.com/TommyAmberson/qzr-sheet/issues/40)
   * Phase state machine + transition API (new issue, coming) — blocked by #12
   * [#15 Late-team handling](https://github.com/TommyAmberson/qzr-sheet/issues/15)
   * [#41 Post-stats-break consolation marking](https://github.com/TommyAmberson/qzr-sheet/issues/41)
     — blocked by #8
   * [#42 Elim bracket epic](https://github.com/TommyAmberson/qzr-sheet/issues/42) — blocked by #12,
     #14, #41
   * [#16 Schedule result linkage](https://github.com/TommyAmberson/qzr-sheet/issues/16) — blocked
     by #7, #12, #42

   The builder itself has shipped (specs/005-schedule-redesign): generation from team counts with
   pins, the draw, elim lanes, and linked publishing with versions. Follow-ups:
   * [#134 Name and letter schedule lanes as meets do](https://github.com/TommyAmberson/qzr-sheet/issues/134)
   * [#135 Build one-day meets in the schedule builder](https://github.com/TommyAmberson/qzr-sheet/issues/135)
   * [#136 Fill every prelim row as the meets' draw tables do](https://github.com/TommyAmberson/qzr-sheet/issues/136)
   * [#137 Choose where consolation Finals run](https://github.com/TommyAmberson/qzr-sheet/issues/137)
   * [#138 Smaller schedule builder options](https://github.com/TommyAmberson/qzr-sheet/issues/138)
   * [#139 Phone layout and light theme for the schedule builder](https://github.com/TommyAmberson/qzr-sheet/issues/139)
   * [#141 Record a quiz's lane in the quiz file and results](https://github.com/TommyAmberson/qzr-sheet/issues/141)
   * [#142 Remove the old schedule tables and routes](https://github.com/TommyAmberson/qzr-sheet/issues/142)
3. [#6 Load teams from schedule](https://github.com/TommyAmberson/qzr-sheet/issues/6) — blocked by
   #12
4. [#8 Stats calculator](https://github.com/TommyAmberson/qzr-sheet/issues/8) — blocked by #7
5. [#10 Guest access](https://github.com/TommyAmberson/qzr-sheet/issues/10) — no-account code entry
   for officials and viewers
6. [#11 Quizzer identity linking](https://github.com/TommyAmberson/qzr-sheet/issues/11) — persistent
   identity layer so stats can span multiple meets

## Backlog (independent, any time)

* [#1 Tablet-optimized touch targets](https://github.com/TommyAmberson/qzr-sheet/issues/1)
* [#147 Phone and tablet use across the rest of the app](https://github.com/TommyAmberson/qzr-sheet/issues/147)
* [#2 Custom question type dropdown](https://github.com/TommyAmberson/qzr-sheet/issues/2)
* [#3 Print-friendly layout](https://github.com/TommyAmberson/qzr-sheet/issues/3)
* [#4 Code signing for desktop installers](https://github.com/TommyAmberson/qzr-sheet/issues/4)
* [#5 Auto-updater for desktop app](https://github.com/TommyAmberson/qzr-sheet/issues/5)
* [#52 Mass results importer for backfilling real meets](https://github.com/TommyAmberson/qzr-sheet/issues/52)
  — blocked by API portion of #7
* [#114 Two-team 15-question tie-breaker quiz](https://github.com/TommyAmberson/qzr-sheet/issues/114)
* Cloudflare Turnstile on the sign-up and reset forms, so scripted requests can't use up an
  address's email allowance (also for verse-vault)
* [#140 Add tooltips to every control](https://github.com/TommyAmberson/qzr-sheet/issues/140)
* [#143 Investigate two-team (1v1) quizzes](https://github.com/TommyAmberson/qzr-sheet/issues/143)
