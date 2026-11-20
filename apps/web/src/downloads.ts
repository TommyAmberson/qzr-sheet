import { strToU8, zipSync } from 'fflate'
import {
  ApiError,
  fillOts,
  odsSupportsFormat,
  questionsPastSheet,
  quizFileStem,
  quizName,
  type QuizFile,
} from '@qzr/shared'
import { downloadTemplate } from './api'

/** Save bytes as a file through the browser's download */
export function saveFile(data: Uint8Array | string, fileName: string, type: string): void {
  const link = document.createElement('a')
  // fflate's and fetch's bytes are never shared memory, which is all the cast rules out
  link.href = URL.createObjectURL(new Blob([data as Uint8Array<ArrayBuffer> | string], { type }))
  link.download = fileName
  // Attached while clicked, and the file let go only once the browser has started saving it
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(link.href), 60_000)
}

/** The file a quiz downloads as: the app's own `.json`, or a filled scoring sheet */
export type QuizFormatChoice = 'json' | 'ods'

export const ODS_TYPE = 'application/vnd.oasis.opendocument.spreadsheet'

/**
 * What a spreadsheet of this quiz leaves out, as a download says it: the whole quiz when the sheet
 * can't hold its format, or the questions past its last column; null when it holds it all
 */
export function sheetNote(file: QuizFile): string | null {
  const name = quizName(file.quiz)
  if (!odsSupportsFormat(file.quiz.format)) {
    return `${name} left out: spreadsheets hold 20-question quizzes only`
  }
  const past = questionsPastSheet(file)
  return past.length === 0
    ? null
    : `${name}: questions ${past.join(', ')} are past the sheet and left out`
}

/**
 * The meet's template when `.ods` is asked for, refused with what to do when it has none;
 * nothing for `.json`
 */
export async function templateFor(
  meetId: number,
  format: QuizFormatChoice,
): Promise<Uint8Array | undefined> {
  if (format === 'json') return undefined
  try {
    return (await downloadTemplate(meetId)).bytes
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 404)) throw e
    throw new Error(
      "Spreadsheets need the meet's scoring template, which an admin uploads on the meet page. Quiz files (.json) download without it.",
    )
  }
}

/** One quiz's file in the chosen format; `.ods` fills the meet's template */
export function quizFileBytes(
  file: QuizFile,
  format: QuizFormatChoice,
  template?: Uint8Array,
): Uint8Array {
  if (format === 'json') return strToU8(JSON.stringify(file, null, 2))
  if (!template) throw new Error('The meet has no scoring template yet')
  return fillOts(template, file)
}

/**
 * A zip of quizzes, one file each, named as the scoresheet names its saves and kept unique. `.ods`
 * leaves out what the sheet can't hold, and `notes` says what. `zip` is null when there is nothing
 * to put in it.
 */
export function quizArchive(
  files: QuizFile[],
  format: QuizFormatChoice,
  template?: Uint8Array,
): { zip: Uint8Array | null; notes: string[] } {
  // A sheet is already a zip, so it is stored as it is rather than compressed again
  const entries: Record<string, [Uint8Array, { level: 0 | 6 }]> = {}
  const notes: string[] = []
  for (const file of files) {
    if (format === 'ods') {
      const note = sheetNote(file)
      if (note) notes.push(note)
      if (!odsSupportsFormat(file.quiz.format)) continue
    }
    const stem = quizFileStem(file.quiz)
    let name = `${stem}.${format}`
    for (let n = 2; name in entries; n++) name = `${stem} (${n}).${format}`
    entries[name] = [quizFileBytes(file, format, template), { level: format === 'ods' ? 0 : 6 }]
  }
  return { zip: Object.keys(entries).length > 0 ? zipSync(entries) : null, notes }
}
