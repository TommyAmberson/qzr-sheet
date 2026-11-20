import {
  ApiError,
  isBlankSheet,
  isQuizFile,
  readOds,
  resultKey,
  resultName,
  scheduleQuizMeta,
  type QuizFile,
  type ScheduleDocument,
} from '@qzr/shared'
import { isRefusal } from './apiErrors'

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

/**
 * What became of one file: stored as a new quiz, as a new revision, or kept behind the current
 * revision; unchanged, as the meet already had it; skipped by the user's choice; refused for what it
 * is or by the API for a reason it gives; or not sent, as sending failed and may work another time
 */
export type FileOutcome =
  | 'stored'
  | 'revision'
  | 'keptCurrent'
  | 'unchanged'
  | 'skipped'
  | 'refused'
  | 'notSent'

/** What happened to one file */
export interface FileReport {
  /** The file as it was reviewed, so one not sent can be sent again as it was */
  item: PlannedFile
  outcome: FileOutcome
  /** Why it wasn't saved, in plain words, or what was saved */
  message: string
}

/** What a send that stored a quiz, as a new one or a revision, reports */
const STORED: FileOutcome[] = ['stored', 'revision', 'keptCurrent']

/** Whether the meet now has the file: stored, or found already stored */
export function isSaved(outcome: FileOutcome): boolean {
  return STORED.includes(outcome) || outcome === 'unchanged'
}

/** The words a batch's summary counts each outcome under, in order */
const SUMMARY_COUNTS: [string, FileOutcome[]][] = [
  ['stored', STORED],
  ['unchanged', ['unchanged']],
  ['skipped', ['skipped']],
  ['refused', ['refused']],
  ['not sent', ['notSent']],
]

/** A batch in one line, "5 files: 4 stored, 1 not sent", leaving out counts of none */
export function summaryOf(reports: FileReport[]): string {
  const counts = SUMMARY_COUNTS.map(([label, outcomes]) => {
    const count = reports.filter((r) => outcomes.includes(r.outcome)).length
    return count > 0 ? `${count} ${label}` : null
  }).filter((count) => count !== null)
  return `${reports.length} ${reports.length === 1 ? 'file' : 'files'}: ${counts.join(', ')}`
}

/** A dialog that asks a question with a button per choice, as `ChoiceDialog` does */
export interface Asker {
  ask<T>(
    title: string,
    detail: string,
    choices: { label: string; value: T | null; primary?: boolean }[],
  ): Promise<T | null>
}

/**
 * Sends one quiz to the meet for a room, by name, as the scheduled quiz given; a name it already has
 * is refused with a 409
 */
type Send = (
  quizFile: QuizFile,
  roomId: number | null,
  onExisting?: OnExisting,
  scheduleQuizId?: string,
) => Promise<Stored>

/** A picked file, read as a quiz, or why it can't be: it is neither a quiz file nor a sheet */
export type PickedFile =
  | { file: string; quizFile: QuizFile; refusal?: undefined }
  | { file: string; quizFile: null; refusal: string }

/**
 * How a planned file came to its scheduled quiz: its name matches it, it was picked by hand or as
 * the review's suggestion, or it has none
 */
export type PlannedMatch = 'name' | 'hand' | 'suggestion' | 'none'

/** How a planned file came to the scheduled quiz it is sent as */
export function matchOf(item: PlannedFile, schedule: ScheduleDocument | null): PlannedMatch {
  const name = nameOf(item.quizFile)
  // A file sent with no scheduled quiz picked is still linked by its name, when the schedule has it
  const scheduled = item.scheduleQuizId
    ? schedule?.quizzes.find((q) => q.id === item.scheduleQuizId)
    : schedule?.quizzes.find((q) => resultName(q) === name)
  if (!scheduled) return 'none'
  if (resultName(scheduled) === name) return 'name'
  return item.scheduleQuizId === item.suggestion ? 'suggestion' : 'hand'
}

/** A picked file on its way to the meet, as the upload's review shows it */
export type PlannedFile = PickedFile & {
  /** The published schedule's quiz it is sent as: the one its name matches, or one picked */
  scheduleQuizId: string | null
  /**
   * For a file no scheduled quiz is named as, the one named as it with the consolation flag the
   * other way, as when a sheet's quiz number is missing its "c"; null when the schedule has none
   */
  suggestion: string | null
  /** Another file of the upload is sent as the same quiz */
  duplicate: boolean
}

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
 * The files picked in a file input, each read as a quiz: a scoring sheet as the scoresheet reads it,
 * or a saved quiz file. The input is cleared, so picking the same files again fires a change.
 */
