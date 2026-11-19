import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import {
  ApiError,
  CellValue,
  DEFAULT_STATS_SETTINGS,
  PlacementFormula,
  QuizFormat,
  type QuizFile,
} from '@qzr/shared'

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
  getRevision: vi.fn(),
}))
vi.mock('../../persistence/fileIO', async () => ({
  ...(await vi.importActual<typeof import('../../persistence/fileIO')>('../../persistence/fileIO')),
  openAnyQuizFile: vi.fn(),
  confirmAction: vi.fn(),
}))

import {
  getMeetName,
  getMeetTeams,
  getMyMeets,
  getPublishedSchedule,
  getRevision,
  getScheduledQuiz,
  getSender,
  getStatsSettings,
  getStoredQuizzes,
  getTeamNames,
  getTeamQuizzers,
  type PublishedSchedule,
  type ScheduledQuizDetails,
} from '../../api'
import { confirmAction, openAnyQuizFile } from '../../persistence/fileIO'
import { useMeetSession } from '../../composables/useMeetSession'
import {
  MEET_ID,
  MEET_NAME,
  MeetPicker,
  autoSaveWritten,
  autoSaved,
  beginPick,
  button,
  calgary,
  held,
  linkedDisplay,
  menu,
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
  stored,
  storedPick,
  stubDialogs,
  teamNames,
  typeQuizzer,
  typeTeam,
  unmountSheets,
  waiting,
  warnings,
} from './linkedSheet'
import { currentTab, startTab } from '../../persistence/autoSave'

// The link as the tab keeps it with its quiz
const session = () => currentTab()!.link
const pickedTeams = () => [0, 1, 2].map((slot) => useMeetSession().getSlot(slot)?.teamId)
const alerts = vi.fn()

beforeEach(async () => {
  stubDialogs()
  localStorage.clear()
  await startTab()
  useMeetSession().clearSession()
  window.history.replaceState(null, '', '/')
  vi.stubGlobal('alert', alerts)
  alerts.mockClear()
  vi.mocked(confirmAction).mockReset().mockResolvedValue(true)
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
  vi.mocked(getScheduledQuiz).mockReset().mockResolvedValue(scheduledQuiz())
  vi.mocked(getPublishedSchedule).mockReset().mockRejectedValue(new ApiError(404, 'Not published'))
  vi.mocked(getStoredQuizzes).mockReset().mockResolvedValue([])
  vi.mocked(getRevision).mockReset()
})

afterEach(() => {
  unmountSheets()
  vi.unstubAllGlobals()
})

/** A sheet with a quiz under way and unlinked: two named teams, one quizzer each, one answer */
async function scoredSheet() {
  vi.mocked(openAnyQuizFile).mockResolvedValue({
    type: 'json',
    content: JSON.stringify(
      quizFile([['Calgary 1', 'Ann'], ['Lions', 'Leo'], ['']], { division: '', quizNumber: '' }, [
        { quizzerId: 10, columnKey: '1', value: CellValue.Correct },
      ]),
    ),
  })
  const sheet = await mountSheet()
  await menu(sheet, 'Open', 'From file')
  return sheet
}
const correctCells = (sheet: Awaited<ReturnType<typeof mountSheet>>) =>
  sheet.findAll('td.cell').filter((cell) => cell.text() === 'C').length

