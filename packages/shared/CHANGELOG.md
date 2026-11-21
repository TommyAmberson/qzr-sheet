# Changelog — @qzr/shared

All notable changes to the shared contract package (QuizFile schema, role enums, shared API types)
are documented here, following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`@qzr/shared` is a **contract package** — its version is a compatibility signal across consumers
(scoresheet PWA + Tauri client, web portal, API Worker). Same version everywhere means same
observable wire/state behaviour. Discipline:

* **MAJOR** — breaking changes to wire format, file format (`FILE_VERSION` bump in `quizFile.ts`),
  or shared types that consumers must adapt to.
* **MINOR** — additive changes (new optional fields, new enum values consumers can ignore).
* **PATCH** — an observable fix that leaves the contract's shape unchanged.

A pull request that changes `packages/shared/src/` bumps `packages/shared/package.json` once, in the
first commit that touches shared, with a dated entry here that later commits on the branch extend.
`tools/check-contract-versions.sh` enforces this at pre-commit and in PR CI. A refactor with no
observable effect doesn't bump: commit it with `git commit --no-verify` instead.

When consumers bump their own version, they must update their CHANGELOG's `### Bundled contract`
subsection to name the current `@qzr/shared` version. CI verifies this in each deploy workflow.

## [Unreleased]

## [1.22.0] - 2026-11-21

### Added

* `PublishedSchedule` carries the `version` read and the meet's `phase` it was read in, so a page
  holding it can tell whether a meet day naming a version and phase needs it read again

## [1.21.2] - 2026-11-21

### Fixed

* The 3rd, 4th and 5th unique-quizzer bonus counts a quizzer's first correct answer in overtime
  (`scoreTeam`). It is a team bonus, and the rulebook keeps only individual points out of overtime,
  as the quiz-out bonus already did
* `overtimeRoundsNeeded` keeps every overtime round that holds answers, even where the scoring ends
  overtime sooner, so a round played under an older rule shows as a problem to settle rather than
  dropping out of the result

## [1.21.1] - 2026-11-21

### Fixed

* `resolveBenches` fills a "New n" bench from a confirmed re-rank. A re-rank lists only its lines'
  teams, at the prelim places they held between them (7 to 12, say), but a bench was looked up by
  counting from the top, so every re-rank bench past the list's length stayed empty

## [1.21.0] - 2026-11-20

### Added

* `scheduleDayDates` and `slotTimes`: each schedule day's date, the first nearest the meet's start
  on its weekday and each later one the next on its weekday, and when each slot runs on the meet's
  clock, slots before the first day on its date, for the phone schedule's time under way
  (specs/010-meet-day FR-021); `wallClock` and `instantOf` moved from the API, which times slots by
  `slotTimes` too

## [1.20.0] - 2026-11-20

### Added

* `SettledBench` carries `teamId`, the meet team's, where the draw or the division's roster names
  one, and `BenchSources.teamIdOf` matches a name of the results against the roster, so a reader
  fills a bench by id rather than by name (specs/010-meet-day FR-023)

## [1.19.0] - 2026-11-20

### Added

* `StatsSettings.warnIncompleteTypes`: optional; false turns off the flags on a quiz and its
  quizzers whose correct answers by question type don't add up, for a meet that doesn't record
  question types. Absent, as in settings saved before it, means warned (specs/006-meet-stats FR-007)
* `warnsIncompleteTypes(settings)`: whether a meet's admins are warned, absent meaning yes, and
  `quizzerStandings` takes the same choice as `{ warnTypes }`

## [1.18.0] - 2026-11-20

### Added

