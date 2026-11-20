# Contract: the meet day

## `GET /api/meets/:id/day`

For anyone who may read the meet: a member of any role, a guest with this meet's token, or a
superuser (`isViewerOf`). 401 without a session or token, 403 for anyone else.

```ts
interface MeetDay {
  phase: MeetPhase
  /** The published schedule's version these quizzes belong to; null with none published */
  scheduleVersion: number | null
  /** One per quiz of the published schedule, in its order */
  quizzes: DayQuiz[]
  /** Settled benches, `<quizId>:<benchIndex>` to the team's name; a bench the reader may not see yet is left out */
  benches: Record<string, { team: string } | { tied: true }>
  /**
   * Stored quizzes no scheduled quiz has, every one with no published schedule. Admins: all of them;
   * officials: their rooms'; everyone else: only those with a stage whose results they may see
   */
  notOnSchedule: DayResult[]
  /** Admins: how many things need attention, as GET /stats/attention lists them */
  attention?: number
}

/** A stored quiz's result as this reader may see it, the same cut a division's stats make */
interface DayTeam {
  /** As the stored quiz names the team */
  name: string
  place?: 1 | 2 | 3
  tiedWith?: number
  score?: number
}

interface DayQuiz {
  id: string // the schedule quiz id
  status: 'played' | 'attention' | 'underReview' | 'notCounted' | 'hidden' | 'notIn'
  /** The stored quiz's teams, named, in the stored quiz's order; empty when not in or hidden */
  teams: DayTeam[]
  /** Admins, and the official of the quiz's room */
  storedId?: number
  problems?: QuizProblem[]
}

interface DayResult {
  name: string // "D1 Q3"
  division: string
  stage: Stage | null
  status: 'played' | 'attention' | 'underReview'
  teams: DayTeam[]
  /** Admins, and the official of the quiz's room */
  storedId?: number
  problems?: QuizProblem[]
}
```

* What a reader gets follows `viewerHas` for each quiz's division and stage, through the same cut a
  division's stats make (`cutTo`), so it gives exactly what meet stats gives (spec FR-024): every
  scheduled quiz of a stage whose results the reader may not see yet is `hidden`, in or not, with no
  teams (in registration and build, every stage for anyone but an admin); one in error and not
  accepted is `underReview` with team names alone, or `attention` with its problems for admins and
  its room's official; one set not to count is `notCounted` with its team names for those two and
  `notIn` for anyone else; a second stored quiz on one scheduled quiz is listed in `notOnSchedule`;
  an official gets their own room's quizzes with status and problems whatever the stage; `score`
  only where the stage shows scores; a `rank` or `new` bench only once its order is confirmed and
  the reader has that table; a `place` or `points` bench only where the reader may see its source
  quiz's places.
* A result's teams are named as the stored quiz names them and in its order, which a quiz matched to
  the schedule by name may not share with the schedule's benches; the Schedule tab places each
  beside the bench holding that team, by folded name, and lists any team it can't bench under the
  quiz.
* 503 `{ error: "Stats are being prepared" }` with `Retry-After: 1` while revisions are still to be
  scored, as a division's stats. Each request scores a few more.
* A viewer's or coach's response may be served from a copy up to 20 seconds old; an admin's or an
  official's never is.
* With no published schedule: `scheduleVersion` null, `quizzes` and `benches` empty, and every
  stored quiz in `notOnSchedule`, cut to the reader as above, so a meet without a schedule still
  lists its quizzes on the Quizzes tab for everyone.

## Benches elsewhere

* `GET /schedule/published` is unchanged: benches carry their source only.
* The scoresheet, opening a scheduled quiz, reads `benches` from `GET /day` and fills each settled
  bench's team from the meet's roster by name, as it fills a drawn letter's team today.
* A stored quiz's `teamsDiffer` problem (meet stats) now also covers elimination and Finals quizzes
  whose benches are settled.

## Portal addresses

| Address                              | Shows                                      |
| ------------------------------------ | ------------------------------------------ |
| `/:slug`                             | Schedule tab                               |
| `/:slug/quizzes`                     | Quizzes tab                                |
| `/:slug/standings`                   | Standings tab                              |
| `/:slug/roster`                      | Roster tab (members)                       |
| `/:slug/setup`                       | Setup tab (admins)                         |
| any of these with `?division=<name>` | that division picked                       |
| `/:slug/schedule`                    | redirects to `/:slug`                      |
| `/:slug/results`                     | redirects to `/:slug/quizzes`              |
| `/:slug/stats`                       | redirects to `/:slug/standings`            |
| `/:slug/stats/:division`             | redirects to `/:slug/standings?division=…` |
| `/:slug/stats/settings`              | redirects to `/:slug/setup#stats`          |
| `/:slug/results/:resultId`           | the stored quiz's page, unchanged          |
| `/:slug/churches/:churchId/teams`    | a church's teams, unchanged                |
| `/:slug/schedule/edit`               | the schedule builder, unchanged            |

Guests (meet id as slug) reach Schedule, Quizzes and Standings; Roster and Setup redirect them to
Schedule. Today guests reach the results and stats pages but not the schedule page, though
`GET /schedule/published` already serves them; the Schedule tab opens it to them.
`/:slug/stats/settings` is matched before `/:slug/stats/:division`, as it is today.
