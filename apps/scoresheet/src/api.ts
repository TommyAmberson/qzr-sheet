import {
  ApiError,
  createApiClient,
  createFileClient,
  scheduleQuizMeta,
  benchKey,
  drawnTeam,
  seatText,
  type DivisionTeamNames,
  type MeetDay,
  type PublishedSchedule,
  type ScheduleQuiz,
  type SettledBench,
  type QuizFile,
  type StatsSettings,
} from '@qzr/shared'

export type { PublishedSchedule }
import {
  browserTimeZone,
  withGuestToken,
  type GuestJoinAnswer,
  type OnExisting,
  type Sender,
  type Stored,
} from '@qzr/ui'

declare const __API_URL__: string

/** Requests carry the guest token of the meet they're for (see `withGuestToken`) */
const baseRequest = createApiClient(__API_URL__ || '')
const request = withGuestToken(baseRequest, joinMeetGuest)
/** The same, for files: answers with the response, whose bytes the caller reads */
const fileRequest = withGuestToken(createFileClient(__API_URL__ || ''), joinMeetGuest)

/**
 * The meet's scoring template, for exporting to .ods; null when the meet has none, or the meet
 * can't be reached, so the official picks one instead
 */
export async function getMeetTemplate(meetId: number): Promise<Uint8Array | null> {
  try {
    // A slow network gives up soon, so the official gets the picker rather than a wait
    const res = await fileRequest<Response>(`/api/meets/${meetId}/template`, {
      signal: AbortSignal.timeout(5000),
    })
    return new Uint8Array(await res.arrayBuffer())
  } catch {
    return null
  }
}

// ---- Types ----

export interface MeetSummary {
  meetId: number
  meetName: string
  role: string
  /** What the membership is for: an official's room name, a coach's church */
  label?: string
  /** A signed-in official's room in the meet */
  roomId?: number
}

export interface MeetTeam {
  id: number
  churchId: number
  churchName: string
  churchShortName: string
  division: string
  number: number
  consolation: boolean
}

export interface MeetTeamQuizzer {
  quizzerId: number
  name: string
}

// ---- API calls ----

export function getMyMeets(): Promise<{ memberships: MeetSummary[] }> {
  return request('/api/my-meets')
}

/** Submit the sheet to the meet, which knows it by name, for a room or (an admin) none */
export function submitResult(
  meetId: number,
  quizFile: QuizFile,
  roomId: number | null,
  onExisting?: OnExisting,
  /** The scheduled quiz the sheet is linked to, which the meet links the stored quiz to */
  scheduleQuizId?: string | null,
): Promise<Stored> {
  return request(`/api/meets/${meetId}/results`, {
    method: 'POST',
    body: JSON.stringify({
      quizFile,
      roomId: roomId ?? undefined,
      onExisting,
      scheduleQuizId: scheduleQuizId ?? undefined,
    }),
  })
}

/** One revision of a stored quiz's file; a restoring revision gives the file it restores */
export function getRevision(
  meetId: number,
  resultId: number,
  revision: number,
): Promise<{ quizFile: QuizFile }> {
  return request(`/api/meets/${meetId}/results/${resultId}/revisions/${revision}`)
}

/** What a meet's refusal of its stored quizzes means, said once for every place that asks */
export const STORED_QUIZZES_REFUSED =
  "Only the meet's admins, and the officials of the rooms that sent them, can open its stored quizzes."

/** A quiz the meet holds, as the scoresheet lists it: its current version's file */
export interface StoredQuiz {
  id: number
  /** The number of its newest revision, which is the current one */
  revision: number
  savedAt: string
  quizFile: QuizFile
}

/**
 * The meet's stored quizzes that the user may see: all of them for an admin, their rooms' for an
 * official. A 403 `ApiError` for anyone else, which is the server's rule to make, not the sheet's.
 */
export function getStoredQuizzes(meetId: number): Promise<StoredQuiz[]> {
  return request(`/api/meets/${meetId}/results`)
}

/** One saved version of a stored quiz */
export interface StoredQuizVersion {
  revision: number
  savedAt: string
  savedBy: { name: string }
  /** Whether it shows the same file as the current version */
  current: boolean
  quizFile: QuizFile
}

/** A stored quiz's versions, newest first. Its history also lists counting changes, left out here */
export async function getStoredQuizVersions(
  meetId: number,
  resultId: number,
): Promise<StoredQuizVersion[]> {
  const history: ({ kind: string } & StoredQuizVersion)[] = await request(
    `/api/meets/${meetId}/results/${resultId}/revisions`,
  )
  return history.filter((entry) => entry.kind === 'revision')
}

export function getTeamNames(meetId: number): Promise<DivisionTeamNames[]> {
  return request(`/api/meets/${meetId}/team-names`)
}

/** A meet's name, for linking the sheet to it */
export function getMeetName(meetId: number): Promise<{ meet: { name: string } }> {
  return request(`/api/meets/${meetId}`)
}

/** Who the user is when sending to the meet, as the API works it out; 401 or 403 when no one */
export function getSender(meetId: number): Promise<Sender> {
  return request(`/api/meets/${meetId}/results/sender`)
}

/** The meet's stats settings, of which the sheet takes how teams level in a quiz are scored */
export function getStatsSettings(meetId: number): Promise<{ settings: StatsSettings }> {
  return request(`/api/meets/${meetId}/stats/settings`, undefined, meetId)
}

export function getMeetTeams(
  meetId: number,
): Promise<{ teams: MeetTeam[]; meetDivisions: string[] }> {
  return request(`/api/meets/${meetId}/teams`)
}

