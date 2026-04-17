import { CellValue } from '../types/scoresheet'
import type { TeamIdx, SeatIdx, ColIdx } from '../types/indices'
import { toTeamIdx as T, toSeatIdx as S, toColIdx as C } from '../types/indices'

export type ScoresheetActions = {
  setQuizzerName: (teamIdx: TeamIdx, seatIdx: SeatIdx, name: string) => void
  setTeamName: (teamIdx: TeamIdx, name: string) => void
  setCell: (teamIdx: TeamIdx, seatIdx: SeatIdx, colIdx: ColIdx, value: CellValue) => void
  toggleNoJump: (colIdx: ColIdx) => void
  toggleTimeout: (teamId: number, colKey: string) => void
  toggleOnTime: (teamIdx: TeamIdx) => void
  moveQuizzer: (teamIdx: TeamIdx, from: SeatIdx, to: SeatIdx) => void
  columns: { value: { key: string }[] }
  teams: { value: { id: number; onTime: boolean }[] }
  quiz: { value: { overtime: boolean } }
}

export interface TutorialStep {
  id: string
  target:
    | { type: 'selector'; css: string }
    | { type: 'cell'; teamIdx: TeamIdx; seatIdx: SeatIdx; colIdx: ColIdx }
    | { type: 'column'; colIdx: ColIdx }
    | { type: 'timeout-row'; teamIdx: TeamIdx }
    | { type: 'none' }
  placement: 'top' | 'bottom' | 'left' | 'right'
  title: string
  body: string
  completion:
    | { type: 'acknowledge' }
    | {
        type: 'cell-value'
        teamIdx: TeamIdx
        seatIdx: SeatIdx
        colIdx: ColIdx
        value: CellValue | CellValue[]
      }
    | { type: 'input-non-empty'; teamIdx: TeamIdx; seatIdx?: SeatIdx }
    | { type: 'input-empty'; teamIdx: TeamIdx; seatIdx: SeatIdx }
    | { type: 'click-target' }
    | { type: 'seat-change'; teamIdx: TeamIdx }
  allowSelectorPopup?: boolean
  /** Allow clicks through the overlay even for acknowledge steps */
  interactive?: boolean
  /** Run when this step is shown to prepare state */
  setup?: (actions: ScoresheetActions) => void
  /** Run when user presses Skip to fix up state */
  onNext?: (actions: ScoresheetActions) => void
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  // --- Setup ---
  {
    id: 'welcome',
    target: { type: 'none' },
    placement: 'bottom',
    title: 'Welcome to the Scoresheet',
    body: "This tutorial walks you through scoring a Bible quiz. You'll learn how to set up teams, record answers, and use timeouts. Your current quiz is safely saved \u2014 we'll restore it when you're done.",
    completion: { type: 'acknowledge' },
  },
  {
    id: 'name-team',
    target: { type: 'selector', css: '[data-tutorial="team-name-0"]' },
    placement: 'bottom',
    title: 'Name a Team',
    body: 'Click the team name and type a name for this team.',
    completion: { type: 'input-non-empty', teamIdx: T(0) },
  },
  {
    id: 'name-quizzer',
    target: { type: 'selector', css: '[data-tutorial="quizzer-name-0-0"]' },
    placement: 'bottom',
    title: 'Name a Quizzer',
    body: 'Type a name for the first quizzer on this team.',
    completion: { type: 'input-non-empty', teamIdx: T(0), seatIdx: S(0) },
  },
  {
    id: 'remove-quizzer',
    target: { type: 'selector', css: '[data-tutorial="quizzer-row-1-3"] .col--name' },
    placement: 'bottom',
    title: 'Remove a Quizzer',
    body: 'To remove a quizzer, hover over their name and click the \u00d7 button that appears. This creates an empty seat.',
    completion: { type: 'input-empty', teamIdx: T(1), seatIdx: S(3) },
    onNext: (actions) => actions.setQuizzerName(T(1), S(3), ''),
  },
  {
    id: 'add-fifth',
    target: { type: 'selector', css: '[data-tutorial="quizzer-name-2-4"]' },
    placement: 'top',
    title: 'Add a 5th Quizzer',
    body: 'Each team can have up to 5 quizzers. The 5th quizzer starts on the bench. Type a name to add a substitute.',
    completion: { type: 'input-non-empty', teamIdx: T(2), seatIdx: S(4) },
    onNext: (actions) => actions.setQuizzerName(T(2), S(4), 'Quizzer 5'),
  },
  {
    id: 'explain-fifth',
    target: { type: 'selector', css: '[data-tutorial="quizzer-row-2-4"]' },
    placement: 'top',
    title: 'The Substitute',
    body: "The 5th quizzer sits on the bench and can be substituted in during a timeout. We'll try that later.",
    completion: { type: 'acknowledge' },
  },
  {
    id: 'on-time',
    target: { type: 'selector', css: '[data-tutorial="on-time-1"]' },
    placement: 'right',
    title: 'On-Time Bonus',
    body: 'If the full team is present at the start, they earn a +20 on-time bonus. Try clicking it to toggle on and off.',
    completion: { type: 'acknowledge' },
    interactive: true,
  },

