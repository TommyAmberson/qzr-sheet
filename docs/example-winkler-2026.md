# Worked example: Second Districts, Winkler MB — March 6–8, 2026

<!--
  Source: spreadsheet shared by Brad Dueck (Draw_Winkler Mar6-8-2026.ods).
  Per the spreadsheet's own header (Draw - Text sheet, R1) the meet is run
  by CMQ — a sister org of QuizMeet, predates us, runs essentially the same
  rule book with more mature tooling. Reference is intentionally kept vague
  in the doc body; identifying team data is not committed.
-->

This document walks through a real-world quiz meet draw spreadsheet shared with us by a sister
organisation, and maps every sheet, column, and concept it uses to the qzr scheduling model in
`docs/scheduling.md`.

**Context**: the spreadsheet is from a meet that predates QuizMeet, run under a nearly identical
rule book by a separate organisation that has a more mature toolset and process around scheduling.
QuizMeet spun off doing the same thing later. That's why the draw uses divisions named **A** / **C**
rather than QuizMeet's **1** / **2** / **3** — naming convention is the only structural difference.
Many of the patterns this draw uses are exactly what we're building for QuizMeet.

**This file is a source of inspiration, not a rule book.** When `docs/rules.md` underspecifies how a
meet actually runs — how to compose an elim bracket larger than 9 teams, how to handle late arrivals
in the draw, what slot pitches are realistic — look here for one well-tested answer. The rule book
always wins on any rule conflict; this doc shows one organisation's working approach to the gaps the
rule book leaves open. We are free to adapt or diverge wherever it makes sense for QuizMeet.

The spreadsheet itself is not checked in (it contains identifiable team data for an upcoming meet);
the patterns it reveals are.

## 1. Meet at a glance

| Property          | Value                                                                                |
| ----------------- | ------------------------------------------------------------------------------------ |
| Name              | "Second Districts"                                                                   |
| Location          | Winkler, MB                                                                          |
| Dates             | Friday March 6 – Sunday March 8, 2026                                                |
| Divisions         | **A** (36 teams), **C** (14 teams) — this org uses A/B/C; QuizMeet uses 1/2/3        |
| Post-prelim lanes | A→top 12, A→K (next 12), A→B (consolation 25–36), A→M (extra round-robin), C→bracket |
| Rooms             | 9 (Rooms 1–9)                                                                        |
| Prelim slot pitch | 25 min                                                                               |
| Elim slot pitch   | 30 min                                                                               |
| Finals            | 4 staggered Saturday: C Final + K Final at 3:30 pm, A Final + B Final at 4:00 pm     |

**Why "A and C, no B?"** — B is created _post-stats-break_ from the bottom of A (see §5). It isn't a
registration-time division. C is a true second division (14 teams that ran their own prelim
round-robin). Teams' `division` never changes; the multi-bracket lanes inside the elim phase are
what `consolation` and the new `bracket_label` field encode.

## 2. Sheet-by-sheet mapping

| Sheet             | Role in spreadsheet                                                                                                   | qzr equivalent                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `Churches`        | (empty in this file; would hold registration import)                                                                  | `churches` table + `meet_memberships`                                |
| `TeamDraw`        | Master team list with absence/lateness flags + RAND() seeded sort that produces the A1…A36 / C1…C14 letter assignment | `teams` + `prelim_assignments` (the "Roll Teams" output)             |
| `PrelimDraw`      | Lookup tables for 4–8 team prelim brackets, plus the actual letter→team binding for this meet                         | `rules.md` §"Preliminary Round Brackets" + `prelim_assignments`      |
| `PlayoffDraw`     | Lookup tables for 4–8 team playoff brackets, plus the bye column                                                      | Custom playoff template library (currently absent from qzr — see §6) |
| `Team List`       | Per-division printable rosters (one column per division)                                                              | Coach/admin "Rosters" view export                                    |
| `Draw`            | The published, time-by-room schedule grid with team names                                                             | The Schedule grid in `team mode` (post-Roll Teams)                   |
| `Draw - Text`     | Same grid as Draw but with letter codes only (no team names)                                                          | The Schedule grid in `letter mode` (pre-Roll Teams)                  |
| `A Div`, `C Div`  | Per-division standings: place / score / points / errors per quiz, totals, prelim rank, post-WXYZ placement            | `Standings` view; computed from completed `scheduled_quizzes`        |
| `Prelims`         | Per-quiz scoresheet view (one row block per quiz, score / pos)                                                        | The qzr scoresheet itself, one quiz at a time                        |
| `Playoffs`        | Per-elim-quiz seat assignments for A / K / B / M brackets                                                             | `scheduled_quizzes` with `phase='elim'` + `seedRef` defs             |
| `Playoff_Library` | Lookup tables for elim brackets sized 12 / 13 / … / 19 teams                                                          | Custom elim template library (see §6)                                |
| `K_Library`       | Same lookup as `Playoff_Library` but with team names already substituted in for diagnostic display                    | (Derived view; no equivalent needed in qzr)                          |

