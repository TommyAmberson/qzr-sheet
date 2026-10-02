import { describe, it, expect, beforeEach, vi } from 'vitest'
import { resetAutoSave } from '../../persistence/__tests__/resetAutoSave'
import { useScoresheet } from '../useScoresheet'
import { useTutorial } from '../useTutorial'
import { useMeetSession } from '../useMeetSession'
import { TUTORIAL_STEPS } from '../../tutorial/tutorialSteps'
import { CellValue, QuizFormat, toColIdx, toSeatIdx, toTeamIdx } from '@qzr/shared'
import { serializeStore } from '../../persistence/quizFile'

const T = toTeamIdx
const S = toSeatIdx
const C = toColIdx

// Toggle to force parseQuizFile to throw, for snapshot-failure tests.
let forceParseFailure = false
vi.mock('@qzr/shared', async () => {
  const actual = await vi.importActual<typeof import('@qzr/shared')>('@qzr/shared')
  return {
    ...actual,
    parseQuizFile: (json: string) => {
      if (forceParseFailure) throw new Error('forced parse failure')
      return actual.parseQuizFile(json)
    },
  }
})

beforeEach(() => {
  resetAutoSave()
  forceParseFailure = false
})

describe('useTutorial — start', () => {
  it('is inactive initially', () => {
    const s = useScoresheet()
    const t = useTutorial(s)
    expect(t.active.value).toBe(false)
  })

  it('start() activates the tutorial and lands on step 0', () => {
    const s = useScoresheet()
    const t = useTutorial(s)
    t.start()
    expect(t.active.value).toBe(true)
    expect(t.currentStepIndex.value).toBe(0)
    expect(t.currentStep.value?.id).toBe(TUTORIAL_STEPS[0]!.id)
  })

  it('start() saves a snapshot to localStorage', () => {
    const s = useScoresheet()
    s.setCell(T(0), S(0), C(0), CellValue.Correct)
    const t = useTutorial(s)
    t.start()
    expect(localStorage.getItem('qzr-sheet:tutorial-snapshot')).toBeTruthy()
  })

  it('start() pauses auto-save and resets the store', () => {
    const s = useScoresheet()
    s.setCell(T(0), S(0), C(0), CellValue.Correct)
    const t = useTutorial(s)
    t.start()
    expect(s.pauseAutoSave.value).toBe(true)
    // After resetStore, Q1 should be empty again
    expect(s.cells.value[0]![0]![0]).toBe(CellValue.Empty)
  })
})

describe('useTutorial — advance', () => {
  it('advance() increments currentStepIndex', () => {
    const s = useScoresheet()
    const t = useTutorial(s)
    t.start()
    t.advance()
    expect(t.currentStepIndex.value).toBe(1)
  })

  it('advance() on the last step finishes the tutorial', () => {
    const s = useScoresheet()
    const t = useTutorial(s)
    t.start()
    t.currentStepIndex.value = t.totalSteps - 1
    t.advance()
    expect(t.active.value).toBe(false)
  })
})

describe('useTutorial — finish', () => {
  it('finish() deactivates and restores the snapshot', () => {
    const s = useScoresheet()
    s.setCell(T(0), S(0), C(0), CellValue.Correct)
    const t = useTutorial(s)
    t.start()
    // Tutorial reset the store, Q1 is empty now
    expect(s.cells.value[0]![0]![0]).toBe(CellValue.Empty)
    t.finish()
    expect(t.active.value).toBe(false)
    // Q1 should be restored
    expect(s.cells.value[0]![0]![0]).toBe(CellValue.Correct)
  })

  it('finish() clears the localStorage snapshot', () => {
    const s = useScoresheet()
    const t = useTutorial(s)
    t.start()
    expect(localStorage.getItem('qzr-sheet:tutorial-snapshot')).toBeTruthy()
    t.finish()
    expect(localStorage.getItem('qzr-sheet:tutorial-snapshot')).toBeNull()
  })

  it('finish() unpauses auto-save', () => {
    const s = useScoresheet()
    const t = useTutorial(s)
    t.start()
    expect(s.pauseAutoSave.value).toBe(true)
    t.finish()
    expect(s.pauseAutoSave.value).toBe(false)
  })
})