describe('New from schedule', () => {
  it('starts a blank quiz linked to the scheduled quiz, with what the schedule has decided', async () => {
    const sheet = await scoredSheet()
    expect(correctCells(sheet)).toBe(1)

    expect(await pickScheduled(sheet, 'New', 'New from schedule')).toBe(true)

    expect(correctCells(sheet)).toBe(0)
    expect(teamNames(sheet)).toEqual(['Calgary 1', 'Regina 1', ''])
    expect(quizzerNames(sheet)).toEqual([
      ['Ann', 'Abe', '', '', ''],
      ['Ron', 'Rae', '', '', ''],
      ['', '', '', '', ''],
    ])
    expect(quizBoxes(sheet)).toEqual({ division: '1', quizNumber: '7' })
    expect(pickedTeams()).toEqual([calgary.id, regina.id, undefined])
    expect(session()).toMatchObject({ meetId: MEET_ID, quizId: 'q7' })
    expect(linkedDisplay(sheet)).toContain(MEET_NAME)
    expect(linkedDisplay(sheet)).toContain('Div 1 Quiz 7')
  })

  it('is a 20-question quiz, whatever the sheet had', async () => {
    const sheet = await mountSheet()
    await sheet.vm.newQuiz(QuizFormat.FifteenQuestion)
    await pickScheduled(sheet, 'New', 'New from schedule')
    expect(sheet.text()).toContain('20 Q')
  })

  it('says so and changes nothing when the meet is out of reach', async () => {
    const sheet = await scoredSheet()
    vi.mocked(getMeetTeams).mockRejectedValue(new TypeError('Failed to fetch'))

    expect(await pickScheduled(sheet, 'New', 'New from schedule')).toBe(false)

    expect(alerts).toHaveBeenCalledWith(expect.stringContaining("the meet can't be reached"))
    expect(teamNames(sheet)).toEqual(['Calgary 1', 'Lions', ''])
    expect(correctCells(sheet)).toBe(1)
    expect(session()).toBeNull()
  })

  it('takes nothing but Cancel while it waits, and a cancelled answer changes nothing', async () => {
    const sheet = await scoredSheet()
    const schedule = held<ScheduledQuizDetails>()
    vi.mocked(getScheduledQuiz).mockReturnValue(schedule.promise)

    const picking = await beginPick(sheet, 'New', 'New from schedule')
    expect(waiting()).toBe(true)
    expect(document.querySelector<HTMLDialogElement>('.waiting-dialog')!.open).toBe(true)

    // The file shortcuts reach nothing either
    await sheet.vm.newQuiz()
    expect(teamNames(sheet)).toEqual(['Calgary 1', 'Lions', ''])

    await button(sheet, 'Cancel').trigger('click')
    expect(waiting()).toBe(false)
    schedule.arrive(scheduledQuiz())
    expect(await picking.done).toBe(false)

    expect(teamNames(sheet)).toEqual(['Calgary 1', 'Lions', ''])
    expect(correctCells(sheet)).toBe(1)
    expect(session()).toBeNull()
    expect(alerts).not.toHaveBeenCalled()
  })

  it('a plain New keeps the meet and forgets the scheduled quiz', async () => {
    const sheet = await mountSheet()
    await pickScheduled(sheet, 'New', 'New from schedule')
    await sheet.vm.newQuiz()

    expect(session()).toMatchObject({ meetId: MEET_ID, quizId: null, scheduledQuiz: null })
    expect(teamNames(sheet)).toEqual(['', '', ''])
    expect(pickedTeams()).toEqual([undefined, undefined, undefined])
  })

  it('asks first when the meet already holds a result for the quiz', async () => {
    const file = quizFile([
      ['Calgary 1', 'Ann'],
      ['Regina 1', 'Ron'],
    ])
    vi.mocked(getStoredQuizzes).mockResolvedValue([stored(5, file)])
    const sheet = await mountSheet()

    const picking = await beginPick(sheet, 'New', 'New from schedule')
    expect(pageText()).toContain('already has a result')
    await button(sheet, 'Open it').trigger('click')
    expect(await picking.done).toBe(true)
    await flushPromises()

    // The stored quiz, linked as the scheduled quiz it is: its teams picked, blank seats filled
    expect(quizzerNames(sheet)[0]).toEqual(['Ann', 'Abe', '', '', ''])
    expect(pickedTeams()).toEqual([calgary.id, regina.id, undefined])
    expect(session()).toMatchObject({ quizId: 'q7' })
  })

  it("starts the quiz without asking when the user may not see the meet's stored quizzes", async () => {
    vi.mocked(getStoredQuizzes).mockRejectedValue(new ApiError(403, 'Admin or official access'))
    const sheet = await mountSheet()
    expect(await pickScheduled(sheet, 'New', 'New from schedule')).toBe(true)
    expect(teamNames(sheet)).toEqual(['Calgary 1', 'Regina 1', ''])
  })

  it("is what the portal's schedule link does, and the link is cleared", async () => {
    window.history.replaceState(null, '', `/?meetId=${MEET_ID}&quiz=q7`)
    const sheet = await mountSheet()
    expect(teamNames(sheet)).toEqual(['Calgary 1', 'Regina 1', ''])
    expect(session()).toMatchObject({ quizId: 'q7' })
    expect(window.location.search).toBe('')
  })
})

