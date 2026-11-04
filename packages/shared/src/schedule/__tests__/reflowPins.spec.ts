import { describe, expect, it } from 'vitest'
import { checkSchedule } from '../conflicts'
import { defaultElims } from '../elims'
import {
  applyMoves,
  generateSchedule,
  reflowSchedule,
  replaceElims,
  unappliedSettings,
} from '../reflow'
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
  // A free cell is a quiz slot's; slots made for events are taken by them
  const slots = next.frame.filter((r) => r.kind === 'slot' && r.use !== 'event')
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

  it('lists a division swapped for another, though the count is the same', () => {
    const doc = meet([6, 17])
    doc.settings.divisions = [
      doc.settings.divisions[0]!,
      { ...doc.settings.divisions[1]!, id: 'd3', name: 'Div 3' },
    ]
    expect(unappliedSettings(doc)).toContainEqual({
      section: 'teams',
      key: 'divisions',
      applied: '2',
    })
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
    expect(applyMoves(doc)).toBeGreaterThan(0)
    expect(reflowSchedule(doc).rooms).toHaveLength(6)
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

describe('a pinned elim in the tray', () => {
  it('still lets the quizzes it feeds be placed', () => {
    const doc = meet([9])
    const source = doc.quizzes.find((q) =>
      doc.quizzes.some((x) => x.seats.some((s) => s.kind === 'place' && s.quiz === q.id)),
    )!
    source.cell = null
    source.pinned = true
    const after = reflowSchedule(doc)
    const fed = after.quizzes.filter((x) =>
      x.seats.some((s) => s.kind === 'place' && s.quiz === source.id),
    )
    expect(fed.length).toBeGreaterThan(0)
    expect(fed.every((q) => q.cell !== null)).toBe(true)
  })
})

describe('every prelim pinned', () => {
  it('still places the elims', () => {
    const doc = meet([6, 17])
    const placed = doc.quizzes.filter((q) => q.phase === 'elim' && q.cell).length
    for (const q of doc.quizzes) if (q.phase === 'prelim') q.pinned = true
    const after = reflowSchedule(doc)
    expect(after.quizzes.filter((q) => q.phase === 'elim' && q.cell)).toHaveLength(placed)
  })
})

describe('one-room events', () => {
  it('keep re-flow out of their room while they run', () => {
    const doc = meet([6, 17])
    const slot = doc.frame.find((r) => r.kind === 'slot' && r.use === 'prelim')!
    if (slot.kind !== 'slot') throw new Error('no slot')
    doc.events.push({
      id: 'chapel',
      label: 'Chapel',
      slot: slot.id,
      rooms: [doc.rooms[0]!.id],
      pinned: true,
    })
    const after = reflowSchedule(doc)
    expect(checkSchedule(after).filter((c) => c.rule === 'H-3')).toEqual([])
  })
})

describe('re-placing elims (FR-034a)', () => {
  it('moves nothing in a schedule straight from the generator', () => {
    const doc = meet([6, 17, 16])
    const after = replaceElims(doc, { divisions: ['d1', 'd2', 'd3'], includePinned: false })
    const cells = (d: ScheduleDocument) => new Map(d.quizzes.map((q) => [q.id, q.cell]))
    expect(cells(after)).toEqual(cells(doc))
  })

  it("places a division's elims again, leaving everything else and its events alone", () => {
    const start = meet([6, 17])
    // Move Div 2's first elim by hand, so it's pinned somewhere odd,
    const doc = dragToFreeCell(
      start,
      start.quizzes.find((q) => q.division === 'd2' && q.phase === 'elim')!.id,
    )
    // and pin a Div 1 elim where it is
    const d1Elim = doc.quizzes.find((q) => q.division === 'd1' && q.phase === 'elim')!.id
    quiz(doc, d1Elim).pinned = true
    const kept = structuredClone({ frame: doc.frame, events: doc.events, d1: quiz(doc, d1Elim) })

    const without = replaceElims(doc, { divisions: ['d2'], includePinned: false })
    // A pinned elim stays unless included
    expect(without.quizzes.filter((q) => q.division === 'd2' && q.pinned)).toHaveLength(1)

    const after = replaceElims(doc, { divisions: ['d2'], includePinned: true })
    const d2Elims = after.quizzes.filter((q) => q.division === 'd2' && q.phase === 'elim')
    expect(d2Elims.every((q) => q.cell !== null)).toBe(true)
    expect(checkSchedule(after).filter((c) => !c.warning)).toEqual([])
    expect(after.quizzes.filter((q) => q.division === 'd2' && q.pinned)).toEqual([])
    expect({ frame: after.frame, events: after.events, d1: quiz(after, d1Elim) }).toEqual(kept)
  })

  it('keeps a quiz added by hand, which the generator could never place again', () => {
    const doc = meet([8])
    const slot = doc.frame.find((r) => r.kind === 'slot' && r.use === 'elim')!.id
    const room = doc.rooms.find(
      (r) => !doc.quizzes.some((q) => q.cell?.slot === slot && q.cell.room === r.id),
    )
    doc.quizzes.push({
      id: 'by-hand',
      label: 'Div 1 Quiz Z',
      division: 'd1',
      phase: 'elim',
      cell: room ? { slot, room: room.id } : null,
      seats: [{ kind: 'empty' }, { kind: 'empty' }, { kind: 'empty' }],
      pinned: true,
    })
    const after = replaceElims(doc, { divisions: ['d1'], includePinned: true })
    expect(after.quizzes.find((q) => q.id === 'by-hand')).toEqual(
      doc.quizzes.find((q) => q.id === 'by-hand'),
    )
    // and no re-placed elim lands in its cell
    expect(checkSchedule(after).filter((c) => c.rule === 'H-2')).toEqual([])
  })

  it("doesn't bring back an elim deleted from a division it re-places", () => {
    const doc = meet([8])
    const gone = doc.quizzes.find((q) => q.phase === 'elim')!.id
    doc.quizzes = doc.quizzes.filter((q) => q.id !== gone)
    const after = replaceElims(doc, { divisions: ['d1'], includePinned: true })
    expect(after.quizzes.some((q) => q.id === gone)).toBe(false)
  })

  it("doesn't bring back quizzes deleted from the divisions it leaves alone", () => {
    const doc = meet([8, 8])
    const gone = [
      doc.quizzes.find((q) => q.division === 'd1' && q.phase === 'prelim')!.id,
      doc.quizzes.find((q) => q.division === 'd1' && q.phase === 'elim')!.id,
    ]
    doc.quizzes = doc.quizzes.filter((q) => !gone.includes(q.id))
    const after = replaceElims(doc, { divisions: ['d2'], includePinned: false })
    expect(after.quizzes).toHaveLength(doc.quizzes.length)
    expect(after.quizzes.some((q) => gone.includes(q.id))).toBe(false)
  })
})
