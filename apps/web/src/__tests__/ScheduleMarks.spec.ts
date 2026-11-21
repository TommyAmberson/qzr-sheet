import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import {
  benchKey,
  generateSchedule,
  newScheduleDocument,
  type DayQuiz,
  type ScheduleDocument,
  type SettledBench,
} from '@qzr/shared'
import { ScheduleSheet, nameAndNumber } from '@qzr/ui'

// Results on the schedule (specs/010-meet-day, FR-009 to FR-011)

function published(): ScheduleDocument {
  const base = newScheduleDocument('Fall Meet')
  base.settings.divisions = [{ id: '1', name: '1', teams: 6, elims: { lanes: [], lines: [] } }]
  const doc = generateSchedule(base)
  doc.draw['1'] = {
    stale: false,
    teams: 'ABCDEF'.split('').map((letter, i) => ({
      letter,
      name: `Grace ${i + 1}`,
      late: false,
      absent: false,
    })),
  }
  return doc
}

const doc = published()
const quiz = doc.quizzes.find((q) => q.cell)!
/** The drawn team on each of the quiz's benches, in bench order */
const drawn = quiz.seats.map(
  (seat) => doc.draw['1']!.teams.find((t) => seat.kind === 'letter' && t.letter === seat.letter)!,
)

function sheet(day: DayQuiz | null, benches: Record<string, SettledBench> = {}) {
  return mount(ScheduleSheet, {
    props: {
      doc,
      view: 'teams',
      marks: day === null ? null : { quizzes: new Map([[quiz.id, day]]), benches },
    },
  })
}

const bench = (w: ReturnType<typeof sheet>, i: number) =>
  w.find(`[data-seat="${benchKey(quiz.id, i)}"]`)

describe('results on the schedule', () => {
  it("shows each team's place and score beside its bench, matched by name whatever its case", () => {
    const w = sheet({
      id: quiz.id,
      status: 'played',
      teams: [
        { name: drawn[1]!.name!.toUpperCase(), place: 1, score: 180 },
        { name: drawn[0]!.name!, place: 2, score: 120 },
        { name: drawn[2]!.name!, place: 3, score: 40 },
      ],
    })
    expect(bench(w, 1).find('.qz-seat-result').text()).toBe('1st · 180')
    expect(bench(w, 0).find('.qz-seat-result').text()).toBe('2nd · 120')
    expect(w.find('.status').exists()).toBe(false)
  })

  it('shows places alone where the reader is given no scores, and lists a team no bench names', () => {
    const w = sheet({
      id: quiz.id,
      status: 'played',
      teams: [
        { name: drawn[0]!.name!, place: 1 },
        { name: 'Someone Else', place: 2 },
      ],
    })
    expect(bench(w, 0).find('.qz-seat-result').text()).toBe('1st')
    expect(w.find('.unplaced').text()).toBe('Someone Else · 2nd')
  })

  it('marks a shared place the same way on a bench and on the line below', () => {
    const w = sheet({
      id: quiz.id,
      status: 'played',
      teams: [
        { name: drawn[0]!.name!, place: 1, tiedWith: 2, score: 120 },
        { name: 'Someone Else', place: 1, tiedWith: 2, score: 120 },
      ],
    })
    expect(bench(w, 0).find('.qz-seat-result').text()).toBe('=1st · 120')
    expect(w.find('.unplaced').text()).toBe('Someone Else · =1st · 120')
  })

  it.each([
    ['attention', 'Needs attention'],
    ['underReview', 'Under review'],
    ['notCounted', 'Not counted'],
    ['hidden', 'Result not shown yet'],
  ] as const)('marks a quiz %s with its few words', (status, words) => {
    const w = sheet({ id: quiz.id, status, teams: [] })
    expect(w.find('.status').text()).toBe(words)
  })

  it('shows a settled team on its bench, and a tied bench as tied', () => {
    const w = sheet(
      { id: quiz.id, status: 'notIn', teams: [] },
      {
        [benchKey(quiz.id, 0)]: { team: 'Maple Hill 2' },
        [benchKey(quiz.id, 1)]: { tied: true },
      },
    )
    expect(bench(w, 0).find('.qz-seat-line').text()).toBe('Maple Hill 2')
    expect(bench(w, 1).find('.qz-seat-line').text()).toBe('Tied')
  })

  it("writes a settled team by the draw's short name, whatever room the line has, the full one in its tooltip", () => {
    const withIds = structuredClone(doc)
    const team = withIds.draw['1']!.teams[0]!
    team.teamId = 41
    team.name = 'GF 1'
    const w = mount(ScheduleSheet, {
      props: {
        doc: withIds,
        view: 'teams',
        marks: {
          quizzes: new Map([[quiz.id, { id: quiz.id, status: 'notIn', teams: [] } as DayQuiz]]),
          benches: { [benchKey(quiz.id, 0)]: { team: 'Grace Fellowship 1', teamId: 41 } },
        },
      },
    })
    const seat = w.find(`[data-seat="${benchKey(quiz.id, 0)}"]`)
    expect(seat.find('.qz-seat-line').text()).toBe('GF 1')
    expect(seat.attributes('title')).toMatch(/ · Grace Fellowship 1$/)
  })

  it("keeps a team's number apart from its name, so cutting the name short keeps it", () => {
    const w = sheet(
      { id: quiz.id, status: 'notIn', teams: [] },
      { [benchKey(quiz.id, 0)]: { team: 'Maple Hill Bible Fellowship 12' } },
    )
    const line = bench(w, 0).find('.qz-seat-line')
    expect(line.find('.fit-name-head').text()).toBe('Maple Hill Bible Fellowship')
    expect(line.find('.fit-name-number').text()).toBe('12')
    // The bench's source, and the name the line may have cut short
    expect(bench(w, 0).attributes('title')).toMatch(/ · Maple Hill Bible Fellowship 12$/)
    expect(nameAndNumber('Grace 2B')).toEqual({ head: 'Grace', number: ' 2B' })
    expect(nameAndNumber('Absent')).toEqual({ head: 'Absent', number: '' })
  })

  it('draws the sheet as before with no marks, as the builder does', () => {
    const w = sheet(null)
    expect(w.find('.qz-seat-result').exists()).toBe(false)
    expect(w.find('.status').exists()).toBe(false)
    expect(bench(w, 0).find('.qz-seat-line').text()).toBe(drawn[0]!.name!)
  })
})

