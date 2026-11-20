import { ApiError, readOds, type QuizFile } from '@qzr/shared'

/** A quiz the meet already has under the name being sent */
export interface ExistingQuiz {
  id: number
  name: string
  revision: number
  savedBy: { name: string } | null
  savedAt: string | null
}

/** What to do with a quiz whose name the meet already has */
export type OnExisting = 'newRevision' | 'keepCurrent'

/** The answer to sending a quiz the meet stored */
export interface Stored {
  created: boolean
  revision: number
  keptCurrent?: boolean
  /** The file was exactly the quiz's current revision, so nothing was stored */
  unchanged?: boolean
}

/**
 * Who is sending to a meet, as `GET /results/sender` says: an admin, for any of its rooms or none;
 * an official, for their rooms
 */
export interface Sender {
  admin: boolean
  rooms: { id: number; name: string }[]
}

/** What happened to one file */
export interface FileReport {
  file: string
  stored: boolean
  message: string
}

/** A dialog that asks a question with a button per choice, as `ChoiceDialog` does */
export interface Asker {
  ask<T>(
    title: string,
    detail: string,
    choices: { label: string; value: T | null; primary?: boolean }[],
  ): Promise<T | null>
}

/** Sends one quiz to the meet for a room, by name; a name it already has is refused with a 409 */
type Send = (quizFile: QuizFile, roomId: number | null, onExisting?: OnExisting) => Promise<Stored>

/** The quiz the meet already has, when a send was refused for that reason */
export function existingQuizOf(e: unknown): ExistingQuiz | undefined {
  if (!(e instanceof ApiError) || e.status !== 409) return undefined
  return (e.body as { existing?: ExistingQuiz } | undefined)?.existing
}

/**
 * Ask what to do with a quiz the meet already has, worded the same wherever a quiz is sent: don't
 * send it (null), save it keeping the current revision, or save it as the new current revision
 */
export async function askAlreadySubmitted(
  dialog: Asker | null | undefined,
  { name, revision, savedBy }: ExistingQuiz,
): Promise<OnExisting | null> {
  const answer = await dialog?.ask<OnExisting>(
    `${name} was already submitted`,
    `Revision ${revision} is current${savedBy ? `, saved by ${savedBy.name}` : ''}.`,
    [
      { label: "Don't submit", value: null },
      { label: `Save, keep revision ${revision} current`, value: 'keepCurrent' },
      { label: 'Save as new revision', value: 'newRevision', primary: true },
    ],
  )
  return answer ?? null
}

/**
 * The room to send for. A quiz the schedule `placed` in a room the user may send for confirms that
 * room, or picks another. Otherwise an official of one room confirms it; an official of several
 * rooms picks one, and an admin any room of the meet or "No room" (null). Undefined when the user
 * cancels.
 */
export async function chooseRoom(
  dialog: Asker | null | undefined,
  sender: Sender,
  meetName: string,
  action: string,
  placed?: { roomId: number; quizLabel: string },
): Promise<number | null | undefined> {
  const onlyRoom = !sender.admin && sender.rooms.length <= 1
  if (onlyRoom && sender.rooms.length === 0) return null
  // The room the schedule places the quiz in, when the user may send for it, or an official's only
  // room: named before sending, so an official who typed a room's code can see it was the right one
  const placedIn = placed && sender.rooms.find((room) => room.id === placed.roomId)
  const room = placedIn ?? (onlyRoom ? sender.rooms[0] : undefined)
  if (room) {
    const choices: { label: string; value: number | 'other' | null; primary?: boolean }[] = [
      { label: 'Cancel', value: null },
    ]
    if (!onlyRoom) choices.push({ label: 'Another room…', value: 'other' })
    choices.push({ label: action, value: room.id, primary: true })
    const answer = await dialog?.ask(
      `${action} for ${room.name}?`,
      placedIn
        ? `The schedule places ${placed.quizLabel} in ${room.name}.`
        : `You officiate ${room.name} of ${meetName}.`,
      choices,
    )
    if (answer !== 'other') return answer ?? undefined
  }
  if (sender.admin && sender.rooms.length === 0) return null
  const choices: { label: string; value: number | 'none' | null }[] = sender.rooms.map((room) => ({
    label: room.name,
    value: room.id,
  }))
  if (sender.admin) choices.push({ label: 'No room', value: 'none' })
  // Escape also cancels, but a button says so
  choices.push({ label: 'Cancel', value: null })
  const answer = await dialog?.ask(
    `${action} for which room?`,
    sender.admin
      ? `Pick a room of ${meetName}, or no room to save it as your own.`
      : `You officiate ${sender.rooms.length} rooms of ${meetName}.`,
    choices,
  )
  if (answer == null) return undefined
  return answer === 'none' ? null : answer
}

