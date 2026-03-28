import { describe, it, expect } from 'vitest'
import { patchCell, patchCellInRow, escapeXml } from '../odsXml'

describe('escapeXml', () => {
  it('escapes &, <, >', () => {
    expect(escapeXml('a & b < c > d')).toBe('a &amp; b &lt; c &gt; d')
  })

  it('leaves plain strings unchanged', () => {
    expect(escapeXml('Hello World')).toBe('Hello World')
  })
})

describe('patchCellInRow', () => {
  it('patches a self-closing cell at col 0', () => {
    const row =
      '<table:table-row><table:table-cell table:style-name="ce1"/><table:table-cell table:style-name="ce2"/></table:table-row>'
    const result = patchCellInRow(row, 0, 'hello')
    expect(result).toContain('<text:p>hello</text:p>')
    expect(result).toContain('office:value-type="string"')
    expect(result).not.toContain('ce1"/>')
  })

  it('patches second cell in a row', () => {
    const row =
      '<table:table-row><table:table-cell table:style-name="ce1"/><table:table-cell table:style-name="ce2"/></table:table-row>'
    const result = patchCellInRow(row, 1, 42)
    expect(result).toContain('<text:p>42</text:p>')
    expect(result).toContain('office:value-type="float" office:value="42"')
    expect(result).toContain('ce1')
  })

  it('splits a columns-repeated run and patches the target column', () => {
    const row =
      '<table:table-row>' +
      '<table:table-cell table:style-name="ce1"/>' +
      '<table:table-cell table:style-name="ce2" table:number-columns-repeated="5"/>' +
      '</table:table-row>'
    // Target col 3 = 2nd cell in the repeated run (0-based: col1=run[0], ..., col5=run[4])
    const result = patchCellInRow(row, 3, 'x')
    expect(result).toContain('<text:p>x</text:p>')
    // Should have a 2-wide prefix and 2-wide suffix
    expect(result).toContain('table:number-columns-repeated="2"')
    expect(result).not.toContain('table:number-columns-repeated="5"')
  })

  it('patches at the start of a repeated run (colsBefore=0)', () => {
    const row =
      '<table:table-row>' +
      '<table:table-cell table:style-name="ce1" table:number-columns-repeated="4"/>' +
      '</table:table-row>'
    const result = patchCellInRow(row, 0, 'first')
    expect(result).toContain('<text:p>first</text:p>')
    expect(result).toContain('table:number-columns-repeated="3"')
  })

  it('patches at the end of a repeated run (colsAfter=0)', () => {
    const row =
      '<table:table-row>' +
      '<table:table-cell table:style-name="ce1" table:number-columns-repeated="4"/>' +
      '</table:table-row>'
    const result = patchCellInRow(row, 3, 'last')
    expect(result).toContain('<text:p>last</text:p>')
    expect(result).toContain('table:number-columns-repeated="3"')
    expect(result).not.toContain('table:number-columns-repeated="4"')
  })

  it('strips formula attribute from patched cell', () => {
    const row =
      '<table:table-row>' +
      '<table:table-cell table:style-name="ce1" table:formula="of:=[Calc.D7]" office:value-type="float" office:value="0" calcext:value-type="float"><text:p>0</text:p></table:table-cell>' +
      '</table:table-row>'
    const result = patchCellInRow(row, 0, 20)
    expect(result).not.toContain('table:formula')
    expect(result).toContain('office:value="20"')
  })

  it('returns row unchanged if targetCol is out of range', () => {
    const row = '<table:table-row><table:table-cell table:style-name="ce1"/></table:table-row>'
    const result = patchCellInRow(row, 99, 'nope')
    expect(result).toBe(row)
  })
})

describe('patchCell', () => {
  function makeSheet(rows: string[]): string {
    const rowXml = rows.map((r) => `<table:table-row>${r}</table:table-row>`).join('\n')
    return `<table:table table:name="Quiz">\n${rowXml}\n</table:table>`
  }

  it('patches the correct row and column', () => {
    const sheet = makeSheet([
      '<table:table-cell/><table:table-cell/>',
      '<table:table-cell/><table:table-cell/>',
      '<table:table-cell/><table:table-cell/>',
    ])
    const result = patchCell(sheet, 1, 1, 'target')
    const rows = result.match(/<table:table-row>[^]*?<\/table:table-row>/g)!
    expect(rows[0]).not.toContain('target')
    expect(rows[1]).toContain('target')
    expect(rows[2]).not.toContain('target')
  })

  it('handles rows with number-rows-repeated before the target', () => {
    const sheet =
      '<table:table table:name="Quiz">' +
      '<table:table-row table:number-rows-repeated="3"><table:table-cell table:number-columns-repeated="10"/></table:table-row>' +
      '<table:table-row><table:table-cell table:style-name="ce1"/><table:table-cell table:style-name="ce2"/></table:table-row>' +
      '</table:table>'
    // Row 3 (0-based) is the explicit row after the repeated block
    const result = patchCell(sheet, 3, 1, 'found')
    expect(result).toContain('<text:p>found</text:p>')
  })

  it('returns sheet unchanged if row not found', () => {
    const sheet = makeSheet(['<table:table-cell/>'])
    const result = patchCell(sheet, 99, 0, 'x')
    expect(result).toBe(sheet)
  })
})
