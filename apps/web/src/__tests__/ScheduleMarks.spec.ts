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
import { ScheduleSheet } from '@qzr/ui'

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

  it('draws the sheet as before with no marks, as the builder does', () => {
    const w = sheet(null)
    expect(w.find('.qz-seat-result').exists()).toBe(false)
    expect(w.find('.status').exists()).toBe(false)
    expect(bench(w, 0).find('.qz-seat-line').text()).toBe(drawn[0]!.name!)
  })
})
