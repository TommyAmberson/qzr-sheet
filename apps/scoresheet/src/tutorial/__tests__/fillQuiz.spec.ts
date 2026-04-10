import { describe, it, expect, beforeEach } from 'vitest'
import { useScoresheet } from '../../composables/useScoresheet'
import { CellValue } from '../../types/scoresheet'
import { TUTORIAL_STEPS, type ScoresheetActions } from '../tutorialSteps'

beforeEach(() => localStorage.clear())

function buildActions(s: ReturnType<typeof useScoresheet>): ScoresheetActions {
  return {
    setQuizzerName: s.setQuizzerName,
    setTeamName: s.setTeamName,
    setCell: s.setCell,
    toggleNoJump: s.toggleNoJump,
    toggleTimeout: s.toggleTimeout,
    toggleOnTime: s.toggleOnTime,
    moveQuizzer: s.moveQuizzer,
    columns: s.columns,
    teams: s.teams,
    quiz: s.quiz,
  }
}

function runSetup(id: string, actions: ScoresheetActions) {
  const step = TUTORIAL_STEPS.find((st) => st.id === id)
  if (!step) throw new Error(`Tutorial step not found: ${id}`)
  step.setup?.(actions)
}

function runOnNext(id: string, actions: ScoresheetActions) {
  const step = TUTORIAL_STEPS.find((st) => st.id === id)
  if (!step) throw new Error(`Tutorial step not found: ${id}`)
  step.onNext?.(actions)
}

/**
 * Runs the regulation portion of the tutorial fast-forward: fast-forward-1 setup,
 * the skip path of the Q18 A/B interactive steps, then fast-forward-2 setup.
 * Also toggles no-jump on Q5 to match the tutorial's `no-jump` step state.
 */
function runRegulationFill(s: ReturnType<typeof useScoresheet>): ScoresheetActions {
  const actions = buildActions(s)
  // The tutorial sets Q5 as no-jump in the `no-jump` step before fast-forward-1 runs.
  // The fill-quiz setup relies on that already being set.
  s.toggleNoJump(4)
  runSetup('fast-forward-1', actions)
  // Q18 chain is normally interactive — simulate the skip path via onNext callbacks.
  runOnNext('q18-error', actions)
  runOnNext('q18a-error', actions)
  runOnNext('q18b-bonus', actions)
  runSetup('fast-forward-2', actions)
  return actions
}

describe('tutorial fill-quiz — produces a valid tied quiz', () => {
  it('has no validation errors after full fill', () => {
    const s = useScoresheet()
    runRegulationFill(s)
    expect(s.hasAnyErrors.value).toBe(false)
  })

  it('completes all regulation questions Q1–Q20', () => {
    const s = useScoresheet()
    runRegulationFill(s)
    expect(s.allQuestionsComplete.value).toBe(true)
  })

  it('results in a three-way tie', () => {
    const s = useScoresheet()
    runRegulationFill(s)
    const totals = s.scoring.value.map((ts) => ts.total)
    expect(totals[0]).toBe(totals[1])
    expect(totals[1]).toBe(totals[2])
  })

  it('each team scores 120 (100 base + 20 on-time)', () => {
    const s = useScoresheet()
    runRegulationFill(s)
    s.scoring.value.forEach((ts) => expect(ts.total).toBe(120))
  })

  it('all teams have on-time bonus enabled', () => {
    const s = useScoresheet()
    runRegulationFill(s)
    s.teams.value.forEach((t) => expect(t.onTime).toBe(true))
  })

  it('overtime is not yet enabled (toggled interactively later)', () => {
    const s = useScoresheet()
    runRegulationFill(s)
    expect(s.quiz.value.overtime).toBe(false)
  })

  it('Q1 is a correct answer for team 1 quizzer 0', () => {
    const s = useScoresheet()
    runRegulationFill(s)
    expect(s.cells.value[0]![0]![0]).toBe(CellValue.Correct)
  })

  it('Q2 is an error for team 2 quizzer 0 (toss-up chain)', () => {
    const s = useScoresheet()
    runRegulationFill(s)
    expect(s.cells.value[1]![0]![1]).toBe(CellValue.Error)
  })

  it('Q4 is a missed bonus for team 1 quizzer 1', () => {
    const s = useScoresheet()
    runRegulationFill(s)
    expect(s.cells.value[0]![1]![3]).toBe(CellValue.MissedBonus)
  })

  it('Q17A (ci=19) is a correct answer for team 2 quizzer 2', () => {
    const s = useScoresheet()
    runRegulationFill(s)
    expect(s.cells.value[1]![2]![19]).toBe(CellValue.Correct)
  })

  it('Q18 chain: T1 q2 E → T2 q1 E → T3 q2 B', () => {
    const s = useScoresheet()
    runRegulationFill(s)
    expect(s.cells.value[0]![2]![21]).toBe(CellValue.Error) // Q18
    expect(s.cells.value[1]![1]![22]).toBe(CellValue.Error) // Q18A
    expect(s.cells.value[2]![2]![23]).toBe(CellValue.Bonus) // Q18B
  })

  it('Q20 (ci=27) is a no-jump', () => {
    const s = useScoresheet()
    runRegulationFill(s)
    expect(s.noJumps.value[27]).toBe(true)
  })

  it('T2 q3 stays empty (empty seat from tutorial remove-quizzer step)', () => {
    // The regulation fill must not touch T2 qi=3 since that seat was cleared
    // during the tutorial's remove-quizzer step.
    const s = useScoresheet()
    runRegulationFill(s)
    const t2q3Row = s.cells.value[1]![3]!
    // Every cell for T2 q3 in Q1–Q20 should be Empty
    for (let ci = 0; ci < 30; ci++) {
      expect(t2q3Row[ci]).toBe(CellValue.Empty)
    }
  })
})