describe('Link', () => {
  it('changes nothing typed or scored, picks the teams the names name, and fills the blanks', async () => {
    const sheet = await scoredSheet()

    expect(await pickScheduled(sheet, 'Link', 'Link a scheduled quiz')).toBe(true)

    // "Lions" is no roster team and stays, unpicked, where the schedule seats Regina
    expect(teamNames(sheet)).toEqual(['Calgary 1', 'Lions', ''])
    expect(correctCells(sheet)).toBe(1)
    expect(quizzerNames(sheet)[0]).toEqual(['Ann', 'Abe', '', '', ''])
    expect(quizzerNames(sheet)[1]).toEqual(['Leo', '', '', '', ''])
    expect(pickedTeams()).toEqual([calgary.id, undefined, undefined])
    expect(quizBoxes(sheet)).toEqual({ division: '1', quizNumber: '7' })
    expect(session()).toMatchObject({ meetId: MEET_ID, quizId: 'q7' })
  })

  it('picks a slot as the team typed in it, never as the team the schedule seats there', async () => {
    const sheet = await mountSheet()
    await typeTeam(sheet, 0, 'Saskatoon 1')
    await pickScheduled(sheet, 'Link', 'Link a scheduled quiz')

    expect(pickedTeams()[0]).toBe(saskatoon.id)
    expect(quizzerNames(sheet)[0]).toEqual(['Sam', 'Sue', '', '', ''])
  })

  it('fills a blank slot with its scheduled team, but not one already on the sheet', async () => {
    const sheet = await mountSheet()
    // Regina sits first, where the schedule has Calgary; the schedule's second seat is Regina
    await typeTeam(sheet, 0, 'Regina 1')
    await pickScheduled(sheet, 'Link', 'Link a scheduled quiz')

    expect(teamNames(sheet)).toEqual(['Regina 1', '', ''])
    expect(pickedTeams()).toEqual([regina.id, undefined, undefined])
  })

  it("links the other teams when one team's roster can't be had", async () => {
    vi.mocked(getTeamQuizzers).mockImplementation(async (_, teamId) => {
      if (teamId === regina.id) throw new ApiError(500, 'Roster unavailable')
      return { quizzers: rosters[teamId]! }
    })
    const sheet = await mountSheet()
    await typeTeam(sheet, 0, 'Saskatoon 1')
    await typeTeam(sheet, 1, 'Regina 1')
    sheet.findComponent(MeetPicker).vm.$emit('picked', { meetId: MEET_ID, meetName: MEET_NAME })
    await flushPromises()

    expect(alerts).not.toHaveBeenCalled()
    expect(pickedTeams()).toEqual([saskatoon.id, undefined, undefined])
  })

  it('Clear names unpicks the teams too', async () => {
    const sheet = await mountSheet()
    await pickScheduled(sheet, 'New', 'New from schedule')
    await menu(sheet, 'New', 'Clear names')
    await flushPromises()

    expect(teamNames(sheet)).toEqual(['', '', ''])
    expect(pickedTeams()).toEqual([undefined, undefined, undefined])
  })

  it('keeps typed division and quiz number, and a pick made in the same meet', async () => {
    const sheet = await mountSheet()
    sheet.findComponent(MeetPicker).vm.$emit('picked', { meetId: MEET_ID, meetName: MEET_NAME })
    await flushPromises()
    await sheet.find<HTMLSelectElement>('.division-select').setValue('2')
    await typeTeam(sheet, 0, 'Calgary 1')
    await sheet.get('[aria-label="Refetch names from the meet and schedule"]').trigger('click')
    await flushPromises()
    // Division 2's Calgary, since the quiz is of division 2
    expect(pickedTeams()[0]).toBe(9)

    await pickScheduled(sheet, MEET_NAME, 'Link a scheduled quiz')
    expect(quizBoxes(sheet).division).toBe('2')
    expect(pickedTeams()[0]).toBe(9)
  })

  it('links the meet of a scheduled quiz, and unlinking the quiz keeps meet and picks', async () => {
    const sheet = await mountSheet()
    await pickScheduled(sheet, 'Link', 'Link a scheduled quiz')
    expect(session()).toMatchObject({ meetId: MEET_ID, quizId: 'q7' })

    await menu(sheet, MEET_NAME, 'Unlink quiz')
    expect(session()).toMatchObject({ meetId: MEET_ID, quizId: null })
    expect(pickedTeams()).toEqual([calgary.id, regina.id, undefined])
    expect(linkedDisplay(sheet)).not.toContain('Quiz 7')

    await menu(sheet, MEET_NAME, 'Unlink meet')
    expect(session()).toBeNull()
    expect(teamNames(sheet)).toEqual(['Calgary 1', 'Regina 1', ''])
    expect(quizBoxes(sheet)).toEqual({ division: '1', quizNumber: '7' })
  })

  it('remakes the picks against another meet, names as typed', async () => {
    const sheet = await mountSheet()
    await pickScheduled(sheet, 'Link', 'Link a scheduled quiz')
    vi.mocked(getMeetTeams).mockResolvedValue({
      teams: [{ ...regina, id: 52 }],
      meetDivisions: ['1'],
    })
    vi.mocked(getTeamQuizzers).mockResolvedValue({ quizzers: [] })
    sheet.findComponent(MeetPicker).vm.$emit('picked', { meetId: 8, meetName: 'Regionals' })
    await flushPromises()

    expect(session()).toMatchObject({ meetId: 8, quizId: null })
    expect(teamNames(sheet)).toEqual(['Calgary 1', 'Regina 1', ''])
    expect(pickedTeams()).toEqual([undefined, 52, undefined])
  })

  it("scores level teams the meet's way once linked (FR-023b)", async () => {
    vi.mocked(getStatsSettings).mockResolvedValue({
      settings: { ...DEFAULT_STATS_SETTINGS, levelTeams: PlacementFormula.Legacy },
    })
    const sheet = await mountSheet()
    await pickScheduled(sheet, 'Link', 'Link a scheduled quiz')
    const quiz = (sheet.vm as unknown as { quiz: QuizFile['quiz'] }).quiz
    expect(quiz.placementFormula).toBe(PlacementFormula.Legacy)
    // Taken with the link on a sheet nothing was done to by hand: part of its start, not a step
    expect(sheet.get('[title^="Undo"]').attributes('disabled')).toBeDefined()
  })

  it('survives a reload', async () => {
    const first = await mountSheet()
    await pickScheduled(first, 'Link', 'Link a scheduled quiz')
    await autoSaveWritten()
    const sheet = await mountSheet()
    expect(linkedDisplay(sheet)).toContain('Div 1 Quiz 7')
    expect(pickedTeams()).toEqual([calgary.id, regina.id, undefined])
  })

  it('the refresh symbol fetches afresh and links again', async () => {
    const sheet = await mountSheet()
    await typeTeam(sheet, 0, 'Lethbridge 1')
    await pickScheduled(sheet, 'Link', 'Link a scheduled quiz')
    expect(pickedTeams()[0]).toBeUndefined()

    // The admin adds the team, and the schedule decides its third seat
    const lethbridge = { ...calgary, id: 4, churchId: 4, churchName: 'Lethbridge' }
    rosters[4] = [{ quizzerId: 41, name: 'Lee' }]
    vi.mocked(getMeetTeams).mockResolvedValue({
      teams: [...roster, lethbridge],
      meetDivisions: ['1', '2'],
    })
    vi.mocked(getScheduledQuiz).mockResolvedValue(scheduledQuiz([calgary, regina, saskatoon]))
    const refresh = sheet.get('[aria-label="Refetch names from the meet and schedule"]')
    await refresh.trigger('click')
    await flushPromises()

    expect(pickedTeams()).toEqual([4, regina.id, saskatoon.id])
    expect(teamNames(sheet)).toEqual(['Lethbridge 1', 'Regina 1', 'Saskatoon 1'])
  })

  it('the refresh symbol seats a picked team again from its roster as it now is', async () => {
    const sheet = await mountSheet()
    await pickScheduled(sheet, 'New', 'New from schedule')
    expect(useMeetSession().getDbName(0, 1)).toBe('Abe')

    // The roster's second Calgary quizzer is renamed in the portal
    const before = rosters[1]!
    rosters[1] = [before[0]!, { quizzerId: 12, name: 'Abel' }]
    try {
      vi.mocked(getScheduledQuiz).mockResolvedValue(scheduledQuiz())
      await sheet.get('[aria-label="Refetch names from the meet and schedule"]').trigger('click')
      await flushPromises()

      expect(pickedTeams()[0]).toBe(calgary.id)
      expect(useMeetSession().getDbName(0, 1)).toBe('Abel')
      expect(warnings(sheet)).toContain('Calgary 1, Abe: roster has Abel')
    } finally {
      rosters[1] = before
    }
  })

  it('the refresh symbol unpicks a team the roster no longer has', async () => {
    const sheet = await mountSheet()
    await pickScheduled(sheet, 'New', 'New from schedule')
    vi.mocked(getMeetTeams).mockResolvedValue({
      teams: roster.filter((team) => team.id !== regina.id),
      meetDivisions: ['1', '2'],
    })
    vi.mocked(getScheduledQuiz).mockResolvedValue(scheduledQuiz([calgary, null, null]))
    await sheet.get('[aria-label="Refetch names from the meet and schedule"]').trigger('click')
    await flushPromises()

    expect(pickedTeams()).toEqual([calgary.id, undefined, undefined])
    expect(teamNames(sheet)[1]).toBe('Regina 1')
    expect(warnings(sheet)).toContain("Regina 1: not picked from the meet's teams")
  })

  it('refreshes a link kept from before copies whose quiz the schedule has since dropped', async () => {
    const sheet = await mountSheet()
    await pickScheduled(sheet, 'New', 'New from schedule')
    const kept = currentTab()!.link!
    useMeetSession().restoreSession({ ...kept, scheduledQuiz: undefined })
    vi.mocked(getScheduledQuiz).mockResolvedValue(null)
    await sheet.get('[aria-label="Refetch names from the meet and schedule"]').trigger('click')
    await flushPromises()

    expect(alerts).not.toHaveBeenCalled()
    expect(useMeetSession().quizId.value).toBe('q7')
    expect(warnings(sheet)).toContain("Quiz: no longer in the meet's schedule")
  })

  it("the sheet's own fetch on reload renews what is held and picks or fills nothing", async () => {
    const first = await mountSheet()
    await typeTeam(first, 0, 'Lethbridge 1')
    await pickScheduled(first, 'Link', 'Link a scheduled quiz')
    await autoSaveWritten()

    vi.mocked(getMeetTeams).mockResolvedValue({
      teams: [...roster, { ...calgary, id: 4, churchId: 4, churchName: 'Lethbridge' }],
      meetDivisions: ['1', '2'],
    })
    vi.mocked(getScheduledQuiz).mockResolvedValue(scheduledQuiz([calgary, regina, saskatoon]))
    const sheet = await mountSheet()

    expect(session()?.scheduledQuiz?.seats).toEqual([calgary.id, regina.id, saskatoon.id])
    expect(pickedTeams()).toEqual([undefined, regina.id, undefined])
    expect(teamNames(sheet)).toEqual(['Lethbridge 1', 'Regina 1', ''])
    expect(waiting()).toBe(false)
  })

  it('makes no request to unlink, start a plain quiz or edit a name', async () => {
    const sheet = await mountSheet()
    await pickScheduled(sheet, 'Link', 'Link a scheduled quiz')
    for (const call of [getMeetTeams, getScheduledQuiz, getTeamQuizzers])
      vi.mocked(call).mockClear()

    await typeTeam(sheet, 2, 'Bears')
    await typeQuizzer(sheet, 0, 2, 'Zed')
    await sheet.vm.newQuiz()
    await menu(sheet, MEET_NAME, 'Unlink meet')

    for (const call of [getMeetTeams, getScheduledQuiz, getTeamQuizzers]) {
      expect(call).not.toHaveBeenCalled()
    }
  })
})

