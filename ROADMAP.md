# Roadmap

Active work and planning happens in
[GitHub Issues](https://github.com/TommyAmberson/qzr-sheet/issues). This file is a high-level
pointer in suggested build order. See `CHANGELOG.md` for what has shipped, and the user-facing
`apps/web/src/views/RoadmapView.vue` for the public feature-status page.

## Suggested order

1. [#7 Results submission](https://github.com/TommyAmberson/qzr-sheet/issues/7) — officials submit
   completed scoresheets to the server; standalone, foundational for stats and schedule linkage
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
3. [#6 Load teams from schedule](https://github.com/TommyAmberson/qzr-sheet/issues/6) — blocked by
   #12
4. [#8 Stats calculator](https://github.com/TommyAmberson/qzr-sheet/issues/8) — blocked by #7
5. [#10 Guest access](https://github.com/TommyAmberson/qzr-sheet/issues/10) — no-account code entry
   for officials and viewers
6. [#11 Quizzer identity linking](https://github.com/TommyAmberson/qzr-sheet/issues/11) — persistent
   identity layer so stats can span multiple meets

## Backlog (independent, any time)

* [#1 Tablet-optimized touch targets](https://github.com/TommyAmberson/qzr-sheet/issues/1)
* [#2 Custom question type dropdown](https://github.com/TommyAmberson/qzr-sheet/issues/2)
* [#3 Print-friendly layout](https://github.com/TommyAmberson/qzr-sheet/issues/3)
* [#4 Code signing for desktop installers](https://github.com/TommyAmberson/qzr-sheet/issues/4)
* [#5 Auto-updater for desktop app](https://github.com/TommyAmberson/qzr-sheet/issues/5)
