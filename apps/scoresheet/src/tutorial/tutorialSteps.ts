import { CellValue } from '../types/scoresheet'

export type ScoresheetActions = {
  setQuizzerName: (ti: number, qi: number, name: string) => void
  setTeamName: (ti: number, name: string) => void
  setCell: (ti: number, qi: number, ci: number, value: CellValue) => void
  toggleNoJump: (ci: number) => void
  toggleTimeout: (teamId: number, colKey: string) => void
  toggleOnTime: (ti: number) => void
  moveQuizzer: (ti: number, from: number, to: number) => void
  columns: { value: { key: string }[] }
  teams: { value: { id: number; onTime: boolean }[] }
  quiz: { value: { overtime: boolean } }
}

export interface TutorialStep {
  id: string
  target:
    | { type: 'selector'; css: string }
    | { type: 'cell'; ti: number; qi: number; ci: number }
    | { type: 'column'; ci: number }
    | { type: 'timeout-row'; ti: number }
    | { type: 'none' }
  placement: 'top' | 'bottom' | 'left' | 'right'
  title: string
  body: string
  completion:
    | { type: 'acknowledge' }
    | { type: 'cell-value'; ti: number; qi: number; ci: number; value: CellValue | CellValue[] }
    | { type: 'input-non-empty'; teamIdx: number; quizzerIdx?: number }
    | { type: 'input-empty'; teamIdx: number; quizzerIdx: number }
    | { type: 'click-target' }
    | { type: 'seat-change'; teamIdx: number }
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
    completion: { type: 'input-non-empty', teamIdx: 0 },
  },
  {
    id: 'name-quizzer',
    target: { type: 'selector', css: '[data-tutorial="quizzer-name-0-0"]' },
    placement: 'bottom',
    title: 'Name a Quizzer',
    body: 'Type a name for the first quizzer on this team.',
    completion: { type: 'input-non-empty', teamIdx: 0, quizzerIdx: 0 },
  },
  {
    id: 'remove-quizzer',
    target: { type: 'selector', css: '[data-tutorial="quizzer-row-1-3"] .col--name' },
    placement: 'bottom',
    title: 'Remove a Quizzer',
    body: 'To remove a quizzer, hover over their name and click the \u00d7 button that appears. This creates an empty seat.',
    completion: { type: 'input-empty', teamIdx: 1, quizzerIdx: 3 },
    onNext: (actions) => actions.setQuizzerName(1, 3, ''),
  },
  {
    id: 'add-fifth',
    target: { type: 'selector', css: '[data-tutorial="quizzer-name-2-4"]' },
    placement: 'top',
    title: 'Add a 5th Quizzer',
    body: 'Each team can have up to 5 quizzers. The 5th quizzer starts on the bench. Type a name to add a substitute.',
    completion: { type: 'input-non-empty', teamIdx: 2, quizzerIdx: 4 },
    onNext: (actions) => actions.setQuizzerName(2, 4, 'Quizzer 5'),
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
    target: { type: 'cell', ti: 0, qi: 0, ci: 0 },
    placement: 'bottom',
    title: 'Record a Correct Answer',
    body: 'A quizzer on Team 1 answers question 1 correctly. Click this cell, then select C (Correct).',
    completion: { type: 'cell-value', ti: 0, qi: 0, ci: 0, value: CellValue.Correct },
    allowSelectorPopup: true,
    onNext: (actions) => actions.setCell(0, 0, 0, CellValue.Correct),
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
    target: { type: 'cell', ti: 1, qi: 0, ci: 1 },
    placement: 'bottom',
    title: 'Record an Error',
    body: 'A quizzer on Team 2 answers question 2 incorrectly. Click this cell and select E (Error).',
    completion: { type: 'cell-value', ti: 1, qi: 0, ci: 1, value: CellValue.Error },
    allowSelectorPopup: true,
    onNext: (actions) => actions.setCell(1, 0, 1, CellValue.Error),
  },
  {
    id: 'explain-tossup',
    target: { type: 'column', ci: 2 },
    placement: 'right',
    title: 'Toss-Up',
    body: "After an error, that team can't jump on the next question \u2014 it becomes a toss-up for the other two teams.",
    completion: { type: 'acknowledge' },
  },
  {
    id: 'q3-tossup-error',
    target: { type: 'cell', ti: 2, qi: 0, ci: 2 },
    placement: 'bottom',
    title: 'Error on the Toss-Up',
    body: 'A quizzer on Team 3 also answers incorrectly on the toss-up. Click this cell and select E (Error).',
    completion: { type: 'cell-value', ti: 2, qi: 0, ci: 2, value: CellValue.Error },
    allowSelectorPopup: true,
    onNext: (actions) => actions.setCell(2, 0, 2, CellValue.Error),
  },
  {
    id: 'explain-bonus',
    target: { type: 'column', ci: 3 },
    placement: 'right',
    title: 'Bonus Question',
    body: 'Both other teams erred, so the next question is a bonus for Team 1 \u2014 they get to answer without competition.',
    completion: { type: 'acknowledge' },
  },
  {
    id: 'q4-bonus',
    target: { type: 'cell', ti: 0, qi: 1, ci: 3 },
    placement: 'bottom',
    title: 'Answer the Bonus',
    body: 'Click this cell and select B (Bonus) if correct, or MB (Missed Bonus) if incorrect.',
    completion: {
      type: 'cell-value',
      ti: 0,
      qi: 1,
      ci: 3,
      value: [CellValue.Bonus, CellValue.MissedBonus],
    },
    allowSelectorPopup: true,
    onNext: (actions) => actions.setCell(0, 1, 3, CellValue.Bonus),
  },
  {
    id: 'no-jump',
    target: { type: 'selector', css: '[data-tutorial="no-jump-4"]' },
    placement: 'top',
    title: 'No Jump',
    body: 'If nobody jumps on a question, click No Jump to mark it. Click here to toggle it.',
    completion: { type: 'click-target' },
    onNext: (actions) => actions.toggleNoJump(4),
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
    target: { type: 'timeout-row', ti: 2 },
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
    completion: { type: 'seat-change', teamIdx: 2 },
    onNext: (actions) => actions.moveQuizzer(2, 4, 0),
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
    id: 'fill-quiz',
    target: { type: 'none' },
    placement: 'bottom',
    title: 'Fast Forward',
    body: "Let's skip ahead to see what happens when teams are tied. We've filled in a full quiz where all three teams scored equally.",
    completion: { type: 'acknowledge' },
    setup: (actions) => {
      // Column indices: Q1-Q15 → 0-14, Q16/A/B → 15-17, Q17/A/B → 18-20,
      // Q18/A/B → 21-23, Q19/A/B → 24-26, Q20/A/B → 27-29
      const totalCols = 30

      // Clear all existing cells
      for (let ti = 0; ti < 3; ti++) {
        for (let qi = 0; qi < 5; qi++) {
          for (let ci = 0; ci < totalCols; ci++) {
            actions.setCell(ti, qi, ci, CellValue.Empty)
          }
        }
      }

      // Set on-time for all teams
      for (let ti = 0; ti < 3; ti++) {
        if (!actions.teams.value[ti]!.onTime) actions.toggleOnTime(ti)
      }

      // T2 q3 is an empty seat. T3 q0 is the substitute (swapped in after Q5),
      // original T3 first quizzer is now at q4 (bench).
      // T1 has 4 unique correct quizzers (+20), T2/T3 have 3 each (+10),
      // balancing T1's Q17 error (-10).
      // T1: 5C(100) + MB(0) + E(-10) + 4uniq(+20) + OT(+20) = 130
      // T2: 5C(100) + 3uniq(+10) + OT(+20) = 130
      // T3: 5C(100) + 3uniq(+10) + OT(+20) = 130
      //
      // T1: 5C(100) - 10(E) + 20(4 unique: q0,q1,q2,q3) + 20(on-time) = 130
      // T2: 5C(100) + 10(3 unique: q0,q1,q2) + 20(on-time) = 130
      // T3: 5C(100) + 10(3 unique: q0,q1,q2) + 20(on-time) = 130 ✓
      const plays: [number, number, number, CellValue][] = [
        [0, 0, 0, CellValue.Correct], // Q1:  T1 q0 C
        [1, 1, 0, CellValue.Error], //   Q2:  T2 q0 E → toss-up
        [2, 2, 4, CellValue.Error], //   Q3:  T3 q4 E → bonus for T1 (original q0, swapped to bench)
        [3, 0, 1, CellValue.MissedBonus], // Q4: T1 q1 MB
        // Q5: no-jump
        [5, 1, 1, CellValue.Correct], //  Q6:  T2 q1 C
        [6, 2, 1, CellValue.Correct], //  Q7:  T3 q1 C
        [7, 0, 2, CellValue.Correct], //  Q8:  T1 q2 C
        [8, 1, 2, CellValue.Correct], //  Q9:  T2 q2 C
        [9, 2, 2, CellValue.Correct], //  Q10: T3 q2 C
        [10, 0, 1, CellValue.Correct], // Q11: T1 q1 C (4th unique for T1)
        [11, 1, 0, CellValue.Correct], // Q12: T2 q0 C
        [12, 2, 4, CellValue.Correct], // Q13: T3 q4 C (original q0, now on bench)
        [13, 1, 1, CellValue.Correct], // Q14: T2 q1 C
        [14, 2, 1, CellValue.Correct], // Q15: T3 q1 C
        [15, 0, 3, CellValue.Correct], // Q16: T1 q3 C (ci 15)
        [18, 0, 0, CellValue.Error], //   Q17: T1 q0 E (ci 18, -10)
        [19, 1, 2, CellValue.Correct], // Q17A: T2 q2 C (ci 19, toss-up)
        [21, 2, 2, CellValue.Correct], // Q18: T3 q2 C (ci 21)
        // Q19: no-jump (ci 24)
        [27, 0, 0, CellValue.Correct], // Q20: T1 q0 C (ci 27)
      ]

      for (const [ci, ti, qi, value] of plays) {
        actions.setCell(ti, qi, ci, value)
      }

      // No-jump on Q5 (already set from tutorial) and Q19
      actions.toggleNoJump(24) // Q19
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
    body: "Let's play through overtime. In round 1, Team 1 and Team 2 answer correctly, but Team 3 errors and nobody answers the toss-up.",
    completion: { type: 'acknowledge' },
    setup: (actions) => {
      // OT columns: Q21/A/B → ci 30/31/32, Q22/A/B → 33/34/35, Q23/A/B → 36/37/38
      // Q21: T1 q0 C (+20)
      // Q22: T2 q0 C (+20)
      // Q23: T3 q0 E (-10) → Q23A toss-up
      // Q23A: No Jump (resolves Q23 chain)
      actions.setCell(0, 0, 30, CellValue.Correct) // Q21
      actions.setCell(1, 0, 33, CellValue.Correct) // Q22
      actions.setCell(2, 0, 36, CellValue.Error) // Q23
      actions.toggleNoJump(37) // Q23A — no jump on toss-up
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
    body: 'In round 2, Team 1 answers correctly and Team 2 does not. Team 1 takes 1st place, Team 2 takes 2nd.',
    completion: { type: 'acknowledge' },
    setup: (actions) => {
      // OT round 2: Q24/A/B → ci 39/40/41, Q25/A/B → 42/43/44, Q26/A/B → 45/46/47
      // Q24: T1 q2 C (+20)
      // Q25: No Jump
      // Q26: No Jump
      actions.setCell(0, 2, 39, CellValue.Correct) // Q24
      actions.toggleNoJump(42) // Q25
      actions.toggleNoJump(45) // Q26
    },
  },
  {
    id: 'ot-result',
    target: { type: 'selector', css: '[data-tutorial="team-total-0"]' },
    placement: 'top',
    title: 'Final Placements',
    body: 'The quiz is complete! Placements are shown as medals. The scoresheet tracks everything automatically.',
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
