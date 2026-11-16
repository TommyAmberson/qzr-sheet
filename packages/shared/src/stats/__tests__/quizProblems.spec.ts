import { describe, it, expect } from 'vitest'
import { PlacementFormula } from '../../quizFile'
import {
  isNamed,
  matchScheduledQuiz,
  rosterProblems,
  scheduleProblems,
  type ScheduledQuiz,
} from '../quizProblems'
import type { ScoredQuiz } from '../scoredQuiz'
import type { RosterTeam } from '../teamNames'

const quiz = { division: '1', quizNumber: '3' }

function scored(
  teams: Record<string, string[]>,
  places: (1 | 1.2 | 2 | 3)[] = [1, 2, 3],
): ScoredQuiz {
  return {
    name: 'D1 Q3',
    consolation: false,
    formula: PlacementFormula.Rules,
    teams: Object.entries(teams).map(([name, quizzers], i) => ({
      name,
      score: 100,
      regulationScore: 100,
      errors: 0,
      place: places[i] ?? 3,
      quizzers: quizzers.map((quizzer) => ({
        name: quizzer,
        points: 0,
        errors: 0,
        correct: 0,
        types: {},
      })),
    })),
    problems: [],
  }
}

const roster: RosterTeam[] = [
  { id: 1, name: 'First Church 1', shortName: 'FC 1', quizzers: ['Ann Lee', 'Ben Roy', 'Cy Dunn'] },
  { id: 2, name: "St. John's 1", shortName: 'SJ 1', quizzers: ['Dee Holt'] },
  { id: 3, name: 'Grace 1', shortName: 'Grace 1', quizzers: [] },
]
const scheduled: ScheduledQuiz = { key: '1||3', name: 'D1 Q3', teams: roster }
const named = (...names: string[]) => ({ quiz, teams: names.map((name) => ({ name })) })

describe('isNamed', () => {
  it('takes a blank division or quiz number, or the underscore the scoresheet shows for one, as none', () => {
    expect(isNamed(quiz)).toBe(true)
    expect(isNamed({ division: ' ', quizNumber: '3' })).toBe(false)
    expect(isNamed({ division: '1', quizNumber: '_' })).toBe(false)
  })
})

describe('matchScheduledQuiz', () => {
  it('matches on the name and the teams, in any seats, ignoring case, spacing and punctuation', () => {
    expect(matchScheduledQuiz(named('grace  1', 'St Johns 1', 'fc 1'), scheduled)).toBe('match')
  })

  it('matches on the name alone where the schedule names no teams yet', () => {
    expect(matchScheduledQuiz(named('Anyone 1'), { ...scheduled, teams: null })).toBe('match')
  })

  it('calls a miss by a slightly different team name near, not a match', () => {
    expect(matchScheduledQuiz(named('Grace 1', "St. John's 1", 'First Churchh 1'), scheduled)).toBe(
      'near',
    )
  })

  it('does not match another name, other teams, a blank team, or a quiz that says no name', () => {
    expect(
      matchScheduledQuiz({ ...named('Grace 1'), quiz: { ...quiz, quizNumber: '4' } }, scheduled),
    ).toBe('no')
    expect(matchScheduledQuiz(named('Grace 1', "St. John's 1", 'Hope 2'), scheduled)).toBe('no')
    expect(matchScheduledQuiz(named('Grace 1', "St. John's 1", ''), scheduled)).toBe('no')
    expect(
      matchScheduledQuiz(
        { ...named('Grace 1'), quiz: { division: '_', quizNumber: '3' } },
        { ...scheduled, key: '_||3', teams: null },
      ),
    ).toBe('no')
  })
})

