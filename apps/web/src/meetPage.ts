import { inject, type ComputedRef, type InjectionKey, type Ref, type ShallowRef } from 'vue'
import type { MeetDay, ScheduleDocument, SheetView } from '@qzr/shared'
import type { Sender } from '@qzr/ui'
import type { MeetDetail } from './api'
import type { DayRead } from './composables/useMeetDay'

/** The meet's published schedule as the page holds it */
export interface PublishedOnPage {
  document: ScheduleDocument
  view: SheetView
}

/**
 * The tabs of a meet's page, by route name, in the order the tab bar shows them; which a guest may
 * open is the route's `guestAccess`
 */
export const MEET_TABS = [
  { name: 'meet', label: 'Schedule' },
  { name: 'meet-quizzes', label: 'Quizzes' },
  { name: 'meet-standings', label: 'Standings' },
  { name: 'meet-roster', label: 'Roster' },
  { name: 'meet-setup', label: 'Setup' },
] as const

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
  /**
   * Admins and the meet's officials score and manage its quizzes, so a quiz not in yet opens the
   * scoresheet, and the stored quizzes behind the Quizzes list are theirs to read
   */
  scores: ComputedRef<boolean>
  /** A viewer or coach before the meet is under way, who sees nothing of results yet (FR-002) */
  statsHidden: ComputedRef<boolean>
  /** A superuser, who alone removes the meet's admins */
  isSuperuser: Ref<boolean>
  /** The churches the reader coaches at this meet */
  coachChurchIds: Ref<Set<number>>
  /** The division picked, as the meet spells it; null for every division (FR-004) */
  division: ComputedRef<string | null>
  /** Whether a division name, as anything spells it, is the one picked; any is, with none picked */
  inDivision: (name: string) => boolean
  /** Whether a schedule quiz's division, by the schedule's id for it, is the one picked */
  inScheduleDivision: (divisionId: string) => boolean
  /** Pick a division for every tab, or every division with null */
  setDivision: (name: string | null) => Promise<unknown>
  /**
   * The published schedule, read for each version and phase the meet day names; null with none
   * published, undefined until it is first read
   */
  published: ShallowRef<PublishedOnPage | null | undefined>
  day: ShallowRef<MeetDay | null>
  /** Why the meet day couldn't be read; shown under the tab bar */
  dayError: Ref<string>
  beat: Ref<number>
  /**
   * Read the meet day again: the reader's Refresh by default, which moves the beat; `catchUp` after
   * the reader's own change in a tab, which re-reads what it shows itself (research R7, rule 2)
   */
  refresh: (why?: DayRead) => Promise<void>
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
