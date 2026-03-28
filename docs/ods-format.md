# ODS/OTS Format Reference

ODS (OpenDocument Spreadsheet) is a ZIP archive. OTS is the template variant (same structure,
different MIME type). Both are used by LibreOffice Calc.

## Inspecting a Template

```zsh
# Unzip the OTS into an inspect directory
unzip scoresheet.ots -d .scoresheet-ots-inspect

# Pretty-print the large single-line XML files
cd .scoresheet-ots-inspect
xmllint --format content.xml > content-fmt.xml
xmllint --format styles.xml  > styles-fmt.xml
```

The formatted files are for inspection only — do not repack them. Always repack from the original
unformatted files.

## Archive Structure

```
content.xml          # Sheet data, cell values, formulas, automatic styles
styles.xml           # Named styles, number formats, page layout
META-INF/manifest.xml
meta.xml
mimetype             # Must be first entry, uncompressed: "application/vnd.oasis.opendocument.spreadsheet-template"
settings.xml         # View settings (zoom, active sheet, freeze rows, etc.)
Configurations2/     # UI config (toolbars, menus) — can be omitted in generated files
Thumbnails/          # thumbnail.png — can be omitted in generated files
```

For a **generated ODS** (not a template), the MIME type is:
`application/vnd.oasis.opendocument.spreadsheet`

## content.xml Top-Level Structure

```xml
<office:document-content>
  <office:font-face-decls/>   <!-- font declarations -->
  <office:automatic-styles/>  <!-- column/row/cell styles scoped to this file -->
  <office:body>
    <office:spreadsheet>
      <table:content-validations/>   <!-- dropdown lists, input constraints -->
      <table:table table:name="Sheet1"/>
      <table:table table:name="Sheet2"/>
    </office:spreadsheet>
  </office:body>
</office:document-content>
```

## Scoresheet OTS: Sheets

| Sheet          | Purpose                                                                              | Variable?                            |
| -------------- | ------------------------------------------------------------------------------------ | ------------------------------------ |
| `Quiz`         | Visible scoresheet — input cells + display                                           | **No** — fixed layout                |
| `Summaries`    | Per-quizzer summary stats, formula-driven from Calculations                          | **No**                               |
| `Calculations` | Hidden scoring engine, formula-driven from Quiz                                      | **No**                               |
| `Basic`        | Constants: Quizout threshold, division mirror, question type lists, placement tables | **No**                               |
| `Lists`        | Team/quizzer roster data for dropdown validation                                     | **Yes** — changes per tournament/org |

The first four sheets have a fixed, known layout and are entirely formula-driven from `Quiz`. The
`Lists` sheet varies between tournaments and organisations — it is never read or modified by the
fill logic. All five sheets are passed through byte-for-byte from the template; only the `Quiz`
sheet cells are patched.

## Fill Strategy

The app fills a user-supplied OTS by patching `content.xml` in memory:

1. User picks an `.ots` file via the native file dialog
2. `fflate.unzipSync` unpacks all entries into a `Record<string, Uint8Array>`
3. `content.xml` is decoded to a string and cell values are written at **known fixed addresses** in
   the `Quiz` sheet (row/col indices derived from the layout table below)
4. The modified `content.xml` is re-encoded and the archive is repacked with `fflate.zipSync`, with
   `mimetype` stored uncompressed (level 0)
5. The resulting bytes are saved as `.ods` via the native save dialog

Because the `Quiz` sheet layout is fixed, no named ranges or template markers are needed. The
`Lists` sheet and all other entries are passed through byte-for-byte unchanged.

### Handling `number-rows-repeated` / `number-columns-repeated`

ODS compresses runs of identical empty rows/cells using repeat attributes:

```xml
<table:table-row table:number-rows-repeated="1048538">
  <table:table-cell table:number-columns-repeated="64"/>
</table:table-row>
```

The XML walker must expand these virtually (not literally — that would be ~1M DOM nodes) to map
logical row/col indices to the correct XML element. The fill logic splits compressed runs at the
target row/col boundary and rewrites only the affected element.

