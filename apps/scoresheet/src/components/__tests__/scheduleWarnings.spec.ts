import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { ApiError, CellValue } from '@qzr/shared'

vi.mock('../../api', async () => ({
  ...(await vi.importActual<typeof import('../../api')>('../../api')),
  getMeetTeams: vi.fn(),
  // The meet's stats settings are out of reach, so the sheet keeps its own way of scoring
  getStatsSettings: vi.fn(async () => {
    throw new Error('Not reached')
  }),
  getTeamQuizzers: vi.fn(),
  getSender: vi.fn(),
  getMyMeets: vi.fn(),
  getMeetName: vi.fn(),
  getTeamNames: vi.fn(),
  getScheduledQuiz: vi.fn(),
  getPublishedSchedule: vi.fn(),
  getStoredQuizzes: vi.fn(),
}))
vi.mock('../../persistence/fileIO', async () => ({
  ...(await vi.importActual<typeof import('../../persistence/fileIO')>('../../persistence/fileIO')),
  confirmAction: vi.fn(),
}))

import {
  getMeetName,
  getMeetTeams,
  getMyMeets,
  getPublishedSchedule,
  getScheduledQuiz,
  getSender,
  getStoredQuizzes,
  getTeamNames,
  getTeamQuizzers,
} from '../../api'
import { confirmAction } from '../../persistence/fileIO'
import { useMeetSession } from '../../composables/useMeetSession'
import {
  MEET_NAME,
  autoSaved,
  button,
  calgary,
  held,
  mountSheet,
  pageText,
  pickScheduled,
  quizBoxes,
  quizFile,
  quizzerNames,
  regina,
  roster,
  rosters,
  saskatoon,
  scheduledQuiz,
  stubDialogs,
  teamNames,
  typeTeam,
  unmountSheets,
  waiting,
  warnings,
} from './linkedSheet'

type Sheet = Awaited<ReturnType<typeof mountSheet>>
const pickedTeams = () => [0, 1, 2].map((slot) => useMeetSession().getSlot(slot)?.teamId)
const correctCells = (sheet: Sheet) =>
  sheet
    .findAll('td.cell')
    .map((cell, i) => (cell.text() === 'C' ? i : -1))
    .filter((i) => i >= 0)

/** Open the warnings and take the fix labelled so */
async function takeFix(sheet: Sheet, label: string) {
  await sheet.get('.meta-meet-warnings').trigger('click')
  await button(sheet, label).trigger('click')
  await flushPromises()
}

beforeEach(() => {
  stubDialogs()
  localStorage.clear()
  useMeetSession().clearSession()
  vi.stubGlobal('alert', vi.fn())
  vi.mocked(confirmAction).mockReset().mockResolvedValue(false)
  vi.mocked(getMeetTeams)
    .mockReset()
    .mockResolvedValue({ teams: roster, meetDivisions: ['1', '2'] })
  vi.mocked(getTeamQuizzers)
    .mockReset()
    .mockImplementation(async (_, teamId) => ({ quizzers: rosters[teamId]! }))
  vi.mocked(getSender).mockReset().mockResolvedValue({ admin: true, rooms: [] })
  vi.mocked(getMyMeets).mockReset().mockRejectedValue(new ApiError(401, 'Authentication required'))
  vi.mocked(getMeetName)
    .mockReset()
    .mockResolvedValue({ meet: { name: MEET_NAME } })
  vi.mocked(getTeamNames).mockReset().mockResolvedValue([])
  vi.mocked(getScheduledQuiz)
    .mockReset()
    .mockResolvedValue(scheduledQuiz([calgary, regina, saskatoon]))
  vi.mocked(getPublishedSchedule).mockReset().mockRejectedValue(new ApiError(404, 'Not published'))
  vi.mocked(getStoredQuizzes).mockReset().mockResolvedValue([])
})

afterEach(() => {
  unmountSheets()
  vi.unstubAllGlobals()
})

