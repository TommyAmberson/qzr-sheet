import { describe, it, expect } from 'vitest'
import {
  DEFAULT_STATS_SETTINGS,
  ValidationCode,
  viewerHas,
  type DivisionStats,
  type QuizProblem,
  type StatsSettings,
} from '@qzr/shared'
import {
  changeText,
  statsCsv,
  flagText,
  momentsFor,
  nextMove,
  placeLabel,
  previousState,
  problemText,
  quizzerCount,
  rightNow,
  viewerChanges,
  warningText,
  type DivisionAt,
} from '../stats'

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
    expect(problemText({ kind: 'notLinked' })).toBe('It is not linked to a quiz of the schedule.')
    expect(problemText({ kind: 'tieLeftStanding' })).toBe(
      'It ended level with no overtime, and this quiz must have a winner.',
    )
    expect(problemText({ kind: 'overtimePlayed' })).toMatch(/overtime/)
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
  it('says when a confirmed order has changed, and names a quiz seated from a withdrawn one', () => {
    expect(warningText({ kind: 'orderChanged', division: '1', what: 'rerank' })).toMatch(
      /^The re-rank has changed since it was confirmed/,
    )
    expect(warningText({ kind: 'withdrawnOrder', quiz: { id: 1, name: 'D1 QA' } })).toMatch(
      /^D1 QA was seated from an order since withdrawn/,
    )
  })

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

describe('the stats settings page', () => {
  const settings = (change: (s: StatsSettings) => void = () => {}) => {
    const s = structuredClone(DEFAULT_STATS_SETTINGS)
    change(s)
    return s
  }
  const divisions: DivisionAt[] = [
    { division: '1', state: 'stats_break' },
    { division: '2', state: 'prelim_running' },
  ]

  it('offers no moment before a stage is played', () => {
    expect(momentsFor('prelim')[0]).toBe('start')
    expect(momentsFor('finals')).toEqual([
      'eliminationsIn',
      'finalsDone',
      'meetReview',
      'meetDone',
      'never',
    ])
  })

  it('says what viewers will newly see and stop seeing on save, by division', () => {
    const draft = settings((s) => {
      s.prelimStandingsLive = true
      s.results.prelim.level = 'scores'
      s.results.intermediate.from = 'never'
    })
    expect(viewerChanges(DEFAULT_STATS_SETTINGS, draft, divisions, 'live')).toEqual([
      'Division 1 viewers will now see scores in prelim results',
      'Division 1 viewers will stop seeing intermediate results',
      'Division 1 viewers will now see the re-rank',
      'Division 2 viewers will now see scores in prelim results',
      'Division 2 viewers will now see prelim standings',
    ])
  })

  it('says nothing changes for viewers when nothing would show yet', () => {
    const draft = settings((s) => (s.quizzers.from = 'meetReview'))
    expect(viewerChanges(DEFAULT_STATS_SETTINGS, draft, divisions, 'live')).toEqual([])
  })

  it('says when the standings will be worked out another way', () => {
    const draft = settings((s) => (s.tieBreaks = 'pointsThenErrors'))
    expect(viewerChanges(DEFAULT_STATS_SETTINGS, draft, divisions, 'live')).toEqual([
      expect.stringMatching(/^Standings will be worked out the new way/),
    ])
  })

  it("names what a division's viewers have right now", () => {
    const has = viewerHas(DEFAULT_STATS_SETTINGS, 'stats_break', 'live')
    expect(rightNow(has, 'prelim')).toBe('places')
    expect(rightNow(has, 'prelimStandings')).toBe('Locked in')
    expect(rightNow(has, 'quizzers')).toBe('none')
  })

  it("offers each division's next step, Start Finals where it has no eliminations", () => {
    expect(nextMove('prelim_running', ['prelim'])).toEqual({
      to: ['stats_break'],
      label: 'Confirm prelims',
    })
    expect(nextMove('stats_break', ['prelim', 'intermediate', 'elimination'])).toEqual({
      to: ['elim_running'],
      label: 'Confirm intermediates',
    })
    expect(nextMove('stats_break', ['prelim', 'finals'])).toEqual({
      to: ['elim_running', 'finals'],
      label: 'Start Finals',
    })
    // A meet with no published schedule has no stages to go by
    expect(nextMove('stats_break', [])?.label).toBe('Start eliminations')
    expect(nextMove('division_done', ['prelim'])).toBeNull()
    expect(previousState('prelim_running')).toBeNull()
    expect(previousState('finals')).toBe('elim_running')
  })
})

describe('quizzerCount', () => {
  it("says how many quizzers a list ranks, as the statistician's report does", () => {
    expect(quizzerCount('1', { consolation: false, quizzers: [1, 2, 3] })).toBe(
      'There were 3 quizzers in Division 1',
    )
    expect(quizzerCount('2', { consolation: true, quizzers: [1] })).toBe(
      'There was 1 quizzer in the Division 2 consolation list',
    )
  })
})

describe('statsCsv', () => {
  const stats: DivisionStats = {
    division: '1',
    state: 'stats_break',
    phase: 'live',
    results: [
      {
        stage: 'prelim',
        level: 'scores',
        quizzes: [
          {
            name: 'D1 Q1',
            status: 'counted',
            teams: [
              { name: 'Maple, 1', place: 1, score: 120, placementPoints: 20, errors: 1 },
              { name: '=Cedar "1"', place: 2, score: 60, placementPoints: 10, errors: 0 },
            ],
          },
          { name: 'D1 Q2', status: 'underReview', teams: [{ name: 'Maple, 1' }] },
        ],
      },
    ],
    prelimStandings: {
      state: 'livePreview',
      teams: [
        {
          name: 'Maple, 1',
          rank: 1,
          placementPoints: 20,
          quizzes: 1,
          tied: false,
          decidedBy: null,
          lines: [],
        },
      ],
    },
    quizzers: {
      state: 'livePreview',
      through: 'prelim',
      lists: [
        {
          consolation: false,
          quizzers: [
            {
              name: 'Sam Park',
              team: 'Maple, 1',
              place: 1,
              average: 60,
              points: 60,
              errors: 0,
              jumps: 3,
              quizzes: 1,
              types: { INT: 2, FTV: 1 },
              flags: [],
              lines: [
                { quiz: 'D1 Q1', points: 60, errors: 0, jumps: 3, types: { INT: 2, FTV: 1 } },
              ],
            },
          ],
        },
      ],
    },
  }

  it("writes a row per team per quiz in the workbook's columns, leaving out quizzes under review", () => {
    expect(statsCsv(stats).teams.split('\r\n')).toEqual([
      'Team,Quiz,Place,Score,Points,Errors',
      '"Maple, 1",D1 Q1,1,120,20,1',
      `"'=Cedar ""1""",D1 Q1,2,60,10,0`,
      '',
    ])
  })

  it('writes a row per quizzer per quiz with correct answers by type in fixed columns', () => {
    expect(statsCsv(stats).quizzers.split('\r\n').slice(0, 2)).toEqual([
      'Quizzer,Team,Quiz,Points,Errors,Jumps,REF,FTV,INT,MA,Q,SIT',
      'Sam Park,"Maple, 1",D1 Q1,60,0,3,0,1,2,0,0,0',
    ])
  })

  it('writes the team standings, then the quizzer standings', () => {
    const rows = statsCsv(stats).standings.split('\r\n')
    expect(rows).toContain('Prelims,1,,"Maple, 1",20,1')
    expect(rows).toContain('Main,1,Sam Park,"Maple, 1",60,60,0,3,1')
  })
})
