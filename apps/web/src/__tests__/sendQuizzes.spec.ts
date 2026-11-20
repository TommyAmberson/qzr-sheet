// A scoring sheet is zipped by fflate, whose checks for its own byte arrays fail across jsdom's
// realm, so these tests run in Node, which has File
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { ApiError, type QuizFile } from '@qzr/shared'
import {
  chooseRoom,
  markDuplicates,
  pickedFiles,
  matchOf,
  planUpload,
  sendPlanned,
  summaryOf,
  type ExistingQuiz,
  type FileReport,
  type OnExisting,
  type Sender,
  type Stored,
} from '@qzr/ui'
import { newScheduleDocument, PlacementFormula, type ScheduleDocument } from '@qzr/shared'

const existing: ExistingQuiz = {
  id: 7,
  name: 'D1 Q3',
  revision: 2,
  savedBy: { name: 'Room 1' },
  savedAt: '2026-10-02T10:00:00.000Z',
}

/** A saved quiz file, valid as the API checks one, with no teams */
const quizJson = (division: string, quizNumber: string) =>
  JSON.stringify({
    version: 2,
    quiz: {
      division,
      quizNumber,
      overtime: false,
      placementFormula: PlacementFormula.Rules,
      questionTypes: [],
    },
    teams: [],
    answers: [],
    noJumps: [],
  })

const quizFileNamed = (quizNumber: string) =>
  new File([quizJson('1', quizNumber)], `D1Q${quizNumber}.json`)

/** A scoring sheet as LibreOffice saves it, with the division and quiz number in its header */
function sheetNamed(quizNumber: string) {
  const cell = (value: string) =>
    `<table:table-cell office:value-type="string"><text:p>${value}</text:p></table:table-cell>`
  const empty = '<table:table-row><table:table-cell/></table:table-row>'
  const header =
    '<table:table-row><table:table-cell/><table:table-cell/>' +
    cell('1') +
    '<table:table-cell/>' +
    cell(quizNumber) +
    '</table:table-row>'
  const content =
    '<office:document-content><office:body><office:spreadsheet><table:table table:name="Quiz">' +
    empty +
    empty +
    header +
    empty +
    `<table:table-row><table:table-cell/>${cell('Calgary 1')}</table:table-row>` +
    '</table:table></office:spreadsheet></office:body></office:document-content>'
  const bytes = zipSync({ 'content.xml': strToU8(content) })
  return new File([bytes as Uint8Array<ArrayBuffer>], `D1Q${quizNumber}.ods`)
}

/** A file input's change event, with these files picked */
function picked(...files: File[]) {
  const input = { files, value: 'picked' }
  return { event: { target: input } as unknown as Event, input }
}

/** A dialog that answers each question in turn, remembering what it was asked */
function answering(...answers: unknown[]) {
  const asked: string[] = []
  // Each question's button labels, in order
  const offered: string[][] = []
  return {
    asked,
    offered,
    ask: <T>(title: string, _detail?: string, choices: { label: string }[] = []) => {
      asked.push(title)
      offered.push(choices.map((choice) => choice.label))
      return Promise.resolve((answers.shift() ?? null) as T | null)
    },
  }
}

const official = { admin: false, rooms: [{ id: 5, name: 'Room 1' }] }

type SendFn = Parameters<typeof sendPlanned>[5]

/** Read, plan and send the picked files, as the Results page does once they are reviewed */
async function uploadPicked(
  event: Event,
  dialog: Parameters<typeof sendPlanned>[1],
  sender: Sender | null,
  meetName: string,
  send: SendFn,
  schedule: ScheduleDocument | null = null,
) {
  return sendPlanned(
    planUpload(await pickedFiles(event), schedule),
    dialog,
    sender,
    meetName,
    schedule,
    send,
  )
}

/** The change event of a file input with these files picked */
const event = (...files: File[]) => picked(...files).event