  // --- Scoring ---
  {
    id: 'question-type',
    target: { type: 'selector', css: '[data-tutorial="col-header-0"]' },
    placement: 'bottom',
    title: 'Question Type',
    body: 'You can set the question type (INT, FTV, REF, MA, Q, SIT) in the column header dropdown. This is optional but helpful for record-keeping.',
    completion: { type: 'acknowledge' },
  },
  {
    id: 'q1-correct',
    target: { type: 'cell', teamIdx: T(0), seatIdx: S(0), colIdx: C(0) },
    placement: 'bottom',
    title: 'Record a Correct Answer',
    body: 'A quizzer on Team 1 answers question 1 correctly. Click this cell, then select C (Correct).',
    completion: {
      type: 'cell-value',
      teamIdx: T(0),
      seatIdx: S(0),
      colIdx: C(0),
      value: CellValue.Correct,
    },
    allowSelectorPopup: true,
    onNext: (actions) => actions.setCell(T(0), S(0), C(0), CellValue.Correct),
  },
  {
    id: 'observe-total',
    target: { type: 'selector', css: '[data-tutorial="team-total-0"]' },
    placement: 'top',
    title: 'Running Total',
    body: 'The team scored +20 for the correct answer. With the on-time bonus, the total is 40. This updates automatically as you score.',
    completion: { type: 'acknowledge' },
  },
  {
    id: 'q2-error',
    target: { type: 'cell', teamIdx: T(1), seatIdx: S(0), colIdx: C(1) },
    placement: 'bottom',
    title: 'Record an Error',
    body: 'A quizzer on Team 2 answers question 2 incorrectly. Click this cell and select E (Error).',
    completion: {
      type: 'cell-value',
      teamIdx: T(1),
      seatIdx: S(0),
      colIdx: C(1),
      value: CellValue.Error,
    },
    allowSelectorPopup: true,
    onNext: (actions) => actions.setCell(T(1), S(0), C(1), CellValue.Error),
  },
  {
    id: 'explain-tossup',
    target: { type: 'column', colIdx: C(2) },
    placement: 'right',
    title: 'Toss-Up',
    body: "After an error, that team can't jump on the next question \u2014 it becomes a toss-up for the other two teams.",
    completion: { type: 'acknowledge' },
  },
  {
    id: 'q3-tossup-error',
    target: { type: 'cell', teamIdx: T(2), seatIdx: S(0), colIdx: C(2) },
    placement: 'bottom',
    title: 'Error on the Toss-Up',
    body: 'A quizzer on Team 3 also answers incorrectly on the toss-up. Click this cell and select E (Error).',
    completion: {
      type: 'cell-value',
      teamIdx: T(2),
      seatIdx: S(0),
      colIdx: C(2),
      value: CellValue.Error,
    },
    allowSelectorPopup: true,
    onNext: (actions) => actions.setCell(T(2), S(0), C(2), CellValue.Error),
  },
  {
    id: 'explain-bonus',
    target: { type: 'column', colIdx: C(3) },
    placement: 'right',
    title: 'Bonus Question',
    body: 'Both other teams erred, so the next question is a bonus for Team 1 \u2014 they get to answer without competition.',
    completion: { type: 'acknowledge' },
  },
  {
    id: 'q4-bonus',
    target: { type: 'cell', teamIdx: T(0), seatIdx: S(1), colIdx: C(3) },
    placement: 'bottom',
    title: 'Answer the Bonus',
    body: 'Click this cell and select B (Bonus) if correct, or MB (Missed Bonus) if incorrect.',
    completion: {
      type: 'cell-value',
      teamIdx: T(0),
      seatIdx: S(1),
      colIdx: C(3),
      value: [CellValue.Bonus, CellValue.MissedBonus],
    },
    allowSelectorPopup: true,
    onNext: (actions) => actions.setCell(T(0), S(1), C(3), CellValue.Bonus),
  },
  {
    id: 'no-jump',
    target: { type: 'selector', css: '[data-tutorial="no-jump-4"]' },
    placement: 'top',
    title: 'No Jump',
    body: 'If nobody jumps on a question, click No Jump to mark it. Click here to toggle it.',
    completion: { type: 'click-target' },
    onNext: (actions) => actions.toggleNoJump(C(4)),
  },

