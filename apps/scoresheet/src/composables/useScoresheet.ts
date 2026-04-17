import { ref, computed, watch, watchEffect } from 'vue'
import { useHistory } from './useHistory'
import {
  BonusRule,
  CellValue,
  QuestionCategory,
  MAX_TIMEOUTS_PER_TEAM,
  buildColumns,
  QuestionType,
  type Column,
  type Quiz,
  type Team,
  type Timeout,
  type PlaceKey,
} from '../types/scoresheet'
import { createQuizStore } from '../stores/quizStore'
import { scoreTeam, type TeamScoring } from '../scoring/scoreTeam'
import { computeGreyedOut, type GreyedOutResult } from '../scoring/greyedOut'
import { validateCells, ValidationCode, validationMessage } from '../scoring/validation'
import { isBonusSituation } from '../scoring/helpers'
import { computeVisibleColumns, computeOrphanedColumns } from '../scoring/columnVisibility'
import {
  getOvertimeEligibleTeams,
  computeOtIneligibility,
  computeOvertimeRounds,
  computeOtCheckpointScores,
  computeRegulationScores,
  questionsComplete,
  quizJumpedComplete,
} from '../scoring/overtime'
import { computePlacements, computePlacementPoints } from '../scoring/placement'
import type { TeamIdx, SeatIdx, ColIdx } from '../types/indices'
import type { DeserializeResult } from '../persistence/quizFile'
import { saveToStorage, loadFromStorage, clearStorage } from '../persistence/autoSave'

/**
 * Seat vs. Quizzer: the positional indices used throughout this composable
 * (`teamIdx`, `seatIdx`, `colIdx`) are 0-based slots. A "seat" is a position on
 * a team's bench — the occupant can change after a substitution — distinct
 * from a "quizzer," which is a stable person with an immutable `id`. The
 * branded types `TeamIdx` / `SeatIdx` / `ColIdx` keep these straight at
 * compile time; see `../types/indices.ts` for the full explanation.
 */