The spreadsheet is **two layers stacked in one file**: a static template library (the `*Library` and
`*Draw` lookup tables) and the live meet data (everything else). qzr's design splits these cleanly —
the templates would live in `packages/shared/scheduling/templates/` as data tables, and the meet
data lives in the database tables defined in `docs/scheduling.md` §8.

## 3. Team intake & the draw

### 3.1 The TeamDraw sheet

Columns A–H of `TeamDraw` are the canonical intake form:

| Col | Header        | Meaning                                                       |
| --- | ------------- | ------------------------------------------------------------- |
| A   | Team Count    | 1, 2, 3, … — the row number, used for sort                    |
| B   | Church        | Church short name                                             |
| C   | Team #        | Per-church team index — a church with 4 teams uses 1, 2, 3, 4 |
| D   | Team Name     | `{Church} {Team #}` concatenation                             |
| E   | Absent?       | 0/1 flag — sets the team to "no-show"                         |
| F   | Lateness?     | 0/1 flag — pushes the team to the bottom of the random sort   |
| G   | Random        | `=RAND()` — re-rolls until a satisfactory draw appears        |
| H   | (sorted seed) | Position after sort by `(Lateness, Random)` ascending         |

After sort, columns J/K assign the **seed code** (`A1`, `A2`, … or `C1`, …) and the **team binding**
(e.g. `A1` → the team that landed in row 1 after the sort). This is exactly the `prelim_assignments`
table in qzr's data model: one row per `(meetId, division, letter)`.

### 3.2 The lateness flag is non-obvious

The `Lateness?` column doesn't just flag a team — it actively reshapes the draw. A team marked late
gets `lateness=1`, which sorts to the bottom of the seed order, which means they occupy the
highest-numbered letter slots. Those slots appear in fewer prelim quizzes that intersect with
already-arrived teams, minimising the disruption from a delayed bus.

**Implication for qzr**: the "Roll Teams" action needs a per-team "expected late?" toggle that
biases the random permutation, not just a uniform shuffle. See `docs/scheduling.md` §3 observation
12.

### 3.3 The C division has its own seed pool

A church's top few teams go to A; that church's lower teams (5th, 6th, …) go to C. The division
assignment is set at registration time (column L "Division") and never changes. Columns N–T compute
per-church A/C team counts for sanity-checking.

## 4. Prelim composition: lookup tables match `rules.md` shape

Columns G–CC of the `PrelimDraw` sheet are the team-count → quiz-composition lookup tables for
fields of 4 through 8 teams. The shape (3 letter slots per quiz, 3 quizzes per team, no letter twice
in one quiz) matches `docs/rules.md` §"Preliminary Round Brackets" exactly; the specific letter
assignments **mostly** match the rule book but diverge on some quizzes (e.g. for an 8-team field the
spreadsheet's Quiz 2 differs from the rule book's `DEF`). The divergences appear to be intentional
re-balancings, not transcription errors — but the rule book remains the authoritative source for
QuizMeet.

The Winkler spreadsheet only ships 4–8 team lookups inline. The lookup function (`VLOOKUP` against
TeamDraw column J) would let any larger field plug in if the table were filled in; the spreadsheet's
authors composed the A-div 36-team prelims by hand instead.

**For qzr**: ship `drawPrelims(teamCount)` with all 4–21 lookups baked in from day one (it's pure
data; no judgment calls). The composition utility lives in
`packages/shared/scheduling/prelimDraw.ts`. See `docs/scheduling.md` §5.1.

## 5. The schedule structure

### 5.1 Time grid

The `Draw` sheet is the main artefact. Y-axis = wall-clock time slots; x-axis = rooms (1–9). Each
cell at `(slot, room)` holds either a 3-team quiz or is blank. Slot rows are interleaved with
**event rows** (Lunch, Assembly, Awards) that span all rooms.

