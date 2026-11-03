import { describe, expect, it } from 'vitest'
import { checkSchedule } from '../conflicts'
import { defaultElims } from '../elims'
import { applyPreview, generateSchedule, reflowSchedule, unappliedSettings } from '../reflow'
import { newScheduleDocument, type ScheduleDocument } from '../scheduleFile'

function meet(counts: number[]): ScheduleDocument {
  const doc = newScheduleDocument('Test')
  doc.settings.divisions = counts.map((teams, i) => ({
    id: `d${i + 1}`,
    name: `Div ${i + 1}`,
    teams,
    elims: defaultElims(teams),
  }))
  return generateSchedule(doc)
}

/** Move a quiz by hand to a free cell, as a drag does: it becomes pinned */
function dragToFreeCell(doc: ScheduleDocument, id: string): ScheduleDocument {
  const next = structuredClone(doc)
  const q = next.quizzes.find((x) => x.id === id)!
  const taken = new Set(
    next.quizzes.flatMap((x) => (x.cell ? [`${x.cell.slot}|${x.cell.room}`] : [])),
  )
  const slots = next.frame.filter((r) => r.kind === 'slot')
  const free = slots
    .flatMap((s) => next.rooms.map((r) => ({ slot: s.id, room: r.id })))
    .find((c) => !taken.has(`${c.slot}|${c.room}`))!
  q.cell = free
  q.pinned = true
  return next
}

const quiz = (doc: ScheduleDocument, id: string) => doc.quizzes.find((q) => q.id === id)!

describe('reflowSchedule', () => {
  it('never moves, changes or deletes a pinned quiz (H-19, SC-004)', () => {
    let doc = dragToFreeCell(meet([6, 17, 16]), 'd2-P5')
    const before = structuredClone(quiz(doc, 'd2-P5'))
    doc.settings.divisions[2]!.teams = 18
    doc.settings.divisions[2]!.elims = defaultElims(18)
    doc.settings.slotMinutes = 20
    doc.settings.rooms = 6
    doc = reflowSchedule(doc)
    expect(quiz(doc, 'd2-P5')).toEqual(before)
    expect(checkSchedule(doc).filter((c) => !c.warning)).toEqual([])
  })

  it('re-flows everything unpinned to the new settings', () => {
    const doc = meet([6, 17, 16])
    doc.settings.rooms = 6
    const after = reflowSchedule(doc)
    expect(after.rooms).toHaveLength(6)
    expect(after.applied).toEqual(after.settings)
  })

  it('keeps a pinned quiz that no longer fits, marked with the conflict it causes', () => {
    let doc = dragToFreeCell(meet([10]), 'd1-P10')
    doc.settings.divisions[0]!.teams = 8
    doc.settings.divisions[0]!.elims = defaultElims(8)
    doc = reflowSchedule(doc)
    expect(quiz(doc, 'd1-P10').pinned).toBe(true)
    expect(checkSchedule(doc).some((c) => c.rule === 'H-10' && c.quizzes.includes('d1-P10'))).toBe(
      true,
    )
  })

  it('sends a pinned quiz in a removed room to the tray, still pinned', () => {
    let doc = meet([6, 17, 16])
    const last = doc.rooms.at(-1)!.id
    const q = doc.quizzes.find((x) => x.cell?.room === last)!
    q.pinned = true
    doc.settings.rooms = doc.rooms.length - 1
    doc = reflowSchedule(doc)
    expect(quiz(doc, q.id).cell).toBeNull()
    expect(quiz(doc, q.id).pinned).toBe(true)
  })

  it('hands an unpinned quiz back to the generator', () => {
    let doc = dragToFreeCell(meet([6]), 'd1-P3')
    quiz(doc, 'd1-P3').pinned = false
    doc = reflowSchedule(doc)
    expect(quiz(doc, 'd1-P3').cell).toEqual(quiz(meet([6]), 'd1-P3').cell)
    expect(checkSchedule(doc).filter((c) => !c.warning)).toEqual([])
  })
})

describe('Auto-apply off (FR-012a)', () => {
  it('lists each unapplied setting with the value the grid was built with', () => {
    const doc = meet([6, 17])
    doc.settings.slotMinutes = 20
    doc.settings.divisions[1]!.teams = 18
    const list = unappliedSettings(doc)
    expect(list).toContainEqual({ section: 'frame', key: 'slotMinutes', applied: '25' })
    expect(list).toContainEqual({ section: 'teams', key: 'd2.teams', applied: '17' })
  })

  it('a setting changed back to its applied value is no longer unapplied', () => {
    const doc = meet([6])
    doc.settings.slotMinutes = 20
    doc.settings.slotMinutes = 25
    expect(unappliedSettings(doc)).toEqual([])
  })

  it('says how many quizzes Apply will move before it applies', () => {
    const doc = meet([6, 17, 16])
    doc.settings.rooms = 6
    const preview = applyPreview(doc)
    expect(preview.moves).toBeGreaterThan(0)
    expect(preview.doc.rooms).toHaveLength(6)
  })
})
