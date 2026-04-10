import { ref, computed, watch, nextTick } from 'vue'
import { CellValue, QUIZZERS_PER_TEAM, type Timeout } from '../types/scoresheet'
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
  teams: { value: { id: number; seatOrder: number; name: string; onTime: boolean }[] }
  teamQuizzers: { value: { name: string; seatOrder: number }[][] }
  quiz: { value: { overtime: boolean } }
  setQuizzerName: (ti: number, qi: number, name: string) => void
  setTeamName: (ti: number, name: string) => void
  setCell: (ti: number, qi: number, ci: number, value: CellValue) => void
  toggleNoJump: (ci: number) => void
  toggleTimeout: (teamId: number, colKey: string) => void
  toggleOnTime: (ti: number) => void
  moveQuizzer: (ti: number, from: number, to: number) => void
  loadFile: (data: DeserializeResult) => void
  resetStore: () => void
  columns: { value: { key: string }[] }
}

export function useTutorial(scoresheet: ScoresheetAPI) {
  const active = ref(false)
  const currentStepIndex = ref(0)
  const targetEls = ref<HTMLElement[]>([])
  const stepCompleted = ref(false)
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

  function buildActions() {
    return {
      setQuizzerName: scoresheet.setQuizzerName,
      setTeamName: scoresheet.setTeamName,
      setCell: scoresheet.setCell,
      toggleNoJump: scoresheet.toggleNoJump,
      toggleTimeout: scoresheet.toggleTimeout,
      toggleOnTime: scoresheet.toggleOnTime,
      moveQuizzer: scoresheet.moveQuizzer,
      columns: scoresheet.columns,
      teams: scoresheet.teams,
      quiz: scoresheet.quiz,
    }
  }

  function showStep(index: number) {
    cleanup()
    stepCompleted.value = false

    const step = TUTORIAL_STEPS[index]
    if (!step) {
      finish()
      return
    }

    if (step.setup) {
      step.setup(buildActions())
    }

    targetEls.value = resolveTargetEls(step)
    if (step.completion.type === 'acknowledge') stepCompleted.value = true

    setupCompletionWatcher(step)
  }

  function resolveTargetEls(step: TutorialStep): HTMLElement[] {
    const els: HTMLElement[] = []

    if (step.target.type === 'selector') {
      const matched = document.querySelectorAll<HTMLElement>(step.target.css)
      matched.forEach((el) => els.push(el))
    } else if (step.target.type === 'cell') {
      const { ti, qi, ci } = step.target
      const el = document.querySelector<HTMLElement>(`[data-tutorial="cell-${ti}-${qi}-${ci}"]`)
      if (el) els.push(el)
    } else if (step.target.type === 'column') {
      const ci = step.target.ci
      const header = document.querySelector<HTMLElement>(`[data-tutorial="col-header-${ci}"]`)
      if (header) els.push(header)
      for (let ti = 0; ti < 3; ti++) {
        for (let qi = 0; qi < QUIZZERS_PER_TEAM; qi++) {
          const cell = document.querySelector<HTMLElement>(
            `[data-tutorial="cell-${ti}-${qi}-${ci}"]`,
          )
          if (cell) els.push(cell)
        }
      }
      const nj = document.querySelector<HTMLElement>(`[data-tutorial="no-jump-${ci}"]`)
      if (nj) els.push(nj)
    } else if (step.target.type === 'timeout-row') {
      const ti = step.target.ti
      // Timeouts can't be called after Q17, so only show Q1–Q16 (indices 0–15)
      for (let ci = 0; ci < 16; ci++) {
        const cell = document.querySelector<HTMLElement>(`[data-tutorial="timeout-${ti}-${ci}"]`)
        if (cell) els.push(cell)
      }
    }

    if (els.length > 0) {
      els[0]!.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
    }
    return els
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
          { flush: 'post' },
        ),
      )
    }

    if (completion.type === 'input-non-empty') {
      const { teamIdx, quizzerIdx } = completion
      // Focus the input
      const firstEl = targetEls.value[0]
      if (firstEl instanceof HTMLInputElement) {
        firstEl.focus()
        firstEl.select()
      }
      // Watch for name change → mark completed
      cleanupFns.push(
        watch(
          () => scoresheet.teamVersion.value,
          () => {
            const changed =
              quizzerIdx !== undefined
                ? (() => {
                    const name = scoresheet.teamQuizzers.value[teamIdx]?.[quizzerIdx]?.name ?? ''
                    return name.trim() !== '' && name !== `Quizzer ${quizzerIdx + 1}`
                  })()
                : (() => {
                    const team = scoresheet.teams.value[teamIdx]
                    return !!team && team.name !== `Team ${teamIdx + 1}`
                  })()
            if (changed) stepCompleted.value = true
          },
        ),
      )
      // Blur advances if name was changed
      if (firstEl instanceof HTMLInputElement) {
        const onBlur = () => {
          setTimeout(() => {
            if (stepCompleted.value) advance()
          }, 0)
        }
        firstEl.addEventListener('blur', onBlur)
        cleanupFns.push(() => firstEl.removeEventListener('blur', onBlur))
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
      const initialNames = scoresheet.teamQuizzers.value[teamIdx]?.map((q) => q.name) ?? []
      cleanupFns.push(
        watch(
          () => scoresheet.teamVersion.value,
          () => {
            const currentNames = scoresheet.teamQuizzers.value[teamIdx]?.map((q) => q.name) ?? []
            if (JSON.stringify(currentNames) !== JSON.stringify(initialNames)) advance()
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

  /** Called when user clicks the button. Runs onNext if step wasn't completed. */
  async function onNext() {
    const step = currentStep.value
    if (step?.onNext && !stepCompleted.value) {
      const startIndex = currentStepIndex.value
      step.onNext(buildActions())
      // Wait for DOM to reflect the state change before advancing so the next
      // step's resolveTargetEls can find newly-added columns (e.g. Q18A after Q18 error).
      await nextTick()
      // A completion watcher (cell-value, input-non-empty blur) may have already
      // advanced during the flush — don't double-advance.
      if (currentStepIndex.value !== startIndex) return
    }
    advance()
  }

  function finish() {
    cleanup()
    targetEls.value = []

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
    targetEls,
    stepCompleted,
    start,
    advance,
    onNext,
    finish,
    recoverFromCrash,
  }
}