export async function pickedFiles(event: Event): Promise<PickedFile[]> {
  const input = event.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  input.value = ''
  return Promise.all(files.map(readPicked))
}

/** A picked file's quiz: a scoring sheet read as the scoresheet reads it, or a saved quiz file */
async function readPicked(file: File): Promise<PickedFile> {
  const sheet = /\.o[dt]s$/i.test(file.name)
  try {
    const quizFile: unknown = sheet
      ? readOds(new Uint8Array(await file.arrayBuffer()))
      : JSON.parse(await file.text())
    // Checked as the API checks a quiz file, so the review only ever shows a quiz
    if (!isQuizFile(quizFile)) throw new Error('not a quiz')
    // A blank sheet, such as the template itself picked by mistake, holds no quiz to send
    if (sheet && isBlankSheet(quizFile)) {
      return { file: file.name, quizFile: null, refusal: 'A blank sheet, with no quiz on it' }
    }
    return { file: file.name, quizFile }
  } catch {
    const refusal = sheet ? 'Not a quiz file or scoring sheet' : 'Not a quiz file'
    return { file: file.name, quizFile: null, refusal }
  }
}

/** The name a file's quiz is matched by; null for a file that is no quiz */
function nameOf(quizFile: QuizFile | null): string | null {
  return quizFile ? resultKey(quizFile.quiz) : null
}

/**
 * The planned files, each flagged when another goes under the same name: its scheduled quiz's,
 * which a file sent as it takes, or else its own
 */
export function markDuplicates(
  planned: PlannedFile[],
  schedule: ScheduleDocument | null,
): PlannedFile[] {
  const keys = planned.map((p) => {
    const scheduled = schedule?.quizzes.find((q) => q.id === p.scheduleQuizId)
    return scheduled ? resultName(scheduled) : nameOf(p.quizFile)
  })
  return planned.map((p, i) => ({
    ...p,
    duplicate: keys[i] !== null && keys.filter((key) => key === keys[i]).length > 1,
  }))
}

/**
 * Each picked file with the scheduled quiz its name matches, if any, or else the one suggested for
 * it, and whether another names the same quiz
 */
export function planUpload(picked: PickedFile[], schedule: ScheduleDocument | null): PlannedFile[] {
  const scheduledByName = new Map((schedule?.quizzes ?? []).map((q) => [resultName(q), q.id]))
  return markDuplicates(
    picked.map((p) => {
      const quiz = p.quizFile?.quiz
      const scheduleQuizId = quiz ? (scheduledByName.get(resultKey(quiz)) ?? null) : null
      const flipped = quiz && { ...quiz, consolation: !quiz.consolation }
      const suggestion =
        flipped && !scheduleQuizId ? (scheduledByName.get(resultKey(flipped)) ?? null) : null
      return { ...p, scheduleQuizId, suggestion, duplicate: false }
    }),
    schedule,
  )
}

/** The meet's room a scheduled quiz is placed in; null when it has none */
export function roomOfScheduled(schedule: ScheduleDocument, scheduleQuizId: string): number | null {
  const room = schedule.quizzes.find((q) => q.id === scheduleQuizId)?.cell?.room
  return schedule.rooms.find((r) => r.id === room)?.meetRoomId ?? null
}

/** The quiz named as the scheduled quiz names it: its division, consolation flag and number */
function namedAsScheduled(quizFile: QuizFile, schedule: ScheduleDocument, id: string): QuizFile {
  const scheduled = schedule.quizzes.find((q) => q.id === id)
  // A file already named as its scheduled quiz goes as it is, so an unchanged one stays unchanged
  if (!scheduled || resultKey(quizFile.quiz) === resultName(scheduled)) return quizFile
  return { ...quizFile, quiz: { ...quizFile.quiz, ...scheduleQuizMeta(scheduled) } }
}

/**
 * Send an upload's files, in order, once reviewed, reporting each. An admin's files go to their
 * scheduled quizzes' rooms, and any with none for the room the admin picks; an official's go for
 * the room they confirm or pick. A file sent as a scheduled quiz takes that quiz's name. Each name
 * the meet already has asks what to do, and that answer may be kept for the rest of the upload;
 * skipping one moves on, and one file failing doesn't stop the rest. Undefined when nothing was
 * sent, as when the user may no longer send to the meet.
 */
