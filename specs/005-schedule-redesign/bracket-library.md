# Bracket library

The brackets the library holds (FR-029), as the reference schedules ran them. Each is written for a
lane of `n` teams:

* Opening seats are the lane's seeds `1` to `n`, best first. The generator turns them into the
  lane's sources: prelim ranks, or `New n` for ranks from an intermediate above.
* `2A` means 2nd of quiz A. Letters are the lane's own, from A; a lane whose letters continue the
  lane above's shifts them (FR-033).
* The last line is the deciding quiz, called a Finals by default (FR-034).

Every entry satisfies H-12 to H-16 at its size; the library's tests check it.

## 5 teams

One-day meet 2026 (first two quizzes) and Heritage 2025 Div 2 consolation (all of it).

```
A = 1, 3, 5      B = 2, 4, 2A     C = 3A, 2B, 3B   D = 1B, 1A, 1C
E = 2C, 3C, 3D   F = 2D, 1E, 2E   G = 3E, 2F, 3F
Deciding = 1F, 1D, 1G
```

## 6 teams

May 2023, Kelowna 2024, FBC 2025.

```
A = 1, 4, 5      B = 2, 3, 6      C = 2A, 2B, 3A   D = 1A, 1B, 1C
E = 2C, 3C, 3B   F = 1E, 2D, 3D   G = 2F, 3F, 2E
Deciding = 1D, 1F, 1G
```

## 7 teams

Feb 2023, Kelowna Nov 2023, FBC 2025 3c.

```
A = 1, 5, 7      B = 2, 4, 6      C = 3, 2A, 2B    D = 1B, 1A, 1C
E = 3A, 3B, 3C   F = 2C, 2E, 3E   G = 1E, 2D, 3D   H = 1F, 2G, 3G
Deciding = 1G, 1D, 1H
```

## 8 teams

Nov 2022, FBC 2025 2c, Heritage 2024 third lane.

```
A = 1, 4, 8      B = 2, 5, 7      C = 3, 6, 3A     D = 1A, 1C, 2B
E = 1B, 2A, 2C   F = 3B, 3C, 3D   G = 1F, 3E, 2F   H = 2D, 2E, 1G
Deciding = 1D, 1E, 1H
```

## 9 teams

The same bracket after the openers; the openers depend on what feeds it.

Snake order, when an XY feeds it or it takes ranks directly (FBC 2025, 2C 2021 to 2023):

```
A = 1, 6, 7      B = 2, 5, 8      C = 3, 4, 9
```

Rule-book Bracket B order, when an X feeds it (Heritage 2023, 2025):

```
A = 1, 4, 9      B = 2, 5, 7      C = 3, 6, 8
```

Then, either way:

```
D = 1A, 1C, 2B   E = 1B, 2A, 2C   F = 3A, 3B, 3C   G = 3D, 3E, 1F   H = 2D, 2E, 1G
Deciding = 1D, 1E, 1H
```

## 10 teams

Heritage 2025 Div 1: the 9-team bracket's later quizzes with Heritage 2025's own openers, and a
rerank X on 8 to 10. Seed 10 enters the bottom placing quiz G, whose result goes nowhere further.

```
A = 1, 4, 8      B = 2, 5, 7      C = 3, 6, 9      D = 1A, 1C, 2B
E = 1B, 2A, 2C   F = 3A, 3B, 3C   G = 3F, 2F, 10   H = 3D, 3E, 1F
I = 2D, 2E, 1H
Deciding = 1D, 1E, 1I
```

## 11 teams

Built the same way as the 10-team bracket (agreed 2026-11-02): a play-in X on 9 to 11, whose winner
takes seed 9 (as Heritage 2023), and whose other two join the bottom placing quiz G, which places
9th to 11th.

```
X = 9, 10, 11
A = 1, 4, 1X     B = 2, 5, 7      C = 3, 6, 8      D = 1A, 1C, 2B
E = 1B, 2A, 2C   F = 3A, 3B, 3C   G = 2F, 2X, 3X   H = 3D, 3E, 1F
I = 2D, 2E, 1H
Deciding = 1D, 1E, 1I
```

## 12 teams

2021 to 2025, and CMQ's A and K lanes.

```
A = 1, 5, 12     B = 2, 6, 11     C = 3, 7, 10     D = 4, 8, 9
E = 1A, 1B, 1C   F = 2A, 2B, 2C   G = 3B, 2D, 3A   H = 2F, 3D, 3C
I = 2E, 1D, 1F   J = 3I, 1G, 1H   K = 3E, 2I, 1J
Deciding = 1E, 1I, 1K
```

## 14 teams

CMQ's C division as run in 2026: a play-in A on seeds 12 to 14, whose winner enters E and whose
other two play on in M.

```
A = 12, 13, 14   B = 1, 5, 11     C = 2, 6, 10     D = 3, 7, 9
E = 4, 8, 1A     F = 1B, 1C, 1D   G = 2B, 2C, 2D   H = 3C, 2E, 3B
I = 2G, 3E, 3D   J = 2F, 1E, 1G   K = 3J, 1H, 1I   L = 3F, 2J, 1K
M = 2A, 3H, 3A   N = 3I, 3G, 3M   O = 1N, 2H, 2M   P = 2I, 1O, 1M
Deciding = 1F, 1J, 1L
```

## Rule book

`docs/rules.md` Brackets A, B and C for 9 teams, as written there.

## Sizes without a bracket

Any other size (4, 13, 15 and up) has none; a lane of that size is generated as placeholder quizzes
for the director (FR-036), or can be a round robin (FR-029). CMQ's workbook also holds 13 to 20-team
brackets (the 12-team bracket plus play-ins S to V), but several of their cells are broken, so they
aren't entered until a working copy is available.
