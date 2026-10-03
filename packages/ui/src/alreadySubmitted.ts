import { ApiError, type QuizFile } from '@qzr/shared'

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
}

/**
 * The "already submitted" question, worded the same wherever a quiz is sent: don't send it, save it
 * keeping the current revision, or save it as the new current revision
 */
export function alreadySubmittedQuestion({ name, revision, savedBy }: ExistingQuiz) {
  return {
    title: `${name} was already submitted`,
    detail: `Revision ${revision} is current${savedBy ? `, saved by ${savedBy.name}` : ''}.`,
    choices: [
      { label: "Don't submit", value: null },
      { label: `Save, keep revision ${revision} current`, value: 'keepCurrent' as OnExisting },
      { label: 'Save as new revision', value: 'newRevision' as OnExisting, primary: true },
    ],
  }
}

/** The quiz the meet already has, when a send was refused for that reason */
export function existingQuizOf(e: unknown): ExistingQuiz | undefined {
  if (!(e instanceof ApiError) || e.status !== 409) return undefined
  return (e.body as { existing?: ExistingQuiz } | undefined)?.existing
}

/** What happened to one file */
export interface FileReport {
  file: string
  stored: boolean
  message: string
}

/**
 * Send saved quiz files to a meet one at a time, in the order given. Each name the meet already has
 * asks what to do, and skipping one moves on to the next; one file failing doesn't stop the rest.
 */
export async function sendQuizFiles(
  files: File[],
  send: (quizFile: QuizFile, onExisting?: OnExisting) => Promise<Stored>,
  ask: (existing: ExistingQuiz) => Promise<OnExisting | null>,
): Promise<FileReport[]> {
  const reports: FileReport[] = []
  for (const file of files) {
    reports.push({ file: file.name, ...(await sendOne(file, send, ask)) })
  }
  return reports
}

async function sendOne(
  file: File,
  send: (quizFile: QuizFile, onExisting?: OnExisting) => Promise<Stored>,
  ask: (existing: ExistingQuiz) => Promise<OnExisting | null>,
): Promise<Omit<FileReport, 'file'>> {
  let quizFile: QuizFile
  try {
    quizFile = JSON.parse(await file.text()) as QuizFile
  } catch {
    return { stored: false, message: 'Not a quiz file' }
  }
  try {
    return { stored: true, message: storedMessage(await send(quizFile)) }
  } catch (e) {
    const existing = existingQuizOf(e)
    if (!existing) return { stored: false, message: (e as Error).message }
    const choice = await ask(existing)
    if (!choice)
      return { stored: false, message: `Skipped: ${existing.name} was already submitted` }
    try {
      return { stored: true, message: storedMessage(await send(quizFile, choice)) }
    } catch (again) {
      return { stored: false, message: (again as Error).message }
    }
  }
}

function storedMessage({ created, revision, keptCurrent }: Stored): string {
  if (created) return 'Stored'
  if (keptCurrent) return `Saved as revision ${revision}; the earlier revision stays current`
  return `Saved as revision ${revision}`
}