describe('Open', () => {
  it('opening a file unlinks the sheet and asks the meet nothing', async () => {
    const linked = await mountSheet()
    await pickScheduled(linked, 'Link', 'Link a scheduled quiz')
    vi.mocked(openAnyQuizFile).mockResolvedValue({
      type: 'json',
      content: JSON.stringify(
        quizFile([
          ['Calgary 1', 'Ann'],
          ['Saskatoon 1', 'Bo'],
        ]),
      ),
    })
    for (const call of [getMeetTeams, getScheduledQuiz, getTeamQuizzers])
      vi.mocked(call).mockClear()

    await menu(linked, 'Open', 'From file')

    expect(session()).toBeNull()
    expect(teamNames(linked)).toEqual(['Calgary 1', 'Saskatoon 1', ''])
    expect(warnings(linked)).toEqual([])
    expect(linkedDisplay(linked)).toContain('Link')
    for (const call of [getMeetTeams, getScheduledQuiz, getTeamQuizzers]) {
      expect(call).not.toHaveBeenCalled()
    }
  })

  it('opens a stored quiz from the meet as if its file were opened and the meet then linked', async () => {
    const file = quizFile(
      [
        ['Calgary 1', 'Ann'],
        ['Lions', 'Leo'],
      ],
      { quizNumber: '9' },
    )
    const sheet = await mountSheet()
    await menu(sheet, 'Open', 'From the meet')
    const opened = await storedPick(sheet)(MEET_ID, MEET_NAME, file)
    await flushPromises()

    expect(opened).toBe(true)
    expect(teamNames(sheet)).toEqual(['Calgary 1', 'Lions', ''])
    expect(quizzerNames(sheet)[0]).toEqual(['Ann', 'Abe', '', '', ''])
    expect(pickedTeams()).toEqual([calgary.id, undefined, undefined])
    expect(session()).toMatchObject({ meetId: MEET_ID, quizId: null })
    expect(warnings(sheet)).toContain("Lions: not picked from the meet's teams")
  })

  it("brings none of the last quiz's picks to a quiz opened or started in the same meet", async () => {
    const sheet = await mountSheet()
    await pickScheduled(sheet, 'New', 'New from schedule')
    expect(pickedTeams()).toEqual([calgary.id, regina.id, undefined])

    // Its first team is no roster team, and its second sits where the last quiz had Regina
    await storedPick(sheet)(MEET_ID, MEET_NAME, quizFile([['Lions', 'Leo'], ['Saskatoon 1']]))
    await flushPromises()
    expect(pickedTeams()).toEqual([undefined, saskatoon.id, undefined])
    expect(warnings(sheet)).toEqual([
      "Lions: not picked from the meet's teams",
      'Team 3: no team picked',
    ])

    vi.mocked(getScheduledQuiz).mockResolvedValue(scheduledQuiz([null, saskatoon, null]))
    await pickScheduled(sheet, 'New', 'New from schedule')
    expect(pickedTeams()).toEqual([undefined, saskatoon.id, undefined])
    expect(teamNames(sheet)).toEqual(['', 'Saskatoon 1', ''])
  })

  it('links a stored quiz to the scheduled quiz of the same division and number', async () => {
    vi.mocked(getPublishedSchedule).mockResolvedValue({
      document: {
        quizzes: [{ id: 'q7', division: '1', lane: 0, label: 'Quiz 7' }],
      },
    } as unknown as PublishedSchedule)
    const sheet = await mountSheet()
    await storedPick(sheet)(MEET_ID, MEET_NAME, quizFile([['Calgary 1', 'Ann']]))
    await flushPromises()
    expect(session()).toMatchObject({ quizId: 'q7' })
  })

  it('opens the stored quiz of a scheduled quiz, linked to it', async () => {
    const file = quizFile([
      ['Calgary 1', 'Ann'],
      ['Regina 1', 'Ron'],
    ])
    vi.mocked(getStoredQuizzes).mockResolvedValue([stored(5, file)])
    const sheet = await mountSheet()

    expect(await pickScheduled(sheet, 'Open', 'From the schedule')).toBe(true)

    expect(teamNames(sheet)).toEqual(['Calgary 1', 'Regina 1', ''])
    expect(pickedTeams()).toEqual([calgary.id, regina.id, undefined])
    expect(session()).toMatchObject({ quizId: 'q7' })
  })

  it('with nothing stored for a scheduled quiz, says so and offers to start it', async () => {
    const sheet = await mountSheet()
    const picking = await beginPick(sheet, 'Open', 'From the schedule')
    expect(pageText()).toContain('Nothing is stored for Div 1 Quiz 7')

    await button(sheet, 'Start it as a new quiz').trigger('click')
    expect(await picking.done).toBe(true)
    await flushPromises()
    expect(teamNames(sheet)).toEqual(['Calgary 1', 'Regina 1', ''])
  })

  it('offers to start a scheduled quiz when the meet refuses its stored quizzes', async () => {
    vi.mocked(getStoredQuizzes).mockRejectedValue(
      new ApiError(403, 'Admin or official access required'),
    )
    const sheet = await mountSheet()
    await beginPick(sheet, 'Open', 'From the schedule')

    expect(alerts).not.toHaveBeenCalled()
    expect(pageText()).toContain('Nothing is stored for Div 1 Quiz 7')
  })

  it('leaves the sheet and both links alone when cancelled while waiting', async () => {
    const sheet = await autoSaved(
      quizFile([
        ['Calgary 1', 'Ann'],
        ['Bears', 'Bo'],
      ]),
    )
    await pickScheduled(sheet, 'Link', 'Link a scheduled quiz')
    const before = { names: teamNames(sheet), session: session() }
    const file = quizFile([['Saskatoon 1', 'Sam']])
    const open = () => storedPick(sheet)(MEET_ID, MEET_NAME, file)

    const meet = held<Awaited<ReturnType<typeof getMeetTeams>>>()
    vi.mocked(getMeetTeams).mockReturnValue(meet.promise)
    const opening = open()
    await flushPromises()
    await button(sheet, 'Cancel').trigger('click')
    meet.arrive({ teams: roster, meetDivisions: ['1', '2'] })
    expect(await opening).toBe(false)
    expect({ names: teamNames(sheet), session: session() }).toEqual(before)
  })

  it.each([
    ['naming the meet by id', `/?meetId=${MEET_ID}&result=7&revision=2`],
    ['in the form links were shared in before', `/?meet=${MEET_ID}&result=7&revision=2`],
  ])('opens the version a portal link %s names, linked to its meet', async (_, link) => {
    vi.mocked(getRevision).mockResolvedValue({
      quizFile: quizFile([['Calgary 1', 'Ann']], { quizNumber: '17' }),
    })
    window.history.replaceState(null, '', link)
    const sheet = await mountSheet()

    expect(getRevision).toHaveBeenCalledWith(MEET_ID, 7, 2)
    expect(session()).toMatchObject({ meetId: MEET_ID, meetName: MEET_NAME })
    expect(quizBoxes(sheet).quizNumber).toBe('17')
    expect(pickedTeams()[0]).toBe(calgary.id)
    expect(window.location.search).toBe('')
  })
})