## Quiz Sheet Layout

### Column → Question Mapping

Each question number maps to **exactly one column**. Q16–Q20 do **not** have separate A/B columns in
the ODS — each is a single column. The A/B sub-question structure is handled via extra rows 29–31
(see below).

| Spreadsheet col | Index (0-based) | Content                               |
| --------------- | --------------- | ------------------------------------- |
| A               | 0               | Quizzer index (1–5)                   |
| B–C             | 1–2             | Team/quizzer name (merged input cell) |
| D               | 3               | Q1                                    |
| E               | 4               | Q2                                    |
| …               | …               | …                                     |
| R               | 17              | Q15                                   |
| S               | 18              | Q16 (first A/B-eligible question)     |
| T               | 19              | Q17 (error points begin)              |
| U               | 20              | Q18                                   |
| V               | 21              | Q19                                   |
| W               | 22              | Q20                                   |
| X               | 23              | OT Q21                                |
| Y               | 24              | OT Q22                                |
| Z               | 25              | OT Q23                                |
| AA              | 26              | OT Q24                                |
| AB              | 27              | OT Q25                                |
| AC              | 28              | OT Q26                                |
| AD              | 29              | Score (formula / static value)        |

### Row Layout

```
Row 2   Header labels: "Error Points" (col T area), "Overtime" (col X area)
Row 3   Metadata: Div (C3), Quiz# (E3, spans E:F) | Q number headers: 16–26
Row 4   On Time, Timeouts
        Visual "A" sub-labels at cols S–W (Q16–20) and OT cols — display only, not input
─────── Team 1 ──────────────────────────────────────────────────────────────────────
Row 5   Team 1 name (B5, merged B:C) | Q number headers 1–15
        Visual "B" sub-labels at cols S–W (Q16–20) and OT cols — display only, not input
Rows 6–10   Quizzers 1–5 (col A = index, B:C = name, D:AC = cells, AD = score)
Row 11  Score row: per-question running totals (D11:AD11)
─────── Team 2 ──────────────────────────────────────────────────────────────────────
Row 12  Separator / A sub-labels row
Row 13  Team 2 name (B13) | Q number headers
Rows 14–18  Quizzers 1–5
Row 19  Score row (D19:AD19)
─────── Team 3 ──────────────────────────────────────────────────────────────────────
Row 20  Separator / A sub-labels row
Row 21  Team 3 name (B21) | Q number headers
Rows 22–26  Quizzers 1–5
Row 27  Score row (D27:AD27)
─────── Footer ──────────────────────────────────────────────────────────────────────
Row 28  No Jump (x) row — one cell per Q1–Q20 (cols D–W) + OT (cols X–AC)
Row 29  Question Types row — one cell per Q1–Q20 (cols D–W); val21 dropdown
Row 30  Overtime / A sub-answer row:
          col C = Overtime y/n flag
          cols E–R = Q2–Q15 sub-answer cells (val22)
          cols S–W = Q16–Q20 sub-answer cells (val22)
Row 31  B sub-answer row — same column layout as row 30 (no label in col B)
```

### A/B Sub-Question Structure (Q16–Q20)

The ODS uses **one column per question number** for Q16–Q20. Quizzer answer values (`c`/`e`/`f`
etc.) always go in the quizzer rows at the parent question's column, regardless of whether the
answer was on the toss-up, A sub, or B sub.

Three footer rows provide per-question **type metadata** for the Summaries sheet:

| Row | Role                                            | Column range |
| --- | ----------------------------------------------- | ------------ |
| 29  | Question type for the toss-up / normal question | D–W (Q1–Q20) |
| 30  | Question type for the A sub-question            | E–W (Q2–Q20) |
| 31  | Question type for the B sub-question            | E–W (Q2–Q20) |

The Summaries sheet selects which row's question type to display using a `CHOOSE` formula:

```
CHOOSE(selector+1; Quiz.S29; Quiz.S30; Quiz.S31)   ← Q16 (col S)
CHOOSE(selector+1; Quiz.T29; Quiz.T30; Quiz.T31)   ← Q17 (col T)
...etc.
```

