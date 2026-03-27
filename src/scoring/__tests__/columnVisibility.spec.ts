import { describe, it, expect } from 'vitest'
import { CellValue, buildColumns } from '../../types/scoresheet'
import { computeVisibleColumns, computeOrphanedColumns } from '../columnVisibility'

const C = CellValue.Correct
const E = CellValue.Error
const F = CellValue.Foul
const B = CellValue.Bonus
const MB = CellValue.MissedBonus
const _ = CellValue.Empty

/** Build blank 3-team, 5-quizzer cell grid for given columns */
function blankCells(colCount: number): CellValue[][][] {
  return [0, 1, 2].map(() => Array.from({ length: 5 }, () => new Array(colCount).fill(_)))
}

describe('computeVisibleColumns', () => {
  describe('A/B column visibility', () => {
    const columns = buildColumns()
    const ci = (key: string) => {
      const idx = columns.findIndex((c) => c.key === key)
      if (idx === -1) throw new Error(`Column ${key} not found`)
      return idx
    }

    it('hides A/B columns when parent has no error', () => {
      const cells = blankCells(columns.length)
      const noJumps = columns.map(() => false)
      const result = computeVisibleColumns(cells, columns, noJumps, 0)
      const keys = result.map((r) => r.col.key)
      expect(keys).not.toContain('16A')
      expect(keys).not.toContain('16B')
      expect(keys).not.toContain('17A')
    })

    it('hides A column when it is bypassed (cascadeDisabled)', () => {
      const cells = blankCells(columns.length)
      cells[0]![0]![ci('17')] = E
      const noJumps = columns.map(() => false)
      // Simulate A being bypassed (bonus-routing)
      const cascadeDisabled = new Set([ci('17A')])
      const result = computeVisibleColumns(cells, columns, noJumps, 0, cascadeDisabled)
      const keys = result.map((r) => r.col.key)
      expect(keys).not.toContain('17A')
    })

    it('shows B column when A is bypassed (cascadeDisabled on A, not on B)', () => {
      const cells = blankCells(columns.length)
      cells[0]![0]![ci('17')] = E
      const noJumps = columns.map(() => false)
      const cascadeDisabled = new Set([ci('17A')])
      const result = computeVisibleColumns(cells, columns, noJumps, 0, cascadeDisabled)
      const keys = result.map((r) => r.col.key)
      expect(keys).toContain('17B')
    })

    it('does NOT show B when both A and B are cascadeDisabled (parent resolved)', () => {
      const cells = blankCells(columns.length)
      cells[0]![0]![ci('17')] = C
      const noJumps = columns.map(() => false)
      const cascadeDisabled = new Set([ci('17A'), ci('17B')])
      const result = computeVisibleColumns(cells, columns, noJumps, 0, cascadeDisabled)
      const keys = result.map((r) => r.col.key)
      expect(keys).not.toContain('17A')
      expect(keys).not.toContain('17B')
    })

    it('shows A column when parent has error', () => {
      const cells = blankCells(columns.length)
      cells[0]![0]![ci('17')] = E
      const noJumps = columns.map(() => false)
      const result = computeVisibleColumns(cells, columns, noJumps, 0)
      const keys = result.map((r) => r.col.key)
      expect(keys).toContain('17A')
    })

    it('shows A/B columns that have content even if parent has no error', () => {
      const cells = blankCells(columns.length)
      // Put content on 17A without an error on 17
      cells[0]![0]![ci('17A')] = C
      const noJumps = columns.map(() => false)
      const result = computeVisibleColumns(cells, columns, noJumps, 0)
      const keys = result.map((r) => r.col.key)
      expect(keys).toContain('17A')
    })

    it('shows A/B columns that have no-jump marked even if parent has no error', () => {
      const cells = blankCells(columns.length)
      const noJumps = columns.map(() => false)
      noJumps[ci('17A')] = true
      const result = computeVisibleColumns(cells, columns, noJumps, 0)
      const keys = result.map((r) => r.col.key)
      expect(keys).toContain('17A')
    })
  })

  describe('OT column visibility', () => {
    it('hides all OT columns when visibleOtRounds is 0', () => {
      const columns = buildColumns(2)
      const cells = blankCells(columns.length)
      const noJumps = columns.map(() => false)
      const result = computeVisibleColumns(cells, columns, noJumps, 0)
      const keys = result.map((r) => r.col.key)
      expect(keys).not.toContain('21')
      expect(keys).not.toContain('22')
      expect(keys).not.toContain('23')
    })

    it('shows OT columns within visible rounds', () => {
      const columns = buildColumns(2)
      const cells = blankCells(columns.length)
      const noJumps = columns.map(() => false)
      const result = computeVisibleColumns(cells, columns, noJumps, 1)
      const keys = result.map((r) => r.col.key)
      expect(keys).toContain('21')
      expect(keys).toContain('22')
      expect(keys).toContain('23')
      // Round 2 hidden
      expect(keys).not.toContain('24')
    })

    it('keeps OT columns with content visible even when visibleOtRounds drops to 0', () => {
      const columns = buildColumns(2)
      const ci = (key: string) => {
        const idx = columns.findIndex((c) => c.key === key)
        if (idx === -1) throw new Error(`Column ${key} not found`)
        return idx
      }
      const cells = blankCells(columns.length)
      cells[0]![0]![ci('21')] = C // OT answer exists
      const noJumps = columns.map(() => false)
      // visibleOtRounds is 0, but Q21 has content
      const result = computeVisibleColumns(cells, columns, noJumps, 0)
      const keys = result.map((r) => r.col.key)
      expect(keys).toContain('21')
    })

    it('keeps OT columns with no-jump visible even when visibleOtRounds drops to 0', () => {
      const columns = buildColumns(2)
      const ci = (key: string) => {
        const idx = columns.findIndex((c) => c.key === key)
        if (idx === -1) throw new Error(`Column ${key} not found`)
        return idx
      }
      const cells = blankCells(columns.length)
      const noJumps = columns.map(() => false)
      noJumps[ci('22')] = true // Q22 marked as no-jump
      const result = computeVisibleColumns(cells, columns, noJumps, 0)
      const keys = result.map((r) => r.col.key)
      expect(keys).toContain('22')
    })

    it('hides OT columns beyond visible rounds that have no content', () => {
      const columns = buildColumns(2)
      const ci = (key: string) => {
        const idx = columns.findIndex((c) => c.key === key)
        if (idx === -1) throw new Error(`Column ${key} not found`)
        return idx
      }
      const cells = blankCells(columns.length)
      cells[0]![0]![ci('21')] = C // round 1 has content
      const noJumps = columns.map(() => false)
      // Only 1 round visible, round 2 columns empty
      const result = computeVisibleColumns(cells, columns, noJumps, 1)
      const keys = result.map((r) => r.col.key)
      expect(keys).toContain('21')
      expect(keys).not.toContain('24') // round 2, no content
    })

    it('shows OT A/B columns with content even when parent has no error', () => {
      const columns = buildColumns(1)
      const ci = (key: string) => {
        const idx = columns.findIndex((c) => c.key === key)
        if (idx === -1) throw new Error(`Column ${key} not found`)
        return idx
      }
      const cells = blankCells(columns.length)
      cells[0]![0]![ci('21A')] = C
      const noJumps = columns.map(() => false)
      const result = computeVisibleColumns(cells, columns, noJumps, 1)
      const keys = result.map((r) => r.col.key)
      expect(keys).toContain('21A')
    })

    it('keeps OT A/B columns with content visible even when OT rounds drop to 0', () => {
      const columns = buildColumns(1)
      const ci = (key: string) => {
        const idx = columns.findIndex((c) => c.key === key)
        if (idx === -1) throw new Error(`Column ${key} not found`)
        return idx
      }
      const cells = blankCells(columns.length)
      cells[0]![0]![ci('21A')] = C
      const noJumps = columns.map(() => false)
      const result = computeVisibleColumns(cells, columns, noJumps, 0)
      const keys = result.map((r) => r.col.key)
      expect(keys).toContain('21A')
    })
  })

  describe('normal regulation columns', () => {
    it('always shows normal regulation columns (Q1-15, Q16-20 base)', () => {
      const columns = buildColumns()
      const cells = blankCells(columns.length)
      const noJumps = columns.map(() => false)
      const result = computeVisibleColumns(cells, columns, noJumps, 0)
      const keys = result.map((r) => r.col.key)
      for (let n = 1; n <= 20; n++) {
        expect(keys).toContain(`${n}`)
      }
    })
  })
})