  // --- Timeout + substitution ---
  {
    id: 'call-timeout',
    target: { type: 'selector', css: '[data-tutorial="timeout-2-4"]' },
    placement: 'bottom',
    title: 'Call a Timeout',
    body: 'Each team gets 2 timeouts per quiz. Click here to mark a timeout for Team 3 after question 5.',
    completion: { type: 'click-target' },
    onNext: (actions) => {
      const teamId = actions.teams.value[2]?.id
      const colKey = actions.columns.value[4]?.key
      if (teamId !== undefined && colKey) actions.toggleTimeout(teamId, colKey)
    },
  },
  {
    id: 'explain-timeout',
    target: { type: 'timeout-row', teamIdx: T(2) },
    placement: 'bottom',
    title: 'Timeout',
    body: 'The "T" marker shows that Team 3 called a timeout here. During a timeout, coaches can substitute quizzers.',
    completion: { type: 'acknowledge' },
  },
  {
    id: 'swap-quizzer',
    target: { type: 'selector', css: '[data-tutorial="quizzer-row-2-4"]' },
    placement: 'top',
    title: 'Substitute a Quizzer',
    body: "Drag the 5th quizzer up to swap them into the lineup. Grab the drag handle (\u2807) and drag to another quizzer's position.",
    completion: { type: 'seat-change', teamIdx: T(2) },
    onNext: (actions) => actions.moveQuizzer(T(2), S(4), S(0)),
  },
  {
    id: 'explain-substitution',
    target: { type: 'selector', css: '[data-tutorial^="quizzer-row-2-"]' },
    placement: 'top',
    title: 'Substitution Complete',
    body: 'The quizzers have been swapped. The substitute is now in the lineup and the other quizzer moves to the bench (seat 5).',
    completion: { type: 'acknowledge' },
  },