```
Friday  6:30  Registration
        7:00  Officials Meeting in Room 2          ← event in a single room
        7:30  Opening Assembly
        8:00  A Qz 1 .. A Qz 6                     ← 6 A-div prelim quizzes in Rooms 1–6
        8:25  A Qz 8 .. A Qz 13
        8:50  A Qz 15 .. A Qz 20
        9:30  Billet pickup (event)
Saturday 8:30 Billet drop-off
        8:45  A Qz 22 .. A Qz 27                   ← prelims continue
        9:10  A Qz 28 .. A Qz 33
        9:35  A Qz 34 .. A Qz 36 in Rooms 2-4 only ← partial round
       10:00  Assembly + stats break (event)       ← prelims end, standings calculated
       11:00  A Qz W..Z, B Qz A..B                 ← intermediates + B-bracket elim begin
       11:30  A Qz A..C, K Qz A..C                 ← championship + secondary brackets
       12:00  Lunch (event)
        1:00  Elim continues (A/K/B/C brackets in parallel)
        2:30  …
        3:30  C Final, K Final
        4:00  A Final, B Final
        4:30  Social, Supper, Awards, Worship
Sunday  10:00 Billet drop-off
```

Two patterns here:

1. **Slot pitch varies**: 25 min between prelim slots, 30 min between elim slots, longer for events.
   The schedule editor must let admins set per-slot duration (already in `docs/scheduling.md` §3 obs
   #3 and §8 `meetSlots.durationMinutes`).
2. **Not every (slot, room) cell is filled**: e.g. 9:35 only uses rooms 2-4 because A division wraps
   up at quiz 36. The grid editor must tolerate sparse rounds.

### 5.2 Prelim quiz numbering vs round count

A division has 36 teams × 3 quizzes per team ÷ 3 teams per quiz = **36 quizzes**. With 6 rooms
running A-div prelims: 36 quizzes ÷ 6 rooms = **6 rounds**. The schedule sketch above shows five
6-quiz rounds plus one partial 3-quiz round at 9:35 = 33 visible cells. The remaining 3 quizzes (A
Qz 7, 14, 21) run alongside in additional time slots not detailed here. Quiz numbering reflects the
draw order, not the slot order.

C division has 14 teams × 3 ÷ 3 = **14 quizzes**, run in fewer rooms in parallel with A's prelims.
The spreadsheet doesn't show the C prelim rounds explicitly in the `Draw` sheet — they interleave in
under-utilised rooms during the A-div Friday/Saturday morning blocks.

## 6. The post-stats-break elim composition (the interesting bit)

This is where the spreadsheet diverges most from `rules.md`. The rule book specifies a championship
bracket of 9 teams plus optional XYZ (positions 7–15) and XXYYZZ (positions 16–24). Winkler runs
**four parallel elim lanes off A division alone**, plus a fifth for C division:

| Lane          | Quizzes      | Composition                                | Teams it holds                                                  |
| ------------- | ------------ | ------------------------------------------ | --------------------------------------------------------------- |
| Championship  | `A Qz A..M`  | Top 12 of A division after stats break     | A-div ranks 1–12 (12 teams)                                     |
| Secondary (K) | `K Qz A..M`  | Next 12 of A division                      | A-div ranks 13–24 (12 teams)                                    |
| Consolation   | `B Qz A..K`  | Bottom 12 of A division (Bracket B + bye)  | A-div ranks 25–36 (12 teams)                                    |
| Extras (M)    | `M Qz 1..11` | Round-robin extras for mid/lower-pack play | A-div mid/low ranks (~15–30; overlaps K and B by design)        |
| C-div bracket | `C Qz D..P`  | C-division elim (separate division)        | C-div teams ranked at stats break (some dropped per team count) |

The lanes run **in parallel** across the 9 rooms — e.g. at 11:30 Saturday, A Qz A/B/C run in rooms
1-3, K Qz A/B/C in rooms 4-6, B Qz C in room 7, and C Qz D/E in rooms 8-9.

### 6.1 The K bracket (not in the rule book)

`K Qz A..M` follows the same letter shape as `A Qz A..M`, but seats are populated from **prelim
ranks 13–24** rather than 1–12. The structure isn't spelled out in `docs/rules.md`; the
spreadsheet's `Playoff_Library` sheet holds custom lookup tables for "12 Team Elimination", "13 Team
Elimination", through "19 Team Elimination" — each a hand-composed bracket template.

**Implication**: the rule book's Brackets A/B/C are 9-team templates only. Real meets routinely run
larger brackets via meet-director-authored templates. qzr should treat the rule book as the
**canonical 9-team templates** (always present) and add a **custom template library** for other
sizes, seeded from the patterns in `Playoff_Library` and similar spreadsheets.

### 6.2 The B bracket (consolation, but different from rule-book consolation)

`B Qz A..K` holds A-div ranks 25–36 (12 teams). The rule book's "Consolation final 9 bracket" is for
a 9-team field of positions 10–18 (under the "more than 24 teams" branch); Winkler uses a
**meet-director-authored 12-team variant with one bye** (column D of `PlayoffDraw` is literally
labeled "Bye"). The shape derives from rule-book Bracket B but is scaled up.

### 6.3 The W/X/Y/Z intermediate (4 quizzes for 12 teams)

The rule book specifies XYZ (3 quizzes for 9 teams, ranks 7–15) and XXYYZZ (3 more quizzes for 9
teams, ranks 16–24). Winkler runs **W/X/Y/Z** — 4 quizzes for 12 teams (ranks 9–20) — to determine
where teams land in the K bracket vs the B bracket. This is a generalised intermediate the rule book
doesn't define:

```
A Qz W: ranks  9, 16, 17     (= rule-book's "X": 7, 12, 15 generalised)
A Qz X: ranks 10, 15, 18
A Qz Y: ranks 11, 14, 19
A Qz Z: ranks 12, 13, 20
```

Pattern: 1st & 3rd of each rank-triple swap with 2nd of an adjacent triple to balance opponent
strength. The spreadsheet's authors derived these by hand.

**Implication**: qzr's intermediate quiz support needs to handle generalised N-team intermediates
(`drawIntermediate(rankRange: [from, to])`), not just the rule-book XYZ and XXYYZZ shapes. See
`docs/scheduling.md` §3 observation 11.

### 6.4 Staggered finals

The four finals run in two adjacent slots, not all at once. **C Final** and **K Final** at 3:30 pm,
then **A Final** and **B Final** at 4:00 pm. Each is a `phase='elim', lane='final'` quiz with three
seedRefs into the prior bracket structure (e.g. A Final = `1ofE`, `1ofI`, `1ofK` where E/I/K are the
A-bracket terminal quizzes). The 3:30 / 4:00 split is presumably so the meet director / awards team
can attend each final live; the schedule editor should support a "Final" tag on quizzes so the UI
can highlight them and so completion gates the division's `division_done` state advance.

## 7. Patterns the spreadsheet validates

These are decisions in `docs/scheduling.md` that the Winkler spreadsheet confirms with a real-world
example:

1. **Def vs resolution layering** (`docs/scheduling.md` §7, "Def vs resolution layering") — the
   `Draw` sheet's elim cells use `1ofA`, `2ofE`, `3ofI` as opaque placeholders, resolved to teams
   only when the upstream quiz finishes. The spreadsheet computes the resolution via `VLOOKUP`
   against the `Playoffs` results columns; qzr's `seed_resolutions` table is the equivalent.
2. **Letter-mode publishing** (`docs/scheduling.md` §9 "Letter mode") — the `Draw - Text` sheet
   exists specifically so the schedule can be printed before "Roll Teams" finalizes. qzr should
   support this view from day one.
3. **Per-division state machine** (`docs/scheduling.md` §2) — A and C run prelims in parallel, hit
   stats break independently, and feed elims at different times. The spreadsheet handles this via
   separate sheets per division; qzr handles it via per-`division_states` rows.
4. **Multiple bracket lanes per division** (`docs/scheduling.md` §6) — `teams.consolation` is the
   lane marker. Winkler shows lanes can be more than just "championship vs consolation": A-div has
   championship (A), secondary (K), consolation (B), and an extras round-robin (M). The
   `consolation: boolean` may need to widen into `bracketLane: string` if we want to support these
   multi-lane fields directly.
5. **Slot pitch varies by phase** — 25 min in prelims, 30 min in elims, plus variable-duration
   events. Confirms `meetSlots.durationMinutes` is per-row, not per-meet.
6. **Sparse round support** — last prelim round (9:35 Saturday) only fills 3 of 6 rooms. Editor must
   allow empty `(slot, room)` cells.

## 8. Patterns that motivate new design work

These are gaps in the current design exposed by the spreadsheet:

1. **Lateness bias in Roll Teams** — see §3.2. Add per-team `expectedLate: boolean` to
   `prelim_assignments` input; bias the permutation so late teams sort to higher letters.
2. **Custom bracket templates beyond rule-book A/B/C** — see §6.1. Library of 12/13/14/…/19 team
   elim templates, hand-composed by the qzr authors based on `Playoff_Library` patterns. Stored as
   data in `packages/shared/scheduling/templates/`.
3. **Generalised intermediate quizzes** — see §6.3. `drawIntermediate(from, to)` utility for rank
   ranges other than 7–15 / 16–24.
4. **Multi-lane elim within a single division** — see §6 lane table. Either widen
   `teams.consolation` to `bracketLane` or add a separate `team_bracket_assignments` table mapping
   `(meetId, teamId) → lane`. The latter keeps `teams.consolation` backwards-compatible and lets a
   team appear in multiple lanes (e.g. an A-div team in both the K bracket and the M extras
   round-robin).
5. **Final tag** — `scheduled_quizzes` needs a flag (`isFinal: boolean` or `lane='final'` value) so
   finals are visually distinct and so completion advances `division_states`.
6. **Wide grid UX** — 9 rooms × ~30 slots = 270 cells. The schedule editor must support horizontal
   scrolling and per-row freeze of the time column, matching the existing scoresheet's sticky-header
   approach.

## 9. What qzr would deliver in place of this spreadsheet

If a meet director used qzr for Winkler 2026 instead of the .ods, here's the rough flow:

| Stage                  | Spreadsheet today                                                | qzr equivalent                                                                 |
| ---------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Registration           | TeamDraw filled by hand; coaches email roster updates            | Coach portal: each church's coach edits their own teams + quizzers             |
| Lateness flagging      | `Lateness?` column toggled the morning of                        | Admin marks team as expected-late before Roll Teams                            |
| Prelim draw            | Sort by `(Lateness, RAND)`; A1..A36 / C1..C14 assigned manually  | Click "Roll Teams" → seeded permutation written to `prelim_assignments`        |
| Prelim composition     | Author copies cells from rules.md into the live grid             | `drawPrelims(36)` → 36 letter-coded quizzes with seats                         |
| Schedule layout        | Cells dragged into time × room grid by hand                      | `autoSlot(quizzes, rooms, rounds)` first draft, admin tweaks via drag-drop     |
| Letter-mode publishing | Print `Draw - Text` sheet                                        | Letter-mode Schedule view (no team names yet); printable                       |
| Team-mode publishing   | Print `Draw` sheet                                               | Team-mode Schedule view (post-Roll Teams); auto-published when phase → live    |
| Live scoring           | Officials write on paper, scorekeeper transcribes into `Prelims` | Officials use the qzr scoresheet directly per-room (one tab per room)          |
| Standings              | A Div / C Div sheets compute via formula                         | Real-time standings view, recomputed from `scheduled_quizzes.completedAt`      |
| Stats break            | Director eyeballs A Div sheet, picks bracket sizes manually      | Director clicks "Advance to stats break"; sees rank list + suggested lanes     |
| Elim composition       | Director copies elim template from `Playoff_Library`             | `drawElims(division, lane, template)` with custom template library             |
| Elim resolution        | `VLOOKUP` from `Playoffs` results into `Draw` cells              | `seed_resolutions` auto-fill when upstream `scheduled_quizzes.completedAt` set |
| Final placements       | Hand-written summary sheet                                       | Per-division `division_done` view with placement, used for awards              |

## 10. Outstanding questions surfaced by this example

These are scheduling-design questions the rule book doesn't answer; the spreadsheet shows _one_
answer but the qzr design needs to make a deliberate choice:

1. **Multi-lane elims in one division** — should `teams.consolation` widen to a string
   (`'main' | 'consolation' | 'k' | 'm'`), or should we add a separate `team_bracket_assignments`
   table? Spreadsheet uses lane labels (A/K/B/M) freely; current qzr schema only models main vs
   consolation.
2. **Custom bracket template authoring** — does qzr ship the 12–19 team templates as built-in data,
   or expose a "bracket builder" UX so a director can author their own per meet? Spreadsheet's
   `Playoff_Library` suggests built-in templates suffice for typical fields.
3. **Generalised intermediate** — should `drawIntermediate` be a single parameterised function, or a
   small library of named intermediates (XYZ, XXYYZZ, WXYZ, etc.)? Spreadsheet shows WXYZ as a
   one-off; library approach scales worse, parameterised approach is easier to misuse.
4. **Multi-final concurrency** — when 4 finals run simultaneously, the awards ceremony needs all
   four results before announcing. Should qzr gate the meet-level "advance to done" on all finals
   being marked `completedAt`, or per-division `division_done` advances independently? Spreadsheet
   implicitly does the latter.
5. **Round vs slot duration** — 25 min in prelims, 30 in elims is tournament-specific. Should qzr
   default to these values, or prompt the admin per phase? Spreadsheet hard-codes per-row.