describe('useTutorial — onNext double-advance guard', () => {
  // Regression guard for commit 2511d41. The onNext path awaits nextTick,
  // which can let a completion watcher fire and advance before the post-await
  // advance runs. Without the index-guard, this would skip a step.
  it('does not double-advance when a cell-value watcher fires during onNext', async () => {
    const s = useScoresheet()
    const t = useTutorial(s)
    t.start()

    // Jump to `q1-correct` — a cell-value completion step with an onNext fallback.
    const q1Idx = TUTORIAL_STEPS.findIndex((step) => step.id === 'q1-correct')
    expect(q1Idx).toBeGreaterThanOrEqual(0)
    t.currentStepIndex.value = q1Idx

    // Manually reinstate the cell-value watcher for the current step by re-running
    // showStep via setting the index (start() already called showStep(0)).
    // Since we jumped directly, we need to invoke showStep for the new step.
    // The public API doesn't expose showStep, but calling advance() from q1Idx-1
    // would trigger it. Easier: simulate by calling onNext from the previous step.
    // Instead, just verify onNext advances correctly by calling it from the current
    // step — the watcher is set by showStep, which hasn't run here.
    // So this test verifies the no-double-advance behavior by running through
    // start() normally and then advancing to q1-correct via the tutorial flow.

    // Reset: go back and walk forward via advance() so showStep sets up watchers.
    t.currentStepIndex.value = 0
    // Advance until we reach q1-correct (all prior steps are acknowledge or input)
    while (t.currentStepIndex.value < q1Idx) {
      t.advance()
    }
    expect(t.currentStepIndex.value).toBe(q1Idx)

    // At q1-correct, press the button (onNext). The fallback will fill the cell,
    // the cell-value watcher will fire during nextTick, and advance() will run.
    // With the index-guard, we end up exactly one step ahead, not two.
    await t.onNext()
    expect(t.currentStepIndex.value).toBe(q1Idx + 1)
  })
})

describe('useTutorial — snapshot safety', () => {
  // If parseQuizFile throws when start() tries to snapshot state, the tutorial
  // must refuse to activate. The user's pre-tutorial state must stay intact.
  it('start() refuses to activate if snapshot cannot be parsed', () => {
    const s = useScoresheet()
    s.setCell(T(0), S(0), C(0), CellValue.Correct)
    forceParseFailure = true
    const t = useTutorial(s)
    t.start()
    expect(t.active.value).toBe(false)
    // Pre-tutorial state is still there
    expect(s.cells.value[0]![0]![0]).toBe(CellValue.Correct)
    // Auto-save was not paused (start bailed before touching it)
    expect(s.pauseAutoSave.value).toBe(false)
  })

  // finish() uses the in-memory snapshot — so restore works even if localStorage
  // is wiped between start() and finish().
  it('finish() restores state using in-memory snapshot even when localStorage is cleared', () => {
    const s = useScoresheet()
    s.setCell(T(0), S(0), C(0), CellValue.Correct)
    const t = useTutorial(s)
    t.start()
    // Tutorial reset the store, Q1 is empty
    expect(s.cells.value[0]![0]![0]).toBe(CellValue.Empty)
    // Nuke localStorage mid-tutorial
    localStorage.clear()
    t.finish()
    // Pre-tutorial state restored from the in-memory copy
    expect(s.cells.value[0]![0]![0]).toBe(CellValue.Correct)
  })
})

