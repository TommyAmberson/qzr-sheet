import { ref } from 'vue'
import { ApiError, MeetRole, type QuizFile } from '@qzr/shared'
import {
  existingQuizOf,
  guestStateRef,
  type ExistingQuiz,
  type OnExisting,
  type Sender,
} from '@qzr/ui'
import { getMyMeets, getSender, submitResult } from '../api'

/** A meet the user may submit to */
export interface SubmitTarget {
  meetId: number
  meetName: string
}

/** What happened to a submission: stored, or not, because the meet already has its name */
export type SubmitOutcome =
  | { stored: true; created: boolean; revision: number; keptCurrent: boolean }
  | { stored: false; existing: ExistingQuiz }

/** The meet roles that may send quizzes to a meet */
const SENDING_ROLES: string[] = [MeetRole.Admin, MeetRole.Official, MeetRole.Superuser]

/** Whether a meet role may send quizzes to its meet; the API still decides on each submission */
export function maySend(role: string): boolean {
  return SENDING_ROLES.includes(role)
}
const LAST_MEET_KEY = 'qzr-submit-meet'

const targets = ref<SubmitTarget[]>([])
/** The signed-in account's meets, as last known */
let accountMeets: SubmitTarget[] = []
let refreshes = 0

/**
 * Whether the user may send quizzes to the meet, and for which rooms, as the API works it out.
 * Null when they may not (signed out with no code for it, or neither an admin nor an official of
 * it); undefined when there's no telling (offline, or the server failed).
 */
export async function senderOf(meetId: number): Promise<Sender | null | undefined> {
  try {
    return await getSender(meetId)
  } catch (e) {
    return e instanceof ApiError && (e.status === 401 || e.status === 403) ? null : undefined
  }
}

/**
 * Work out the meets the user may submit to: those joined with an official's code, and a signed-in
 * account's meets as an admin, official or superuser. The API still decides on each submission;
 * this only decides whether to offer Submit, and where.
 */
async function refreshTargets(): Promise<void> {
  const run = ++refreshes
  let account = accountMeets
  try {
    const { memberships } = await getMyMeets()
    account = memberships
      .filter(({ role }) => maySend(role))
      .map(({ meetId, meetName }) => ({ meetId, meetName }))
  } catch (e) {
    // Signed out, there are none; otherwise there's no telling, so keep what's known
    if (e instanceof ApiError && e.status === 401) account = []
  }
  // A slower, older refresh mustn't overwrite a newer one
  if (run !== refreshes) return
  accountMeets = account
  const list: SubmitTarget[] = guestStateRef.value.joined
    .filter((joined) => joined.role === MeetRole.Official)
    .map(({ meetId, meetName }) => ({ meetId, meetName }))
  for (const meet of account) {
    if (!list.some((t) => t.meetId === meet.meetId)) list.push(meet)
  }
  targets.value = list
}

/**
 * Send the quiz to the meet, which knows it by its name (division and quiz number), for a room or
 * (an admin) none. A name the meet already has comes back with what's stored, unless sent again
 * saying what to do with it.
 */
async function submitQuiz(
  meetId: number,
  quizFile: QuizFile,
  roomId: number | null,
  onExisting?: OnExisting,
): Promise<SubmitOutcome> {
  try {
    const { created, revision, keptCurrent } = await submitResult(
      meetId,
      quizFile,
      roomId,
      onExisting,
    )
    return { stored: true, created, revision, keptCurrent: keptCurrent ?? false }
  } catch (e) {
    const existing = existingQuizOf(e)
    if (!existing) throw e
    return { stored: false, existing }
  }
}

/** The meet last submitted to: offered first next time, and the source of team names (Story 6) */
const lastMeetId = ref<number | null>(storedLastMeet())

function storedLastMeet(): number | null {
  try {
    const stored = Number(localStorage.getItem(LAST_MEET_KEY))
    return stored > 0 ? stored : null
  } catch {
    return null
  }
}

function rememberMeet(meetId: number): void {
  lastMeetId.value = meetId
  try {
    localStorage.setItem(LAST_MEET_KEY, String(meetId))
  } catch {
    // Storage unavailable: the meet is remembered until the page closes
  }
}

/**
 * Submitting the sheet to a meet, which needn't be linked: the sheet's teams come from a meet only
 * when the user loads them, and a practice meet may have none.
 */
export function useSubmitToMeet() {
  return { targets, refreshTargets, submitQuiz, lastMeetId, rememberMeet }
}