describe("a seat's source beyond the draw", () => {
  /** The quiz with its first bench filled from a re-rank and its second from a rank, the third drawn */
  function ranked() {
    const withRanks = structuredClone(doc)
    const q = withRanks.quizzes.find((x) => x.id === quiz.id)!
    q.seats[0] = { kind: 'new', rank: 11 }
    q.seats[1] = { kind: 'rank', rank: 3 }
    return withRanks
  }
  const seatOf = (w: ReturnType<typeof mount>, i: number) =>
    w.find(`[data-seat="${benchKey(quiz.id, i)}"]`)

  it('is written faintly on the line until its team is known, nothing left of the bench', () => {
    const w = mount(ScheduleSheet, { props: { doc: ranked(), view: 'teams' } })
    const seat = seatOf(w, 0)
    expect(seat.find('.qz-seat-src').text()).toBe('')
    const line = seat.find('.qz-seat-line')
    expect(line.classes()).toContain('ghost')
    expect(line.text()).toBe(seat.attributes('title'))
    expect(line.text()).toMatch(/11/)
    // A drawn letter stays left of the bench
    expect(seatOf(w, 2).find('.qz-seat-src').text()).toBe(
      quiz.seats[2]!.kind === 'letter' ? quiz.seats[2]!.letter : '',
    )
  })

  it('gives way to the team once known, the source kept for the tooltip', () => {
    const w = mount(ScheduleSheet, {
      props: {
        doc: ranked(),
        view: 'teams',
        marks: {
          quizzes: new Map([[quiz.id, { id: quiz.id, status: 'notIn', teams: [] } as DayQuiz]]),
          benches: { [benchKey(quiz.id, 0)]: { team: 'Maple Hill 2' } },
        },
      },
    })
    const seat = seatOf(w, 0)
    const line = seat.find('.qz-seat-line')
    expect(line.classes()).not.toContain('ghost')
    expect(line.text()).toBe('Maple Hill 2')
    expect(seat.find('.qz-seat-src').text()).toBe('')
    expect(seat.attributes('title')).toMatch(/11 · Maple Hill 2$/)
  })

  it('stays left of the bench in the builder, where seats are edited', () => {
    const w = mount(ScheduleSheet, { props: { doc: ranked(), view: 'teams', editable: true } })
    const seat = seatOf(w, 0)
    expect(seat.find('.qz-seat-src').text()).toMatch(/11/)
    expect(seat.find('.qz-seat-line').classes()).not.toContain('ghost')
  })
})
