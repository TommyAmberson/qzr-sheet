import { describe, it, expect } from 'vitest'
import { useHistory } from '../useHistory'

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
})
