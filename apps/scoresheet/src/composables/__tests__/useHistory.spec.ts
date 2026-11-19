import { describe, it, expect } from 'vitest'
import { useHistory } from '@qzr/ui'

describe('useHistory', () => {
  it('canUndo is false initially', () => {
    const h = useHistory()
    expect(h.canUndo.value).toBe(false)
  })

  it('canRedo is false initially', () => {
    const h = useHistory()
    expect(h.canRedo.value).toBe(false)
  })

  it('canUndo is true after a push', () => {
    const h = useHistory()
    h.push({ undo: () => {}, redo: () => {} })
    expect(h.canUndo.value).toBe(true)
  })

  it('undo calls the undo fn and makes canUndo false when stack is empty', () => {
    const h = useHistory()
    let val = 1
    h.push({ undo: () => (val = 0), redo: () => (val = 1) })
    h.undo()
    expect(val).toBe(0)
    expect(h.canUndo.value).toBe(false)
  })

  it('redo calls the redo fn after undo', () => {
    const h = useHistory()
    let val = 1
    h.push({ undo: () => (val = 0), redo: () => (val = 1) })
    h.undo()
    h.redo()
    expect(val).toBe(1)
    expect(h.canRedo.value).toBe(false)
  })

  it('pushing a new command clears the redo stack', () => {
    const h = useHistory()
    h.push({ undo: () => {}, redo: () => {} })
    h.undo()
    expect(h.canRedo.value).toBe(true)
    h.push({ undo: () => {}, redo: () => {} })
    expect(h.canRedo.value).toBe(false)
  })

  it('undo does nothing when stack is empty', () => {
    const h = useHistory()
    expect(() => h.undo()).not.toThrow()
  })

  it('redo does nothing when redo stack is empty', () => {
    const h = useHistory()
    expect(() => h.redo()).not.toThrow()
  })

  it('supports multiple undo steps', () => {
    const h = useHistory()
    const log: number[] = []
    h.push({ undo: () => log.push(1), redo: () => {} })
    h.push({ undo: () => log.push(2), redo: () => {} })
    h.push({ undo: () => log.push(3), redo: () => {} })
    h.undo()
    h.undo()
    expect(log).toEqual([3, 2])
    expect(h.canUndo.value).toBe(true)
  })

  it('caps history at MAX_HISTORY entries', () => {
    const h = useHistory(3)
    let val = 0
    for (let i = 0; i < 5; i++) {
      const captured = i
      h.push({ undo: () => (val = captured), redo: () => {} })
    }
    // Only last 3 pushes are kept; undo 3 times should bottom out
    h.undo() // val = 4
    h.undo() // val = 3
    h.undo() // val = 2
    expect(val).toBe(2)
    expect(h.canUndo.value).toBe(false)
  })

  it('clear resets both stacks', () => {
    const h = useHistory()
    h.push({ undo: () => {}, redo: () => {} })
    h.undo()
    h.clear()
    expect(h.canUndo.value).toBe(false)
    expect(h.canRedo.value).toBe(false)
  })

  describe("steps of the caller's own type", () => {
    interface Step {
      label: string
      undo: () => void
      redo: () => void
    }
    const step = (label: string, log: string[]): Step => ({
      label,
      undo: () => log.push(`undo ${label}`),
      redo: () => log.push(`redo ${label}`),
    })

    it('go in and come out as they went in', () => {
      const h = useHistory<Step>()
      const log: string[] = []
      h.push(step('a', log))
      h.push(step('b', log))
      h.undo()
      expect(h.undoSteps.value.map((s) => s.label)).toEqual(['a'])
      expect(h.redoSteps.value.map((s) => s.label)).toEqual(['b'])
    })

    it('can be set as stacks, and undone and redone from there', () => {
      const h = useHistory<Step>()
      const log: string[] = []
      h.setStacks([step('a', log), step('b', log)], [step('c', log)])
      expect(h.canUndo.value).toBe(true)
      expect(h.canRedo.value).toBe(true)
      h.redo()
      h.undo()
      h.undo()
      expect(log).toEqual(['redo c', 'undo c', 'undo b'])
      expect(h.undoSteps.value.map((s) => s.label)).toEqual(['a'])
      expect(h.redoSteps.value.map((s) => s.label)).toEqual(['c', 'b'])
    })

    it('keep to the limit passed in, the oldest falling off', () => {
      const h = useHistory<Step>(1000)
      const log: string[] = []
      for (let i = 0; i < 1001; i++) h.push(step(String(i), log))
      expect(h.undoSteps.value).toHaveLength(1000)
      expect(h.undoSteps.value[0]!.label).toBe('1')
      h.setStacks(
        Array.from({ length: 1001 }, (_, i) => step(String(i), log)),
        [],
      )
      expect(h.undoSteps.value).toHaveLength(1000)
      expect(h.undoSteps.value[0]!.label).toBe('1')
    })
  })
})
