import { describe, it, expect, vi } from 'vitest'
import { ApiError, type QuizFile } from '@qzr/shared'
import { chooseRoom, uploadPicked, type ExistingQuiz, type OnExisting, type Stored } from '@qzr/ui'

const existing: ExistingQuiz = {
  id: 7,
  name: 'D1 Q3',
  revision: 2,
  savedBy: { name: 'Room 1' },
  savedAt: '2026-10-02T10:00:00.000Z',
}

const quizFileNamed = (quizNumber: string) =>
  new File([JSON.stringify({ version: 2, quiz: { quizNumber } })], `D1Q${quizNumber}.json`)

/** A file input's change event, with these files picked */
function picked(...files: File[]) {
  const input = { files, value: 'picked' }
  return { event: { target: input } as unknown as Event, input }
}

/** A dialog that answers each question in turn, remembering what it was asked */
function answering(...answers: unknown[]) {
  const asked: string[] = []
  return {
    asked,
    ask: <T>(title: string): Promise<T | null> => {
      asked.push(title)
      return Promise.resolve((answers.shift() ?? null) as T | null)
    },
  }
}

const official = { admin: false, rooms: [{ id: 5, name: 'Room 1' }] }

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
    const reports = await uploadPicked(event, answering(), official, 'Practice', send)
    expect(send.mock.calls.map((call) => call[1])).toEqual([5, 5])
    expect(input.value).toBe('')
    expect(reports).toEqual([
      { file: 'D1Q1.json', stored: true, message: 'Stored' },
      {
        file: 'D1Q2.json',
        stored: true,
        message: 'Saved as revision 3; the earlier revision stays current',
      },
    ])
  })

  it('asks about a name the meet already has, and sends it again as chosen or skips it', async () => {
    const conflict = new ApiError(409, 'D1 Q3 was already submitted', { existing })
    const send = vi
      .fn<(file: QuizFile, roomId: number | null, onExisting?: OnExisting) => Promise<Stored>>()
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce({ created: false, revision: 3 })
      .mockRejectedValueOnce(conflict)
    const dialog = answering('newRevision', null)
    const { event } = picked(quizFileNamed('3'), quizFileNamed('3'))
    const reports = await uploadPicked(event, dialog, official, 'Practice', send)
    expect(send.mock.calls[1]![2]).toBe('newRevision')
    expect(dialog.asked).toEqual(['D1 Q3 was already submitted', 'D1 Q3 was already submitted'])
    expect(reports!.map((r) => [r.stored, r.message])).toEqual([
      [true, 'Saved as revision 3'],
      [false, 'Skipped: D1 Q3 was already submitted'],
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
    const reports = await uploadPicked(event, answering(), official, 'Practice', send)
    expect(reports!.map((r) => [r.file, r.stored, r.message])).toEqual([
      ['notes.txt', false, 'Not a quiz file'],
      ['D1Q8.json', false, 'This file was saved by a newer version'],
      ['D1Q9.json', true, 'Stored'],
    ])
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
    expect(send).not.toHaveBeenCalled()
  })
})

describe('chooseRoom', () => {
  const rooms = [
    { id: 5, name: 'Room 1' },
    { id: 6, name: 'Room 2' },
  ]

  it("doesn't ask an official of one room", async () => {
    const dialog = answering()
    expect(await chooseRoom(dialog, official, 'Practice', 'Upload')).toBe(5)
    expect(dialog.asked).toEqual([])
  })

  it('asks an official of several rooms which one', async () => {
    const dialog = answering(6)
    expect(await chooseRoom(dialog, { admin: false, rooms }, 'Practice', 'Upload')).toBe(6)
    expect(dialog.asked).toEqual(['Upload for which room?'])
  })

  it('lets an admin pick no room, and cancelling picks nothing', async () => {
    const admin = { admin: true, rooms }
    expect(await chooseRoom(answering('none'), admin, 'Practice', 'Submit')).toBeNull()
    expect(await chooseRoom(answering(null), admin, 'Practice', 'Submit')).toBe(undefined)
  })
})
