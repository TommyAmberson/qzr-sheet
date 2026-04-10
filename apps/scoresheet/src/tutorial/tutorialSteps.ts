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

      // Realistic quiz: [colIdx, teamIdx, quizzerIdx, value]
      // Note: T2 (ti=1) q3 is an empty seat (removed during tutorial)
      //
      // Q1:  T1 q0 C (+20)       T1: 20
      // Q2:  T2 q0 E (0)         T2: 0    → toss-up Q3
      // Q3:  T3 q0 E (0)         T3: 0    → bonus Q4 for T1
      // Q4:  T1 q1 B (+10)       T1: 30
      // Q5:  No Jump
      // Q6:  T2 q1 C (+20)       T2: 20
      // Q7:  T3 q1 C (+20)       T3: 20
      // Q8:  T1 q2 C (+20)       T1: 50
      // Q9:  T2 q2 C (+20)       T2: 40
      // Q10: T3 q2 C (+20)       T3: 40
      // Q11: T1 q0 C (+20)       T1: 70
      // Q12: T2 q0 C (+20)       T2: 60
      // Q13: T3 q3 C (+20)       T3: 60
      // Q14: T2 q1 C (+20)       T2: 80
      // Q15: T1 q3 C (+20)       T1: 90
      // Q16: T3 q0 C (+20)       T3: 80
      // Q17: T1 q1 E (-10)       T1: 80   → Q17A toss-up
      // Q17A:T2 q2 C (+20)       T2: 100  → resolves Q17
      // Q18: T3 q1 C (+20)       T3: 100
      // Q19: No Jump
      // Q20: T1 q0 C (+20)       T1: 100
      const plays: [number, number, number, CellValue][] = [
        [0, 0, 0, CellValue.Correct], // Q1
        [1, 1, 0, CellValue.Error], // Q2
        [2, 2, 0, CellValue.Error], // Q3 (toss-up)
        [3, 0, 1, CellValue.Bonus], // Q4 (bonus for T1)
        // Q5: no-jump
        [5, 1, 1, CellValue.Correct], // Q6
        [6, 2, 1, CellValue.Correct], // Q7
        [7, 0, 2, CellValue.Correct], // Q8
        [8, 1, 2, CellValue.Correct], // Q9
        [9, 2, 2, CellValue.Correct], // Q10
        [10, 0, 0, CellValue.Correct], // Q11
        [11, 1, 0, CellValue.Correct], // Q12
        [12, 2, 3, CellValue.Correct], // Q13
        [13, 1, 1, CellValue.Correct], // Q14 (T2 q1, not q3 — empty seat)
        [14, 0, 3, CellValue.Correct], // Q15
        [15, 2, 0, CellValue.Correct], // Q16 (ci 15)
        [18, 0, 1, CellValue.Error], // Q17 (ci 18, error points -10)
        [19, 1, 2, CellValue.Correct], // Q17A (ci 19, toss-up)
        [21, 2, 1, CellValue.Correct], // Q18 (ci 21)
        // Q19: no-jump (ci 24)
        [27, 0, 0, CellValue.Correct], // Q20 (ci 27)
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
    body: 'All three teams are tied. Toggle the Overtime switch to add overtime rounds.',
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
    body: 'Overtime questions appear in groups of 3. Only tied teams can answer, and error points (-10) apply to all overtime questions.',
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
    body: "Let's play through overtime. In round 1, Team 1 and Team 2 answer correctly, but Team 3 errors. Team 3 falls behind and is eliminated.",
    completion: { type: 'acknowledge' },
    setup: (actions) => {
      // OT Q21-Q23 → ci 30-32 (Normal columns), 33-35 (A), 36-38 (B)
      // Q21: T1 q0 C (+20)
      // Q22: T2 q0 C (+20)
      // Q23: T3 q0 E (-10)
      actions.setCell(0, 0, 30, CellValue.Correct) // Q21
      actions.setCell(1, 0, 33, CellValue.Correct) // Q22
      actions.setCell(2, 0, 36, CellValue.Error) // Q23
    },
  },
  {
    id: 'ot-eliminated',
    target: { type: 'selector', css: '[data-tutorial="team-total-2"]' },
    placement: 'top',
    title: 'Team Eliminated',
    body: 'Team 3 is no longer tied and finishes in 3rd place. They can leave the platform. Teams 1 and 2 continue to the next round.',
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
      // OT round 2: Q24-Q26 → ci 39-41 (Normal), 42-44 (A), 45-47 (B)
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