  // --- Overtime ---
  {
    id: 'fast-forward-1',
    target: { type: 'none' },
    placement: 'bottom',
    title: 'Fast Forward',
    body: "Let's fast-forward through the first 17 questions. Then we'll walk through a Q18 A/B chain live.",
    completion: { type: 'acknowledge' },
    setup: (actions) => {
      // Column indices: Q1-Q15 → 0-14, Q16/A/B → 15-17, Q17/A/B → 18-20,
      // Q18/A/B → 21-23, Q19/A/B → 24-26, Q20/A/B → 27-29
      const totalCols = 30

      // Clear all existing cells
      for (let teamIdx = 0; teamIdx < 3; teamIdx++) {
        for (let seatIdx = 0; seatIdx < 5; seatIdx++) {
          for (let colIdx = 0; colIdx < totalCols; colIdx++) {
            actions.setCell(T(teamIdx), S(seatIdx), C(colIdx), CellValue.Empty)
          }
        }
      }

      // Set on-time for all teams
      for (let teamIdx = 0; teamIdx < 3; teamIdx++) {
        if (!actions.teams.value[teamIdx]!.onTime) actions.toggleOnTime(T(teamIdx))
      }

      // Fill Q1-Q17A only — Q18 chain is walked through interactively.
      // Final scores after all answers will be 120 each (three-way tie).
      const plays: [number, number, number, CellValue][] = [
        [0, 0, 0, CellValue.Correct], //   Q1:  T1 q0 C
        [1, 1, 0, CellValue.Error], //     Q2:  T2 q0 E → toss-up
        [2, 2, 0, CellValue.Error], //     Q3:  T3 q0 E → bonus for T1
        [3, 0, 1, CellValue.MissedBonus], // Q4: T1 q1 MB
        // Q5: no-jump (already set from earlier tutorial step)
        [5, 1, 1, CellValue.Correct], //   Q6:  T2 q1 C
        [6, 2, 1, CellValue.Correct], //   Q7:  T3 q1 C
        [7, 0, 2, CellValue.Correct], //   Q8:  T1 q2 C
        [8, 1, 2, CellValue.Correct], //   Q9:  T2 q2 C
        [9, 2, 2, CellValue.Correct], //   Q10: T3 q2 C
        [10, 0, 1, CellValue.Correct], //  Q11: T1 q1 C (4th unique for T1)
        [11, 1, 0, CellValue.Correct], //  Q12: T2 q0 C (3rd unique for T2)
        [12, 2, 0, CellValue.Correct], //  Q13: T3 q0 C (3rd unique for T3)
        [13, 1, 1, CellValue.Correct], //  Q14: T2 q1 C
        [14, 2, 1, CellValue.Correct], //  Q15: T3 q1 C
        [15, 0, 3, CellValue.Correct], //  Q16: T1 q3 C
        [18, 0, 0, CellValue.Error], //    Q17: T1 q0 E (-10)
        [19, 1, 2, CellValue.Correct], //  Q17A: T2 q2 C
      ]

      for (const [colIdx, teamIdx, seatIdx, value] of plays) {
        actions.setCell(T(teamIdx), S(seatIdx), C(colIdx), value)
      }
    },
  },
  {
    id: 'q18-error',
    target: { type: 'cell', teamIdx: T(0), seatIdx: S(2), colIdx: C(21) },
    placement: 'bottom',
    title: 'Question 18',
    body: 'Every question from 17-20 must have all three teams jumping. Team 1 errors on Q18 \u2014 click this cell and select E.',
    completion: {
      type: 'cell-value',
      teamIdx: T(0),
      seatIdx: S(2),
      colIdx: C(21),
      value: CellValue.Error,
    },
    allowSelectorPopup: true,
    onNext: (actions) => actions.setCell(T(0), S(2), C(21), CellValue.Error),
  },
  {
    id: 'explain-q18a',
    target: { type: 'column', colIdx: C(22) },
    placement: 'right',
    title: 'Toss-Up (Q18A)',
    body: 'Because Team 1 errored, the question number doesn\u2019t advance \u2014 we ask an A version of Q18 instead. Q18A is a toss-up for the other two teams.',
    completion: { type: 'acknowledge' },
  },
  {
    id: 'q18a-error',
    target: { type: 'cell', teamIdx: T(1), seatIdx: S(1), colIdx: C(22) },
    placement: 'bottom',
    title: 'Toss-Up Error',
    body: 'Team 2 jumps on the toss-up and errors too. Click this cell and select E.',
    completion: {
      type: 'cell-value',
      teamIdx: T(1),
      seatIdx: S(1),
      colIdx: C(22),
      value: CellValue.Error,
    },
    allowSelectorPopup: true,
    onNext: (actions) => actions.setCell(T(1), S(1), C(22), CellValue.Error),
  },
  {
    id: 'explain-q18b',
    target: { type: 'column', colIdx: C(23) },
    placement: 'right',
    title: 'Bonus (Q18B)',
    body: 'Team 2 also errored, so the number still doesn\u2019t advance \u2014 we ask a B version of Q18. Q18B is a bonus for Team 3, who answers without competition. Only after this will we move to Q19.',
    completion: { type: 'acknowledge' },
  },
  {
    id: 'q18b-bonus',
    target: { type: 'cell', teamIdx: T(2), seatIdx: S(2), colIdx: C(23) },
    placement: 'bottom',
    title: 'Bonus Answer',
    body: 'Click this cell and pick B (Bonus) or MB (Missed Bonus).',
    completion: {
      type: 'cell-value',
      teamIdx: T(2),
      seatIdx: S(2),
      colIdx: C(23),
      value: [CellValue.Bonus, CellValue.MissedBonus],
    },
    allowSelectorPopup: true,
    onNext: (actions) => actions.setCell(T(2), S(2), C(23), CellValue.Bonus),
  },
  {
    id: 'fast-forward-2',
    target: { type: 'none' },
    placement: 'bottom',
    title: 'Fast Forward',
    body: "We'll fill in the rest of the quiz. All three teams end up tied \u2014 time for overtime.",
    completion: { type: 'acknowledge' },
    setup: (actions) => {
      // Q19: T1 q2 C (colIdx 24), Q20: no-jump (colIdx 27)
      actions.setCell(T(0), S(2), C(24), CellValue.Correct)
      actions.toggleNoJump(C(27))
    },
  },
  {
    id: 'overtime-toggle',
    target: { type: 'selector', css: '[data-tutorial="overtime-toggle"]' },
    placement: 'bottom',
    title: 'Enable Overtime',
    body: 'All three teams are tied. If this quiz needs to break ties, toggle the Overtime switch to add overtime rounds.',
    completion: { type: 'acknowledge' },
    interactive: true,
    onNext: (actions) => {
      actions.quiz.value.overtime = true
    },
  },
  {
    id: 'explain-overtime',
    target: { type: 'selector', css: '[data-tutorial="col-header-30"]' },
    placement: 'bottom',
    title: 'Overtime',
    body: 'Overtime questions appear in groups of 3. Only tied teams can answer, and error points (-10) apply. Questions 21-23 have A/B parts just like 16-20.',
    completion: { type: 'acknowledge' },
    setup: (actions) => {
      if (!actions.quiz.value.overtime) actions.quiz.value.overtime = true
    },
  },
  {
    id: 'ot-round-1',
    target: { type: 'none' },
    placement: 'bottom',
    title: 'Overtime — Round 1',
    body: "Let's play through overtime. Each team errors once and two of the toss-ups are answered. Team 3 falls behind.",
    completion: { type: 'acknowledge' },
    setup: (actions) => {
      // OT columns: Q21/A/B → colIdx 30/31/32, Q22/A/B → 33/34/35, Q23/A/B → 36/37/38
      // Q21: T1 E (-10) → 110, Q21A: T2 C (+20) → 140
      // Q22: T2 E (-10) → 130, Q22A: T1 C (+20) → 130
      // Q23: T3 E (-10) → 110, Q23A: NJ
      // Result: T1=130, T2=130, T3=110
      actions.setCell(T(0), S(2), C(30), CellValue.Error) // Q21: T1 q2 E
      actions.setCell(T(1), S(1), C(31), CellValue.Correct) // Q21A: T2 q1 C
      actions.setCell(T(1), S(0), C(33), CellValue.Error) // Q22: T2 q0 E
      actions.setCell(T(0), S(0), C(34), CellValue.Correct) // Q22A: T1 q0 C
      actions.setCell(T(2), S(1), C(36), CellValue.Error) // Q23: T3 q1 E
      actions.toggleNoJump(C(37)) // Q23A: NJ
    },
  },
  {
    id: 'ot-placed',
    target: { type: 'selector', css: '[data-tutorial="team-total-2"]' },
    placement: 'top',
    title: 'Team Placed',
    body: 'Team 3 is no longer tied and finishes in 3rd place. Their result is final — they can leave the platform. Teams 1 and 2 continue to break the remaining tie.',
    completion: { type: 'acknowledge' },
  },
  {
    id: 'ot-round-2',
    target: { type: 'none' },
    placement: 'bottom',
    title: 'Overtime — Round 2',
    body: 'Team 1 has a rough round — three errors. Team 2 picks up one of the bonuses. Watch what happens to the final scores.',
    completion: { type: 'acknowledge' },
    setup: (actions) => {
      // OT round 2: Q24/A/B → colIdx 39/40/41, Q25/A/B → 42/43/44, Q26/A/B → 45/46/47
      // With only 2 teams, A columns are skipped (greyedOut routes directly to B)
      // Q24: T1 E (-10)→120, Q24B: T2 MB (bonus, 0)→130
      // Q25: T1 E (-10)→110, Q25B: T2 MB (bonus, 0)→130
      // Q26: T1 E (-10)→100, Q26B: T2 B  (bonus,+10)→140
      // Result: T2=140 (1st), T1=100 (2nd), T3=110 (3rd)
      // 2nd place (100) < 3rd place (110) — scores are non-linear!
      actions.setCell(T(0), S(1), C(39), CellValue.Error) // Q24: T1 q1 E
      actions.setCell(T(1), S(1), C(41), CellValue.MissedBonus) // Q24B: T2 q1 MB
      actions.setCell(T(0), S(3), C(42), CellValue.Error) // Q25: T1 q3 E
      actions.setCell(T(1), S(2), C(44), CellValue.MissedBonus) // Q25B: T2 q2 MB
      actions.setCell(T(0), S(0), C(45), CellValue.Error) // Q26: T1 q0 E
      actions.setCell(T(1), S(0), C(47), CellValue.Bonus) // Q26B: T2 q0 B (+10)
    },
  },
  {
    id: 'ot-result',
    target: { type: 'selector', css: '[data-tutorial^="team-total-"]' },
    placement: 'left',
    title: 'Final Placements',
    body: 'Notice that 2nd place scored lower than 3rd — placement is determined by overtime, but the score reflects the full quiz. Be careful when recording placement points!',
    completion: { type: 'acknowledge' },
  },

  // --- Wrap-up ---
  {
    id: 'done',
    target: { type: 'none' },
    placement: 'bottom',
    title: "You're Ready!",
    body: 'That covers the basics of scoring a quiz. You can access this tutorial anytime from the ? button. Your original quiz will now be restored.',
    completion: { type: 'acknowledge' },
  },
]