* `resolveBenches`: which team sits on each bench of a division's quizzes, from where its team comes
  from and what has since been settled: a prelim rank or re-rank once its order is confirmed, a
  place in a quiz once that quiz counts, a round robin's place once all its quizzes count, ranked as
  the prelims are, ties broken the meet's way. Teams level across a bench's place in a quiz leave it
  tied; an order, or a round robin's standings, gives its teams by position even where it still
  marks them tied. With `benchKey`, `drawnTeam` (a letter bench's drawn team, which
  `scheduledQuizOf`, the scoresheet and the schedule's benches now share) and the `BenchSources` it
  reads (#16). `countingTeams` gives the teams of a division's quizzes that count, as the tables
  take them, for the benches they feed.

* `MeetDay`, `DayQuiz`, `DayResult`, `DayTeam` and `dayQuizStatus`: the meet day response, and a
  scheduled quiz's status for one reader, a stage they may not see yet hiding every quiz of it.
  `benchShown`: whether a reader may see the team settled onto a bench. `notCounted` is the status
  an admin or the quiz's official sees for one set not to count.

### Changed

* `scheduledQuizOf` takes the settled benches, so an elimination or Finals quiz is held against its
  teams once every bench is settled, rather than matched on its name alone, and a lookup that takes
  each settled team as the roster names it.

## [1.17.0] - 2026-11-19

### Added

* The ODS reader and writer, `readOds` and `fillOts` (with `odsSupportsFormat` and
  `ODS_TWENTY_ONLY`), moved here from the scoresheet so the portal reads and fills sheets the same
  way. `fflate` is now a dependency of this package.
* `createFileClient`, the API client's twin for files: it answers with the response itself rather
  than its JSON, and sends a body without a JSON content type.
* `quizFileStem` and `BLANK_IN_FILE_NAME`, the scoresheet's file name for a quiz ("D1Q3", "D_Q_" for
  a blank one), so the portal's downloads are named the same way.
* `questionsPastSheet`, the questions of a quiz past the sheet's two overtime rounds (Q27 on), which
  an `.ods` export leaves out, so a download can say so.
* `isBlankSheet`, whether a sheet holds nothing of a quiz, so the API's template check and the
  upload's refusal of a blank sheet agree.

### Changed

* `readOds` reads an "mb" marked on an empty seat, a row with no quizzer or one whose quizzer has
  left, as a no-jump on that question, which is how the app records a bonus that falls to an empty
  chair, instead of as a mark in an empty seat.
* `readOds` reads a quiz number written with a lowercase "c" in front ("cA") as that consolation
  quiz, as the sheets have no consolation box, and `fillOts` writes a consolation quiz that way, so
  an exported consolation quiz comes back as itself. A quiz lettered "C" stays as it is.

### Fixed

* `fillOts` writes a no-jump on an A or B question (`16A` to `20B`) into its question's column, as
  it does that question's answers. It left them out, so an exported sheet lost them, and its
  placements and scores could change when read back.
* `fillOts` writes nothing past the sheet's last column (Q26). An overtime past its two rounds went
  into the columns after it; `questionsPastSheet` names what is left out instead.

## [1.16.0] - 2026-11-19

### Added

* `lookAlikeQuizzers`, a division's warning of two quizzer names on one team that look like one
  quizzer spelt two ways, by the test team names use (`looksAlike`, now exported). Two names in one
  quiz are two quizzers, and never flagged.
* `AttentionItem`, everything that needs an admin's attention across a meet, and `attentionOf`, a
  division's share of it: its warnings, its quizzers listed in another number of quizzes than their
  team with the quizzes they're missing from, and its quizzes whose question types don't add up.
* `NameDismissal` and `nameDismissal`: two names an admin said are different, held folded and in a
  fixed order. `DivisionStatsInput.dismissed` leaves those pairs unflagged.
* A quiz result's teams carry, for admins in a quiz that counts, the placement points it gives
  (`placementPoints`) and the team's `errors`.

### Changed

* A standings row's line for a quiz may leave out `score` and `errors`, as the API does for a viewer
  where that stage's results show places only.

## [1.15.0] - 2026-11-19

### Added

* `DIVISION_PREFIX`, the `Div` a division's name is shown with on schedules, in labels and in its
  boxes, which `divisionName` now uses.
* `quizLabel`, a scheduled quiz's label from its division's bare name and its own name
  (`Div 2 Quiz A`), beside `quizNumber`, which reads the name back. The schedule's prelims,
  intermediates and eliminations are labelled through it.

## [1.14.0] - 2026-11-18

### Added

* The meet's stats settings: `StatsSettings`, `DEFAULT_STATS_SETTINGS` and `statsSettingsError`,
  with the moments a thing can show from (`MOMENTS`) and the first a stage's results can show from
  (`STAGE_BEGINS`). Prelims and intermediates are played without overtime unless an admin turns it
  off (FR-023d).
* `viewerHas`: what a viewer is given of a division's stats from the settings, the division's state
  and the meet's phase, with the state of each standings table; `viewersSeeStats`, the phases in
  which anyone but an admin sees stats.
* `finals` in `DIVISION_STATES`, between `elim_running` and `division_done`.
* `TIE_BREAK_ORDERS`: `divisionStandings` takes the meet's order, and ranks by total points, then
  fewest errors, with no head-to-head when the meet says so (FR-023).
* `ScoredQuiz.overtimePlayed`, and the `overtimePlayed` problem: overtime played in a prelim or an
  intermediate of a meet that plays them without it (FR-014, FR-023d).
* `divisionStats` takes the orders an admin confirmed (`ConfirmedOrder`): a confirmed prelim order
  or re-rank shows locked in as it was confirmed, with the current order beside it for admins where
  a later correction changed it, and an `orderChanged` warning (FR-019b, FR-019c).
* A stored quiz seated from an order since withdrawn is flagged (`withdrawnOrder` on the quiz and as
  a warning) until an admin keeps it.
* `incompleteTypes` on a quiz in a division's stats, where a quizzer's correct answers by type don't
  add up (FR-020a).
* `heldQuizzes`: a division's quizzes with a stage, each with whether it counts, without working the
  tables out.
* `divisionStats` takes `quizzersThrough`, so quizzer standings by stage cover the quizzes up to the
  last step confirmed (FR-018a).

### Changed

* `divisionStats` takes the meet's settings: placement points for teams level in a quiz follow the
  meet's way, whatever the quiz file carries (FR-023a), and standings and the re-rank its tie-break
  order.
* `scheduleProblems` takes what the quiz is held against as one object, as `quizProblems` does, with
  whether the meet plays its prelims without overtime.

### Removed

* `ScoredQuiz.formula`: placement points follow the meet's way of scoring level teams, not the
  file's, so nothing reads it. Kept scores are made again by this version.

## [1.13.0] - 2026-11-17

### Added

* `bareDivision`, a division's name as typed, without a prefix typed before it (`Div 2`,
  `Division 2` and `D2` are all `2`), `divisionTitle`, a division shown on its own (`Division 2`),
  and `findDivision`, the division of a list a name is, as the list spells it

