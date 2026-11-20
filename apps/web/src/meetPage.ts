import { inject, type ComputedRef, type InjectionKey, type Ref, type ShallowRef } from 'vue'
import type { MeetDay } from '@qzr/shared'
import type { Sender } from '@qzr/ui'
import type { MeetDetail } from './api'

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
  meet: Ref<MeetDetail['meet'] | null>
  /** Who may send quizzes to the meet: its admins and its rooms' officials; null for anyone else */
  sender: Ref<Sender | null>
  isAdmin: ComputedRef<boolean>
  /** Signed out, reading the meet with a guest code (the slug is then the meet's id) */
  isGuest: ComputedRef<boolean>
  /** The division picked, as the meet spells it; null for every division (FR-004) */
  division: ComputedRef<string | null>
  day: ShallowRef<MeetDay | null>
  dayError: Ref<string>
  beat: Ref<number>
  refresh: () => Promise<void>
}

export const meetPageKey: InjectionKey<MeetPage> = Symbol('meetPage')

/** The meet page a tab sits in */
export function useMeetPage(): MeetPage {
  const page = inject(meetPageKey)
  if (!page) throw new Error('A meet tab must sit in the meet page')
  return page
}
