/**
 * What the specs of a scoresheet tied to a meet share: a small roster, a scheduled quiz, the
 * child dialogs stood in for, and ways to read and drive the sheet.
 */
import { defineComponent } from 'vue'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { PlacementFormula, type QuizFile } from '@qzr/shared'

import type { MeetTeam, MeetTeamQuizzer, ScheduledQuizDetails, StoredQuiz } from '../../api'
import Scoresheet from '../Scoresheet.vue'

export const MEET_ID = 3
export const MEET_NAME = 'Practice'

const team = (id: number, churchName: string, division: string): MeetTeam => ({
  id,
  churchId: id,
  churchName,
  churchShortName: churchName.slice(0, 3),
  division,
  number: 1,
  consolation: false,
})
export const calgary = team(1, 'Calgary', '1')
export const regina = team(2, 'Regina', '1')
export const saskatoon = team(3, 'Saskatoon', '1')
/** Division 2's Calgary is listed first, so only the quiz's division can prefer division 1's */
export const roster = [team(9, 'Calgary', '2'), calgary, regina, saskatoon]

const quizzer = (quizzerId: number, name: string): MeetTeamQuizzer => ({ quizzerId, name })
export const rosters: Record<number, MeetTeamQuizzer[]> = {
  1: [quizzer(11, 'Ann'), quizzer(12, 'Abe')],
  2: [quizzer(21, 'Ron'), quizzer(22, 'Rae')],
  3: [quizzer(31, 'Sam'), quizzer(32, 'Sue')],
  9: [quizzer(91, 'Cal')],
}

/** Quiz 7 of division 1: Calgary, Regina, and a third seat the schedule hasn't decided */
export function scheduledQuiz(
  seats: (MeetTeam | null)[] = [calgary, regina, null],
  quiz: Partial<ScheduledQuizDetails['quiz']> = {},
): ScheduledQuizDetails {
  return {
    quiz: {
      id: 'q7',
      meetName: MEET_NAME,
      label: 'Div 1 Quiz 7',
      division: '1',
      consolation: false,
      quizNumber: '7',
      ...quiz,
    },
    seats: seats.map((seated, i) => ({
      seatNumber: i + 1,
      letter: seated ? 'A' : null,
      seedRef: seated ? null : '1 of X',
      team: seated,
      quizzers: seated ? rosters[seated.id]! : [],
    })),
  }
}

/** A saved quiz: up to three teams by name, each with its quizzers, and answers by quizzer id */
export function quizFile(
  teams: [name: string, ...quizzers: string[]][],
  quiz: Partial<QuizFile['quiz']> = {},
  answers: QuizFile['answers'] = [],
): QuizFile {
  return {
    version: 2,
    quiz: {
      division: '1',
      quizNumber: '7',
      overtime: false,
      placementFormula: PlacementFormula.Rules,
      questionTypes: [],
      ...quiz,
    },
    // A whole sheet, as the scoresheet saves it: three teams of five seats, blank where not given
    teams: [0, 1, 2].map((t) => ({
      id: t + 1,
      name: teams[t]?.[0] ?? '',
      onTime: true,
      seatOrder: t,
      // The first seat of team t is quizzer (t + 1) * 10
      quizzers: [0, 1, 2, 3, 4].map((q) => ({
        id: (t + 1) * 10 + q,
        name: teams[t]?.[q + 1] ?? '',
        seatOrder: q,
      })),
    })),
    answers,
    noJumps: [],
  }
}

export const stored = (id: number, file: QuizFile, revision = 1): StoredQuiz => ({
  id,
  revision,
  savedAt: '2026-11-14T15:00:00.000Z',
  quizFile: file,
})

/** The test DOM has no modal dialogs */
export function stubDialogs() {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open')
  }
}

/** A picker stood in for: the spec plays the user picking, through the picker's own interface */
const picker = (name: string, props: string[], emits: string[] = []) =>
  defineComponent({
    name,
    props,
    emits,
    setup(_, { expose }) {
      expose({ open: () => {} })
      return () => null
    },
  })
export const SchedulePicker = picker('SchedulePickerDialog', ['title', 'onPick'])
export const StoredPicker = picker('StoredQuizPickerDialog', ['onPick'])
export const MeetPicker = picker('MeetPickerDialog', [], ['picked'])

const mounted: VueWrapper[] = []

/** Take down the sheets a spec mounted: one left up goes on answering the shared meet session */
export function unmountSheets() {
  for (const sheet of mounted.splice(0)) sheet.unmount()
  document.body.innerHTML = ''
}

