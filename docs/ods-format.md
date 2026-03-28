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

| Spreadsheet col | Index (0-based) | Content                               |
| --------------- | --------------- | ------------------------------------- |
| A               | 0               | Quizzer index (1–5)                   |
| B–C             | 1–2             | Team/quizzer name (merged input cell) |
| D               | 3               | Q1                                    |
| E               | 4               | Q2                                    |
| …               | …               | …                                     |
| R               | 17              | Q15                                   |
| S               | 18              | Q16                                   |
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
Row 3   Question number headers: 16, 17, 18, 19, 20, 21, 22 … 26
Row 4   Metadata: Div (C4), Quiz# (D4), On Time, Timeouts | A sub-labels above Q17–20 + OT cols
─────── Team 1 ──────────────────────────────────────────────────────────────────────
Row 5   Team 1 name (B5, merged B:C) | Q number headers 1–15, B sub-labels below
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
Row 28  No Jump (x) row — one cell per question column
Row 29  Question Types row — one cell per question column
Row 30  Overtime (y/n) cell (col C)
```

### Fill Targets (0-based row, 0-based col)

All coordinates are 0-based. Row 1 in the layout above = index 0.

| Data                          | Row   | Col  | Notes           |
| ----------------------------- | ----- | ---- | --------------- |
| Division                      | 3     | 2    | C4              |
| Quiz number                   | 3     | 3    | D4              |
| Overtime y/n                  | 29    | 2    | C30             |
| Team 1 name                   | 4     | 1    | B5              |
| Team 1 on-time                | 3     | 6    |                 |
| Team 1 quizzer N name         | 5–9   | 1    | rows 6–10       |
| Team 1 quizzer N answer col K | 5–9   | 3–28 | cols D–AC       |
| Team 1 score col K            | 10    | 3–29 | row 11          |
| Team 2 name                   | 12    | 1    | B13             |
| Team 2 on-time                | 11    | 6    | (separator row) |
| Team 2 quizzer N name         | 13–17 | 1    | rows 14–18      |
| Team 2 quizzer N answer col K | 13–17 | 3–28 |                 |
| Team 2 score col K            | 18    | 3–29 | row 19          |
| Team 3 name                   | 20    | 1    | B21             |
| Team 3 on-time                | 19    | 6    | (separator row) |
| Team 3 quizzer N name         | 21–25 | 1    | rows 22–26      |
| Team 3 quizzer N answer col K | 21–25 | 3–28 |                 |
| Team 3 score col K            | 26    | 3–29 | row 27          |
| No-jump col K                 | 27    | 3–28 | row 28          |
| Question type col K           | 28    | 3–28 | row 29          |

### A/B Sub-row Labels

Q17–Q20 (error points) and all OT columns have A/B sub-labels:

* Row 4 (above the team-name row): **A** label
* Row 5 (the team-name/Q-header row): **B** label

Q16 has **no** A/B sub-label.

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