### Changed

* `divisionName` adds `Div` to a division's bare name, even one already starting with it, so a
  division saved with its prefix by mistake shows as `Div Div 2`
* `sameDivision` ignores case and spacing only: `Div 2` is no longer division `2`, so a division
  saved with its prefix by mistake shows as one the meet doesn't have
* A schedule's divisions are named bare: quiz labels (`Div 2 Quiz 16`, `Div 2C Quiz I`) and a room's
  divisions add the prefix to the name

## [1.12.0] - 2026-11-15

### Added

* `scheduledStage` and `storedStage`: the stage the schedule gives one of its quizzes (a bracket's
  deciding quiz is its Finals, a quiz on a line an intermediate), and a stored quiz's stage from the
  admin's choice, else its linked scheduled quiz, else its counting record; with `STAGE_CHOICES`,
  `StageChoice` and `StageFrom`
* `quizProblems`, with `rosterProblems` and `scheduleProblems`: everything wrong with a stored quiz.
  Beside the scoring problems, a team or quizzer not on the roster of the quiz's division (with the
  nearest roster name), a team listing more quizzers than its roster, a roster quizzer missing from
  the quiz, a linked quiz whose name or teams differ from its scheduled quiz's, and an elimination
  or Finals left level with no overtime. `QuizProblem` is now the union of all three kinds
