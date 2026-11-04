import {
  createApiClient,
  scheduleQuizMeta,
  seatText,
  type DivisionTeamNames,
  type PublishedSchedule,
  type QuizFile,
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
): Promise<Stored> {
  return request(`/api/meets/${meetId}/results`, {
    method: 'POST',
    body: JSON.stringify({ quizFile, roomId: roomId ?? undefined, onExisting }),
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
}

/** The meet's newest published schedule; a 404 `ApiError` when nothing is published */
export function getPublishedSchedule(meetId: number): Promise<PublishedSchedule> {
  // The time zone places a schedule still in the old tables on the meet's days
  const timeZone = encodeURIComponent(browserTimeZone())
  return request(`/api/meets/${meetId}/schedule/published?timeZone=${timeZone}`)
}

/**
 * One quiz of the published schedule with its seats resolved: a prelim letter to the team the draw
 * gave it, when the schedule shows teams, with that team's roster. Other seats have no team until
 * the elims are filled in.
 */
export async function getScheduledQuiz(
  meetId: number,
  quizId: string,
): Promise<ScheduledQuizDetails> {
  const [{ document, meetName }, { teams }] = await Promise.all([
    getPublishedSchedule(meetId),
    getMeetTeams(meetId),
  ])
  const quiz = document.quizzes.find((q) => q.id === quizId)
  if (!quiz) throw new Error("This quiz isn't in the meet's published schedule")
  const draw = document.draw[quiz.division]?.teams ?? []
  const seats = await Promise.all(
    quiz.seats.map(async (seat, i): Promise<ScheduledQuizSeat> => {
      const teamId =
        seat.kind === 'letter' ? draw.find((t) => t.letter === seat.letter)?.teamId : undefined
      const team = teams.find((t) => t.id === teamId) ?? null
      return {
        seatNumber: i + 1,
        letter: seat.kind === 'letter' ? seat.letter : null,
        seedRef: seat.kind === 'letter' ? null : seatText(document, quiz, seat, 'letters'),
        team,
        quizzers: team ? (await getTeamQuizzers(meetId, team.id)).quizzers : [],
      }
    }),
  )
  return {
    quiz: { id: quiz.id, meetName, label: quiz.label, ...scheduleQuizMeta(quiz) },
    seats,
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