export function useScoresheet() {
  const store = createQuizStore()
  const history = useHistory()

  // --- Reactive wrappers around store data ---
  const quiz = ref<Quiz>(store.quiz)

  // Bump this to force recomputation of cells/scoring after answer changes
  const answerVersion = ref(0)

  // Bump this to force recomputation when team metadata (e.g. onTime) changes
  const teamVersion = ref(0)

  /**
   * Internally tracked overtime round count.
   * Starts at 1 when OT is enabled, auto-grows when content is added.
   */
  const internalOtRounds = ref(1)

  /** No-jump flags — grows/shrinks with columns */
  const noJumpMap = ref(new Map<string, boolean>())

  /** Timeouts per team — 0 to MAX_TIMEOUTS_PER_TEAM entries per team */
  const timeoutMap = ref(new Map<number, Timeout[]>())

  // --- Restore persisted state from localStorage ---
  const restored = loadFromStorage()
  if (restored) {
    store.loadState(restored)
    quiz.value = store.quiz
    noJumpMap.value = restored.noJumps
    timeoutMap.value = restored.timeouts
    internalOtRounds.value = restored.quiz.overtime
      ? Math.max(
          1,
          computeOvertimeRounds(
            store.cellGrid(buildColumns(20)),
            buildColumns(20),
            restored.teams.map((t) => t.onTime),
            buildColumns(20).map((c) => restored.noJumps.get(c.key) ?? false),
          ),
        )
      : 1
    if (restored.answers.length > 0 || restored.quizzers.some((q) => q.name.trim())) {
      history.push({ undo: () => {}, redo: () => {} })
    }
  }

  /** Columns built reactively — regulation when OT is off, + OT rounds when on */
  const columns = computed<Column[]>(() => {
    const rounds = quiz.value.overtime ? internalOtRounds.value : 0
    return buildColumns(rounds)
  })

  const noJumps = computed<boolean[]>(() =>
    columns.value.map((col) => noJumpMap.value.get(col.key) ?? false),
  )

  /** Teams sorted by seat order — this is the canonical iteration order */
  const teams = computed<Team[]>(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    teamVersion.value // reactive dependency
    return [...store.teams].sort((a, b) => a.seatOrder - b.seatOrder)
  })

  /** Quizzers per team, indexed by team position */
  const teamQuizzers = computed(() => teams.value.map((team) => store.quizzersByTeam(team.id)))

  /** Derived cell grid — recomputes when answerVersion or columns change */
  const cells = computed<CellValue[][][]>(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    answerVersion.value // reactive dependency
    return store.cellGrid(columns.value)
  })

  /** Set a cell value using positional indices (for UI compatibility) */
  function setCell(teamIdx: TeamIdx, seatIdx: SeatIdx, colIdx: ColIdx, value: CellValue) {
    const team = teams.value[teamIdx]
    if (!team) return
    const qzrs = store.quizzersByTeam(team.id)
    const qzr = qzrs[seatIdx]
    const col = columns.value[colIdx]
    if (!qzr || !col) return
    const prev = store.getAnswer(qzr.id, col.key)
    if (prev === value) return
    store.setAnswer(qzr.id, col.key, value)
    answerVersion.value++
    history.push({
      undo: () => {
        store.setAnswer(qzr.id, col.key, prev)
        answerVersion.value++
      },
      redo: () => {
        store.setAnswer(qzr.id, col.key, value)
        answerVersion.value++
      },
    })
  }

  // --- Scoring ---

  const scoring = computed<TeamScoring[]>(() => {
    const cols = columns.value
    const grid = cells.value
    return teams.value.map((team, teamIdx) => scoreTeam(grid[teamIdx]!, cols, team.onTime))
  })

  // --- Grey-out & validation ---

  // Per-column ineligibility map: which teams can't jump on each OT column,
  // scoped correctly so teams resolved out in round N aren't retroactively
  // tossed-up on round N columns.
  const otIneligibility = computed(() =>
    computeOtIneligibility(
      cells.value,
      columns.value,
      teams.value.map((t) => t.onTime),
      noJumps.value,
    ),
  )

  // Regulation-only eligibility for NotInOvertime validation — a team's OT
  // answers are never invalid just because they were resolved out later.
  const otEligibleTeams = computed(() =>
    getOvertimeEligibleTeams(
      cells.value,
      columns.value,
      teams.value.map((t) => t.onTime),
    ),
  )

  const greyedOutResult = computed<GreyedOutResult>(() =>
    computeGreyedOut(cells.value, columns.value, otIneligibility.value, quiz.value.bonusRule),
  )

  // Auto-NJ: when a seat-bonus column targets an empty seat, auto-set NJ.
  // The user can remove the auto-NJ; dismissedAutoNJ prevents re-adding.
  // This watchEffect reads greyedOutResult (which depends on noJumps via
  // otIneligibility) and writes noJumpMap — but only adds new keys and never
  // flips existing ones, so the next invocation is a no-op and the cycle stops.
  const autoNoJumpKeys = ref(new Set<string>())
  const dismissedAutoNJ = ref(new Set<string>())

  watchEffect(() => {
    if (quiz.value.bonusRule !== BonusRule.Seat) return
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    teamVersion.value
    let changed = false
    const currentAuto = new Set<string>()

    for (const [colIdx, seat] of greyedOutResult.value.bonusSeats) {
      const key = columns.value[colIdx]?.key
      if (!key) continue
      const bonusTeamIdx = findBonusTeamIdx(colIdx)
      if (bonusTeamIdx === undefined) continue
      const qzrs = store.quizzersByTeam(teams.value[bonusTeamIdx]!.id)
      const isEmpty = !qzrs[seat]?.name?.trim()

      if (isEmpty) {
        currentAuto.add(key)
        if (!noJumpMap.value.get(key) && !dismissedAutoNJ.value.has(key)) {
          noJumpMap.value.set(key, true)
          changed = true
        }
      }
    }

    // Remove auto-NJ for keys that are no longer empty-seat bonuses
    for (const key of autoNoJumpKeys.value) {
      if (!currentAuto.has(key) && noJumpMap.value.get(key)) {
        noJumpMap.value.delete(key)
        changed = true
      }
    }

    // Clear dismissals for keys no longer in bonusSeats
    for (const key of dismissedAutoNJ.value) {
      if (!currentAuto.has(key)) dismissedAutoNJ.value.delete(key)
    }

    if (changed) noJumpMap.value = new Map(noJumpMap.value)
    autoNoJumpKeys.value = currentAuto
  })

  function findBonusTeamIdx(colIdx: number): number | undefined {
    const tossed = greyedOutResult.value.tossedUp
    const tc = teams.value.length
    for (let teamIdx = 0; teamIdx < tc; teamIdx++) {
      if (!tossed.has(`${teamIdx}:${colIdx}`) && isBonusSituation(tossed, teamIdx, colIdx, tc))
        return teamIdx
    }
    return undefined
  }

  const orphanedColumns = computed(() =>
    computeOrphanedColumns(
      cells.value,
      columns.value,
      noJumps.value,
      visibleOtRounds.value,
      greyedOutResult.value.colStatuses,
    ),
  )

  /** Set of "teamIdx:seatIdx" keys for quizzers with empty/blank names */
  const emptySeats = computed(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    teamVersion.value // reactive dependency
    const set = new Set<string>()
    teams.value.forEach((team, teamIdx) => {
      const qzrs = store.quizzersByTeam(team.id)
      qzrs.forEach((qzr, seatIdx) => {
        if (store.isQuizzerUnnamed(qzr.id)) set.add(`${teamIdx}:${seatIdx}`)
      })
    })
    return set
  })

  const validationErrors = computed(() =>
    validateCells(
      cells.value,
      columns.value,
      greyedOutResult.value,
      noJumps.value,
      otEligibleTeams.value,
      orphanedColumns.value,
      emptySeats.value,
    ),
  )

  /** Column indices that have an invalid timeout (after Q16) */
  const timeoutValidationErrors = computed(() => {
    const invalidCols = new Set<number>()
    for (const timeouts of timeoutMap.value.values()) {
      for (const t of timeouts) {
        if (t.afterColumnKey !== null && !isTimeoutAllowed(t.afterColumnKey)) {
          const colIdx = columns.value.findIndex((c) => c.key === t.afterColumnKey)
          if (colIdx >= 0) invalidCols.add(colIdx)
        }
      }
    }
    return invalidCols
  })

  /** Team indices that have invalid timeouts, mapped to the offending column indices */
  const timeoutErrorsByTeam = computed(() => {
    const map = new Map<number, Set<number>>()
    for (const [teamId, timeouts] of timeoutMap.value) {
      const teamIdx = teams.value.findIndex((t) => t.id === teamId)
      if (teamIdx < 0) continue
      for (const t of timeouts) {
        if (t.afterColumnKey !== null && !isTimeoutAllowed(t.afterColumnKey)) {
          const colIdx = columns.value.findIndex((c) => c.key === t.afterColumnKey)
          if (colIdx >= 0) {
            if (!map.has(teamIdx)) map.set(teamIdx, new Set())
            map.get(teamIdx)!.add(colIdx)
          }
        }
      }
    }
    return map
  })

  /** Team indices that have more than 2 timeouts */
  const tooManyTimeoutsTeams = computed(() => {
    const set = new Set<number>()
    for (const [teamId, timeouts] of timeoutMap.value) {
      if (timeouts.length > MAX_TIMEOUTS_PER_TEAM) {
        const teamIdx = teams.value.findIndex((t) => t.id === teamId)
        if (teamIdx >= 0) set.add(teamIdx)
      }
    }
    return set
  })

  // --- Query helpers (business logic the template needs) ---

  function isBonusForTeam(teamIdx: TeamIdx, colIdx: ColIdx): boolean {
    return isBonusSituation(greyedOutResult.value.tossedUp, teamIdx, colIdx, teams.value.length)
  }

  function isGreyedOut(teamIdx: TeamIdx, seatIdx: SeatIdx, colIdx: ColIdx): boolean {
    const d = greyedOutResult.value.disabled
    return d.has(`${teamIdx}:${colIdx}`) || d.has(`${teamIdx}:${seatIdx}:${colIdx}`)
  }

  function isInvalid(teamIdx: TeamIdx, seatIdx: SeatIdx, colIdx: ColIdx): boolean {
    return validationErrors.value.has(`${teamIdx}:${seatIdx}:${colIdx}`)
  }

  /** Get human-readable validation messages for a cell (deduplicated) */
  function cellValidationMessages(teamIdx: TeamIdx, seatIdx: SeatIdx, colIdx: ColIdx): string[] {
    const codes = validationErrors.value.get(`${teamIdx}:${seatIdx}:${colIdx}`)
    if (!codes) return []
    return [...new Set(codes.map(validationMessage))]
  }

  /** Whether any cell in a column has a validation error */
  function columnHasErrors(colIdx: ColIdx): boolean {
    if (timeoutValidationErrors.value.has(colIdx)) return true
    for (const key of validationErrors.value.keys()) {
      if (key.endsWith(`:${colIdx}`)) return true
    }
    return false
  }

  /** Get deduplicated validation messages for all cells in a column */
  function columnValidationMessages(colIdx: ColIdx): string[] {
    const msgs = new Set<string>()
    if (timeoutValidationErrors.value.has(colIdx)) {
      msgs.add(validationMessage(ValidationCode.TimeoutAfterQ16))
    }
    for (const [key, codes] of validationErrors.value) {
      if (key.endsWith(`:${colIdx}`)) {
        for (const code of codes) msgs.add(validationMessage(code))
      }
    }
    return [...msgs]
  }

  /** Whether any cell for a specific quizzer has a validation error */
  function quizzerHasErrors(teamIdx: TeamIdx, seatIdx: SeatIdx): boolean {
    for (const key of validationErrors.value.keys()) {
      if (key.startsWith(`${teamIdx}:${seatIdx}:`)) return true
    }
    return false
  }

  /** Get deduplicated validation messages for a specific quizzer */
  function quizzerValidationMessages(teamIdx: TeamIdx, seatIdx: SeatIdx): string[] {
    const msgs = new Set<string>()
    for (const [key, codes] of validationErrors.value) {
      if (key.startsWith(`${teamIdx}:${seatIdx}:`)) {
        for (const code of codes) msgs.add(validationMessage(code))
      }
    }
    return [...msgs]
  }

  /** Get deduplicated validation messages for all cells in a team */
  function teamValidationMessages(teamIdx: TeamIdx): string[] {
    const msgs = new Set<string>()
    if (timeoutErrorsByTeam.value.has(teamIdx)) {
      msgs.add(validationMessage(ValidationCode.TimeoutAfterQ16))
    }
    if (tooManyTimeoutsTeams.value.has(teamIdx)) {
      msgs.add(validationMessage(ValidationCode.TooManyTimeouts))
    }
    for (const [key, codes] of validationErrors.value) {
      if (key.startsWith(`${teamIdx}:`)) {
        for (const code of codes) msgs.add(validationMessage(code))
      }
    }
    return [...msgs]
  }

  function isAfterOut(teamIdx: TeamIdx, seatIdx: SeatIdx, colIdx: ColIdx): boolean {
    const qs = scoring.value[teamIdx]?.quizzers[seatIdx]
    if (!qs || qs.outAfterCol < 0 || colIdx <= qs.outAfterCol) return false
    if (cells.value[teamIdx]![seatIdx]![colIdx] !== CellValue.Empty) return false
    if (qs.quizzedOut && !qs.erroredOut) {
      if (columns.value[colIdx]?.type === QuestionType.B || isBonusForTeam(teamIdx, colIdx))
        return false
    }
    return true
  }

  function isFouledOnQuestion(teamIdx: TeamIdx, seatIdx: SeatIdx, colIdx: ColIdx): boolean {
    return greyedOutResult.value.fouledQuizzers.has(`${teamIdx}:${seatIdx}:${colIdx}`)
  }

  function teamHasErrors(teamIdx: TeamIdx): boolean {
    if (timeoutErrorsByTeam.value.has(teamIdx)) return true
    if (tooManyTimeoutsTeams.value.has(teamIdx)) return true
    for (const key of validationErrors.value.keys()) {
      if (key.startsWith(`${teamIdx}:`)) return true
    }
    return false
  }

  const hasAnyErrors = computed(
    () =>
      validationErrors.value.size > 0 ||
      timeoutValidationErrors.value.size > 0 ||
      tooManyTimeoutsTeams.value.size > 0,
  )

  /** Get the answer value for a column (first non-empty, non-foul value) */
  function colAnswerValue(colIdx: ColIdx): CellValue {
    for (const team of cells.value) {
      for (const row of team) {
        const v = row[colIdx] ?? CellValue.Empty
        if (v !== CellValue.Empty && v !== CellValue.Foul) return v
      }
    }
    return CellValue.Empty
  }

  /** Check if a quizzer is an empty seat by positional indices */
  function isEmptySeat(teamIdx: TeamIdx, seatIdx: SeatIdx): boolean {
    const team = teams.value[teamIdx]
    if (!team) return false
    const qzrs = store.quizzersByTeam(team.id)
    const qzr = qzrs[seatIdx]
    if (!qzr) return false
    return store.isQuizzerUnnamed(qzr.id)
  }

  function noJumpHasConflict(colIdx: ColIdx): boolean {
    if (!noJumps.value[colIdx]) return false
    // No-jump on an orphaned column is itself invalid
    if (orphanedColumns.value.has(colIdx)) return true
    for (const key of validationErrors.value.keys()) {
      if (key.endsWith(`:${colIdx}`)) {
        const codes = validationErrors.value.get(key)
        if (codes?.includes(ValidationCode.NoJump)) return true
      }
    }
    return false
  }

  // --- Column visibility ---

  /** How many OT rounds should be visible (0 = none, 1 = Q21-23, etc.) */
  const visibleOtRounds = computed(() => {
    if (!quiz.value.overtime) return 0
    return computeOvertimeRounds(
      cells.value,
      columns.value,
      teams.value.map((t) => t.onTime),
      noJumps.value,
    )
  })

  /** Grow internal allocation when more rounds are needed */
  watch(visibleOtRounds, (needed) => {
    if (needed > internalOtRounds.value) {
      internalOtRounds.value = needed
    }
  })

  const visibleColumns = computed(() =>
    computeVisibleColumns(
      cells.value,
      columns.value,
      noJumps.value,
      visibleOtRounds.value,
      greyedOutResult.value.colStatuses,
    ),
  )

  /** Whether regulation questions (Q1–20) are fully filled out */
  const regulationComplete = computed(() =>
    questionsComplete(cells.value, columns.value, noJumps.value, 1, 20),
  )

  /** Whether all questions in the visible range have been jumped on or no-jumped */
  const allQuestionsComplete = computed(() =>
    quizJumpedComplete(cells.value, columns.value, noJumps.value, visibleOtRounds.value),
  )

  /** Placement medals per team: PlaceKey (encoding rank + tie-width), or null if not yet placed */
  const placements = computed(() => {
    if (!regulationComplete.value || hasAnyErrors.value) {
      return teams.value.map((): PlaceKey | null => null)
    }
    const onTimes = teams.value.map((t) => t.onTime)
    const regScores = computeRegulationScores(cells.value, columns.value, onTimes)
    const checkpoints = computeOtCheckpointScores(
      cells.value,
      columns.value,
      onTimes,
      noJumps.value,
    )
    return computePlacements(regScores, checkpoints, true, visibleOtRounds.value > 0)
  })

  /** Placement points per team (null if not yet placed), derived from placement + regulation score.
   * Per rules §1.e.4: in case of a tie, placement points use the score at end of Q20, not OT. */
  const placementPoints = computed(() => {
    const onTimes = teams.value.map((t) => t.onTime)
    const regScores = computeRegulationScores(cells.value, columns.value, onTimes)
    return teams.value.map((_, teamIdx) =>
      computePlacementPoints(
        regScores[teamIdx] ?? 0,
        placements.value[teamIdx] ?? null,
        quiz.value.placementFormula,
      ),
    )
  })

  /** Update a team name by positional index */
  function setTeamName(teamIdx: TeamIdx, name: string) {
    const team = teams.value[teamIdx]
    if (!team) return
    store.setTeamName(team.id, name)
    teamVersion.value++
  }

  /** Move a quizzer within a team by positional indices */
  function moveQuizzer(teamIdx: TeamIdx, fromSeat: SeatIdx, toSeat: SeatIdx) {
    const team = teams.value[teamIdx]
    if (!team) return
    store.moveQuizzer(team.id, fromSeat, toSeat)
    teamVersion.value++
    answerVersion.value++
  }

  /** Update a quizzer name by positional indices */
  function setQuizzerName(teamIdx: TeamIdx, seatIdx: SeatIdx, name: string) {
    const team = teams.value[teamIdx]
    if (!team) return
    const qzrs = store.quizzersByTeam(team.id)
    const qzr = qzrs[seatIdx]
    if (!qzr) return
    store.setQuizzerName(qzr.id, name)
    teamVersion.value++
  }

  /** Toggle on-time for a team by index */
  function toggleOnTime(teamIdx: TeamIdx) {
    const team = teams.value[teamIdx]
    if (!team) return
    team.onTime = !team.onTime
    teamVersion.value++
  }

  /** Toggle no-jump for a column by key */
  function toggleNoJump(colIdx: ColIdx) {
    const key = columns.value[colIdx]?.key
    if (!key) return
    const prev = noJumpMap.value.get(key) ?? false
    const next = !prev
    // If removing an auto-NJ, suppress re-adding until the bonus situation changes
    if (!next && autoNoJumpKeys.value.has(key)) {
      dismissedAutoNJ.value.add(key)
      dismissedAutoNJ.value = new Set(dismissedAutoNJ.value)
    }
    noJumpMap.value.set(key, next)
    noJumpMap.value = new Map(noJumpMap.value)
    history.push({
      undo: () => {
        noJumpMap.value.set(key, prev)
        noJumpMap.value = new Map(noJumpMap.value)
        if (prev && autoNoJumpKeys.value.has(key)) {
          dismissedAutoNJ.value.delete(key)
          dismissedAutoNJ.value = new Set(dismissedAutoNJ.value)
        }
      },
      redo: () => {
        noJumpMap.value.set(key, next)
        noJumpMap.value = new Map(noJumpMap.value)
        if (!next && autoNoJumpKeys.value.has(key)) {
          dismissedAutoNJ.value.add(key)
          dismissedAutoNJ.value = new Set(dismissedAutoNJ.value)
        }
      },
    })
  }

  // --- Timeouts ---

  function teamTimeouts(teamId: number): Timeout[] {
    return timeoutMap.value.get(teamId) ?? []
  }

  function timeoutCount(teamId: number): number {
    return teamTimeouts(teamId).length
  }

  /** Snapshot the entire timeoutMap for undo/redo */
  function snapshotTimeouts(): Map<number, Timeout[]> {
    const snap = new Map<number, Timeout[]>()
    for (const [k, v] of timeoutMap.value) snap.set(k, [...v])
    return snap
  }

  function applyTimeoutSnapshot(snap: Map<number, Timeout[]>): void {
    timeoutMap.value = new Map(snap)
  }

  /** Timeouts can be called between questions up through Q16; not after Q17+ (error points) */
  function isTimeoutAllowed(columnKey: string): boolean {
    const num = parseInt(columnKey, 10)
    return !isNaN(num) && num <= 16
  }

  function addTimeout(teamId: number, afterColumnKey: string | null): void {
    const snapshot = snapshotTimeouts()
    const current = teamTimeouts(teamId)

    // Only one team can have a timeout after a given question — clear the other team's
    if (afterColumnKey !== null) {
      for (const [otherId, otherTimeouts] of timeoutMap.value) {
        if (otherId === teamId) continue
        const filtered = otherTimeouts.filter((t) => t.afterColumnKey !== afterColumnKey)
        if (filtered.length !== otherTimeouts.length) {
          timeoutMap.value.set(otherId, filtered)
        }
      }
    }

    // If a column is specified and this team has an untracked timeout, upgrade it
    if (afterColumnKey !== null) {
      const untrackedIdx = current.findIndex((t) => t.afterColumnKey === null)
      if (untrackedIdx >= 0) {
        const next = [...current]
        next[untrackedIdx] = { afterColumnKey }
        timeoutMap.value.set(teamId, next)
        timeoutMap.value = new Map(timeoutMap.value)
        history.push({
          undo: () => applyTimeoutSnapshot(snapshot),
          redo: () => addTimeout(teamId, afterColumnKey),
        })
        return
      }
    }

    const next = [...current, { afterColumnKey }]
    timeoutMap.value.set(teamId, next)
    timeoutMap.value = new Map(timeoutMap.value)
    history.push({
      undo: () => applyTimeoutSnapshot(snapshot),
      redo: () => addTimeout(teamId, afterColumnKey),
    })
  }

  function removeLastTimeout(teamId: number): void {
    const current = teamTimeouts(teamId)
    if (current.length === 0) return

    const prev = [...current]
    const next = current.slice(0, -1)
    timeoutMap.value.set(teamId, next)
    timeoutMap.value = new Map(timeoutMap.value)
    history.push({
      undo: () => {
        timeoutMap.value.set(teamId, prev)
        timeoutMap.value = new Map(timeoutMap.value)
      },
      redo: () => {
        timeoutMap.value.set(teamId, next)
        timeoutMap.value = new Map(timeoutMap.value)
      },
    })
  }

  /** Toggle a timeout for a team at a specific column */
  function toggleTimeout(teamId: number, columnKey: string): void {
    const current = teamTimeouts(teamId)
    const existingIdx = current.findIndex((t) => t.afterColumnKey === columnKey)
    if (existingIdx >= 0) {
      // Remove it
      const snapshot = snapshotTimeouts()
      const next = current.filter((_, i) => i !== existingIdx)
      timeoutMap.value.set(teamId, next)
      timeoutMap.value = new Map(timeoutMap.value)
      history.push({
        undo: () => applyTimeoutSnapshot(snapshot),
        redo: () => toggleTimeout(teamId, columnKey),
      })
    } else {
      addTimeout(teamId, columnKey)
    }
  }

  /** Check if a specific team has a timeout at a specific column */
  function hasTimeoutAt(teamId: number, columnKey: string): boolean {
    return teamTimeouts(teamId).some((t) => t.afterColumnKey === columnKey)
  }

  /** Check if any team has a timeout after the given column */
  function hasTimeoutAfterCol(colKey: string): boolean {
    for (const timeouts of timeoutMap.value.values()) {
      if (timeouts.some((t) => t.afterColumnKey === colKey)) return true
    }
    return false
  }

  /** Set the question category for a column by index (null clears it) */
  function setQuestionType(colIdx: ColIdx, category: QuestionCategory | null) {
    const col = columns.value[colIdx]
    if (!col) return
    store.setQuestionType(col.key, category)
    answerVersion.value++
  }

  /** Load a deserialized quiz file into the store, replacing all state */
  function loadFile(data: DeserializeResult) {
    store.loadState(data)
    quiz.value = store.quiz
    noJumpMap.value = data.noJumps
    timeoutMap.value = data.timeouts
    internalOtRounds.value = data.quiz.overtime
      ? Math.max(
          1,
          computeOvertimeRounds(
            store.cellGrid(buildColumns(20)),
            buildColumns(20),
            data.teams.map((t) => t.onTime),
            buildColumns(20).map((c) => data.noJumps.get(c.key) ?? false),
          ),
        )
      : 1
    answerVersion.value++
    teamVersion.value++
    history.clear()
    saveToStorage(store, data.noJumps, data.timeouts)
  }
  function resetStore() {
    const fresh = createQuizStore()
    store.loadState({
      quiz: fresh.quiz,
      teams: fresh.teams,
      quizzers: fresh.quizzers,
      answers: [],
    })
    quiz.value = store.quiz
    noJumpMap.value = new Map()
    timeoutMap.value = new Map()
    autoNoJumpKeys.value = new Set()
    dismissedAutoNJ.value = new Set()
    internalOtRounds.value = 1
    answerVersion.value++
    teamVersion.value++
    history.clear()
    clearStorage()
  }

  /** Clear all answers and no-jump flags, keeping names and quiz metadata */
  function clearAnswers() {
    // Snapshot before calling loadState — loadState mutates the internal arrays in-place,
    // so passing store.teams/quizzers directly would zero them out mid-iteration.
    const teams = [...store.teams]
    const quizzers = [...store.quizzers]
    store.loadState({
      quiz: store.quiz,
      teams,
      quizzers,
      answers: [],
    })
    noJumpMap.value = new Map()
    timeoutMap.value = new Map()
    autoNoJumpKeys.value = new Set()
    dismissedAutoNJ.value = new Set()
    internalOtRounds.value = 1
    answerVersion.value++
    history.clear()
    saveToStorage(store, noJumpMap.value, timeoutMap.value)
  }

  /** Reset all team and quizzer names to defaults (Team 1/2/3, Quizzer 1/2/3/4) */
  function clearNames() {
    const sortedTeams = [...store.teams].sort((a, b) => a.seatOrder - b.seatOrder)
    for (let i = 0; i < sortedTeams.length; i++) {
      const team = sortedTeams[i]!
      store.setTeamName(team.id, `Team ${i + 1}`)
      const qzrs = store.quizzersByTeam(team.id)
      for (let j = 0; j < qzrs.length; j++) {
        store.setQuizzerName(qzrs[j]!.id, j < 4 ? `Quizzer ${j + 1}` : '')
      }
    }
    teamVersion.value++
    history.clear()
    saveToStorage(store, noJumpMap.value, timeoutMap.value)
  }

  // --- Auto-persist to localStorage ---
  const pauseAutoSave = ref(false)
  let persistTimer: ReturnType<typeof setTimeout> | null = null
  function schedulePersist() {
    if (pauseAutoSave.value) return
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => saveToStorage(store, noJumpMap.value, timeoutMap.value), 300)
  }
  watch(
    [
      () => answerVersion.value,
      () => teamVersion.value,
      noJumpMap,
      timeoutMap,
      () => quiz.value.division,
      () => quiz.value.quizNumber,
      () => quiz.value.overtime,
      () => quiz.value.consolation,
      () => quiz.value.placementFormula,
      () => quiz.value.bonusRule,
    ],
    schedulePersist,
  )

  return {
    columns,
    quiz,
    teams,
    teamQuizzers,
    cells,
    noJumps,
    scoring,
    setCell,
    toggleNoJump,
    toggleOnTime,
    setTeamName,
    setQuizzerName,
    moveQuizzer,

    // Grey-out & validation
    validationErrors,
    timeoutValidationErrors,
    tooManyTimeoutsTeams,

    // Query helpers
    isEmptySeat,
    isBonusForTeam,
    isGreyedOut,
    isInvalid,
    cellValidationMessages,
    columnHasErrors,
    columnValidationMessages,
    quizzerHasErrors,
    quizzerValidationMessages,
    teamValidationMessages,
    isAfterOut,
    isFouledOnQuestion,
    teamHasErrors,
    hasAnyErrors,
    colAnswerValue,
    noJumpHasConflict,

    // Column visibility
    visibleColumns,
    visibleOtRounds,
    allQuestionsComplete,

    // Placements
    placements,
    placementPoints,

    // Undo/redo
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    isDirty: history.isDirty,
    undo: history.undo,
    redo: history.redo,
    markSaved: history.markSaved,

    // Persistence
    store,
    noJumpMap,
    timeoutMap,
    pauseAutoSave,
    answerVersion,
    teamVersion,
    loadFile,
    resetStore,
    clearAnswers,
    clearNames,

    // Timeouts
    teamTimeouts,
    timeoutCount,
    isTimeoutAllowed,
    addTimeout,
    removeLastTimeout,
    toggleTimeout,
    hasTimeoutAt,
    hasTimeoutAfterCol,

    // Question types
    setQuestionType,
  }
}
