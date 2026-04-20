import { ref, computed, watch, nextTick } from 'vue'
import { CellValue, QUIZZERS_PER_TEAM, type Timeout } from '../types/scoresheet'
import { serializeStore, parseQuizFile, type DeserializeResult } from '../persistence/quizFile'
import type { QuizStore } from '../stores/quizStore'
import { TUTORIAL_STEPS, type TutorialStep } from '../tutorial/tutorialSteps'
import type { TeamIdx, SeatIdx, ColIdx } from '../types/indices'

const SNAPSHOT_KEY = 'qzr-sheet:tutorial-snapshot'

export interface ScoresheetAPI {
  store: QuizStore
  noJumpMap: { value: Map<string, boolean> }
  timeoutMap: { value: Map<number, Timeout[]> }
  pauseAutoSave: { value: boolean }
  cells: { value: CellValue[][][] }
  teams: { value: { id: number; seatOrder: number; name: string; onTime: boolean }[] }
  teamQuizzers: { value: { name: string; seatOrder: number }[][] }
  quiz: { value: { overtime: boolean } }
  setQuizzerName: (teamIdx: TeamIdx, seatIdx: SeatIdx, name: string) => void
  setTeamName: (teamIdx: TeamIdx, name: string) => void
  setCell: (teamIdx: TeamIdx, seatIdx: SeatIdx, colIdx: ColIdx, value: CellValue) => void
  toggleNoJump: (colIdx: ColIdx) => void
  toggleTimeout: (teamId: number, colKey: string) => void
  toggleOnTime: (teamIdx: TeamIdx) => void
  moveQuizzer: (teamIdx: TeamIdx, from: SeatIdx, to: SeatIdx) => void
  loadFile: (data: DeserializeResult) => void
  resetStore: () => void
  columns: { value: { key: string }[] }
}

export function useTutorial(scoresheet: ScoresheetAPI) {
  const active = ref(false)
  const currentStepIndex = ref(0)
  const targetEls = ref<HTMLElement[]>([])
  const stepCompleted = ref(false)
  // In-memory copy of the parsed snapshot — the normal `finish()` path restores
  // from this, not from the serialized string, so a parse failure at finish time
  // can't destroy the user's pre-tutorial state.
  let snapshotData: DeserializeResult | null = null
  let cleanupFns: (() => void)[] = []

  const currentStep = computed<TutorialStep | null>(() =>
    active.value ? (TUTORIAL_STEPS[currentStepIndex.value] ?? null) : null,
  )

  const totalSteps = TUTORIAL_STEPS.length

  function start() {
    const serialized = serializeStore(
      scoresheet.store,
      scoresheet.noJumpMap.value,
      scoresheet.timeoutMap.value,
    )
    // Parse immediately to verify we can restore later, and keep the parsed
    // form in memory. If this throws, refuse to start — the user's state is
    // still intact because we haven't touched the store yet.
    try {
      snapshotData = parseQuizFile(serialized)
    } catch (e) {
      console.error('Tutorial: failed to snapshot current state, not starting', e)
      return
    }
    try {
      localStorage.setItem(SNAPSHOT_KEY, serialized)
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
      const { teamIdx, seatIdx, colIdx } = step.target
      const el = document.querySelector<HTMLElement>(
        `[data-tutorial="cell-${teamIdx}-${seatIdx}-${colIdx}"]`,
      )
      if (el) els.push(el)
    } else if (step.target.type === 'column') {
      const { colIdx } = step.target
      const header = document.querySelector<HTMLElement>(`[data-tutorial="col-header-${colIdx}"]`)
      if (header) els.push(header)
      for (let teamIdx = 0; teamIdx < 3; teamIdx++) {
        for (let seatIdx = 0; seatIdx < QUIZZERS_PER_TEAM; seatIdx++) {
          const cell = document.querySelector<HTMLElement>(
            `[data-tutorial="cell-${teamIdx}-${seatIdx}-${colIdx}"]`,
          )
          if (cell) els.push(cell)
        }
      }
      const nj = document.querySelector<HTMLElement>(`[data-tutorial="no-jump-${colIdx}"]`)
      if (nj) els.push(nj)
    } else if (step.target.type === 'timeout-row') {
      const { teamIdx } = step.target
      // Timeouts can't be called after Q17, so only show Q1–Q16 (indices 0–15)
      for (let colIdx = 0; colIdx < 16; colIdx++) {
        const cell = document.querySelector<HTMLElement>(
          `[data-tutorial="timeout-${teamIdx}-${colIdx}"]`,
        )
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
      const { teamIdx, seatIdx, colIdx, value } = completion
      const values = Array.isArray(value) ? value : [value]
      cleanupFns.push(
        watch(
          () => scoresheet.cells.value[teamIdx]?.[seatIdx]?.[colIdx],
          (cellVal) => {
            if (cellVal !== undefined && values.includes(cellVal)) advance()
          },
          { flush: 'post' },
        ),
      )
    }

    if (completion.type === 'input-non-empty') {
      const { teamIdx, seatIdx } = completion
      // Focus the input
      const firstEl = targetEls.value[0]
      if (firstEl instanceof HTMLInputElement) {
        firstEl.focus()
        firstEl.select()
      }
      // Watch for name change → mark completed
      const nameSource =
        seatIdx !== undefined
          ? () => scoresheet.teamQuizzers.value[teamIdx]?.[seatIdx]?.name ?? ''
          : () => scoresheet.teams.value[teamIdx]?.name ?? ''
      const placeholder = seatIdx !== undefined ? `Quizzer ${seatIdx + 1}` : `Team ${teamIdx + 1}`
      cleanupFns.push(
        watch(nameSource, (name) => {
          const changed =
            seatIdx !== undefined
              ? name.trim() !== '' && name !== placeholder
              : name !== placeholder
          if (changed) stepCompleted.value = true
        }),
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
      const { teamIdx, seatIdx } = completion
      cleanupFns.push(
        watch(
          () => scoresheet.teamQuizzers.value[teamIdx]?.[seatIdx]?.name ?? 'x',
          (name) => {
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
          () => scoresheet.teamQuizzers.value[teamIdx]?.map((q) => q.name) ?? [],
          (currentNames) => {
            const changed =
              currentNames.length !== initialNames.length ||
              currentNames.some((n, i) => n !== initialNames[i])
            if (changed) advance()
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

    // Prefer the in-memory snapshot (no parse needed) so the normal exit path
    // is immune to parse failures. Fall back to localStorage only if the
    // in-memory copy was lost (e.g. tutorial was entered via crash recovery).
    if (snapshotData) {
      scoresheet.loadFile(snapshotData)
    } else {
      const saved = localStorage.getItem(SNAPSHOT_KEY)
      if (saved) {
        try {
          scoresheet.loadFile(parseQuizFile(saved))
        } catch (e) {
          // Leave the current store state alone rather than wiping it —
          // leaking tutorial state is strictly better than destroying user data.
          console.error('Tutorial: failed to restore snapshot on finish', e)
        }
      }
    }

    scoresheet.pauseAutoSave.value = false
    active.value = false
    snapshotData = null
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
