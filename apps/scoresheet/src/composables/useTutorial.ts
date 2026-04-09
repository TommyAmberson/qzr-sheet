import { ref, computed, watch } from 'vue'
import { CellValue, type Timeout } from '../types/scoresheet'
import { serializeStore, parseQuizFile, type DeserializeResult } from '../persistence/quizFile'
import type { QuizStore } from '../stores/quizStore'
import { TUTORIAL_STEPS, type TutorialStep } from '../tutorial/tutorialSteps'

const SNAPSHOT_KEY = 'qzr-sheet:tutorial-snapshot'

export interface ScoresheetAPI {
  store: QuizStore
  noJumpMap: { value: Map<string, boolean> }
  timeoutMap: { value: Map<number, Timeout[]> }
  pauseAutoSave: { value: boolean }
  answerVersion: { value: number }
  teamVersion: { value: number }
  cells: { value: CellValue[][][] }
  teams: { value: { id: number; seatOrder: number; name: string }[] }
  teamQuizzers: { value: { name: string; seatOrder: number }[][] }
  setQuizzerName: (ti: number, qi: number, name: string) => void
  setTeamName: (ti: number, name: string) => void
  loadFile: (data: DeserializeResult) => void
  resetStore: () => void
}

export function useTutorial(scoresheet: ScoresheetAPI) {
  const active = ref(false)
  const currentStepIndex = ref(0)
  const targetEl = ref<HTMLElement | null>(null)
  let snapshot: string | null = null
  let cleanupFns: (() => void)[] = []

  const currentStep = computed<TutorialStep | null>(() =>
    active.value ? (TUTORIAL_STEPS[currentStepIndex.value] ?? null) : null,
  )

  const totalSteps = TUTORIAL_STEPS.length

  function start() {
    snapshot = serializeStore(
      scoresheet.store,
      scoresheet.noJumpMap.value,
      scoresheet.timeoutMap.value,
    )
    try {
      localStorage.setItem(SNAPSHOT_KEY, snapshot)
    } catch {
      // localStorage full — proceed without crash recovery
    }

    scoresheet.pauseAutoSave.value = true
    scoresheet.resetStore()

    active.value = true
    currentStepIndex.value = 0
    showStep(0)
  }

  function showStep(index: number) {
    cleanup()

    const step = TUTORIAL_STEPS[index]
    if (!step) {
      finish()
      return
    }

    targetEl.value = resolveTargetEl(step)

    setupCompletionWatcher(step)
  }

  function resolveTargetEl(step: TutorialStep): HTMLElement | null {
    let selector: string | null = null

    if (step.target.type === 'selector') {
      selector = step.target.css
    } else if (step.target.type === 'cell') {
      const { ti, qi, ci } = step.target
      selector = `[data-tutorial="cell-${ti}-${qi}-${ci}"]`
    }

    if (!selector) return null

    const el = document.querySelector<HTMLElement>(selector)
    if (el) {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
    }
    return el
  }

  function setupCompletionWatcher(step: TutorialStep) {
    const completion = step.completion

    if (completion.type === 'cell-value') {
      const { ti, qi, ci, value } = completion
      const values = Array.isArray(value) ? value : [value]
      cleanupFns.push(
        watch(
          () => scoresheet.answerVersion.value,
          () => {
            const cellVal = scoresheet.cells.value[ti]?.[qi]?.[ci]
            if (cellVal !== undefined && values.includes(cellVal)) advance()
          },
        ),
      )
    }

    if (completion.type === 'input-non-empty') {
      const el = targetEl.value
      if (el instanceof HTMLInputElement) {
        el.focus()
        el.select()
      }
    }

    if (completion.type === 'input-empty') {
      const { teamIdx, quizzerIdx } = completion
      cleanupFns.push(
        watch(
          () => scoresheet.teamVersion.value,
          () => {
            const name = scoresheet.teamQuizzers.value[teamIdx]?.[quizzerIdx]?.name ?? 'x'
            if (!name.trim()) advance()
          },
        ),
      )
    }

    if (completion.type === 'click-target') {
      if (step.id === 'no-jump') {
        cleanupFns.push(
          watch(
            () => scoresheet.noJumpMap.value,
            () => advance(),
            { deep: true },
          ),
        )
      } else if (step.id === 'call-timeout') {
        cleanupFns.push(
          watch(
            () => scoresheet.timeoutMap.value,
            () => advance(),
            { deep: true },
          ),
        )
      }
    }

    if (completion.type === 'seat-change') {
      const { teamIdx } = completion
      const initialOrder = scoresheet.teamQuizzers.value[teamIdx]?.map((q) => q.seatOrder) ?? []
      cleanupFns.push(
        watch(
          () => scoresheet.teamVersion.value,
          () => {
            const currentOrder =
              scoresheet.teamQuizzers.value[teamIdx]?.map((q) => q.seatOrder) ?? []
            if (JSON.stringify(currentOrder) !== JSON.stringify(initialOrder)) advance()
          },
        ),
      )
    }
  }

  function advance() {
    if (currentStepIndex.value < totalSteps - 1) {
      currentStepIndex.value++
      showStep(currentStepIndex.value)
    } else {
      finish()
    }
  }

  /** Called when user clicks Next — runs onNext callback then advances */
  function onNext() {
    const step = currentStep.value
    if (step?.onNext) {
      step.onNext({
        setQuizzerName: scoresheet.setQuizzerName,
        setTeamName: scoresheet.setTeamName,
      })
    }
    advance()
  }

  function finish() {
    cleanup()
    targetEl.value = null

    const snapshotData = snapshot || localStorage.getItem(SNAPSHOT_KEY)
    if (snapshotData) {
      try {
        const data = parseQuizFile(snapshotData)
        scoresheet.loadFile(data)
      } catch {
        scoresheet.resetStore()
      }
    }

    scoresheet.pauseAutoSave.value = false
    active.value = false
    snapshot = null
    try {
      localStorage.removeItem(SNAPSHOT_KEY)
    } catch {
      // ignore
    }
  }

  function cleanup() {
    cleanupFns.forEach((fn) => fn())
    cleanupFns = []
  }

  function recoverFromCrash(): boolean {
    const saved = localStorage.getItem(SNAPSHOT_KEY)
    if (!saved) return false
    try {
      const data = parseQuizFile(saved)
      scoresheet.loadFile(data)
      localStorage.removeItem(SNAPSHOT_KEY)
      return true
    } catch {
      localStorage.removeItem(SNAPSHOT_KEY)
      return false
    }
  }

  return {
    active,
    currentStep,
    currentStepIndex,
    totalSteps,
    targetEl,
    start,
    advance,
    onNext,
    finish,
    recoverFromCrash,
  }
}
