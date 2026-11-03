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

describe('re-flow with rooms and quizzes from elsewhere', () => {
  it("keeps each room's id, name and meet room", () => {
    const doc = meet([6])
    doc.rooms = doc.rooms.map((r, i) => ({
      id: String(40 + i),
      name: `Hall ${i}`,
      meetRoomId: 40 + i,
    }))
    for (const q of doc.quizzes)
      if (q.cell) q.cell = { ...q.cell, room: String(40 + Number(q.cell.room.slice(5)) - 1) }
    doc.settings.slotMinutes = 30
    const after = reflowSchedule(doc)
    expect(after.rooms.slice(0, doc.rooms.length)).toEqual(doc.rooms)
  })

  it('a pinned quiz under another id stands in for the generated quiz it is, so nothing doubles', () => {
    const doc = meet([6])
    // As a schedule converted from the old editor: the old row ids, every quiz pinned
    doc.quizzes = doc.quizzes.map((q, i) => ({ ...q, id: String(100 + i), pinned: true }))
    doc.frame = doc.frame.map((r) => ({ ...r, pinned: true }))
    const after = reflowSchedule(doc)
    expect(after.quizzes).toHaveLength(doc.quizzes.length)
  })
})

describe('pinned Finals side by side', () => {
  it('keeps its cell to itself when two Finals run at once', () => {
    const doc = meet([6, 6, 6])
    doc.settings.finals.sideBySide = 2
    doc.applied.finals.sideBySide = 2
    const flowed = reflowSchedule(doc)
    const finalsSlots = flowed.frame.filter((r) => r.kind === 'slot' && r.use === 'finals')
    const deciding = flowed.quizzes.filter((q) => q.deciding && q.cell)
    // Pin one Final in the second finals slot's first room
    const pinned = deciding[0]!
    pinned.cell = { slot: finalsSlots[1]!.id, room: flowed.rooms[0]!.id }
    pinned.pinned = true
    const after = reflowSchedule(flowed)
    const cells = after.quizzes.filter((q) => q.cell).map((q) => `${q.cell!.slot}/${q.cell!.room}`)
    expect(new Set(cells).size).toBe(cells.length)
  })
})

describe('a converted schedule re-flowed', () => {
  it("names a pinned quiz in a regenerated seat by the pinned quiz's own id", () => {
    const doc = meet([9])
    const ids = new Map(doc.quizzes.map((q, i) => [q.id, String(500 + i)]))
    doc.quizzes = doc.quizzes.map((q) => ({
      ...q,
      id: ids.get(q.id)!,
      pinned: true,
      seats: q.seats.map((s) => (s.kind === 'place' ? { ...s, quiz: ids.get(s.quiz)! } : s)),
    }))
    // Unpin one elim that takes a place from another quiz, as a director would
    const taker = doc.quizzes.find((q) => q.seats.some((s) => s.kind === 'place'))!
    taker.pinned = false
    const after = reflowSchedule(doc)
    const known = new Set(after.quizzes.map((q) => q.id))
    for (const q of after.quizzes)
      for (const s of q.seats) if (s.kind === 'place') expect(known.has(s.quiz)).toBe(true)
  })
})