Where `selector` = 0 → row 29 (toss-up resolved), 1 → row 30 (A sub resolved), 2 → row 31 (B sub
resolved).

The visual **A/B labels** in rows 4–5 at cols S–W are static display text only — they are not
separate input columns.

**App column key → ODS mapping for Q16–Q20:**

| App key | Quizzer rows (answer value) | Row 29 (Q type) | Row 30 (Q type) | Row 31 (Q type) |
| ------- | --------------------------- | --------------- | --------------- | --------------- |
| `"16"`  | col S (idx 18)              | col S           | —               | —               |
| `"16A"` | col S (idx 18)              | —               | col S           | —               |
| `"16B"` | col S (idx 18)              | —               | —               | col S           |
| `"17"`  | col T (idx 19)              | col T           | —               | —               |
| `"17A"` | col T (idx 19)              | —               | col T           | —               |
| `"17B"` | col T (idx 19)              | —               | —               | col T           |
| …       | …                           | …               | …               | …               |

### Fill Targets (0-based row, 0-based col)

All coordinates are 0-based. Row 1 in the layout above = index 0.

| Data                          | Row   | Col   | Notes                               |
| ----------------------------- | ----- | ----- | ----------------------------------- |
| Division                      | 2     | 2     | C3                                  |
| Quiz number                   | 2     | 4     | E3                                  |
| Overtime y/n                  | 29    | 2     | C30                                 |
| Team 1 name                   | 4     | 1     | B5                                  |
| Team 1 on-time                | 3     | 6     |                                     |
| Team 1 quizzer N name         | 5–9   | 1     | rows 6–10                           |
| Team 1 quizzer N answer col K | 5–9   | 3–28  | cols D–AC; Q1–Q20 then OT           |
| Team 1 score col K            | 10    | 3–29  | row 11                              |
| Team 2 name                   | 12    | 1     | B13                                 |
| Team 2 on-time                | 11    | 6     | (separator row)                     |
| Team 2 quizzer N name         | 13–17 | 1     | rows 14–18                          |
| Team 2 quizzer N answer col K | 13–17 | 3–28  |                                     |
| Team 2 score col K            | 18    | 3–29  | row 19                              |
| Team 3 name                   | 20    | 1     | B21                                 |
| Team 3 on-time                | 19    | 6     | (separator row)                     |
| Team 3 quizzer N name         | 21–25 | 1     | rows 22–26                          |
| Team 3 quizzer N answer col K | 21–25 | 3–28  |                                     |
| Team 3 score col K            | 26    | 3–29  | row 27                              |
| No-jump col K                 | 27    | 3–28  | row 28                              |
| Question type col K (normal)  | 28    | 3–22  | row 29; toss-up question type       |
| Question type col K (A sub)   | 29    | 18–22 | row 30; Q16–Q20 A sub-question type |
| Question type col K (B sub)   | 30    | 18–22 | row 31; Q16–Q20 B sub-question type |

### Quizzer Cell ODS Column Index for Q1–Q20 and OT

For writing quizzer answers in rows 6–10, 14–18, 22–26:

```
Q1  → col 3   Q11 → col 13
Q2  → col 4   Q12 → col 14
…             Q15 → col 17
Q10 → col 12  Q16 → col 18
              Q17 → col 19
              Q18 → col 20
              Q19 → col 21
              Q20 → col 22
              OT Q21 → col 23
              OT Q22 → col 24
              …
              OT Q26 → col 28
```

App keys `"16A"`, `"16B"`, `"17A"`, `"17B"`, … do **not** write to quizzer rows. They write to rows
30 and 31 respectively at the same column as their question number.

### A/B Sub-row Labels

Q16–Q20 and all OT columns have visual A/B header labels:

* Row 4 (above the team-name row): **A** label — static display text only
* Row 5 (the team-name/Q-header row): **B** label — static display text only

Q16 **does** have A/B sub-row labels (previously documented incorrectly as not having them).

## Cell Styling Conventions