describe('useTutorial — meet link', () => {
  it('clears the meet link on start and restores it on finish', () => {
    const meet = useMeetSession()
    // Plant a session directly so we don't depend on a network roundtrip.
    meet.restoreSession({
      meetId: 42,
      meetName: 'Test Meet',
      slots: [undefined, undefined, undefined],
      teamList: [],
      meetDivisions: ['1'],
      quizId: null,
    })
    expect(meet.isActive.value).toBe(true)

    const s = useScoresheet()
    const t = useTutorial(s)
    t.start()
    expect(meet.isActive.value).toBe(false)
    expect(localStorage.getItem('qzr-sheet:tutorial-meet-snapshot')).toBeTruthy()

    t.finish()
    expect(meet.isActive.value).toBe(true)
    expect(meet.meetName.value).toBe('Test Meet')
    expect(localStorage.getItem('qzr-sheet:tutorial-meet-snapshot')).toBeNull()

    meet.clearSession()
  })

  it('does not persist a meet snapshot when no meet was linked', () => {
    const s = useScoresheet()
    const t = useTutorial(s)
    t.start()
    expect(localStorage.getItem('qzr-sheet:tutorial-meet-snapshot')).toBeNull()
    t.finish()
  })

  it('recoverFromCrash restores both quiz and meet snapshots', () => {
    const meet = useMeetSession()
    meet.restoreSession({
      meetId: 7,
      meetName: 'Crash Meet',
      slots: [undefined, undefined, undefined],
      teamList: [],
      meetDivisions: [],
      quizId: null,
    })

    const s = useScoresheet()
    const t = useTutorial(s)
    t.start()
    // Simulate a crash mid-tutorial: clear in-memory session state via a
    // fresh tutorial instance pointing at a fresh scoresheet.
    const s2 = useScoresheet()
    meet.clearSession()
    const t2 = useTutorial(s2)

    expect(t2.recoverFromCrash()).toBe(true)
    expect(meet.isActive.value).toBe(true)
    expect(meet.meetName.value).toBe('Crash Meet')

    meet.clearSession()
  })
})

describe('useTutorial — 15-question quiz', () => {
  it('teaches on a 20-question sheet and restores the 15-question quiz afterwards', () => {
    const s = useScoresheet()
    s.resetStore(QuizFormat.FifteenQuestion)
    s.setCell(T(0), S(0), C(0), CellValue.Correct)
    const t = useTutorial(s)
    t.start()
    expect(s.quiz.value.format).toBe(QuizFormat.TwentyQuestion)
    t.finish()
    expect(s.quiz.value.format).toBe(QuizFormat.FifteenQuestion)
    expect(s.cells.value[0]![0]![0]).toBe(CellValue.Correct)
  })
})

describe('useTutorial — a quiz opened from a newer file', () => {
  function openedFromNewer() {
    const s = useScoresheet()
    const { id: _, ...quiz } = s.store.quiz
    s.loadFile(
      {
        quiz: { ...quiz },
        teams: s.store.teams.map(({ quizId: _, ...t }) => t),
        quizzers: [...s.store.quizzers],
        answers: [],
        noJumps: new Map<string, boolean>(),
        timeouts: new Map(),
      },
      { fromNewerFile: true },
    )
    return s
  }

  it('keeps its warning through the tutorial', () => {
    const s = openedFromNewer()
    const t = useTutorial(s)
    t.start()
    t.finish()
    expect(s.openedFromNewerFile.value).toBe(true)
  })

  it('does not carry a stale warning into a later tutorial', () => {
    localStorage.setItem('qzr-sheet:tutorial-from-newer-file', '1')
    const s = useScoresheet()
    useTutorial(s).start()
    const next = useScoresheet()
    expect(useTutorial(next).recoverFromCrash()).toBe(true)
    expect(next.openedFromNewerFile.value).toBe(false)
  })

  it('keeps its warning through crash recovery', () => {
    const s = openedFromNewer()
    useTutorial(s).start()
    // The app crashes mid-tutorial; the next session recovers the snapshot
    const next = useScoresheet()
    expect(useTutorial(next).recoverFromCrash()).toBe(true)
    expect(next.openedFromNewerFile.value).toBe(true)
  })
})

describe("useTutorial — crash recovery of a newer build's snapshot", () => {
  it('sets the snapshot aside instead of deleting it', () => {
    const s = useScoresheet()
    const { id: _, ...quiz } = s.store.quiz
    const newer = JSON.stringify({
      version: 99,
      quiz: { ...quiz, questionTypes: [] },
      teams: [],
      answers: [],
      noJumps: [],
    })
    localStorage.setItem('qzr-sheet:tutorial-snapshot', newer)
    expect(useTutorial(s).recoverFromCrash()).toBe(false)
    expect(localStorage.getItem('qzr-sheet:tutorial-snapshot')).toBeNull()
    expect(s.keptNewerAutoSaves.value).toHaveLength(1)
  })
})

