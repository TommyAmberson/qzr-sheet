/**
 * ODS XML cell patcher for the Quiz sheet.
 *
 * The Quiz sheet rows we need to write are all explicit (not row-repeated).
 * Cells within those rows may use table:number-columns-repeated to compress
 * runs of identical empty cells, but the cells we target are either already
 * individual or at the boundary of a run.
 *
 * Strategy: for each target (row, col, value), find the correct
 * <table:table-row> by walking rows and counting logical rows, then find and
 * patch the correct cell within that row.
 *
 * We operate on the full content.xml string (not a DOM) to avoid any XML
 * parser dependency in the browser.
 */

/** Matches a table:table-row opening tag. */
const ROW_OPEN = /<table:table-row\b([^>]*)>/g
/** Matches a table:table-cell or covered-table-cell opening tag or self-closing tag. */
const CELL_OPEN = /<table:(table-cell|covered-table-cell)\b([^>]*?)(\/?)>/g

function getRepeat(attrs: string, attr: string): number {
  const m = attrs.match(new RegExp(`${attr}="(\\d+)"`))
  return m ? parseInt(m[1]!, 10) : 1
}

/** Escape XML text content. */
export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Build a replacement cell XML string with the given value.
 * Preserves style attributes from the original opening tag.
 * Strips formula, value-type, value, and columns-repeated attributes.
 */
function buildCell(originalAttrs: string, value: string | number): string {
  let attrs = originalAttrs
    .replace(/\s*table:number-columns-repeated="\d+"/, '')
    .replace(/\s*office:value(?:-type)?="[^"]*"/g, '')
    .replace(/\s*calcext:value-type="[^"]*"/, '')
    .replace(/\s*table:formula="[^"]*"/, '')
    .trim()

  if (typeof value === 'number') {
    attrs += ` office:value-type="float" office:value="${value}" calcext:value-type="float"`
  } else {
    attrs += ` office:value-type="string" calcext:value-type="string"`
  }

  const content = `<text:p>${escapeXml(String(value))}</text:p>`
  return `<table:table-cell ${attrs}>${content}</table:table-cell>`
}

/**
 * Find the start index of the Nth logical table-row (0-based) within xml.
 * Returns the index of the `<` of the opening tag, or -1 if not found.
 */
function findRowStart(xml: string, targetLogicalRow: number): number {
  ROW_OPEN.lastIndex = 0
  let logical = 0
  let m: RegExpExecArray | null

  while ((m = ROW_OPEN.exec(xml)) !== null) {
    const attrs = m[1]!
    const repeats = getRepeat(attrs, 'table:number-rows-repeated')
    if (logical + repeats > targetLogicalRow) {
      return m.index
    }
    logical += repeats
  }
  return -1
}

/**
 * Given the start index of a table-row opening tag in xml, return the
 * substring from that tag start to the end of </table:table-row>.
 */
function extractRow(xml: string, rowStart: number): string {
  const closeTag = '</table:table-row>'
  const end = xml.indexOf(closeTag, rowStart)
  if (end === -1) throw new Error('Malformed ODS: no closing table:table-row')
  return xml.slice(rowStart, end + closeTag.length)
}

/**
 * Within a row XML string, patch the cell at logical column `targetCol`.
 *
 * Returns the modified row string, with the target cell replaced by a new
 * cell containing `value`. The original cell's style attributes are preserved.
 * If the cell was part of a columns-repeated run, the run is split.
 */
export function patchCellInRow(rowXml: string, targetCol: number, value: string | number): string {
  CELL_OPEN.lastIndex = 0
  let logical = 0
  let m: RegExpExecArray | null

  while ((m = CELL_OPEN.exec(rowXml)) !== null) {
    const fullMatch = m[0]!
    const attrs = m[2]!
    const selfClose = m[3] === '/'
    const colRepeats = getRepeat(attrs, 'table:number-columns-repeated')

    if (logical + colRepeats <= targetCol) {
      logical += colRepeats
      continue
    }

    // This cell tag covers targetCol.
    const cellStart = m.index
    const tagEnd = cellStart + fullMatch.length

    // Find the end of the full cell element (including children and closing tag)
    let cellEnd: number
    if (selfClose) {
      cellEnd = tagEnd
    } else {
      const close = '</table:table-cell>'
      cellEnd = rowXml.indexOf(close, tagEnd)
      if (cellEnd === -1) throw new Error('Malformed ODS: unclosed table:table-cell')
      cellEnd += close.length
    }

    const colsBefore = targetCol - logical
    const colsAfter = colRepeats - colsBefore - 1

    // Original cell inner content (for non-self-closing repeated cells)
    const innerContent = selfClose
      ? ''
      : rowXml.slice(tagEnd, cellEnd - '</table:table-cell>'.length)

    // Build prefix: cells before the target within this repeated run
    let prefix = ''
    if (colsBefore > 0) {
      const beforeAttrs = attrs.includes('table:number-columns-repeated')
        ? attrs.replace(
            /table:number-columns-repeated="\d+"/,
            `table:number-columns-repeated="${colsBefore}"`,
          )
        : `${attrs} table:number-columns-repeated="${colsBefore}"`
      prefix = selfClose
        ? `<table:table-cell ${beforeAttrs.trim()}/>`
        : `<table:table-cell ${beforeAttrs.trim()}>${innerContent}</table:table-cell>`
    }

    // Build the patched cell
    const patched = buildCell(attrs, value)

    // Build suffix: cells after the target within this repeated run
    let suffix = ''
    if (colsAfter > 0) {
      const afterAttrs =
        colsAfter === 1
          ? attrs.replace(/\s*table:number-columns-repeated="\d+"/, '').trim()
          : attrs.includes('table:number-columns-repeated')
            ? attrs.replace(
                /table:number-columns-repeated="\d+"/,
                `table:number-columns-repeated="${colsAfter}"`,
              )
            : `${attrs} table:number-columns-repeated="${colsAfter}"`
      suffix = selfClose
        ? `<table:table-cell ${afterAttrs.trim()}/>`
        : `<table:table-cell ${afterAttrs.trim()}>${innerContent}</table:table-cell>`
    }

    return rowXml.slice(0, cellStart) + prefix + patched + suffix + rowXml.slice(cellEnd)
  }

  return rowXml // target col not found — return unchanged
}

/**
 * Patch a single cell in the Quiz sheet XML.
 *
 * @param sheetXml - the full content of the Quiz <table:table>...</table:table> element
 * @param row - 0-based logical row index
 * @param col - 0-based logical column index
 * @param value - string or number to write
 * @returns modified sheetXml
 */
export function patchCell(
  sheetXml: string,
  row: number,
  col: number,
  value: string | number,
): string {
  const rowStart = findRowStart(sheetXml, row)
  if (rowStart === -1) return sheetXml

  const rowXml = extractRow(sheetXml, rowStart)
  const patchedRow = patchCellInRow(rowXml, col, value)

  return sheetXml.slice(0, rowStart) + patchedRow + sheetXml.slice(rowStart + rowXml.length)
}
