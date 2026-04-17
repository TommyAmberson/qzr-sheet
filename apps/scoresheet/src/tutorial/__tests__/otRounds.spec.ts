import { describe, it, expect, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { useScoresheet } from '../../composables/useScoresheet'
import { TUTORIAL_STEPS, type ScoresheetActions } from '../tutorialSteps'
import { toColIdx } from '../../types/indices'

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
 * Reach the tied regulation state (T1=T2=T3=120), then enable overtime
 * (simulating the `overtime-toggle` step's onNext).
 */
function runThroughRegulationAndEnableOT(s: ReturnType<typeof useScoresheet>): ScoresheetActions {
  const actions = buildActions(s)
  s.toggleNoJump(toColIdx(4)) // Q5 no-jump (set by earlier tutorial step)
  runSetup('fast-forward-1', actions)
  runOnNext('q18-error', actions)
  runOnNext('q18a-error', actions)
  runOnNext('q18b-bonus', actions)
  runSetup('fast-forward-2', actions)
  runOnNext('overtime-toggle', actions)
  return actions
}

describe('tutorial OT round 1', () => {
  it('T3 falls behind after round 1', () => {
    const s = useScoresheet()
    const actions = runThroughRegulationAndEnableOT(s)
    runSetup('ot-round-1', actions)
    const [t1, t2, t3] = s.scoring.value.map((ts) => ts.total)
    // T3 errored on Q23, T1 and T2 each net-zero (error + toss-up correct)
    expect(t3).toBeLessThan(t1!)
    expect(t3).toBeLessThan(t2!)
    // T1 and T2 should still be tied after round 1
    expect(t1).toBe(t2)
  })

  it('T1 and T2 still tied after round 1 (continues to round 2)', async () => {
    const s = useScoresheet()
    const actions = runThroughRegulationAndEnableOT(s)
    runSetup('ot-round-1', actions)
    await nextTick() // let the visibleOtRounds watcher grow internalOtRounds
    expect(s.visibleOtRounds.value).toBeGreaterThanOrEqual(2)
  })

  it('no validation errors after round 1', () => {
    const s = useScoresheet()
    const actions = runThroughRegulationAndEnableOT(s)
    runSetup('ot-round-1', actions)
    expect(s.hasAnyErrors.value).toBe(false)
  })
})

describe('tutorial OT round 2 — final placements', () => {
  // OT rounds 2+ require the internalOtRounds watcher to fire between rounds,
  // which only happens after a Vue flush. That's why these tests are async and
  // await nextTick between runSetup('ot-round-1') and runSetup('ot-round-2').
  it('produces non-linear scores: 2nd place total < 3rd place total', async () => {
    const s = useScoresheet()
    const actions = runThroughRegulationAndEnableOT(s)
    runSetup('ot-round-1', actions)
    await nextTick()
    runSetup('ot-round-2', actions)
    await nextTick()

    const totals = s.scoring.value.map((ts) => ts.total)
    const placements = s.placements.value

    // Find which team is 1st, 2nd, 3rd by placement
    const firstIdx = placements.findIndex((p) => p !== null && Math.floor(p) === 1)
    const secondIdx = placements.findIndex((p) => p !== null && Math.floor(p) === 2)
    const thirdIdx = placements.findIndex((p) => p !== null && Math.floor(p) === 3)

    expect(firstIdx).toBeGreaterThanOrEqual(0)
    expect(secondIdx).toBeGreaterThanOrEqual(0)
    expect(thirdIdx).toBeGreaterThanOrEqual(0)

    // The whole point of the tutorial ending: 2nd place has a lower total score
    // than 3rd place because T1 crashed out in round 2 after T3 was already placed.
    expect(totals[secondIdx]!).toBeLessThan(totals[thirdIdx]!)
  })

  it('all three teams have a placement medal', async () => {
    const s = useScoresheet()
    const actions = runThroughRegulationAndEnableOT(s)
    runSetup('ot-round-1', actions)
    await nextTick()
    runSetup('ot-round-2', actions)
    await nextTick()
    s.placements.value.forEach((p) => expect(p).not.toBeNull())
  })

  it('no validation errors after all OT rounds', async () => {
    const s = useScoresheet()
    const actions = runThroughRegulationAndEnableOT(s)
    runSetup('ot-round-1', actions)
    await nextTick()
    runSetup('ot-round-2', actions)
    await nextTick()
    expect(s.hasAnyErrors.value).toBe(false)
  })
})
