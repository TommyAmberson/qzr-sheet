# Roadmap

Active work and planning happens in
[GitHub Issues](https://github.com/TommyAmberson/qzr-sheet/issues). This file is a high-level
pointer in suggested build order. See `CHANGELOG.md` for what has shipped, and the user-facing
`apps/web/src/views/RoadmapView.vue` for the public feature-status page.

## Suggested order

Results (#7, specs/003-practice-meet-results), the schedule builder (#9,
specs/005-schedule-redesign) and stats (#8, specs/006-meet-stats) have shipped: submitting and
uploading, standings, corrections with history, generation from team counts with pins, the draw,
elim lanes, linked publishing with versions, quizzer standings, stages and the re-rank, what viewers
see and when, results management, and the statistician's report and download. Meets move between
LibreOffice sheets and the app in both directions (#52, specs/009-ods-round-trip): sheets upload in
bulk, matched to the schedule, and quizzes download as files or spreadsheets from the meet's own
template. A meet is one page in tabs (specs/010-meet-day): its schedule with results as they come in
and elimination benches filling with the teams that earned them (#16), on the schedule and in the
scoresheet that opens them, its quizzes, standings, roster and setup, kept current while open.
Officials see every result and standing as admins do; the viewer settings are for viewers and
coaches.

1. Real data to check stats against:
   [#116 Store score-only quiz results](https://github.com/TommyAmberson/qzr-sheet/issues/116)
2. [#117 Add a review phase between live and done](https://github.com/TommyAmberson/qzr-sheet/issues/117),
   with [#154 Dispute quiz results](https://github.com/TommyAmberson/qzr-sheet/issues/154)
3. [#11 Quizzer identity linking](https://github.com/TommyAmberson/qzr-sheet/issues/11) — persistent
   identity layer so stats can span multiple meets

## Bugs

* [#96 Enforce phase-based coach permissions](https://github.com/TommyAmberson/qzr-sheet/issues/96)
* [#92 Keep recovery copies until a save succeeds when storage is full](https://github.com/TommyAmberson/qzr-sheet/issues/92)

## Schedule builder follow-ups

* [#134 Name and letter schedule lanes as meets do](https://github.com/TommyAmberson/qzr-sheet/issues/134)
* [#135 Build one-day meets in the schedule builder](https://github.com/TommyAmberson/qzr-sheet/issues/135)
* [#136 Fill every prelim row as the meets' draw tables do](https://github.com/TommyAmberson/qzr-sheet/issues/136)
* [#137 Choose where consolation Finals run](https://github.com/TommyAmberson/qzr-sheet/issues/137)
* [#138 Smaller schedule builder options](https://github.com/TommyAmberson/qzr-sheet/issues/138)
* [#139 Phone layout and light theme for the schedule builder](https://github.com/TommyAmberson/qzr-sheet/issues/139)
* [#141 Record a quiz's lane in the quiz file and results](https://github.com/TommyAmberson/qzr-sheet/issues/141)
  — only needed once a division has two consolation lanes that each letter from A
* [#142 Remove the old schedule tables and routes](https://github.com/TommyAmberson/qzr-sheet/issues/142),
  and drop `quiz_results.room_id` with it
* [#63 Schedule viewer: richer rendering and filters](https://github.com/TommyAmberson/qzr-sheet/issues/63)

## Backlog (independent, any time)

* [#147 Phone and tablet use across the rest of the app](https://github.com/TommyAmberson/qzr-sheet/issues/147)
* [#2 Custom question type dropdown](https://github.com/TommyAmberson/qzr-sheet/issues/2)
* [#3 Print-friendly layout](https://github.com/TommyAmberson/qzr-sheet/issues/3)
* [#4 Code signing for desktop installers](https://github.com/TommyAmberson/qzr-sheet/issues/4)
* [#5 Auto-updater for desktop app](https://github.com/TommyAmberson/qzr-sheet/issues/5)
* [#153 Save a quiz to the server while it's being scored](https://github.com/TommyAmberson/qzr-sheet/issues/153)
* Cloudflare Turnstile on the sign-up and reset forms, so scripted requests can't use up an
  address's email allowance (also for verse-vault)
* [#140 Add tooltips to every control](https://github.com/TommyAmberson/qzr-sheet/issues/140)
* [#143 Investigate two-team (1v1) quizzes](https://github.com/TommyAmberson/qzr-sheet/issues/143),
  including the two-team 15-question tie-breaker (#114)
* [#122 Link to the portal from the scoresheet](https://github.com/TommyAmberson/qzr-sheet/issues/122)
* [#123 Let members leave a meet themselves](https://github.com/TommyAmberson/qzr-sheet/issues/123)

## Hardening

* [#97 Hardening: security headers, Tauri CSP, CI pinning](https://github.com/TommyAmberson/qzr-sheet/issues/97)
* [#98 Give qzr and verse-vault separate subdomains](https://github.com/TommyAmberson/qzr-sheet/issues/98)