| Style           | Color               | Meaning                                       |
| --------------- | ------------------- | --------------------------------------------- |
| Input cell      | `#ffff99` (yellow)  | User enters value here                        |
| Formula/output  | transparent / white | Computed, not editable                        |
| Greyed out      | `Shading` style     | Cell disabled (tossed-up, foul cascade, etc.) |
| OT blocked      | `Block` style       | OT columns hidden when Overtime = "n"         |
| Name cell green | `Green` conditional | All quizzers entered (quizout reached)        |
| Name cell red   | `Red` conditional   | Missing quizzer entries                       |

The fill logic writes plain string/number values only. Existing cell styles are preserved —
conditional formatting in the template continues to work on the filled values.

## Calculations Sheet Row Offsets

The hidden Calculations sheet provides per-question score values that the Quiz score rows reference.
Row offsets within each team block:

| Row | Content                                                 |
| --- | ------------------------------------------------------- |
| 7   | Per-question scores for Q1–Q20 + OT (D7:AD7) for team 1 |
| 42  | Team 1 total score                                      |
| 58  | Per-question scores for team 2 (D58:AD58)               |
| 93  | Team 2 total score                                      |
| 109 | Per-question scores for team 3 (D109:AD109)             |

The fill logic does **not** modify the Calculations sheet. The template's existing formulas
calculate scores from the filled Quiz sheet values automatically when opened in LibreOffice.

## Summaries Sheet and the CHOOSE Pattern

The Summaries sheet (visible, shows per-quizzer stats) reads Q16–Q20 outcomes using:

```
CHOOSE([.U57]+1; [Quiz.S29]; [Quiz.S30]; [Quiz.S31])  ← Q16
CHOOSE([.V57]+1; [Quiz.T29]; [Quiz.T30]; [Quiz.T31])  ← Q17
CHOOSE([.W57]+1; [Quiz.U29]; [Quiz.U30]; [Quiz.U31])  ← Q18
CHOOSE([.X57]+1; [Quiz.V29]; [Quiz.V30]; [Quiz.V31])  ← Q19
CHOOSE([.Y57]+1; [Quiz.W29]; [Quiz.W30]; [Quiz.W31])  ← Q20
```

`[.U57]` through `[.Y57]` are selector values (0/1/2) that encode how the question resolved:

* 0 → row 29 (question resolved on the normal/toss-up answer)
* 1 → row 30 (question resolved on the A sub-answer)
* 2 → row 31 (question resolved on the B sub-answer)

For scoring the quizzer-cell totals (correct count, error count), Calculations reads directly from
Quiz rows 6–26 at cols S–W (Q16–Q20), so quizzer cells for those columns always use the same
`c`/`e`/`f` values as Q1–Q15.

## Named Ranges (OTS original)

| Name                 | Purpose                                  |
| -------------------- | ---------------------------------------- |
| `Overtime`           | Cell holding "y"/"n" for overtime toggle |
| `Div`                | Division selector cell                   |
| `Quizout`            | Threshold value for quiz-out detection   |
| `Teams`              | List range for team name dropdowns       |
| `Tstart` / `Tcolumn` | Lookup ranges for team roster            |
| `Qstart` / `Qcolumn` | Lookup ranges for quizzer roster         |

These are used by the template's own formulas and validations. The fill logic ignores them — it
targets cells by fixed address, not by named range.

## Minimum viable manifest.xml

```xml
<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0">
  <manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.spreadsheet"/>
  <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
  <manifest:file-entry manifest:full-path="styles.xml"  manifest:media-type="text/xml"/>
  <manifest:file-entry manifest:full-path="meta.xml"    manifest:media-type="text/xml"/>
</manifest:manifest>
```

## Packing a Valid ODS

The `mimetype` entry **must** be first and **uncompressed** (stored). Everything else can be
deflated normally.

```zsh
# Example using zip (for reference — production code uses fflate in-browser)
cd output-dir
zip -0 ../out.ods mimetype
zip -r ../out.ods META-INF content.xml styles.xml meta.xml
```