describe('computeOrphanedColumns', () => {
  describe('A/B orphans', () => {
    const columns = buildColumns()
    const ci = (key: string) => {
      const idx = columns.findIndex((c) => c.key === key)
      if (idx === -1) throw new Error(`Column ${key} not found`)
      return idx
    }

    it('A column with content but parent error is bypassed (cascadeDisabled) is orphaned', () => {
      const cells = blankCells(columns.length)
      cells[0]![0]![ci('17')] = E
      cells[1]![0]![ci('17A')] = C // answer on bypassed A column
      const noJumps = columns.map(() => false)
      const cascadeDisabled = new Set([ci('17A')])
      const orphaned = computeOrphanedColumns(cells, columns, noJumps, 0, cascadeDisabled)
      expect(orphaned.has(ci('17A'))).toBe(true)
    })

    it('B column with content is NOT orphaned when A was bypassed', () => {
      const cells = blankCells(columns.length)
      cells[0]![0]![ci('17')] = E
      cells[1]![0]![ci('17B')] = B // answer on B, A was bypassed
      const noJumps = columns.map(() => false)
      const cascadeDisabled = new Set([ci('17A')])
      const orphaned = computeOrphanedColumns(cells, columns, noJumps, 0, cascadeDisabled)
      expect(orphaned.has(ci('17B'))).toBe(false)
    })

    it('A column with content but no parent error is orphaned', () => {
      const cells = blankCells(columns.length)
      cells[0]![0]![ci('17A')] = C
      const noJumps = columns.map(() => false)
      const orphaned = computeOrphanedColumns(cells, columns, noJumps, 0)
      expect(orphaned.has(ci('17A'))).toBe(true)
    })

    it('B column with content but no A error is orphaned', () => {
      const cells = blankCells(columns.length)
      cells[0]![0]![ci('17B')] = B
      const noJumps = columns.map(() => false)
      const orphaned = computeOrphanedColumns(cells, columns, noJumps, 0)
      expect(orphaned.has(ci('17B'))).toBe(true)
    })

    it('A column with no-jump but no parent error is orphaned', () => {
      const cells = blankCells(columns.length)
      const noJumps = columns.map(() => false)
      noJumps[ci('17A')] = true
      const orphaned = computeOrphanedColumns(cells, columns, noJumps, 0)
      expect(orphaned.has(ci('17A'))).toBe(true)
    })

    it('A column triggered by parent error is NOT orphaned', () => {
      const cells = blankCells(columns.length)
      cells[0]![0]![ci('17')] = E
      cells[1]![0]![ci('17A')] = C
      const noJumps = columns.map(() => false)
      const orphaned = computeOrphanedColumns(cells, columns, noJumps, 0)
      expect(orphaned.has(ci('17A'))).toBe(false)
    })

    it('B column triggered by A error is NOT orphaned', () => {
      const cells = blankCells(columns.length)
      cells[0]![0]![ci('17')] = E
      cells[1]![0]![ci('17A')] = E
      cells[2]![0]![ci('17B')] = B
      const noJumps = columns.map(() => false)
      const orphaned = computeOrphanedColumns(cells, columns, noJumps, 0)
      expect(orphaned.has(ci('17B'))).toBe(false)
    })

    it('hidden A/B columns (no content, no parent error) are NOT orphaned', () => {
      const cells = blankCells(columns.length)
      const noJumps = columns.map(() => false)
      const orphaned = computeOrphanedColumns(cells, columns, noJumps, 0)
      expect(orphaned.has(ci('17A'))).toBe(false)
      expect(orphaned.has(ci('17B'))).toBe(false)
    })

    it('normal regulation columns are never orphaned', () => {
      const cells = blankCells(columns.length)
      const noJumps = columns.map(() => false)
      const orphaned = computeOrphanedColumns(cells, columns, noJumps, 0)
      for (let n = 1; n <= 20; n++) {
        expect(orphaned.has(ci(`${n}`))).toBe(false)
      }
    })
  })

  describe('OT orphans', () => {
    it('OT column with content beyond visible rounds is orphaned', () => {
      const columns = buildColumns(2)
      const ci = (key: string) => {
        const idx = columns.findIndex((c) => c.key === key)
        if (idx === -1) throw new Error(`Column ${key} not found`)
        return idx
      }
      const cells = blankCells(columns.length)
      cells[0]![0]![ci('21')] = C
      const noJumps = columns.map(() => false)
      // visibleOtRounds = 0, so Q21 is beyond max
      const orphaned = computeOrphanedColumns(cells, columns, noJumps, 0)
      expect(orphaned.has(ci('21'))).toBe(true)
    })

    it('OT column with no-jump beyond visible rounds is orphaned', () => {
      const columns = buildColumns(2)
      const ci = (key: string) => {
        const idx = columns.findIndex((c) => c.key === key)
        if (idx === -1) throw new Error(`Column ${key} not found`)
        return idx
      }
      const cells = blankCells(columns.length)
      const noJumps = columns.map(() => false)
      noJumps[ci('22')] = true
      const orphaned = computeOrphanedColumns(cells, columns, noJumps, 0)
      expect(orphaned.has(ci('22'))).toBe(true)
    })

    it('OT column within visible rounds is NOT orphaned', () => {
      const columns = buildColumns(2)
      const ci = (key: string) => {
        const idx = columns.findIndex((c) => c.key === key)
        if (idx === -1) throw new Error(`Column ${key} not found`)
        return idx
      }
      const cells = blankCells(columns.length)
      cells[0]![0]![ci('21')] = C
      const noJumps = columns.map(() => false)
      // visibleOtRounds = 1, Q21 is within range
      const orphaned = computeOrphanedColumns(cells, columns, noJumps, 1)
      expect(orphaned.has(ci('21'))).toBe(false)
    })

    it('empty OT column beyond visible rounds is NOT orphaned (just hidden)', () => {
      const columns = buildColumns(2)
      const ci = (key: string) => {
        const idx = columns.findIndex((c) => c.key === key)
        if (idx === -1) throw new Error(`Column ${key} not found`)
        return idx
      }
      const cells = blankCells(columns.length)
      const noJumps = columns.map(() => false)
      const orphaned = computeOrphanedColumns(cells, columns, noJumps, 0)
      expect(orphaned.has(ci('24'))).toBe(false)
    })

    it('OT A/B column with content beyond visible rounds is orphaned', () => {
      const columns = buildColumns(1)
      const ci = (key: string) => {
        const idx = columns.findIndex((c) => c.key === key)
        if (idx === -1) throw new Error(`Column ${key} not found`)
        return idx
      }
      const cells = blankCells(columns.length)
      cells[0]![0]![ci('21A')] = C
      const noJumps = columns.map(() => false)
      const orphaned = computeOrphanedColumns(cells, columns, noJumps, 0)
      expect(orphaned.has(ci('21A'))).toBe(true)
    })
  })
})
