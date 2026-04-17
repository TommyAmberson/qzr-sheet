# Roadmap

Active work and planning happens in
[GitHub Issues](https://github.com/TommyAmberson/qzr-sheet/issues). This file is a high-level
pointer in suggested build order. See `CHANGELOG.md` for what has shipped, and the user-facing
`apps/web/src/views/RoadmapView.vue` for the public feature-status page.

## Suggested order

1. [#7 Results submission](https://github.com/TommyAmberson/qzr-sheet/issues/7) — officials submit
   completed scoresheets to the server; standalone, foundational for stats and schedule linkage
2. [#9 Schedule — generation, management, and views](https://github.com/TommyAmberson/qzr-sheet/issues/9)
   — round-robin scheduling, broken into sub-issues:
   * [#12 Schedule generation + schema](https://github.com/TommyAmberson/qzr-sheet/issues/12)
     (foundational)
   * [#13 Schedule view + publish](https://github.com/TommyAmberson/qzr-sheet/issues/13)
   * [#14 Schedule manual editing](https://github.com/TommyAmberson/qzr-sheet/issues/14)
   * [#15 Schedule re-generation](https://github.com/TommyAmberson/qzr-sheet/issues/15)
   * [#16 Schedule result linkage](https://github.com/TommyAmberson/qzr-sheet/issues/16) — blocked
     by #7, #12
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