* `teamNamed` and `teamsNearName`, with `RosterTeam`: the comparison of a typed team name with a
  roster's, by full name, then short name, then with punctuation set aside, as the scoresheet makes
  it when a meet is linked, so the sheet and the server match alike
* `resultKeyName`, the name a result key gives its quiz; `LINK_HOWS` and `CHANGE_KINDS`, how a
  stored quiz came to be linked and the kinds of decision about it; and `sameDivision`, whether two
  names are one division however each is written (`2`, `Div 2`)
* `mayChangeQuizzes`: whether stored quizzes may change in a meet phase, by an admin or not; the API
  refuses by it and the portal hides controls by it
* `scheduledQuizOf`: a quiz of the schedule as stored quizzes are held against it, with the teams
  its draw letters name, or none where a seat is filled from a rank or another quiz's result
* `divisionStats` takes each quiz's stage, link and acceptance, the division's roster, and whether
  the schedule has later stages, and gives: quizzes of every stage, a quiz in error under review
  until accepted and then marked `accepted`; the re-ranked order of the teams that played an
  intermediate (`rerank`), by prelim placement points plus the intermediate's, within the ranks they
  held; a bracket's first three from its one decided Finals (`medals`), with a `twoFinals` warning
  where it has more; finalists marked only where prelims lead straight to a Finals; and roster teams
  and quizzers under the roster's names, so a team written by its short and its full name is one row

### Changed

* A team with no name and no quizzer named is the empty seat of a two-team quiz: no roster error,
  and a two-team quiz matches a scheduled quiz seating two teams
* A quiz whose division has no teams on the meet's roster gets one `divisionNotOnRoster` problem,
  not one for every team
* The re-rank breaks ties among the intermediate's teams alone
* A quiz accepted as scored while its teams are still level in an unplayed overtime is placed by its
  scores as they stand, the level teams sharing the place; `placeKey` is exported for it
* The re-rank after an intermediate gives teams it separates places of their own, though they were
  level in the prelims
* `divisionStandings` takes quizzes that are already placed: `CountedQuiz` is a name and its teams,
  with no `placed` flag, and the `unplaced` warning is gone, since a quiz in error never reaches it.
  It takes `{ finalists }`, off where the quizzes do not lead straight to a Finals
* `scheduleProblems` and `quizProblems` take the quiz's own name as a result key
* `STAGES` and `Stage` moved from the division stats module to the stages module; both are still
  exported from the package

## [1.11.0] - 2026-11-14

### Added

* `scoreStoredQuiz` and `ScoredQuiz`: what scoring makes of one stored quiz file, for keeping beside
  a stored revision. The quiz's name; per team its name, score, score before overtime, errors and
  place by score; per named quizzer the points, errors, correct answers and correct answers by
  question type; the quiz's own placement formula; and every scoring problem, each validation error
  with its team, quizzer, question and code, the unanswered questions, and a tie left undecided in
  an overtime not played out. It holds no placement points, since a meet's settings decide those
* `assessStoredQuiz`: the one pass over a stored quiz that `quizOutcome` and `scoreStoredQuiz` both
  read
* `divisionStats`, with the response types the stats API sends (`DivisionStats`, `StageResults`,
  `QuizResult`, `TeamTable`, `StatsWarning`, `QuizRef`, `QuizProblem`, `Stage`): a division's
  quizzes by stage and its prelim standings, read from scored quizzes with placement points worked
  out from each team's place and score