/** Whether to answer the rest of an upload's stored quizzes as this one was answered */
async function askSameForRest(dialog: Asker | null | undefined, remaining: number) {
  const answer = await dialog?.ask<boolean>(
    'The same for the rest of this upload?',
    `${remaining} more ${remaining === 1 ? 'file is' : 'files are'} still to send. Any the meet already has can be answered the same way.`,
    [
      { label: 'Ask each time', value: false },
      { label: 'Do the same', value: true, primary: true },
    ],
  )
  return answer === true
}

/**
 * Upload the saved quiz files and scoring sheets picked in a file input: the room is chosen, then
 * the files are sent one at a time, in order. Each name the meet already has asks what to do, and
 * that answer may be kept for the rest of the upload; skipping one moves on to the next, and one
 * file failing doesn't stop the rest. Undefined when nothing was sent, as when the user may no
 * longer send to the meet.
 */
export async function uploadPicked(
  event: Event,
  dialog: Asker | null | undefined,
  sender: Sender | null,
  meetName: string,
  send: Send,
): Promise<FileReport[] | undefined> {
  // Cleared first, whatever happens, so picking the same files again fires a change
  const input = event.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  input.value = ''
  if (!sender || files.length === 0) return undefined
  const roomId = await chooseRoom(dialog, sender, meetName, 'Upload')
  if (roomId === undefined) return undefined
  // The answer kept for the rest of the upload, once the user asks to; undefined until then
  let kept: OnExisting | null | undefined
  const reports: FileReport[] = []
  for (const [at, file] of files.entries()) {
    const decide = async (existing: ExistingQuiz) => {
      if (kept !== undefined) return kept
      const choice = await askAlreadySubmitted(dialog, existing)
      const remaining = files.length - at - 1
      if (remaining > 0 && (await askSameForRest(dialog, remaining))) kept = choice
      return choice
    }
    reports.push({
      file: file.name,
      ...(await sendOne(
        file,
        (quizFile, onExisting) => send(quizFile, roomId, onExisting),
        decide,
      )),
    })
  }
  return reports
}

/** A picked file's quiz: a scoring sheet read as the scoresheet reads it, or a saved quiz file */
async function quizFileOf(file: File): Promise<QuizFile | null> {
  try {
    if (/\.o[dt]s$/i.test(file.name)) return readOds(new Uint8Array(await file.arrayBuffer()))
    return JSON.parse(await file.text()) as QuizFile
  } catch {
    return null
  }
}

async function sendOne(
  file: File,
  send: (quizFile: QuizFile, onExisting?: OnExisting) => Promise<Stored>,
  decide: (existing: ExistingQuiz) => Promise<OnExisting | null>,
): Promise<Omit<FileReport, 'file'>> {
  const quizFile = await quizFileOf(file)
  if (!quizFile) {
    const sheet = /\.o[dt]s$/i.test(file.name)
    return {
      stored: false,
      message: sheet ? 'Not a quiz file or scoring sheet' : 'Not a quiz file',
    }
  }
  try {
    return { stored: true, message: storedMessage(await send(quizFile)) }
  } catch (e) {
    const existing = existingQuizOf(e)
    if (!existing) return { stored: false, message: (e as Error).message }
    const choice = await decide(existing)
    if (!choice)
      return { stored: false, message: `Skipped: ${existing.name} was already submitted` }
    try {
      return { stored: true, message: storedMessage(await send(quizFile, choice)) }
    } catch (again) {
      return { stored: false, message: (again as Error).message }
    }
  }
}

function storedMessage({ created, revision, keptCurrent, unchanged }: Stored): string {
  if (created) return 'Stored'
  if (unchanged) return 'Unchanged'
  if (keptCurrent) return `Saved as revision ${revision}; the earlier revision stays current`
  return `Saved as revision ${revision}`
}