export function getTeamQuizzers(
  meetId: number,
  teamId: number,
): Promise<{ quizzers: MeetTeamQuizzer[] }> {
  return request(`/api/teams/${teamId}/quizzers`, undefined, meetId)
}

/** A schedule quiz as the scoresheet loads it: the fields that name its results (research R10) */
export interface ScheduledQuizSummary {
  id: string
  /** The meet's name, shown when the scoresheet wasn't on this meet yet */
  meetName: string
  label: string
  division: string
  consolation: boolean
  quizNumber: string
  /** The meet's room the schedule places the quiz in, when it places it in one */
  roomId?: number
}

export interface ScheduledQuizSeat {
  seatNumber: number
  letter: string | null
  /** A seat that isn't a prelim letter, as the schedule shows it: `1 of X`, `2nd in pts` */
  seedRef: string | null
  team: MeetTeam | null
  quizzers: MeetTeamQuizzer[]
}

export interface ScheduledQuizDetails {
  quiz: ScheduledQuizSummary
  seats: ScheduledQuizSeat[]
  /** False when the quiz has benches the meet may have settled and the meet day couldn't be read */
  benchesRead?: boolean
}

/** The meet's newest published schedule; a 404 `ApiError` when nothing is published */
export function getPublishedSchedule(meetId: number): Promise<PublishedSchedule> {
  // The time zone places a schedule still in the old tables on the meet's days
  const timeZone = encodeURIComponent(browserTimeZone())
  return request(`/api/meets/${meetId}/schedule/published?timeZone=${timeZone}`)
}

/** A bench the meet fills from orders and results: not a letter, which the draw fills, nor an empty seat */
function settles(seat: ScheduleQuiz['seats'][number]): boolean {
  return seat.kind !== 'letter' && seat.kind !== 'empty'
}

/**
 * The benches the meet has settled on a team, from the meet day; null when it can't be had in a few
 * seconds. The API may be preparing the day just after a quiz is stored, so that answer is asked
 * again while time allows
 */
async function settledBenches(meetId: number): Promise<Record<string, SettledBench> | null> {
  const signal = AbortSignal.timeout(6000)
  for (;;) {
    try {
      return (await request<MeetDay>(`/api/meets/${meetId}/day?fresh`, { signal })).benches
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 503 || signal.aborted) return null
      // A second's wait, cut short when the time runs out
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(wait)
          signal.removeEventListener('abort', done)
          resolve()
        }
        const wait = setTimeout(done, 1000)
        signal.addEventListener('abort', done, { once: true })
      })
    }
  }
}

/**
 * One quiz of the published schedule with its seats resolved: a prelim letter to the team the draw
 * gave it, when the schedule shows teams, and any other bench to the team the meet has settled on
 * it from confirmed orders and counted quizzes (specs/010-meet-day FR-023), each with that team's
 * roster unless `rosters` is false. Null when the published schedule has no such quiz, or there is
 * no published schedule. A `schedule` already fetched is used rather than fetched again.
 */
export async function getScheduledQuiz(
  meetId: number,
  quizId: string,
  { schedule, rosters = true }: { schedule?: PublishedSchedule; rosters?: boolean } = {},
): Promise<ScheduledQuizDetails | null> {
  // With the schedule in hand, the meet day is asked for alongside the teams
  const early = schedule?.document.quizzes.find((q) => q.id === quizId)?.seats.some(settles)
    ? settledBenches(meetId)
    : undefined
  // Only the schedule's 404 means there is none; any other refusal is the meet's to report
  const [published, { teams }] = await Promise.all([
    schedule ??
      getPublishedSchedule(meetId).catch((e) => {
        if (e instanceof ApiError && e.status === 404) return null
        throw e
      }),
    getMeetTeams(meetId),
  ])
  if (!published) return null
  const { document, meetName } = published
  const quiz = document.quizzes.find((q) => q.id === quizId)
  if (!quiz) return null
  const read = early ? await early : quiz.seats.some(settles) ? await settledBenches(meetId) : {}
  // Out of reach, the quiz opens as it would with no network (principle I)
  const settled = read ?? {}
  // The meet names each settled team by its id, from the draw or the division's roster
  const settledTeamId = (i: number) => {
    const bench = settled[benchKey(quiz.id, i)]
    return bench && 'team' in bench ? bench.teamId : undefined
  }
  const seats = await Promise.all(
    quiz.seats.map(async (seat, i): Promise<ScheduledQuizSeat> => {
      const teamId = settles(seat) ? settledTeamId(i) : drawnTeam(document, quiz, seat)?.teamId
      const team = teams.find((t) => t.id === teamId) ?? null
      return {
        seatNumber: i + 1,
        letter: seat.kind === 'letter' ? seat.letter : null,
        seedRef: seat.kind === 'letter' ? null : seatText(document, quiz, seat, 'letters'),
        team,
        quizzers: team && rosters ? (await getTeamQuizzers(meetId, team.id)).quizzers : [],
      }
    }),
  )
  const roomId = document.rooms.find((room) => room.id === quiz.cell?.room)?.meetRoomId
  return {
    quiz: { id: quiz.id, meetName, label: quiz.label, ...scheduleQuizMeta(quiz), roomId },
    seats,
    benchesRead: read !== null,
  }
}

export function joinMeet(
  code: string,
): Promise<{ meet: { id: number; name: string }; role: string; label?: string }> {
  return request('/api/join', { method: 'POST', body: JSON.stringify({ code }) })
}

/**
 * Guest join: a 24h JWT plus the resolved meet identity. Without a guest token, since renewing a
 * session joins through here.
 */
export function joinMeetGuest(code: string): Promise<GuestJoinAnswer> {
  return baseRequest('/api/join/guest', { method: 'POST', body: JSON.stringify({ code }) })
}