* `quizzerStandings`, with `QuizzerList`, `QuizzerStanding` and `QuizzerFlag`: a division's quizzers
  ranked by average, total points over the quizzes their team played, then fewest errors, level
  quizzers sharing a place; the quizzers of consolation teams ranked apart; flags for a quizzer
  listed in a different number of quizzes from their team and for question types that don't add up.
  `divisionStats` gives it as `quizzers`, a `QuizzerTable`, over every counting quiz but a Finals
* `mostUsedSpelling` and `countSpelling`, the spelling a name is shown under and its tally, which
  the team standings already used
* `incompleteQuestions`, the questions of a range not yet filled out, which `questionsComplete` now
  reads; `placeRank` and `placeTieCount`, which read a `PlaceKey`; `byNumber`, the order quiz and
  division names are listed in; and `resultKeyDivision`, the division a result key names

## [1.10.0] - 2026-11-12

### Added

* `OutTally` with `newOutTally`, `countTowardsOut`, `isQuizzedOut`, `isErroredOut`, `isFouledOut`
  and `hasLeftBench`, and the thresholds `ERRORS_TO_ERROR_OUT` and `FOULS_TO_FOUL_OUT`: the one
  count of a quizzer's marks towards going out, which `scoreTeam`, `validateCells` and the ODS
  reader now share
* `QuizzerScoring.out`, a quizzer's `OutTally`: the correct answers, errors and fouls the bench
  counts, overtime included, beside the regulation-only `correctCount`, `errorCount` and `foulCount`
* `QuizzerScoring.teamQuizoutBonus`, whether the team got the quiz-out bonus for the quizzer, and
  `QuizzerScoring.leftBenchAfterCol`, the column where they errored or fouled out, which is later
  than `outAfterCol` for a quizzer who quizzed out first

### Fixed