export async function mountSheet() {
  const wrapper = mount(Scoresheet, {
    attachTo: document.body,
    global: {
      stubs: {
        SchedulePickerDialog: SchedulePicker,
        StoredQuizPickerDialog: StoredPicker,
        MeetPickerDialog: MeetPicker,
      },
    },
  })
  mounted.push(wrapper)
  await flushPromises()
  return wrapper
}

type Sheet = VueWrapper

/** What the scoresheet hands the schedule picker and the stored quiz picker to call on a pick */
export const schedulePick = (sheet: Sheet) =>
  sheet.findComponent(SchedulePicker).props('onPick') as (
    meetId: number,
    quizId: string,
  ) => Promise<boolean>
export const storedPick = (sheet: Sheet) =>
  sheet.findComponent(StoredPicker).props('onPick') as (
    meetId: number,
    meetName: string,
    quizFile: QuizFile,
  ) => Promise<boolean>

/** A button by its label, on the sheet or in a dialog, which is teleported out of it */
export const button = (_sheet: Sheet, label: string) =>
  [...document.querySelectorAll('button')]
    .map((element) => new DOMWrapper(element))
    .find((candidate) => candidate.text().includes(label))!

/** Everything on the page, dialogs included */
export const pageText = () => document.body.textContent ?? ''

/** Choose an item of one of the header's menus */
export async function menu(sheet: Sheet, opener: string, item: string) {
  await button(sheet, opener).trigger('click')
  await button(sheet, item).trigger('click')
  await flushPromises()
}

/**
 * Start picking a quiz in the schedule picker and leave it in flight, for a spec that looks at the
 * sheet while it waits. `done` settles when the pick has.
 */
export async function beginPick(sheet: Sheet, opener: string, item: string, quizId = 'q7') {
  await menu(sheet, opener, item)
  const done = schedulePick(sheet)(MEET_ID, quizId)
  await flushPromises()
  return { done }
}

/** Long enough for the sheet's debounced auto-save to have been written */
export const autoSaveWritten = () => new Promise((resolve) => setTimeout(resolve, 350))

/** Pick a quiz in the schedule picker, for whichever menu item opened it */
export async function pickScheduled(sheet: Sheet, opener: string, item: string, quizId = 'q7') {
  await menu(sheet, opener, item)
  const picked = schedulePick(sheet)(MEET_ID, quizId)
  await flushPromises()
  return picked
}

const values = (sheet: Sheet, selector: string) =>
  sheet.findAll<HTMLInputElement>(selector).map((input) => input.element.value)
export const teamNames = (sheet: Sheet) => values(sheet, 'input.editable-name--team')
/** Quizzer names by team, five seats each */
export function quizzerNames(sheet: Sheet): string[][] {
  const all = values(sheet, 'input.editable-name--quizzer')
  return [0, 1, 2].map((t) => all.slice(t * 5, t * 5 + 5))
}
export const typeTeam = (sheet: Sheet, slot: number, name: string) =>
  sheet.findAll('input.editable-name--team')[slot]!.setValue(name)
export const typeQuizzer = (sheet: Sheet, slot: number, seat: number, name: string) =>
  sheet.findAll('input.editable-name--quizzer')[slot * 5 + seat]!.setValue(name)

/** Division and quiz number, as the header's two boxes show them */
export function quizBoxes(sheet: Sheet) {
  const division = sheet.find<HTMLSelectElement>('.division-select').exists()
    ? sheet.find<HTMLSelectElement>('.division-select').element.value
    : values(sheet, 'label.meta-field input[type="text"]')[0]
  return { division, quizNumber: values(sheet, 'label.meta-field input[type="text"]').pop() }
}

export const linkedDisplay = (sheet: Sheet) => sheet.find('.meta-session-pill').text()
export const warnings = (sheet: Sheet) =>
  sheet.find('.meta-meet-warnings').exists()
    ? sheet.find('.meta-meet-warnings').attributes('title')!.split('\n')
    : []
export const waiting = () => document.querySelector('.waiting-dialog__text') !== null

/** A sheet restored from an auto-save: one with changes that a New or an Open would lose */
export function autoSaved(file: QuizFile) {
  localStorage.setItem('qzr-sheet:current', JSON.stringify(file))
  return mountSheet()
}

/** A promise the spec settles by hand, to hold a fetch open */
export function held<T>() {
  let arrive!: (value: T) => void
  const promise = new Promise<T>((resolve) => (arrive = resolve))
  return { promise, arrive }
}
