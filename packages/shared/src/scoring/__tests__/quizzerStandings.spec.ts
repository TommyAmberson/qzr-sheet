import { describe, it, expect } from 'vitest'
import { foldName } from '../../results'
import { scoreStoredQuiz } from '../../stats/scoredQuiz'
import { quizzerStandings, type QuizzerFigures, type QuizzerQuiz } from '../quizzerStandings'
import { REFERENCE_TYPES, referenceMeet } from './fixtures/referenceMeet'

function figures(name: string, points: number, errors = 0, correct = points / 20): QuizzerFigures {
  return { name, points, errors, correct, types: correct ? { INT: correct } : {} }
}
function quiz(
  name: string,
  teams: Record<string, QuizzerFigures[]>,
  consolation = false,
): QuizzerQuiz {
  return {
    name,
    consolation,
    teams: Object.entries(teams).map(([team, quizzers]) => ({ name: team, quizzers })),
  }
}
/** The one list of a division with no consolation quiz */
function ranked(quizzes: QuizzerQuiz[]) {
  const lists = quizzerStandings(quizzes)
  expect(lists).toHaveLength(1)
  return lists[0]!.quizzers
}

describe('quizzerStandings', () => {
  it('totals each quizzer over the quizzes and averages over the quizzes their team played', () => {
    const [ann] = ranked([
      quiz('Q1', { Maple: [figures('Ann', 60, 1)] }),
      quiz('Q2', { Maple: [figures('Ann', 40)] }),
      quiz('Q3', { Maple: [figures('Ann', 20, 2)] }),
    ])
    expect(ann).toMatchObject({
      name: 'Ann',
      team: 'Maple',
      points: 120,
      errors: 3,
      jumps: 9,
      quizzes: 3,
      average: 40,
      types: { INT: 6 },
      flags: [],
    })
    expect(ann!.lines).toEqual([
      { quiz: 'Q1', points: 60, errors: 1, jumps: 4, types: { INT: 3 } },
      { quiz: 'Q2', points: 40, errors: 0, jumps: 2, types: { INT: 2 } },
      { quiz: 'Q3', points: 20, errors: 2, jumps: 3, types: { INT: 1 } },
    ])
  })

  it("divides by the team's quizzes when a quizzer sat one out, and flags both counts", () => {
    const [ann, bea] = ranked([
      quiz('Q1', { Maple: [figures('Ann', 60), figures('Bea', 20)] }),
      quiz('Q2', { Maple: [figures('Ann', 60)] }),
    ])
    expect(ann).toMatchObject({ average: 60, quizzes: 2, flags: [] })
    expect(bea).toMatchObject({
      average: 10,
      quizzes: 2,
      flags: [{ kind: 'quizCount', listed: 1, teamQuizzes: 2 }],
    })
  })

  it('ranks by average, then fewest errors', () => {
    const quizzers = ranked([
      quiz('Q1', { Maple: [figures('Ann', 100, 0, 5)], Cedar: [figures('Cy', 40, 1)] }),
      quiz('Q2', { Maple: [figures('Ann', 0)], Cedar: [figures('Cy', 40, 0)] }),
      quiz('Q3', { Maple: [figures('Ann', 0)], Cedar: [figures('Cy', 20, 0)] }),
      quiz('Q4', { Stone: [figures('Dee', 40, 3), figures('Eli', 40, 1)] }),
    ])
    // Eli and Dee average 40, Eli with fewer errors; Ann and Cy both average 100 / 3, Ann with none
    expect(quizzers.map((q) => [q.name, q.place])).toEqual([
      ['Eli', 1],
      ['Dee', 2],
      ['Ann', 3],
      ['Cy', 4],
    ])
    expect(quizzers[2]!.average).toBe(100 / 3)
  })

  it('gives quizzers level on average and errors one place, and skips the next', () => {
    const quizzers = ranked([
      quiz('Q1', {
        Maple: [figures('Ann', 40, 1), figures('Bea', 40, 1), figures('Col', 20)],
        Cedar: [figures('Cy', 60)],
      }),
    ])
    expect(quizzers.map((q) => [q.name, q.place])).toEqual([
      ['Cy', 1],
      ['Ann', 2],
      ['Bea', 2],
      ['Col', 4],
    ])
  })

  it('knows a quizzer by name within team, ignoring case and spacing', () => {
    const quizzers = ranked([
      quiz('Q1', { 'Maple 1': [figures('Ann  Lee', 20)], 'Cedar 1': [figures('Ann Lee', 20)] }),
      quiz('Q2', { 'maple 1': [figures('ann lee', 20)], 'Cedar 1': [figures('Ann Lee', 40)] }),
      quiz('Q3', { 'Maple 1': [figures('Ann Lee', 20)], 'Cedar 1': [figures('Ann Lee', 40)] }),
    ])
    expect(quizzers.map((q) => [q.name, q.team, q.points])).toEqual([
      ['Ann Lee', 'Cedar 1', 100],
      ['Ann Lee', 'Maple 1', 60],
    ])
  })

  it("flags type counts that don't add up to the correct answers", () => {
    const [ann, bea] = ranked([
      quiz('Q1', {
        Maple: [
          { name: 'Ann', points: 40, errors: 0, correct: 2, types: { INT: 1 } },
          { name: 'Bea', points: 20, errors: 1, correct: 1, types: { FTV: 1 } },
        ],
      }),
    ])
    expect(ann!.flags).toEqual([{ kind: 'incompleteTypes' }])
    expect(bea!.flags).toEqual([])
  })

  it('ranks the quizzers of consolation teams apart, over every quiz their team played', () => {
    const lists = quizzerStandings([
      quiz('Q1', { Maple: [figures('Ann', 20)], Cedar: [figures('Cy', 60)] }),
      quiz('Q2', { Maple: [figures('Ann', 40)], Cedar: [figures('Cy', 20)] }),
      quiz('cA', { Maple: [figures('Ann', 60)] }, true),
    ])
    expect(lists.map((list) => [list.consolation, list.quizzers.map((q) => q.name)])).toEqual([
      [false, ['Cy']],
      [true, ['Ann']],
    ])
    expect(lists[1]!.quizzers[0]).toMatchObject({ points: 120, quizzes: 3, average: 40, place: 1 })
  })

  it('leaves out a team with no name', () => {
    expect(quizzerStandings([quiz('Q1', { ' ': [figures('Ann', 20)] })])).toEqual([])
  })
})

