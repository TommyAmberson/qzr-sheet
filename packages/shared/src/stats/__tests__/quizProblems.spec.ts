import { describe, it, expect } from 'vitest'
import { rosterProblems, scheduleProblems, type ScheduledQuiz } from '../quizProblems'
import type { ScoredQuiz } from '../scoredQuiz'
import type { Stage } from '../stages'
import type { RosterTeam } from '../teamNames'

function scored(
  teams: Record<string, string[]>,
  places: (1 | 1.2 | 2 | 3)[] = [1, 2, 3],
): ScoredQuiz {
  return {
    name: 'D1 Q3',
    consolation: false,
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
    overtimePlayed: false,
    problems: [],
  }
}

const schedule = (
  quiz: ScoredQuiz,
  stage: Stage,
  key: string,
  linked: ScheduledQuiz | null,
  schedulePublished: boolean,
  prelimsWithoutOvertime = true,
) => scheduleProblems(quiz, { stage, key, linked, schedulePublished, prelimsWithoutOvertime })

const roster: RosterTeam[] = [
  { id: 1, name: 'First Church 1', shortName: 'FC 1', quizzers: ['Ann Lee', 'Ben Roy', 'Cy Dunn'] },
  { id: 2, name: "St. John's 1", shortName: 'SJ 1', quizzers: ['Dee Holt'] },
  { id: 3, name: 'Grace 1', shortName: 'Grace 1', quizzers: [] },
]
const scheduled: ScheduledQuiz = { key: '1||3', name: 'D1 Q3', teams: roster }

describe('a two-team quiz', () => {
  // Its third team is an empty seat: no name, and no quizzer named

  it('is the scheduled quiz that seats two teams, with no teams differing', () => {
    const pair = { ...scheduled, teams: [roster[2]!, roster[0]!] }
    expect(
      schedule(scored({ 'Grace 1': [], 'FC 1': [], '': [] }), 'prelim', '1||3', pair, true),
    ).toEqual([])
  })

  it('has no roster error for its empty seat', () => {
    expect(rosterProblems(scored({ 'Grace 1': [], 'SJ 1': ['Dee Holt'], '': [] }), roster)).toEqual(
      [],
    )
  })
})

describe('scheduleProblems', () => {
  const teams = { 'First Church 1': [], "St. John's 1": [], 'Grace 1': [] }

  it('finds nothing wrong with a quiz that is the scheduled quiz, nor with one that is not linked', () => {
    expect(schedule(scored(teams), 'prelim', '1||3', scheduled, true)).toEqual([])
    expect(schedule(scored({ 'Hope 2': [] }), 'prelim', '1||9', null, false)).toEqual([])
  })

  it('says when a linked quiz has another name or other teams', () => {
    expect(
      schedule(scored({ ...teams, 'Grace 1': [] }), 'prelim', '1||4', scheduled, true),
    ).toEqual([{ kind: 'nameDiffers', scheduled: 'D1 Q3' }])
    expect(
      schedule(
        scored({ 'First Church 1': [], "St. John's 1": [], 'Hope 2': [] }),
        'prelim',
        '1||3',
        scheduled,
        true,
      ),
    ).toEqual([{ kind: 'teamsDiffer', scheduled: ['First Church 1', "St. John's 1", 'Grace 1'] }])
  })

  it('lets a prelim or an intermediate end level, and not an elimination or a Finals', () => {
    const level = scored(teams, [1.2, 1.2, 3])
    expect(schedule(level, 'prelim', '1||3', null, false)).toEqual([])
    expect(schedule(level, 'intermediate', '1||3', null, false)).toEqual([])
    expect(schedule(level, 'elimination', '1||3', null, false)).toEqual([
      { kind: 'tieLeftStanding' },
    ])
    expect(schedule(level, 'finals', '1||3', null, false)).toEqual([{ kind: 'tieLeftStanding' }])
    expect(schedule(scored(teams), 'finals', '1||3', null, false)).toEqual([])
  })
})

describe('overtime in a prelim or an intermediate (FR-023d)', () => {
  const played = { ...scored({ 'Grace 1': [] }), overtimePlayed: true }

  it('is an error in a meet that plays them without overtime, and only there', () => {
    for (const stage of ['prelim', 'intermediate'] as const) {
      expect(schedule(played, stage, '1||3', null, false)).toEqual([{ kind: 'overtimePlayed' }])
      expect(schedule(played, stage, '1||3', null, false, false)).toEqual([])
    }
    expect(schedule(played, 'elimination', '1||3', null, false)).toEqual([])
  })

  it('is no error where overtime was switched on and never played', () => {
    expect(schedule(scored({ 'Grace 1': [] }), 'prelim', '1||3', null, false)).toEqual([])
  })
})

describe('a quiz not linked to the schedule', () => {
  it('is in error in a meet with a published schedule, and not in a meet without one', () => {
    const teams = scored({ 'Grace 1': [] })
    expect(schedule(teams, 'prelim', '1||9', null, true)).toEqual([{ kind: 'notLinked' }])
    expect(schedule(teams, 'prelim', '1||9', null, false)).toEqual([])
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

  it('says once that the division has no teams on the roster, instead of naming every team', () => {
    expect(rosterProblems(scored({ 'Grace 1': [], 'FC 1': [] }), [])).toEqual([
      { kind: 'divisionNotOnRoster' },
    ])
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
    expect(rosterProblems(scored({ '': ['Ann Lee'], 'Hope 2': [], 'Team 1': [] }), roster)).toEqual(
      [
        { kind: 'teamNotOnRoster', team: '' },
        { kind: 'teamNotOnRoster', team: 'Hope 2' },
        { kind: 'teamNotOnRoster', team: 'Team 1' },
      ],
    )
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
