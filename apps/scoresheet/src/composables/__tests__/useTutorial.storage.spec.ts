import { describe, it, expect, vi } from 'vitest'
import { currentTab, startTab } from '../../persistence/autoSave'
import { useScoresheet } from '../useScoresheet'
import { useTutorial } from '../useTutorial'
import { CellValue, toColIdx, toSeatIdx, toTeamIdx } from '@qzr/shared'

// No startTab here: the tab is what the sheet has when the device's storage could not be opened
describe("useTutorial — without the device's storage", () => {
  it('gives back the quiz it set aside', () => {
    expect(currentTab()).toBeNull()
    const s = useScoresheet()
    s.setCell(toTeamIdx(0), toSeatIdx(0), toColIdx(0), CellValue.Correct)
    const t = useTutorial(s)
    t.start()
    t.finish()
    expect(s.cells.value[0]![0]![0]).toBe(CellValue.Correct)
    expect(s.canUndo.value).toBe(true)
  })

  it('ends when the quiz is replaced while it runs', () => {
    const s = useScoresheet()
    s.setCell(toTeamIdx(0), toSeatIdx(0), toColIdx(0), CellValue.Correct)
    const t = useTutorial(s)
    t.start()
    s.replaceQuiz()
    expect(t.active.value).toBe(false)
  })

  it('says the quiz is not being kept when the tab could not start', async () => {
    const open = vi.spyOn(indexedDB, 'open').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    await expect(startTab()).rejects.toThrow()
    open.mockRestore()
    expect(useScoresheet().keepFailed.value).toBe('failed')
  })
})
