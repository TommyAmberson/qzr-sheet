import { describe, it, expect } from 'vitest'
import { ValidationCode, type QuizProblem } from '@qzr/shared'
import { changeText, flagText, placeLabel, problemText, warningText } from '../stats'

describe('changeText', () => {
  it('says what was decided about a stored quiz', () => {
    expect(changeText({ what: 'stage', stage: 'finals' })).toBe('Stage set to Finals')
    expect(changeText({ what: 'stage', stage: null })).toBe('Stage left to the schedule')
    expect(changeText({ what: 'link', scheduleQuizId: 'p3', how: 'matched' })).toBe(
      'Linked to the schedule by its name and teams',
    )
    expect(changeText({ what: 'link', scheduleQuizId: null })).toBe('Unlinked from the schedule')
    expect(changeText({ what: 'acceptance', revision: 2, accepted: true })).toBe(
      'Revision 2 accepted as scored',
    )
  })
})

describe('placeLabel', () => {
  it('names a place, and says when teams share it', () => {
    expect(placeLabel(2)).toBe('2nd')
    expect(placeLabel(1, 2)).toBe('tied 1st')
  })
})

describe('problemText', () => {
  it('says where a validation error is and what it is', () => {
    expect(
      problemText({
        kind: 'validation',
        team: 'Maple Hill 1',
        quizzer: 'Alex Abbott',
        question: '16A',
        code: ValidationCode.NoJump,
      }),
    ).toMatch(/^Maple Hill 1, Alex Abbott, question 16A: \S/)
  })

  it("names only the team for an error that is the team's", () => {
    expect(
      problemText({
        kind: 'validation',
        team: 'Maple Hill 1',
        quizzer: null,
        question: null,
        code: ValidationCode.TooManyTimeouts,
      }),
    ).toMatch(/^Maple Hill 1: \S/)
  })

  it('says when an overtime is not finished', () => {
    expect(problemText({ kind: 'undecided' })).toBe(
      'Teams are still level: the overtime is not finished.',
    )
  })

  it('says what a roster error is and what the roster has', () => {
    expect(
      problemText({ kind: 'teamNotOnRoster', team: 'Mapel Hill 1', near: 'Maple Hill 1' }),
    ).toBe("Mapel Hill 1 is not one of the division's teams. The roster has Maple Hill 1.")
    expect(problemText({ kind: 'teamNotOnRoster', team: '' })).toBe(
      "A team with no name is not one of the division's teams.",
    )
    expect(
      problemText({ kind: 'quizzerMissing', team: 'Maple Hill 1', quizzer: 'Alex Abbott' }),
    ).toBe('Maple Hill 1: Alex Abbott is on the roster and not in this quiz.')
  })

  it('says how a quiz differs from its scheduled quiz', () => {
    expect(problemText({ kind: 'nameDiffers', scheduled: 'D1 Q3' })).toBe(
      'It is linked to D1 Q3, which is not its name.',
    )
    expect(problemText({ kind: 'tieLeftStanding' })).toBe(
      'It ended level with no overtime, and this quiz must have a winner.',
    )
  })

  it('lists the unanswered questions', () => {
    expect(problemText({ kind: 'unanswered', questions: ['15'] })).toBe(
      'Question 15 has no answer.',
    )
    expect(problemText({ kind: 'unanswered', questions: ['14', '15'] })).toBe(
      'Questions 14, 15 have no answer.',
    )
  })
})

describe('flagText', () => {
  it('gives both counts for a quizzer listed in fewer quizzes than their team played', () => {
    expect(flagText({ kind: 'quizCount', listed: 4, teamQuizzes: 6 })).toBe(
      "listed in 4 of the team's 6 quizzes",
    )
  })
})

describe('warningText', () => {
  it('names a quiz in error and how many errors it has', () => {
    const quiz = { id: 1, name: 'D1 Q3' }
    const problem: QuizProblem = { kind: 'unanswered', questions: ['15'] }
    expect(warningText({ kind: 'inError', quiz, problems: [problem] })).toBe(
      'D1 Q3 has an error, so it adds nothing.',
    )
    expect(warningText({ kind: 'inError', quiz, problems: [problem, problem] })).toBe(
      'D1 Q3 has 2 errors, so it adds nothing.',
    )
  })

  it('names two quizzes that are both a Finals', () => {
    expect(
      warningText({
        kind: 'twoFinals',
        division: '1',
        consolation: false,
        quizzes: [
          { id: 1, name: 'D1 QF' },
          { id: 2, name: 'D1 QG' },
        ],
      }),
    ).toBe(
      'D1 QF and D1 QG are both the Finals, so neither gives its first three. Set all but one to another stage.',
    )
  })

  it("gives each team's count when prelims are unequal", () => {
    expect(
      warningText({
        kind: 'unequalPrelims',
        division: '1',
        teams: [
          { name: 'Maple Hill 1', quizzes: 3 },
          { name: 'Cedar Grove 1', quizzes: 2 },
        ],
      }),
    ).toBe(
      'Teams have played different numbers of counted quizzes: Maple Hill 1 3, Cedar Grove 1 2.',
    )
  })
})