describe('scheduleProblems', () => {
  const teams = { 'First Church 1': [], "St. John's 1": [], 'Grace 1': [] }

  it('finds nothing wrong with a quiz that is the scheduled quiz, nor with one that is not linked', () => {
    expect(scheduleProblems(scored(teams), 'prelim', quiz, scheduled)).toEqual([])
    expect(
      scheduleProblems(scored({ 'Hope 2': [] }), 'prelim', { ...quiz, quizNumber: '9' }, null),
    ).toEqual([])
  })

  it('says when a linked quiz has another name or other teams', () => {
    expect(
      scheduleProblems(
        scored({ ...teams, 'Grace 1': [] }),
        'prelim',
        { ...quiz, quizNumber: '4' },
        scheduled,
      ),
    ).toEqual([{ kind: 'nameDiffers', scheduled: 'D1 Q3' }])
    expect(
      scheduleProblems(
        scored({ 'First Church 1': [], "St. John's 1": [], 'Hope 2': [] }),
        'prelim',
        quiz,
        scheduled,
      ),
    ).toEqual([{ kind: 'teamsDiffer', scheduled: ['First Church 1', "St. John's 1", 'Grace 1'] }])
  })

  it('lets a prelim or an intermediate end level, and not an elimination or a Finals', () => {
    const level = scored(teams, [1.2, 1.2, 3])
    expect(scheduleProblems(level, 'prelim', quiz, null)).toEqual([])
    expect(scheduleProblems(level, 'intermediate', quiz, null)).toEqual([])
    expect(scheduleProblems(level, 'elimination', quiz, null)).toEqual([
      { kind: 'tieLeftStanding' },
    ])
    expect(scheduleProblems(level, 'finals', quiz, null)).toEqual([{ kind: 'tieLeftStanding' }])
    expect(scheduleProblems(scored(teams), 'finals', quiz, null)).toEqual([])
  })
})

describe('rosterProblems', () => {
  it('finds nothing where every team and quizzer is on the roster, by full or short name', () => {
    expect(
      rosterProblems(
        scored({
          'fc 1': ['ann  lee', 'Ben Roy', 'Cy Dunn'],
          'St Johns 1': ['Dee Holt'],
          'Grace 1': ['Anyone'],
        }),
        roster,
      ),
    ).toEqual([])
  })

  it('finds nothing in a meet with no roster', () => {
    expect(rosterProblems(scored({ 'Team 1': ['Quizzer 1'] }), null)).toEqual([])
  })

  it('names a team that matches nothing, with the nearest roster team', () => {
    expect(rosterProblems(scored({ 'First Churchh 1': [] }), roster)).toEqual([
      { kind: 'teamNotOnRoster', team: 'First Churchh 1', near: 'First Church 1' },
    ])
  })

  it('takes a blank team, another division\'s team and an old sheet\'s "Team 1" as not on the roster', () => {
    expect(rosterProblems(scored({ '': [], 'Hope 2': [], 'Team 1': [] }), roster)).toEqual([
      { kind: 'teamNotOnRoster', team: '' },
      { kind: 'teamNotOnRoster', team: 'Hope 2' },
      { kind: 'teamNotOnRoster', team: 'Team 1' },
    ])
  })

  it("names a quizzer not on the team's roster, with the roster name it is nearest to", () => {
    expect(
      rosterProblems(scored({ 'First Church 1': ['Ann Lee', 'Ben Roy', 'Cy Dun'] }), roster),
    ).toEqual([
      { kind: 'quizzerNotOnRoster', team: 'First Church 1', quizzer: 'Cy Dun', near: 'Cy Dunn' },
      { kind: 'quizzerMissing', team: 'First Church 1', quizzer: 'Cy Dunn' },
    ])
    expect(rosterProblems(scored({ "St. John's 1": ['Quizzer 1'] }), roster)).toEqual([
      { kind: 'quizzerNotOnRoster', team: "St. John's 1", quizzer: 'Quizzer 1' },
      { kind: 'quizzerMissing', team: "St. John's 1", quizzer: 'Dee Holt' },
    ])
  })

  it('says when a team lists more quizzers than its roster has', () => {
    expect(rosterProblems(scored({ "St. John's 1": ['Dee Holt', 'Eli Marsh'] }), roster)).toEqual([
      { kind: 'quizzerNotOnRoster', team: "St. John's 1", quizzer: 'Eli Marsh' },
      { kind: 'tooManyQuizzers', team: "St. John's 1", listed: 2, roster: 1 },
    ])
  })

  it('names a roster quizzer missing from the quiz', () => {
    expect(rosterProblems(scored({ 'First Church 1': ['Ann Lee', 'Ben Roy'] }), roster)).toEqual([
      { kind: 'quizzerMissing', team: 'First Church 1', quizzer: 'Cy Dunn' },
    ])
  })
})