* Overtime answers count towards quizzing, erroring and fouling out, in `scoreTeam` and in
  `validateCells`' `QuizzerOut` check. They were skipped, so a third error, a fourth correct answer
  or a third foul in overtime left the quizzer in. A quiz-out in overtime with no errors gives the
  team the +10 quiz-out bonus, and a foul-out in overtime costs the team 10. The quizzer's own
  points and counts still leave overtime out (#165)

## [1.9.0] - 2026-11-11

### Added

* `MEET_PHASES` gains `review`, between `live` and `done`: quizzing is over and the admin checks and
  corrects results before the meet is locked (#117). A consumer that lists or orders phases picks it
  up from the array; one that compares against `'live'` or `'done'` by name should check whether
  `review` belongs with either.

## [1.8.0] - 2026-11-11

### Added

* `ScheduleSettings.finals.consolation`, optional: `'withFinals'` runs consolation lanes' Finals in
  the Finals slots, `'inLane'` in their lane's rooms. Unset, it follows the division count as before
  (FR-019a). `consolationFinalsWithFinals(settings)` says which applies.

### Changed

* `generateSchedule` gives the prelims the fewest rows that hold them, rather than starting a
  weekend at 8, so a division borrows a smaller division's room once that one is done: Nov 2021 (5
  and 22 teams in 4 rooms) and Nov 2022 (8 and 27 in 5) take 7 prelim rows, as those meets did
  (FR-019).

## [1.7.1] - 2026-11-04

### Changed

* `generateSchedule` no longer skips a slot after an intermediate: the quizzes using its results run
  in the very next row (FR-028a). The intermediate's row is longer by `totallingMinutes`, whose
  default is now 0, since the app totals the results. `buildFrame` takes the elim slots holding an
  intermediate.

### Removed

* Warning W-3: any time to total sits inside the intermediate's own row, so a `New n` quiz in the
  next row is soon enough, and H-12 still orders it after the intermediate.

## [1.7.0] - 2026-11-04

### Added

* `schedule/`: the schedule builder's pure logic, starting with the rule book's prelim draw tables
  for 4 to 21 teams (`PRELIM_DRAW_PATTERNS`, `getPrelimDraw`), moved here from the portal so the
  builder, the API and the readers share them.
* The schedule document (`ScheduleDocumentSchema`, `SCHEDULE_FILE_VERSION` 1) and its file codec
  (`serializeSchedule`, `parseScheduleFile`, `NewerScheduleFileError`, `newScheduleDocument`):
  settings, frame rows, rooms, quizzes with their seats and pins, and the draw, in one versioned
  JSON document. When linked to a meet it names the meet, its time zone, and each room's meet room.
* The schedule conflict check (`checkSchedule`): every hard rule and warning of
  `docs/schedule-invariants.md` that a schedule breaks, by rule ID with the quizzes involved and a
  reason; `resultName`, the name a schedule quiz's results are saved under (W-5); and
  `scheduleQuizMeta`, the scoresheet's division, consolation flag and quiz number that make it.
* Name helpers: `ordinal`, `quizNumber` (a quiz's own name, its label's last word) and
  `teamDisplayName` (`Grace 2`), and the `PublishedSchedule` response type.
* `DIVISION_COLOURS` and `divisionColour`: a division's colour, chosen from a named palette or taken
  by its place.
* `replaceElims`: divisions' elims placed again where the generator would, around everything else.
* `recommendedRooms`: the fewest rooms, at least 3, that fit a schedule's prelims.
* `lateCounts`, `lateLetters` and the `lateTeams` setting: whether late marks count at all, off by
  default, and a division's late letters when they do.
* `cellMoves`, how many quizzes a change moves, and `lineRanges`, the ranks each line's intermediate
  plays.
* `WEEKDAYS`: the day names day rows use, shared by the builder and the old-table conversion.
* `laneName`: the name a lane's quizzes go by (`Div 2C`), for renaming a quiz by hand.
* `resultKey`: the key a meet stores a quiz's results under, which `resultName` now returns too.
* `elimsForCount` and `setTeamCount`: a division's elims for a new team count, keeping elims the
  director changed with the last lane taking the difference, and the one way to change a count.
* Events in the schedule document (`ScheduleEvent`), each in a slot over any rooms or all of them,
  and `eventCells`, the cells they take, with `eventRooms`.
* `drawPrelims`: a division's prelim quizzes as letters from either draw source, the rule book's
  tables for 4 to 21 teams or the rotating draw (no rematches from 7 teams up, any size to 90 and
  beyond), with 6 quizzes per team as two rounds that avoid repeating pairings.
* `buildFrame` and `defaultRoomCount`: the Weekend and One day frame presets, with their events, and
  as many slots as a schedule needs, and the fewest rooms (at least 3) that fit its prelims.
* `placePrelims`: where each prelim quiz goes. Each division takes a block of adjacent rooms in
  division order, sized by its share of the quizzes, packed from its first slot with no team twice
  in a slot; a division that doesn't fit borrows only as many of other rooms' latest free cells as
  it needs, and what fits nowhere is left unplaced with the reason.
* `defaultElims` and `buildElimQuizzes`: a division's elims by its size, as the org's meets ran them
  (lanes stacked down the ranks, a rerank XY across the line below the main lane), built from the
  bracket library for 5 to 12 and 14 teams, with consolation letters continuing the main lane's and
  each lane's deciding quiz called a Finals or named as its next letter.
* Elim settings in full: intermediates of one to four quizzes (X, XY, XYZ, WXYZ), reranking or
  play-in, on any line between lanes, with a window that slides (`defaultAbove`); round-robin lanes
  of 1 to 3 quizzes each with an optional Finals on points; the 10, 11 and 14-team brackets and the
  rule book's Brackets A to C, chosen per lane; lane labels of their own and lettering that
  restarts; and placeholder quizzes for a lane size with no bracket.
* `generateSchedule`: a whole schedule from its settings: frame, rooms, prelims, each division's
  stats break, elims in its own rooms with time to total an intermediate, and Finals one at a time
  in Room 1, highest division first, each consolation's just before its division's.
* `reflowSchedule`, `unappliedSettings` and `applyMoves`: re-flow a schedule to its settings around
  every pinned quiz, which keeps its cell, label and seats; list the settings the grid wasn't built
  with, with their applied values; and count what Apply would move. Generated slots and events carry
  ids by what they are for, so a pinned quiz keeps its slot when the frame is rebuilt, and frame
  rows can be pinned too.
* `sheetRows`, `seatText`, `roomDivisions` and `formatClock`: a schedule laid out as the printed
  sheet, each seat's text in letters or drawn teams, and the divisions using each room.
* `drawDivision` and `clearDraw`: a division's draw, every team one letter, late teams given letters
  that share quizzes and start as late as can be, the rest at random; the schedule never changes.
* `sortPrelims`: prelims placed again with drawn late teams' quizzes in the latest cells, in any
  room; across rooms, each division keeps a block of adjacent rooms whose edge moves at most once,
  so no room switches division and back. Pinned quizzes stay unless included.
* `basicRows`: the basic schedule, each run of quiz slots collapsed into one "Quizzing" row.

## [1.6.0] - 2026-10-31

### Added

* The auth client gains the email-code plugin, with `requestPasswordReset` and `resetPassword` for
  "Forgot password?", and `sendVerificationCode` and `verifyEmail` for the address check after
  sign-up and in account settings (spec 005).
* `codeErrorMessage` turns a failed code request into a message for the person, never a raw error,
  and `providersDisconnectedBy` reads the GitHub and Google sign-ins a password reset disconnected.
* `connectedProviders`, `connectProvider` and `disconnectProvider` in the auth client, for account
  settings, and `socialSignInError` explains why connecting GitHub or Google failed.
* `pendingProvider`, `confirmProviderCode`, `resendProviderCode`, `claimProvider` and
  `takeOverAccount` in the auth client, for the code step and the "That's me" or "That's not me"
  choice after a GitHub or Google sign-in onto an unverified account, with the `PendingProviderStep`
  and `AccountError` types.
* `signInSocial` returns the result of a refused start (a rate limit, say) instead of nothing.
* `signUpCodeSkipped` reads a sign-up response whose verification code the daily limit skipped.
* `effectiveAccountRole`, an account's role as every check reads it: superuser only on a verified
  address, shared by the API and the portal.
* `SOCIAL_PROVIDERS`, `SOCIAL_PROVIDER_LABEL` and `isSocialProvider`, the one list of GitHub and
  Google with their labels, and `tooManyRequestsMessage` for an email limit's message.

### Changed

* `socialSignInError` explains `sign_in_with_provider`, an account that signs in only with GitHub or
  Google (opening the email form, where "Forgot password?" sets a password), and
  `provider_email_unverified`, a sign-in refused because the provider doesn't report its address
  verified, and its `account_not_linked` message points to connecting from account settings.

## [1.5.0] - 2026-10-04

### Added

* `divisionStandings` warns of look-alike team names (`lookAlike`): two names in the division within
  one edit of each other once folded for case and spaces, or two edits when both are at least six
  characters long. Names ending in different numbers or letters, such as "Calgary 1" and "Calgary
  2", or "Regina A" and "Regina B", are never flagged
* `editDistance`, the number of single-character edits between two strings, which the standings and
  the scoresheet's quizzer matching share
* `tidyName` is exported, so the API stores team names as the standings show them
* `DivisionTeamNames`, the shape of a meet's team names list on the wire

## [1.4.1] - 2026-10-03

### Fixed

* **15-question quizzes** - A/B questions begin at 12, not 11, and error points and 10-point bonuses
  at 13, not 12: a quizzer's first error on Q12 is free, a Q12 bonus is worth 20, and timeouts are
  allowed through Q12. A stored quiz with answers on 11A or 11B flags them as orphaned

## [1.4.0] - 2026-10-02

### Changed

* `serialize` takes what `deserialize` returns, quizzes without an `id` and teams without a
  `quizId`, which it never used, so a stored quiz file can be read, edited and written back.

## [1.3.0] - 2026-10-02

### Added

* `divisionStandings`, which ranks a division's teams by placement points over its counted quizzes,
  breaking ties by head-to-head, then total points, then fewest errors, and marks the finalists,
  with warnings for unequal quiz counts, quizzes that can't be placed, and a tie at the finalist
  cutoff.
* `foldName`, which folds a name for case and spaces, so the standings and the API's quiz names
  match names the same way.
* `quizName`, a quiz's name as officials know it ("D1 Q3", or "D1c Q3" in consolation), moved from
  the API so the portal names quizzes the same way.

## [1.2.0] - 2026-10-02

### Added

* `quizOutcome`, which scores and places a stored quiz from its file exactly as the scoresheet shows
  it: each team's score, place, placement points and error count, or that it can't be placed yet.
  With it, `overtimeRoundsNeeded` and `emptySeatKeys`, which the scoresheet now uses too.
* `isQuizFile`, which checks a value is exactly a quiz file without converting loose values, so the
  API stores only files that read back as they were checked.
* `ApiError.body`, the whole body of an error response, for errors that carry more than a message.
* `RESULT_ACTIONS`, how a revision of a stored quiz was saved, for the API's table and the portal.

## [1.1.0] - 2026-10-02

### Added

* The scoresheet's scoring, moved here unchanged so the portal and API can score stored quiz files:
  `scoreTeam`, grey-out, validation, overtime, placement and column visibility, the per-format
  `quizRules`, the scoresheet's column and quiz types (`buildColumns`, `Column`, `Quiz`, …), and the
  branded index types.
* Quiz file reading and writing, moved from the scoresheet: `serialize`, `deserialize`,
  `parseQuizFile`, `parseQuizFileAttempt`, `fileVersionFor` and `NewerFileVersionError`, so the API
  can validate submitted files the way the scoresheet does.
* `buildCellGrid`, which lays a quiz's answers out as the `cells[team][seat][col]` grid the scoring
  functions read, with `inSeatOrder`, `answerKey` and `answerLookup` for the order and lookup it
  uses.
* `assessQuiz`, which validates a quiz and places it once it can be placed, taken out of the
  scoresheet so a stored quiz is placed exactly as the sheet shows it, and `isTimeoutAllowed`.

## [1.0.0] - 2026-10-01

### Added

* `QuizFormat` enum (`'20-question'`, `'15-question'`) and an optional `quiz.format` field on
  `QuizFile`. A missing format means a 20-question quiz.

### Changed

* **Breaking:** `FILE_VERSION` is now 3 and the schema accepts versions 1, 2, and 3. A file is
  stamped with the version needed to read it: 20-question quizzes stay version 2, so readers of
  0.10.x and earlier keep opening them, while 15-question quizzes are version 3 and carry
  `quiz.format`. Readers of 0.10.x and earlier refuse version 3 files rather than opening them as
  20-question quizzes.

## [0.10.0] - 2026-10-01

### Added

* **`socialSignInError()` / `withoutErrorParam()`** - read and strip the `?error=` a failed GitHub
  or Google sign-in comes back with. `account_not_linked` (since better-auth 1.6.11, a social
  sign-in refuses to merge into an existing account whose email is unverified, which our password
  accounts always are) is reported as an existing account, so the UI can point the user at email
  sign-in

### Changed

* **`signInSocial` passes `errorCallbackURL`** - a failed social sign-in now returns to the page it
  started on, with `?error=`, instead of Better Auth's error page on the API

## [0.9.2] — 2026-05-21

First per-package release after the per-package deploys cutover. No source changes since v0.9.1
(unified tag) — bumping to establish the per-package baseline so consumer changelogs have a contract
version to reference under `### Bundled contract`. Future entries here document wire/state changes.
