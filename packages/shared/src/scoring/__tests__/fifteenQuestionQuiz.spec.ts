import { describe, it, expect } from 'vitest'
import { PlacementFormula } from '../../types/scoresheet'
import { RULES, cols, buildCells } from './fixtures/fifteenQuestionQuiz'
import { scoreTeam } from '../scoreTeam'
import { computeGreyedOut } from '../greyedOut'
import { validateCells } from '../validation'
import { computeRegulationScores } from '../overtime'
import { computePlacements, computePlacementPoints } from '../placement'

describe('a complete 15-question quiz, scored by hand', () => {
  const cells = buildCells()
  const onTimes = [true, true, true]
  const scores = cells.map((team, i) => scoreTeam(team, cols, onTimes[i]!, RULES))

  it('is a valid sequence of answers', () => {
    const errors = validateCells(cells, cols, computeGreyedOut(cells, cols), RULES)
    expect(errors.size).toBe(0)
  })

  it('matches the hand-scored team totals', () => {
    expect(scores.map((s) => s.total)).toEqual([200, 30, 100])
  })

  it('matches the hand-scored quizzer totals and outs', () => {
    const a = scores[0]!.quizzers
    expect(a[0]!.points).toBe(70)
    expect(a[0]!.quizzedOut).toBe(true)
    expect(scores[2]!.quizzers[1]!.points).toBe(70)
    expect(scores[2]!.quizzers[1]!.quizzedOut).toBe(true)
    expect(scores[1]!.quizzers.some((q) => q.quizzedOut || q.erroredOut || q.fouledOut)).toBe(false)
  })

  it('places A, C, B with the Rules placement points', () => {
    const regScores = computeRegulationScores(cells, cols, onTimes, RULES)
    const places = computePlacements(regScores, [], true, false)
    expect(places).toEqual([1, 3, 2])
    const points = regScores.map((score, i) =>
      computePlacementPoints(score, places[i]!, PlacementFormula.Rules),
    )
    expect(points).toEqual([20, 1, 9])
  })
})