export async function sendPlanned(
  planned: PlannedFile[],
  dialog: Asker | null | undefined,
  sender: Sender | null,
  meetName: string,
  schedule: ScheduleDocument | null,
  send: Send,
): Promise<FileReport[] | undefined> {
  if (!sender || planned.length === 0) return undefined
  const byScheduledRoom =
    sender.admin && schedule !== null && planned.some((p) => p.scheduleQuizId !== null)
  // Files with no scheduled room, unmatched or matched to a quiz not placed in a room yet, go for a
  // room the user picks, as a whole unmatched upload does
  const roomOf = (p: PlannedFile) =>
    schedule && p.scheduleQuizId ? roomOfScheduled(schedule, p.scheduleQuizId) : null
  const sendable = planned.some((p) => p.quizFile !== null)
  const unmatched = planned.some((p) => p.quizFile !== null && roomOf(p) === null)
  const chosenRoom =
    sendable && (!byScheduledRoom || unmatched)
      ? await chooseRoom(dialog, sender, meetName, 'Upload')
      : null
  if (chosenRoom === undefined) return undefined
  // The answer kept for the rest of the upload, once the user asks to; undefined until then. The
  // question is put once, at the first quiz the meet already has
  let kept: OnExisting | null | undefined
  let askedForRest = false
  const reports: FileReport[] = []
  for (const [at, item] of planned.entries()) {
    if (!item.quizFile) {
      reports.push({ item, outcome: 'refused', message: item.refusal })
      continue
    }
    const decide = async (existing: ExistingQuiz) => {
      if (kept !== undefined) return kept
      const choice = await askAlreadySubmitted(dialog, existing)
      const remaining = planned.slice(at + 1).filter((p) => p.quizFile !== null).length
      if (!askedForRest && remaining > 0) {
        askedForRest = true
        if (await askSameForRest(dialog, remaining)) kept = choice
      }
      return choice
    }
    const id = item.scheduleQuizId ?? undefined
    const quizFile = id && schedule ? namedAsScheduled(item.quizFile, schedule, id) : item.quizFile
    const roomId = (byScheduledRoom ? roomOf(item) : null) ?? chosenRoom
    reports.push({
      item,
      ...(await sendOne(
        quizFile,
        (file, onExisting) => send(file, roomId, onExisting, id),
        decide,
      )),
    })
  }
  return reports
}

async function sendOne(
  quizFile: QuizFile,
  send: (quizFile: QuizFile, onExisting?: OnExisting) => Promise<Stored>,
  decide: (existing: ExistingQuiz) => Promise<OnExisting | null>,
): Promise<Sent> {
  try {
    return storedReport(await send(quizFile))
  } catch (e) {
    const existing = existingQuizOf(e)
    if (!existing) return failedReport(e)
    const choice = await decide(existing)
    if (!choice)
      return { outcome: 'skipped', message: `Skipped: ${existing.name} was already submitted` }
    try {
      return storedReport(await send(quizFile, choice))
    } catch (again) {
      return failedReport(again)
    }
  }
}

/** A file's report but the file */
type Sent = Omit<FileReport, 'item'>

function storedReport({ created, revision, keptCurrent, unchanged }: Stored): Sent {
  if (created) return { outcome: 'stored', message: 'Stored' }
  if (unchanged) return { outcome: 'unchanged', message: 'Unchanged' }
  if (keptCurrent) {
    const message = `Saved as revision ${revision}; the earlier revision stays current`
    return { outcome: 'keptCurrent', message }
  }
  return { outcome: 'revision', message: `Saved as revision ${revision}` }
}

/**
 * A send that failed: not sent, when a server error, a busy or signed-out session, no answer in
 * time, or a meet out of reach may pass, said in plain words rather than as the status the server
 * gave; otherwise refused, with the reason the API or the browser gives, which sending again won't
 * change
 */
function failedReport(e: unknown): Sent {
  // fetch fails with a TypeError when the meet can't be reached, and a timeout with its own error
  if (e instanceof TypeError) {
    // The connection may also have dropped after the meet stored it; sending again finds it unchanged
    const message = "The meet couldn't be reached, so this file may not have been saved"
    return { outcome: 'notSent', message }
  }
  if (e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
    // The meet may have stored it before the answer was lost; sending it again finds it unchanged
    const message = 'No answer came from the meet, so this file may not have been saved'
    return { outcome: 'notSent', message }
  }
  if (!(e instanceof ApiError) || isRefusal(e)) {
    return { outcome: 'refused', message: (e as Error).message }
  }
  if (e.status === 401) {
    return { outcome: 'notSent', message: "You were signed out, so this file wasn't saved" }
  }
  return { outcome: 'notSent', message: "The server was busy and this file wasn't saved" }
}