describe('uploadPicked', () => {
  it('sends each file in order for the room, reports each, and clears the input', async () => {
    const send = vi
      .fn<(file: QuizFile, roomId: number | null) => Promise<Stored>>()
      .mockImplementation(async (file) =>
        file.quiz.quizNumber === '1'
          ? { created: true, revision: 1 }
          : { created: false, revision: 3, keptCurrent: true },
      )
    const { event, input } = picked(quizFileNamed('1'), quizFileNamed('2'))
    const reports = await uploadPicked(event, answering(5), official, 'Practice', send)
    expect(send.mock.calls.map((call) => call[1])).toEqual([5, 5])
    expect(input.value).toBe('')
    expect(reports!.map((r) => [r.item.file, r.outcome, r.message])).toEqual([
      ['D1Q1.json', 'stored', 'Stored'],
      ['D1Q2.json', 'keptCurrent', 'Saved as revision 3; the earlier revision stays current'],
    ])
  })

  it('asks about a name the meet already has, and sends it again as chosen or skips it', async () => {
    const conflict = new ApiError(409, 'D1 Q3 was already submitted', { existing })
    const send = vi
      .fn<(file: QuizFile, roomId: number | null, onExisting?: OnExisting) => Promise<Stored>>()
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce({ created: false, revision: 3 })
      .mockRejectedValueOnce(conflict)
    // Asked once to answer the rest the same way, the user says no
    const dialog = answering(5, 'newRevision', false, null)
    const { event } = picked(quizFileNamed('3'), quizFileNamed('3'))
    const reports = await uploadPicked(event, dialog, official, 'Practice', send)
    expect(send.mock.calls[1]![2]).toBe('newRevision')
    expect(dialog.asked).toEqual([
      'Upload for Room 1?',
      'D1 Q3 was already submitted',
      'The same for the rest of this upload?',
      'D1 Q3 was already submitted',
    ])
    expect(reports!.map((r) => [r.outcome, r.message])).toEqual([
      ['revision', 'Saved as revision 3'],
      ['skipped', 'Skipped: D1 Q3 was already submitted'],
    ])
  })

  it('reports a file that is not JSON or is refused, and carries on', async () => {
    const send = vi
      .fn<(file: QuizFile) => Promise<Stored>>()
      .mockRejectedValueOnce(new ApiError(422, 'This file was saved by a newer version'))
      .mockResolvedValueOnce({ created: true, revision: 1 })
    const { event } = picked(
      new File(['not json'], 'notes.txt'),
      quizFileNamed('8'),
      quizFileNamed('9'),
    )
    const reports = await uploadPicked(event, answering(5), official, 'Practice', send)
    expect(reports!.map((r) => [r.item.file, r.outcome, r.message])).toEqual([
      ['notes.txt', 'refused', 'Not a quiz file'],
      ['D1Q8.json', 'refused', 'This file was saved by a newer version'],
      ['D1Q9.json', 'stored', 'Stored'],
    ])
  })

  it('reports a send that may work another time as not sent, in plain words', async () => {
    const conflict = new ApiError(409, 'D1 Q3 was already submitted', { existing })
    const send = vi
      .fn<(file: QuizFile) => Promise<Stored>>()
      .mockRejectedValueOnce(new ApiError(503, 'Service Unavailable'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new DOMException('The operation timed out.', 'TimeoutError'))
      .mockRejectedValueOnce(conflict)
      .mockRejectedValueOnce(new ApiError(500, 'Internal Server Error'))
      .mockRejectedValueOnce(new ApiError(429, 'Too Many Requests'))
      .mockRejectedValueOnce(new ApiError(401, 'Unauthorized'))
      .mockRejectedValueOnce(new RangeError('Invalid array length'))
    const files = ['1', '2', '3', '4', '5', '6', '7'].map(quizFileNamed)
    const dialog = answering(5, 'newRevision', false)
    const reports = await uploadPicked(event(...files), dialog, official, 'Practice', send)
    const busy = "The server was busy and this file wasn't saved"
    const unreachable = "The meet couldn't be reached, so this file may not have been saved"
    expect(reports!.map((r) => [r.outcome, r.message])).toEqual([
      ['notSent', busy],
      ['notSent', unreachable],
      ['notSent', 'No answer came from the meet, so this file may not have been saved'],
      ['notSent', busy],
      ['notSent', busy],
      ['notSent', "You were signed out, so this file wasn't saved"],
      // A fault in the page itself is shown as it is, as sending again won't mend it
      ['refused', 'Invalid array length'],
    ])
  })

  it('asks about answering the rest only once, counting files that can still be sent', async () => {
    const conflict = new ApiError(409, 'D1 Q3 was already submitted', { existing })
    const send = vi
      .fn<(file: QuizFile, roomId: number | null, onExisting?: OnExisting) => Promise<Stored>>()
      .mockImplementation(async (_file, _room, onExisting) => {
        if (!onExisting) throw conflict
        return { created: false, revision: 3 }
      })
    const dialog = answering(5, 'newRevision', false, 'newRevision', 'newRevision')
    const files = [
      quizFileNamed('3'),
      quizFileNamed('4'),
      new File(['x'], 'notes.txt'),
      quizFileNamed('5'),
    ]
    await uploadPicked(event(...files), dialog, official, 'Practice', send)
    expect(dialog.asked.filter((title) => title.startsWith('The same'))).toHaveLength(1)
  })

  it('reads a scoring sheet and sends it like a quiz file', async () => {
    const send = vi
      .fn<(file: QuizFile) => Promise<Stored>>()
      .mockResolvedValue({ created: true, revision: 1 })
    const { event } = picked(sheetNamed('4'), quizFileNamed('5'))
    const reports = await uploadPicked(event, answering(5), official, 'Practice', send)
    expect(send.mock.calls.map(([file]) => [file.quiz.division, file.quiz.quizNumber])).toEqual([
      ['1', '4'],
      ['1', '5'],
    ])
    expect(send.mock.calls[0]![0].teams).toHaveLength(3)
    expect(reports!.map((r) => [r.item.file, r.outcome])).toEqual([
      ['D1Q4.ods', 'stored'],
      ['D1Q5.json', 'stored'],
    ])
  })

  it('refuses a .json that holds no quiz', async () => {
    const picked = await pickedFiles(
      event(new File(['null'], 'empty.json'), new File(['{"name":"app"}'], 'package.json')),
    )
    expect(picked.map((p) => [p.file, p.quizFile, p.refusal])).toEqual([
      ['empty.json', null, 'Not a quiz file'],
      ['package.json', null, 'Not a quiz file'],
    ])
  })

  it('asks nothing when no file of the upload can be sent', async () => {
    const send = vi.fn<(file: QuizFile) => Promise<Stored>>()
    const dialog = answering()
    const reports = await uploadPicked(
      event(new File(['x'], 'notes.txt')),
      dialog,
      official,
      'Practice',
      send,
    )
    expect(dialog.asked).toEqual([])
    expect(reports!.map((r) => [r.item.file, r.outcome, r.message])).toEqual([
      ['notes.txt', 'refused', 'Not a quiz file'],
    ])
  })

  it('refuses a blank sheet, such as the template picked by mistake', async () => {
    const blank = new File(
      [
        zipSync({
          'content.xml': strToU8(
            '<office:document-content><office:body><office:spreadsheet><table:table table:name="Quiz"></table:table></office:spreadsheet></office:body></office:document-content>',
          ),
        }) as Uint8Array<ArrayBuffer>,
      ],
      'Scoresheet.ots',
    )
    const [picked] = await pickedFiles(event(blank))
    expect(picked).toMatchObject({ quizFile: null, refusal: 'A blank sheet, with no quiz on it' })
  })

  it('refuses a spreadsheet that is not a scoring sheet, and carries on', async () => {
    const send = vi.fn<(file: QuizFile) => Promise<Stored>>().mockResolvedValue({
      created: true,
      revision: 1,
    })
    const { event } = picked(new File(['not a zip'], 'budget.ods'), quizFileNamed('6'))
    const reports = await uploadPicked(event, answering(5), official, 'Practice', send)
    expect(send).toHaveBeenCalledTimes(1)
    expect(reports!.map((r) => [r.item.file, r.outcome, r.message])).toEqual([
      ['budget.ods', 'refused', 'Not a quiz file or scoring sheet'],
      ['D1Q6.json', 'stored', 'Stored'],
    ])
  })

  it('reports a file the meet already holds as unchanged, asking nothing', async () => {
    const send = vi.fn<(file: QuizFile) => Promise<Stored>>().mockResolvedValue({
      created: false,
      revision: 2,
      unchanged: true,
    })
    const dialog = answering(5)
    const reports = await uploadPicked(
      event(quizFileNamed('3')),
      dialog,
      official,
      'Practice',
      send,
    )
    expect(dialog.asked).toEqual(['Upload for Room 1?'])
    expect(reports!.map((r) => [r.item.file, r.outcome, r.message])).toEqual([
      ['D1Q3.json', 'unchanged', 'Unchanged'],
    ])
  })

  it("answers the rest of the batch's stored quizzes as the first was answered, when asked to", async () => {
    const conflict = new ApiError(409, 'D1 Q3 was already submitted', { existing })
    const send = vi
      .fn<(file: QuizFile, roomId: number | null, onExisting?: OnExisting) => Promise<Stored>>()
      .mockImplementation(async (_file, _room, onExisting) => {
        if (!onExisting) throw conflict
        return { created: false, revision: 3, keptCurrent: true }
      })
    const dialog = answering(5, 'keepCurrent', true)
    const files = [quizFileNamed('3'), quizFileNamed('4'), quizFileNamed('5')]
    const reports = await uploadPicked(event(...files), dialog, official, 'Practice', send)
    expect(dialog.asked).toEqual([
      'Upload for Room 1?',
      'D1 Q3 was already submitted',
      'The same for the rest of this upload?',
    ])
    expect(send.mock.calls.filter((call) => call[2] === 'keepCurrent')).toHaveLength(3)
    expect(reports!.every((r) => r.outcome === 'keptCurrent')).toBe(true)
  })

  it('clears the input and sends nothing when the user may no longer send', async () => {
    const send = vi.fn()
    const { event, input } = picked(quizFileNamed('1'))
    expect(await uploadPicked(event, answering(), null, 'Practice', send)).toBe(undefined)
    expect(input.value).toBe('')
    expect(send).not.toHaveBeenCalled()
  })

  it('sends nothing when no file is picked or the room choice is cancelled', async () => {
    const send = vi.fn()
    expect(await uploadPicked(picked().event, answering(), official, 'Practice', send)).toBe(
      undefined,
    )
    const admin = { admin: true, rooms: official.rooms }
    const { event } = picked(quizFileNamed('1'))
    expect(await uploadPicked(event, answering(null), admin, 'Practice', send)).toBe(undefined)
    expect(await uploadPicked(event, answering(null), official, 'Practice', send)).toBe(undefined)
    expect(send).not.toHaveBeenCalled()
  })
})

describe('summaryOf', () => {
  const report = (outcome: FileReport['outcome']): FileReport => ({
    item: {} as FileReport['item'],
    outcome,
    message: '',
  })

  it('counts a batch by outcome, new revisions and kept-current files as stored, leaving out zeros', () => {
    const reports = (['stored', 'revision', 'keptCurrent', 'unchanged', 'notSent'] as const).map(
      report,
    )
    expect(summaryOf(reports)).toBe('5 files: 3 stored, 1 unchanged, 1 not sent')
  })

  it('says when nothing was saved', () => {
    expect(summaryOf([report('notSent'), report('notSent')])).toBe('2 files: 2 not sent')
    expect(summaryOf([report('refused'), report('skipped')])).toBe('2 files: 1 skipped, 1 refused')
  })
})

describe('an upload matched to the schedule', () => {
  const admin = {
    admin: true,
    rooms: [
      { id: 5, name: 'Room 1' },
      { id: 6, name: 'Room 2' },
    ],
  }
  const schedule = (): ScheduleDocument => {
    const doc = newScheduleDocument('Meet')
    doc.rooms = [
      { id: 'r1', name: 'Room 1', meetRoomId: 5 },
      { id: 'r2', name: 'Room 2', meetRoomId: 6 },
    ]
    const quiz = (id: string, label: string, room: string) => ({
      id,
      label,
      division: '1',
      phase: 'prelim' as const,
      cell: { slot: 's1', room },
      seats: [],
      pinned: false,
    })
    doc.quizzes = [quiz('q3', '3', 'r1'), quiz('q4', '4', 'r2')]
    return doc
  }
  const named = (division: string, quizNumber: string) =>
    new File([quizJson(division, quizNumber)], `D${division}Q${quizNumber}.json`)
  const stored = () => vi.fn<SendFn>().mockResolvedValue({ created: true, revision: 1 })

  it("pairs each file with its scheduled quiz, and sends an admin's to each quiz's room", async () => {
    const send = stored()
    const dialog = answering()
    await uploadPicked(
      event(named('1', '3'), named('1', '4')),
      dialog,
      admin,
      'Practice',
      send,
      schedule(),
    )
    expect(dialog.asked).toEqual([])
    expect(send.mock.calls.map((call) => [call[1], call[3]])).toEqual([
      [5, 'q3'],
      [6, 'q4'],
    ])
  })

  it('sends a file already named as its scheduled quiz exactly as it was read', async () => {
    const send = stored()
    const file = named('1', '3')
    await uploadPicked(event(file), answering(), admin, 'Practice', send, schedule())
    expect(JSON.stringify(send.mock.calls[0]![0])).toBe(await file.text())
  })

  it('sends a file given a scheduled quiz as that quiz, in its room', async () => {
    const send = stored()
    const plan = planUpload(await pickedFiles(event(named('1', '9'))), schedule())
    expect(plan[0]!.scheduleQuizId).toBeNull()
    plan[0]!.scheduleQuizId = 'q4'
    await sendPlanned(plan, answering(), admin, 'Practice', schedule(), send)
    expect(send.mock.calls[0]![0].quiz).toMatchObject({ division: '1', quizNumber: '4' })
    expect(send.mock.calls[0]![1]).toBe(6)
  })

  it('flags two files naming one quiz, and a division the schedule spells otherwise', async () => {
    const plan = planUpload(
      await pickedFiles(event(named('1', '3'), named('1', '3'), named('Div 1', '4'))),
      schedule(),
    )
    expect(plan.map((p) => [p.scheduleQuizId, p.duplicate])).toEqual([
      ['q3', true],
      ['q3', true],
      [null, false],
    ])
  })

  it('says how each file matched, and suggests the quiz with the consolation flag the other way', async () => {
    const doc = schedule()
    // Consolation quiz D1c QP, which a sheet missing its "c" reads as main-bracket D1 Qp
    doc.quizzes.push({ ...doc.quizzes[0]!, id: 'qcp', label: 'P', lane: 1 })
    const plan = planUpload(
      await pickedFiles(event(named('1', '3'), named('1', 'p'), named('1', '9'))),
      doc,
    )
    expect(plan.map((p) => [matchOf(p, doc), p.scheduleQuizId, p.suggestion])).toEqual([
      ['name', 'q3', null],
      ['none', null, 'qcp'],
      ['none', null, null],
    ])
  })

  it('records a scheduled quiz picked as the suggestion, by hand, by its name, or none', async () => {
    const doc = schedule()
    doc.quizzes.push({ ...doc.quizzes[0]!, id: 'qcp', label: 'P', lane: 1 })
    const [file] = planUpload(await pickedFiles(event(named('1', 'p'))), doc)
    const [three] = planUpload(await pickedFiles(event(named('1', '3'))), doc)
    const as = (item: typeof file, scheduleQuizId: string | null) =>
      matchOf({ ...item!, scheduleQuizId }, doc)
    expect(as(file, 'qcp')).toBe('suggestion')
    expect(as(file, 'q4')).toBe('hand')
    expect(as(file, null)).toBe('none')
    expect(as(three, 'q3')).toBe('name')
    // None picked, but linked by its name when sent
    expect(as(three, null)).toBe('name')
  })

  it('flags a file given the scheduled quiz another file already matches', async () => {
    const plan = planUpload(await pickedFiles(event(named('1', '3'), named('1', '9'))), schedule())
    plan[1]!.scheduleQuizId = 'q3'
    expect(markDuplicates(plan, schedule()).map((p) => p.duplicate)).toEqual([true, true])
  })

  it('flags a file sent unlinked under the name another is given by its scheduled quiz', async () => {
    const plan = planUpload(await pickedFiles(event(named('1', '9'), named('1', '3'))), schedule())
    plan[0]!.scheduleQuizId = 'q3'
    plan[1]!.scheduleQuizId = null
    expect(markDuplicates(plan, schedule()).map((p) => p.duplicate)).toEqual([true, true])
  })

  it('asks an admin the room for a file whose scheduled quiz has no room yet', async () => {
    const send = stored()
    const doc = schedule()
    doc.quizzes[1]!.cell = null
    await uploadPicked(
      event(named('1', '3'), named('1', '4')),
      answering(6),
      admin,
      'Practice',
      send,
      doc,
    )
    expect(send.mock.calls.map((call) => [call[1], call[3]])).toEqual([
      [5, 'q3'],
      [6, 'q4'],
    ])
  })

  it("asks an admin the room for files the schedule doesn't match", async () => {
    const send = stored()
    await uploadPicked(
      event(named('1', '3'), named('1', '9')),
      answering('none'),
      admin,
      'Practice',
      send,
      schedule(),
    )
    expect(send.mock.calls.map((call) => [call[1], call[3]])).toEqual([
      [5, 'q3'],
      [null, undefined],
    ])
  })
})

describe('chooseRoom', () => {
  const rooms = [
    { id: 5, name: 'Room 1' },
    { id: 6, name: 'Room 2' },
  ]

  it('names the room to an official of one room before sending', async () => {
    const dialog = answering(5)
    expect(await chooseRoom(dialog, official, 'Practice', 'Upload')).toBe(5)
    expect(dialog.asked).toEqual(['Upload for Room 1?'])
    expect(await chooseRoom(answering(null), official, 'Practice', 'Upload')).toBe(undefined)
  })

  it('sends for no room, without asking, when an official has no room on record', async () => {
    const dialog = answering()
    expect(await chooseRoom(dialog, { admin: false, rooms: [] }, 'Practice', 'Submit')).toBeNull()
    expect(dialog.asked).toEqual([])
  })

  it('asks an official of several rooms which one', async () => {
    const dialog = answering(6)
    expect(await chooseRoom(dialog, { admin: false, rooms }, 'Practice', 'Upload')).toBe(6)
    expect(dialog.asked).toEqual(['Upload for which room?'])
  })

  it('offers a way out when asking which room', async () => {
    const dialog = answering(null, null)
    expect(await chooseRoom(dialog, { admin: false, rooms }, 'Practice', 'Submit')).toBe(undefined)
    expect(await chooseRoom(dialog, { admin: true, rooms }, 'Practice', 'Submit')).toBe(undefined)
    expect(dialog.offered).toEqual([
      ['Room 1', 'Room 2', 'Cancel'],
      ['Room 1', 'Room 2', 'No room', 'Cancel'],
    ])
  })

  it('lets an admin pick no room, and cancelling picks nothing', async () => {
    const admin = { admin: true, rooms }
    expect(await chooseRoom(answering('none'), admin, 'Practice', 'Submit')).toBeNull()
    expect(await chooseRoom(answering(null), admin, 'Practice', 'Submit')).toBe(undefined)
  })

  it('asks for the room the schedule places the quiz in, with another room a choice away', async () => {
    const placed = { roomId: 6, quizLabel: 'D1 Q3' }
    const dialog = answering(6)
    expect(await chooseRoom(dialog, { admin: false, rooms }, 'Practice', 'Submit', placed)).toBe(6)
    expect(dialog.asked).toEqual(['Submit for Room 2?'])
    expect(dialog.offered[0]).toEqual(['Cancel', 'Another room…', 'Submit'])

    const elsewhere = answering('other', 5)
    expect(await chooseRoom(elsewhere, { admin: false, rooms }, 'Practice', 'Submit', placed)).toBe(
      5,
    )
    expect(elsewhere.asked).toEqual(['Submit for Room 2?', 'Submit for which room?'])

    // The only room an official has: nothing else to offer
    const only = answering(5)
    const inRoom1 = { roomId: 5, quizLabel: 'D1 Q3' }
    expect(await chooseRoom(only, official, 'Practice', 'Submit', inRoom1)).toBe(5)
    expect(only.offered[0]).toEqual(['Cancel', 'Submit'])
  })

  it('asks as before when the schedule places the quiz in a room the user may not send for', async () => {
    const dialog = answering(5)
    const placed = { roomId: 9, quizLabel: 'D1 Q3' }
    expect(await chooseRoom(dialog, official, 'Practice', 'Submit', placed)).toBe(5)
    expect(dialog.asked).toEqual(['Submit for Room 1?'])
  })
})
