import { describe, it, expect } from 'vitest'
import { deserialize } from '../../quizFileCodec'
import type { PlaceKey } from '../../types/scoresheet'
import { quizOutcome } from '../quizOutcome'
import { divisionStandings, type CountedQuiz } from '../standings'
import { fifteenQuestionQuizFile } from './fixtures/fifteenQuestionQuiz'

/** [team, place, placement points, score, errors] */
type Seat = [string, PlaceKey, number, number?, number?]

/** A placed quiz, built straight from its teams' results */
function quiz(name: string, seats: Seat[]): CountedQuiz {
  return {
    name,
    outcome: {
      placed: true,
      teams: seats.map(([team, place, placementPoints, score = 0, errors = 0]) => ({
        name: team,
        place,
        placementPoints,
        score,
        errors,
      })),
    },
  }
}

const ranking = (quizzes: CountedQuiz[]) =>
  divisionStandings(quizzes).teams.map((t) => [t.name, t.rank, t.decidedBy])

describe('divisionStandings', () => {
  it('totals placement points over the counted quizzes and ranks highest first', () => {
    // By hand: A 20 + 10 + 5 = 35 in 3, B 10 + 20 = 30, C 5 + 20 = 25, D 5 + 10 = 15
    const standings = divisionStandings([
      quiz('Q1', [
        ['A', 1, 20],
        ['B', 2, 10],
        ['C', 3, 5],
      ]),
      quiz('Q2', [
        ['C', 1, 20],
        ['A', 2, 10],
        ['D', 3, 5],
      ]),
      quiz('Q3', [
        ['B', 1, 20],
        ['D', 2, 10],
        ['A', 3, 5],
      ]),
    ])
    expect(standings.teams.map((t) => [t.name, t.placementPoints, t.quizzes, t.rank])).toEqual([
      ['A', 35, 3, 1],
      ['B', 30, 2, 2],
      ['C', 25, 2, 3],
      ['D', 15, 2, 4],
    ])
    expect(standings.teams.map((t) => t.finalist)).toEqual([true, true, true, false])
    expect(standings.teams.every((t) => t.decidedBy === null && !t.tied)).toBe(true)
  })

  it('scores a stored quiz file as the scoresheet places it', () => {
    const standings = divisionStandings([
      { name: 'Q1', outcome: quizOutcome(deserialize(fifteenQuestionQuizFile())) },
    ])
    expect(standings.teams.map((t) => [t.name, t.placementPoints])).toEqual([
      ['Team A', 20],
      ['Team C', 9],
      ['Team B', 1],
    ])
  })

  describe('head-to-head (FR-011a)', () => {
    it('ranks the one of two tied teams that finished above the other more often', () => {
      expect(
        ranking([
          quiz('Q1', [
            ['B', 1, 20],
            ['A', 2, 10],
            ['C', 3, 5],
          ]),
          quiz('Q2', [
            ['A', 1, 20],
            ['C', 2, 10],
            ['D', 3, 5],
          ]),
          quiz('Q3', [
            ['B', 1, 10],
            ['D', 2, 5],
            ['C', 3, 1],
          ]),
        ]).slice(0, 2),
      ).toEqual([
        ['B', 1, 'headToHead'],
        ['A', 2, 'headToHead'],
      ])
    })

    it('ranks a team of three tied ahead only if it beat each of the others, then the rest', () => {
      // B above A (Q1) and above D (Q3); A above D (Q2)
      expect(
        ranking([
          quiz('Q1', [
            ['B', 1, 20],
            ['A', 2, 10],
            ['C', 3, 5],
          ]),
          quiz('Q2', [
            ['A', 1, 20],
            ['D', 2, 10],
            ['C', 3, 5],
          ]),
          quiz('Q3', [
            ['B', 2, 10],
            ['D', 3, 20],
            ['C', 1, 5],
          ]),
        ]).filter(([name]) => name !== 'C'),
      ).toEqual([
        ['B', 1, 'headToHead'],
        ['A', 2, 'headToHead'],
        ['D', 3, 'headToHead'],
      ])
    })

    it('decides nothing among three tied teams that beat each other in a circle', () => {
      // B above A, A above D, D above B: total points decide
      expect(
        ranking([
          quiz('Q1', [
            ['B', 1, 20, 100],
            ['A', 2, 10, 300],
          ]),
          quiz('Q2', [
            ['A', 1, 20],
            ['D', 2, 10, 200],
          ]),
          quiz('Q3', [
            ['D', 1, 20],
            ['B', 2, 10, 150],
          ]),
        ]),
      ).toEqual([
        ['A', 1, 'points'],
        ['B', 2, 'points'],
        ['D', 3, 'points'],
      ])
    })

    it('decides nothing for teams that never met, or that are level', () => {
      const neverMet = [quiz('Q1', [['A', 1, 20, 100]]), quiz('Q2', [['B', 1, 20, 200]])]
      expect(ranking(neverMet)).toEqual([
        ['B', 1, 'points'],
        ['A', 2, 'points'],
      ])
      const level = [
        quiz('Q1', [
          ['A', 1, 20, 100],
          ['B', 2, 10],
        ]),
        quiz('Q2', [
          ['B', 1, 20, 200],
          ['A', 2, 10],
        ]),
      ]
      expect(ranking(level)).toEqual([
        ['B', 1, 'points'],
        ['A', 2, 'points'],
      ])
    })
  })

  it('breaks a tie on total points scored, then on fewest errors (FR-011)', () => {
    expect(
      ranking([
        quiz('Q1', [['A', 1, 20, 100, 3]]),
        quiz('Q2', [['B', 1, 20, 100, 1]]),
        quiz('Q3', [['C', 1, 20, 150, 5]]),
      ]),
    ).toEqual([
      ['C', 1, 'points'],
      ['B', 2, 'errors'],
      ['A', 3, 'errors'],
    ])
  })

  it('shares a rank for a tie no criterion breaks, and flags one at the finalist cutoff (FR-012)', () => {
    const standings = divisionStandings([
      quiz('Q1', [['A', 1, 40]]),
      quiz('Q2', [['B', 1, 30]]),
      quiz('Q3', [['C', 1, 20, 100, 2]]),
      quiz('Q4', [['D', 1, 20, 100, 2]]),
    ])
    expect(standings.teams.map((t) => [t.name, t.rank, t.tied, t.finalist])).toEqual([
      ['A', 1, false, true],
      ['B', 2, false, true],
      ['C', 3, true, false],
      ['D', 3, true, false],
    ])
    expect(standings.warnings).toContainEqual({ kind: 'finalTie', teams: ['C', 'D'] })
  })

  it("doesn't flag a tie that every team of it reaches the final through", () => {
    const standings = divisionStandings([
      quiz('Q1', [['A', 1, 20]]),
      quiz('Q2', [['B', 1, 20]]),
      quiz('Q3', [['C', 1, 10]]),
      quiz('Q4', [['D', 1, 5]]),
    ])
    expect(standings.teams.map((t) => [t.name, t.rank, t.tied, t.finalist])).toEqual([
      ['A', 1, true, true],
      ['B', 1, true, true],
      ['C', 3, false, true],
      ['D', 4, false, false],
    ])
    expect(standings.warnings.some((w) => w.kind === 'finalTie')).toBe(false)
  })

  it('leaves out a team with no name, an empty seat', () => {
    const standings = divisionStandings([
      quiz('Q1', [
        ['A', 1, 20],
        ['B', 2, 10],
        [' ', 3, 1],
      ]),
    ])
    expect(standings.teams.map((t) => t.name)).toEqual(['A', 'B'])
  })

  it('makes every team a finalist in a division of fewer than three', () => {
    const standings = divisionStandings([
      quiz('Q1', [
        ['A', 1, 20],
        ['B', 2, 10],
      ]),
    ])
    expect(standings.teams.map((t) => t.finalist)).toEqual([true, true])
  })

  it('warns when teams have played different numbers of counted quizzes (FR-014)', () => {
    const standings = divisionStandings([
      quiz('Q1', [
        ['Airdrie', 1, 20],
        ['Banff', 2, 10],
      ]),
      quiz('Q2', [['Airdrie', 1, 20]]),
    ])
    expect(standings.warnings).toEqual([{ kind: 'unequalQuizCounts' }])
    expect(standings.teams.map((t) => [t.name, t.quizzes])).toEqual([
      ['Airdrie', 2],
      ['Banff', 1],
    ])
  })

  it("names a quiz that can't be placed, which adds nothing and isn't one of its teams' quizzes (R12)", () => {
    const unplaced: CountedQuiz = {
      name: 'Q2',
      outcome: {
        placed: false,
        teams: [{ name: 'Banff', score: 50, place: null, placementPoints: null, errors: 0 }],
      },
    }
    const standings = divisionStandings([
      quiz('Q1', [
        ['Airdrie', 1, 20],
        ['Banff', 2, 10],
      ]),
      unplaced,
    ])
    expect(standings.teams.map((t) => [t.name, t.placementPoints, t.quizzes])).toEqual([
      ['Airdrie', 20, 1],
      ['Banff', 10, 1],
    ])
    expect(standings.warnings).toEqual([{ kind: 'unplaced', quiz: 'Q2' }])
  })

  describe('look-alike names (FR-016, R11)', () => {
    const flaggedPairs = (names: string[]) =>
      divisionStandings(
        names.map((name, i) => quiz(`Q${i + 1}`, [[name, 1, 20 - i]])),
      ).warnings.filter((w) => w.kind === 'lookAlike')

    it('flags a name one typo away from another, the higher ranked first', () => {
      expect(flaggedPairs(['Calgary 1', 'Calgry 1'])).toEqual([
        { kind: 'lookAlike', teams: ['Calgary 1', 'Calgry 1'] },
      ])
    })

    it('allows two edits between longer names, but one between short ones', () => {
      expect(flaggedPairs(['Calgary 1', 'Calgray 1'])).toHaveLength(1)
      expect(flaggedPairs(['Calgary', 'Calgary 1'])).toHaveLength(1)
      expect(flaggedPairs(['Abc', 'Abx'])).toHaveLength(1)
      expect(flaggedPairs(['Abc', 'Xyc'])).toHaveLength(0)
    })

    it("doesn't flag teams with different numbers or letters, as one church's teams have", () => {
      expect(flaggedPairs(['Calgary 1', 'Calgary 2'])).toEqual([])
      expect(flaggedPairs(['Calgary 1', 'Calgry 2'])).toEqual([])
      expect(flaggedPairs(['Regina A', 'Regina B', 'Regina C'])).toEqual([])
      expect(flaggedPairs(['Regina A', 'Regnia A'])).toHaveLength(1)
    })

    it("doesn't flag names that only differ in case and spaces, which are one team already", () => {
      expect(flaggedPairs(['Calgary 1', 'calgary  1'])).toEqual([])
    })
  })

  it('counts names differing only in case and spaces as one team, under its most-used spelling (FR-015)', () => {
    const standings = divisionStandings([
      quiz('Q1', [['calgary  1', 1, 20]]),
      quiz('Q2', [[' Calgary 1', 1, 20]]),
      quiz('Q3', [['Calgary 1', 1, 20]]),
      quiz('Q4', [['Calgary 1 ', 1, 20]]),
      quiz('Q5', [['Regina', 1, 5]]),
      quiz('Q6', [['REGINA', 1, 5]]),
    ])
    expect(standings.teams.map((t) => [t.name, t.placementPoints, t.quizzes])).toEqual([
      ['Calgary 1', 80, 4],
      ['Regina', 10, 2],
    ])
  })
})