describe('a quiz that differs from its scheduled quiz', () => {
  it('has no schedule warnings when it agrees, or when no scheduled quiz is linked', async () => {
    const sheet = await mountSheet()
    await pickScheduled(sheet, 'New', 'New from schedule')
    expect(warnings(sheet)).toEqual([])

    await button(sheet, MEET_NAME).trigger('click')
    await button(sheet, 'Unlink quiz').trigger('click')
    await sheet.find('label.meta-field:last-of-type input').setValue('9')
    expect(warnings(sheet)).toEqual([])
  })

  it('warns of the division and the quiz number, and sets them from the schedule', async () => {
    const sheet = await autoSaved(
      quizFile([], { division: '2', consolation: true, quizNumber: '4' }),
    )
    await pickScheduled(sheet, 'Link', 'Link a scheduled quiz')

    expect(warnings(sheet)).toEqual(
      expect.arrayContaining(['Division 2 consolation: schedule has 1', 'Quiz 4: schedule has 7']),
    )

    await takeFix(sheet, 'Set division to 1')
    await button(sheet, 'Set quiz to 7').trigger('click')
    expect(quizBoxes(sheet)).toEqual({ division: '1', quizNumber: '7' })
    expect(warnings(sheet).filter((line) => /^(Division|Quiz)/.test(line))).toEqual([])
  })

  it('warns slot by slot, and moves a whole team that sits in another slot', async () => {
    // Regina and Calgary sit in each other's scheduled slots, and Regina's first quizzer answered
    const sheet = await autoSaved(
      quizFile([['Regina 1', 'Ron'], ['Calgary 1', 'Ann'], ['Saskatoon 1']], {}, [
        { quizzerId: 10, columnKey: '1', value: CellValue.Correct },
      ]),
    )
    await pickScheduled(sheet, 'Link', 'Link a scheduled quiz')
    expect(warnings(sheet)).toEqual([
      'Team 1: Regina 1, schedule has Calgary 1',
      'Team 2: Calgary 1, schedule has Regina 1',
    ])
    const scoredBefore = correctCells(sheet)
    const scores = () => sheet.findAll('.team-total-value').map((score) => score.text())
    const scoresBefore = scores()
    expect(new Set(scoresBefore).size).toBeGreaterThan(1)

    await takeFix(sheet, 'Move Calgary 1 to Team 1 (swaps with Regina 1)')

    expect(teamNames(sheet)).toEqual(['Calgary 1', 'Regina 1', 'Saskatoon 1'])
    expect(quizzerNames(sheet)[1]![0]).toBe('Ron')
    expect(pickedTeams()).toEqual([calgary.id, regina.id, saskatoon.id])
    expect(warnings(sheet)).toEqual([])
    // The answer went with Regina to the second team's rows
    expect(correctCells(sheet)).not.toEqual(scoredBefore)
    expect(correctCells(sheet)).toHaveLength(1)
    // Every team's score is what it was, in its new place
    expect(scores()).toEqual([scoresBefore[1], scoresBefore[0], scoresBefore[2]])

    // One undo puts both teams back
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }))
    await flushPromises()
    expect(teamNames(sheet)).toEqual(['Regina 1', 'Calgary 1', 'Saskatoon 1'])
    expect(pickedTeams()).toEqual([regina.id, calgary.id, saskatoon.id])
  })

  it('replaces a team that is not on the sheet, keeping the quizzers typed', async () => {
    const sheet = await autoSaved(quizFile([['Lions', 'Leo'], ['Regina 1'], ['Saskatoon 1']]))
    await pickScheduled(sheet, 'Link', 'Link a scheduled quiz')
    expect(warnings(sheet)).toContain('Team 1: Lions, schedule has Calgary 1')

    await takeFix(sheet, 'Replace Lions with Calgary 1')

    expect(teamNames(sheet)[0]).toBe('Calgary 1')
    expect(pickedTeams()[0]).toBe(calgary.id)
    // Leo stays, held against Calgary's roster; the blank seat beside him takes a Calgary quizzer
    expect(quizzerNames(sheet)[0]!.slice(0, 2)).toEqual(['Leo', 'Abe'])
    expect(warnings(sheet).some((line) => line.startsWith('Calgary 1, Leo'))).toBe(true)
  })

  it("gives a blank slot one warning, the schedule's, and fills it on request", async () => {
    const sheet = await mountSheet()
    await pickScheduled(sheet, 'New', 'New from schedule')
    await typeTeam(sheet, 2, '')
    await button(sheet, MEET_NAME).trigger('click')
    // Clear the third slot's pick too, as a slot nobody has filled
    useMeetSession().clearSlot(2)
    await flushPromises()

    expect(warnings(sheet)).toEqual(['Team 3: blank, schedule has Saskatoon 1'])
    await takeFix(sheet, 'Put Saskatoon 1 in Team 3')
    expect(teamNames(sheet)[2]).toBe('Saskatoon 1')
    expect(warnings(sheet)).toEqual([])
  })

  it('raises nothing for a seat the schedule has not decided', async () => {
    vi.mocked(getScheduledQuiz).mockResolvedValue(scheduledQuiz([calgary, regina, null]))
    const sheet = await autoSaved(quizFile([['Calgary 1'], ['Regina 1'], ['Lions']]))
    await pickScheduled(sheet, 'Link', 'Link a scheduled quiz')
    expect(warnings(sheet)).toEqual(["Lions: not picked from the meet's teams"])
  })

  it('says when the schedule no longer has the quiz, and offers to unlink it', async () => {
    const sheet = await mountSheet()
    await pickScheduled(sheet, 'New', 'New from schedule')
    vi.mocked(getScheduledQuiz).mockResolvedValue(null)
    await sheet.get('[aria-label="Refetch names from the meet and schedule"]').trigger('click')
    await flushPromises()

    expect(warnings(sheet)).toEqual(["Quiz: no longer in the meet's schedule"])
    await takeFix(sheet, 'Unlink quiz')
    expect(useMeetSession().quizId.value).toBeNull()
    expect(warnings(sheet)).toEqual([])
  })

  it('lists them in the one submit question, after a fetch that waits and fills nothing', async () => {
    const sheet = await autoSaved(
      quizFile([['Regina 1'], ['Calgary 1'], ['']], { quizNumber: '4' }),
    )
    await pickScheduled(sheet, 'Link', 'Link a scheduled quiz')
    // The schedule decided its third seat only at first; the blank slot was left to fill
    const teams = held<Awaited<ReturnType<typeof getMeetTeams>>>()
    vi.mocked(getMeetTeams).mockReturnValue(teams.promise)

    await button(sheet, 'Save').trigger('click')
    await button(sheet, 'Submit to meet').trigger('click')
    await flushPromises()
    expect(waiting()).toBe(true)
    teams.arrive({ teams: roster, meetDivisions: ['1', '2'] })
    await flushPromises()

    const question = vi.mocked(confirmAction).mock.lastCall?.[0]
    expect(question).toContain('Check these:')
    expect(question).toContain('Quiz 4: schedule has 7')
    expect(question).toContain('Team 1: Regina 1, schedule has Calgary 1')
    expect(question).toMatch(/Submit anyway\?$/)
    expect(waiting()).toBe(false)
  })

  it('cancelling the wait before the submit question sends nothing and asks nothing', async () => {
    const sheet = await mountSheet()
    await pickScheduled(sheet, 'New', 'New from schedule')
    vi.mocked(getMeetTeams).mockReturnValue(new Promise(() => {}))

    await button(sheet, 'Save').trigger('click')
    await button(sheet, 'Submit to meet').trigger('click')
    await flushPromises()
    await button(sheet, 'Cancel').trigger('click')
    await flushPromises()

    expect(waiting()).toBe(false)
    expect(confirmAction).not.toHaveBeenCalled()
  })
})
