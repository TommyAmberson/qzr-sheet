import { inject, type ComputedRef, type InjectionKey, type Ref, type ShallowRef } from 'vue'
import type { MeetDay, ScheduleDocument, SheetView } from '@qzr/shared'
import type { Sender } from '@qzr/ui'
import type { MeetDetail } from './api'

/** The meet's published schedule as the page holds it */
export interface PublishedOnPage {
  document: ScheduleDocument
  view: SheetView
}

/** The tabs of a meet's page, by route name, in the order the tab bar shows them */
export const MEET_TABS = [
  { name: 'meet', label: 'Schedule', guests: true },
  { name: 'meet-quizzes', label: 'Quizzes', guests: true },
  { name: 'meet-standings', label: 'Standings', guests: true },
  { name: 'meet-roster', label: 'Roster', guests: false },
  { name: 'meet-setup', label: 'Setup', guests: false },
] as const

export type MeetTabName = (typeof MEET_TABS)[number]['name']

/**
 * What the meet page shares with its tabs (specs/010-meet-day): the meet, who the reader is in it,
 * the division picked, and the meet day kept current while the page is open. A tab re-reads its
 * own data when `beat` moves, so every tab refreshes together.
 */
export interface MeetPage {
  slug: Ref<string>
  /** The meet with its rooms' codes, as `GET /meets/:slug` answers; the tabs share this one copy */
  detail: Ref<MeetDetail | null>
  meet: ComputedRef<MeetDetail['meet'] | null>
  /** Who may send quizzes to the meet: its admins and its rooms' officials; null for anyone else */
  sender: Ref<Sender | null>
  isAdmin: ComputedRef<boolean>
  /** Admins and the meet's officials score its quizzes, so a quiz not in yet opens the scoresheet */
  scores: ComputedRef<boolean>
  /** A superuser, who alone removes the meet's admins */
  isSuperuser: Ref<boolean>
  /** The churches the reader coaches at this meet */
  coachChurchIds: Ref<Set<number>>
  /** The division picked, as the meet spells it; null for every division (FR-004) */
  division: ComputedRef<string | null>
  /** Whether a division name, as anything spells it, is the one picked; any is, with none picked */
  inDivision: (name: string) => boolean
  /** Pick a division for every tab, or every division with null */
  setDivision: (name: string | null) => Promise<unknown>
  /**
   * The published schedule, read once and again when the meet day names a newer version; null
   * with none published, undefined while it is first read
   */
  published: ShallowRef<PublishedOnPage | null | undefined>
  day: ShallowRef<MeetDay | null>
  beat: Ref<number>
  /** Read the meet day again, moving the beat */
  refresh: () => Promise<void>
  /** Read the meet itself again, after a tab changed it (its phase, its details) */
  reloadMeet: () => Promise<void>
  /** The scoresheet, opened on a scheduled quiz of the meet */
  scoresheetHref: (scheduleQuizId: string) => string
}

export const meetPageKey: InjectionKey<MeetPage> = Symbol('meetPage')

/** The meet page a tab sits in */
export function useMeetPage(): MeetPage {
  const page = inject(meetPageKey)
  if (!page) throw new Error('A meet tab must sit in the meet page')
  return page
}