describe('useTutorial — a newer snapshot that cannot be set aside', () => {
  it('stays in place, is listed, and the tutorial will not start until it is discarded', () => {
    const s = useScoresheet()
    const { id: _, ...quiz } = s.store.quiz
    const newer = JSON.stringify({
      version: 99,
      quiz: { ...quiz, questionTypes: [] },
      teams: [],
      answers: [],
      noJumps: [],
    })
    localStorage.setItem('qzr-sheet:tutorial-snapshot', newer)
    // Storage is full: setting the snapshot aside fails
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key) {
      if (String(key).startsWith('qzr-sheet:newer-autosave:')) throw new Error('quota')
    })
    try {
      expect(useTutorial(s).recoverFromCrash()).toBe(false)
    } finally {
      setItem.mockRestore()
    }
    expect(s.keptNewerAutoSaves.value).toEqual(['qzr-sheet:tutorial-snapshot'])

    expect(s.tutorialBlockedByKept.value).toBe(true)
    const t = useTutorial(s)
    t.start()
    expect(t.active.value).toBe(false)
    expect(localStorage.getItem('qzr-sheet:tutorial-snapshot')).toBe(newer)

    s.discardKeptNewerAutoSave()
    expect(s.tutorialBlockedByKept.value).toBe(false)
    expect(s.keptNewerAutoSaves.value).toEqual([])
  })
})

describe('useTutorial — keeping the quiz recoverable around a kept newer quiz', () => {
  const realSetItem = Storage.prototype.setItem
  // Storage is full: setting a newer quiz aside fails, every other write goes through
  const failSettingAside = () =>
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key.startsWith('qzr-sheet:newer-autosave:')) throw new Error('quota')
      realSetItem.call(this, key, value)
    })

  function newerFile(s: ReturnType<typeof useScoresheet>) {
    const { id: _, ...quiz } = s.store.quiz
    return JSON.stringify({
      version: 99,
      quiz: { ...quiz, questionTypes: [] },
      teams: [],
      answers: [],
      noJumps: [],
    })
  }

  it('will not start, so the auto-save stays intact, while its slot holds a kept newer quiz', () => {
    const s = useScoresheet()
    localStorage.setItem('qzr-sheet:tutorial-snapshot', newerFile(s))
    const spy = failSettingAside()
    try {
      useTutorial(s).recoverFromCrash()
    } finally {
      spy.mockRestore()
    }
    // The official's quiz is auto-saved, then they start the tutorial and the app crashes
    s.setCell(T(0), S(0), C(0), CellValue.Correct)
    localStorage.setItem(
      'qzr-sheet:current',
      serializeStore(s.store, s.noJumpMap.value, s.timeoutMap.value),
    )
    const t = useTutorial(s)
    t.start()
    expect(t.active.value).toBe(false)
    const afterCrash = useScoresheet()
    expect(afterCrash.cells.value[0]![0]![0]).toBe(CellValue.Correct)
  })

  it('keeps the crash snapshot until the recovered quiz is actually saved', () => {
    const s = useScoresheet()
    s.setCell(T(0), S(0), C(0), CellValue.Correct)
    const snapshot = serializeStore(s.store, s.noJumpMap.value, s.timeoutMap.value)
    // A newer auto-save that can't be moved holds qzr-sheet:current, so auto-save is paused
    localStorage.setItem('qzr-sheet:current', newerFile(s))
    localStorage.setItem('qzr-sheet:tutorial-snapshot', snapshot)
    const spy = failSettingAside()
    let next: ReturnType<typeof useScoresheet>
    try {
      next = useScoresheet()
    } finally {
      spy.mockRestore()
    }
    expect(useTutorial(next).recoverFromCrash()).toBe(true)
    expect(localStorage.getItem('qzr-sheet:tutorial-snapshot')).toBe(snapshot)

    next.discardKeptNewerAutoSave()
    expect(localStorage.getItem('qzr-sheet:tutorial-snapshot')).toBeNull()
    const saved = JSON.parse(localStorage.getItem('qzr-sheet:current')!)
    expect(saved.answers).toHaveLength(1)
  })
})