describe('quizzerStandings against the reference meet', () => {
  it.each(['1', '2'])("agrees with the statistician's standings for division %s", (division) => {
    // The statistician counted every sheet as it was scored, the five with slips included
    const lists = quizzerStandings(
      referenceMeet.quizzes
        .filter(({ sheet }) => sheet.startsWith(`D${division}`))
        // The old sheets mark a consolation quiz in its number, not in the quiz file's own flag
        .map(({ sheet, file }) => ({
          ...scoreStoredQuiz(file),
          name: sheet,
          consolation: /^D\dc/.test(sheet),
        })),
    )
    const theirs = referenceMeet.quizzerStandings.filter((row) => row.division === division)
    expect(theirs.length).toBeGreaterThan(30)
    const differing = theirs.flatMap((row) => {
      const quizzer = lists
        .find((list) => list.consolation === row.consolation)
        ?.quizzers.find(
          (q) =>
            foldName(q.team) === foldName(row.team) && foldName(q.name) === foldName(row.quizzer),
        )
      const ours = quizzer && {
        place: quizzer.place,
        average: quizzer.average.toFixed(2),
        points: quizzer.points,
        errors: quizzer.errors,
        jumps: quizzer.jumps,
        quizzes: quizzer.quizzes,
        types: REFERENCE_TYPES.map((type) => quizzer.types[type] ?? 0),
        typesComplete: !quizzer.flags.some((flag) => flag.kind === 'incompleteTypes'),
      }
      const expected = {
        place: row.place,
        average: row.average.toFixed(2),
        points: row.points,
        errors: row.errors,
        jumps: row.jumps,
        quizzes: row.quizzes,
        types: row.types,
        typesComplete: row.typesComplete,
      }
      return JSON.stringify(ours) === JSON.stringify(expected) ? [] : [{ expected, ours }]
    })
    expect(differing).toEqual([])
  })
})
