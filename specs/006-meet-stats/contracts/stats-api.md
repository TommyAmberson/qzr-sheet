# Contract: meet stats API

HTTP routes under `/api/meets/:meetId`, JSON bodies, errors as `{ error: string }` like the existing
routes. Every route authorises the caller for that meet (principle IV). **Admin** means a meet admin
membership or superuser. **Member** means anyone `isViewerOf` admits: a membership of any role, a
guest token for this meet, or superuser. A stored quiz's **room official** is as in the
[results contract](../../003-practice-meet-results/contracts/results-api.md).

The stats routes are mounted so that guest tokens reach them, as the results routes are. Writes
follow the meet's phase as the results routes do today: allowed while the meet is `live`, by admins
alone in `review`, refused with 409 and `meetPhase` otherwise. Types named here are exported from
`packages/shared` so the portal reads exactly what the API sends.

## Reading stats

### `GET /stats` (member)

What there is to open. `{ phase, divisions: [{ division, state }] }`, divisions in the meet's order,
plus any division name that only stored quizzes carry. 200 with an empty list while the meet is in
`registration` or `build`, for anyone but an admin.

### `GET /stats/:division` (member)

One division's stats, cut down to what this caller may see (FR-017 to FR-021). The API computes it
on each request from the division's scored revisions (R1, R2) and removes what the caller may not
have before answering; it never sends something for the page to hide.

```ts
interface DivisionStats {
  division: string
  state: DivisionStateValue
  phase: MeetPhase
  /** One entry for each stage that has begun and that the caller may see; newest stage first */
  results: StageResults[]
  /** Absent when the caller may not see them yet */
  prelimStandings?: TeamTable
  rerank?: TeamTable
  quizzers?: QuizzerTable
  /** Admins only */
  warnings?: StatsWarning[]
}

interface StageResults {
  stage: 'prelim' | 'intermediate' | 'elimination' | 'finals'
  /** How much each quiz below carries */
  level: 'places' | 'scores'
  quizzes: QuizResult[]
  /** The Finals stage only, once a bracket has one decided Finals: its first three, per bracket */
  medals?: { consolation: boolean; teams: [string, string, string] }[]
}

interface QuizResult {
  name: string // "D1 Q3"
  /** `underReview` carries team names only: no places, no scores */
  status: 'counted' | 'accepted' | 'underReview'
  teams: { name: string; place?: 1 | 2 | 3; tiedWith?: number; score?: number }[]
  /** Admins, and the quiz's room officials: the stored quiz's id, and what is wrong with it */
  id?: number
  problems?: QuizProblem[]
  /** A quizzer's correct answers by type don't add up (FR-007); not an error */
  incompleteTypes?: true
}

interface TeamTable {
  state: 'livePreview' | 'lockedIn'
  /** With `livePreview`: how many of the stage's quizzes it covers */
  covers?: { counted: number; scheduled: number | null }
  teams: {
    name: string
    rank: number
    placementPoints: number
    quizzes: number
    tied: boolean
    decidedBy: 'headToHead' | 'points' | 'errors' | null
    /** Only where prelims lead straight to a Finals (FR-011) */
    finalist?: boolean
    /** The quizzes behind the totals (FR-027) */
    lines: { quiz: string; stage: string; place: number | null; score: number; placementPoints: number | null; errors: number }[]
  }[]
  /** Admins only: the current order, when it no longer matches the confirmed one */
  current?: TeamTable['teams']
  confirmed?: { by: string; at: string }
}

interface QuizzerTable {
  state: 'livePreview' | 'preview' | 'lockedIn'
  /** The last stage it covers; with `preview` by stage, the last confirmed step */
  through: 'prelim' | 'intermediate' | 'elimination'
  /** The division's main list, then its consolation list where there is one */
  lists: {
    consolation: boolean
    quizzers: {
      name: string
      team: string
      place: number
      /** Exact; the page shows two decimals (FR-004) */
      average: number
      points: number
      errors: number
      jumps: number
      quizzes: number
      /** Correct answers by question type */
      types: Record<string, number>
      lines: { quiz: string; points: number; errors: number; jumps: number; types: Record<string, number> }[]
      /** Admins only */
      flags?: QuizzerFlag[]
    }[]
  }[]
}
```

* A viewer, coach or official gets a table only from its moment on, and results at the level the
  settings give (R11). An admin gets every table that exists, results at `scores`, and `warnings`.
* An official additionally gets `id` and `problems` on quizzes of their own rooms (FR-020a).
* A quiz that is not counted is never listed. A quiz with a stage that is in error and not accepted
  is listed as `underReview`.
* 503 `{ error: "Stats are being prepared" }` with `Retry-After: 1` while some of the division's
  revisions are still to be scored (R2); each request scores a few more, so a retry gets further.
* 404 for a division with no stored quiz and not among the meet's divisions. 403 for a non-member.
  200 with no tables, for anyone but an admin, while the meet is in `registration` or `build`.

### `GET /stats/attention` (admin)

Everything that needs attention across the meet (FR-030), each item naming what it is about and what
would clear it. Built from the meet's scored revisions and its names, with no ranking, so one
request covers every division; 503 with `Retry-After: 1`, as a division's stats, while some
revisions are still to be scored (R2).

```ts
/** A stored quiz, as a warning or a list names it */
interface QuizRef {
  id: number
  name: string
}

type AttentionItem =
  | { kind: 'noStage'; quiz: QuizRef; suggestedLink?: { scheduleQuizId: string; label: string } }
  | { kind: 'inError'; quiz: QuizRef; problems: QuizProblem[] }
  | { kind: 'unequalPrelims'; division: string; teams: { name: string; quizzes: number }[] }
  | { kind: 'finalTie'; division: string; teams: string[] }
  | { kind: 'lookAlikeTeams'; division: string; names: [string, string] }
  | { kind: 'lookAlikeQuizzers'; division: string; team: string; names: [string, string] }
  | { kind: 'quizzerCount'; division: string; team: string; quizzer: string; listed: number; teamQuizzes: number }
  | { kind: 'incompleteTypes'; quiz: QuizRef }
  | { kind: 'twoFinals'; division: string; consolation: boolean; quizzes: QuizRef[] }
  | { kind: 'withdrawnOrder'; quiz: QuizRef }
  | { kind: 'otherFormula'; quizzes: QuizRef[] }

type QuizProblem =
  // Scoring errors: known from the quiz alone
  | { kind: 'validation'; team: string; quizzer: string | null; question: string | null; code: ValidationCode }
  | { kind: 'unanswered'; questions: string[] }
  // Roster errors: names held against the roster of the quiz's division
  | { kind: 'teamNotOnRoster'; team: string; near?: string }
  | { kind: 'quizzerNotOnRoster'; team: string; quizzer: string; near?: string }
  | { kind: 'quizzerMissing'; team: string; quizzer: string }
  | { kind: 'tooManyQuizzers'; team: string; listed: number; roster: number }
  // Schedule errors: the quiz held against the scheduled quiz it is linked to
  | { kind: 'nameDiffers'; scheduled: string }
  | { kind: 'teamsDiffer'; scheduled: string[] }
  // The quiz's overtime doesn't fit its stage
  | { kind: 'overtimePlayed' } // in a prelim or an intermediate, where a tie stands
  | { kind: 'tieLeftStanding' } // an elimination or Finals level with no overtime
```

Every `QuizProblem` puts the quiz in error (FR-014). `team` is empty for a team left unnamed; `near`
is the roster name the typed one is closest to. `validation` carries the shared `ValidationCode`,
whose message `validationMessage` gives, with `quizzer` and `question` null for an error that
belongs to a team as a whole. Scoring errors come from the quiz's scored row; roster and schedule
errors are worked out when read, from the roster and schedule as they then stand (R16).

`StatsWarning` on a division's stats is the subset of these about that division's tables.

## Settings

### `GET /stats/settings` (member)

`{ settings: StatsSettings, changed?: { by: string; at: string } }`. `changed` is for admins. Every
member may read the settings: a scoresheet working with the meet needs the way level teams are
scored (FR-023b), and they hold nothing private.

### `PUT /stats/settings` (admin)

Body: `{ settings: StatsSettings }`, the whole document. 200 with the same shape as the read. 400 if
the document is invalid, including a stage's results set to start before the stage. 409 with
`meetPhase` once the meet is `done` (FR-022).

## Stored quizzes

Changes to the [results routes](../../003-practice-meet-results/contracts/results-api.md).

### `POST /results` (official, or admin), changed

Body gains `scheduleQuizId?: string`: the scheduled quiz the sheet is linked to. With it, the stored
quiz is linked to that scheduled quiz, recorded as sent by the scoresheet. Without it, a quiz is
linked when it matches a scheduled quiz on its name and team names (R4). Responses gain
`link: { scheduleQuizId: string; how: 'sheet' | 'matched' | 'hand' } | null`.

* 400 if `scheduleQuizId` is not a quiz of the meet's published schedule.
* A scheduled quiz already linked to another stored quiz does not refuse the submission: the quiz is
  stored unlinked and `link` is null, so nothing an official scored is turned away.

### `GET /results` (admin, or official), changed

Each stored quiz gains: `stage` and `stageFrom` (`'admin' | 'schedule' | 'counted' | null`), `link`,
`suggestedLink`, `incompleteTypes`, `problems` (null for a quiz whose current revision is still to
be scored, R2: the list never waits, since quizzes are edited from it), `accepted` (whether its
current content is accepted), `withdrawnOrder`, and `otherFormula` (its own way of scoring level
teams differs from the meet's). `counted` is gone.

### `PATCH /results/stage` (admin), replaces `PATCH /results/counted`

Body: `{ ids: number[], stage: Stage | null }`. Sets the stage of each quiz named; `null` removes
the admin's choice, so the quiz follows its link again. One `stage` record for each quiz whose stage
changes. 404, changing nothing, if an id is not a quiz of this meet.

### `PUT /results/:id/link` (admin, or the room official)

Body: `{ scheduleQuizId: string | null }`. Links, relinks or unlinks, recorded as by hand.

* 409 naming the other quiz if the scheduled quiz is linked to another stored quiz.
* 400 if it is not a quiz of the meet's published schedule.

### `PUT /results/:id/acceptance` (admin)

Body: `{ revision: number, accepted: boolean }`. Accepting several quizzes shown together is one
such call for each. Accepts the quiz as scored at that revision, or withdraws that (FR-015, FR-016).
409 if `revision` is not the quiz's current revision when accepting, so an admin never accepts
content they have not seen.

### `POST /results/:id/keep` (admin)

Clears the quiz's "played under a withdrawn order" flag (FR-019b). No body.

### `POST /results/formula` (admin)

Sets every stored quiz whose own way of scoring level teams differs from the meet's to the meet's
way (FR-023b): one new revision each, action `edited`, any acceptance carried to the new revision.
`{ changed: number }`.

### `GET /results/:id/revisions`, changed

The history gains entries for this feature's decisions:
`{ kind: 'change', what: 'stage' | 'link' | 'acceptance' | 'kept', ..., changedBy: { name }, changedAt }`,
beside the existing `revision` and `counting` entries.

### `POST /stats/dismissals` (admin)

Body: `{ division: string, team?: string, names: [string, string] }`. Records that the two names are
different teams, or with `team` different quizzers on that team (FR-032). Idempotent.

## Division state

Changes to the existing route in `routes/phase.ts`.

### `POST /divisions/:division/state` (admin), changed

Body: `{ state: DivisionStateValue, confirm?: boolean }`. `finals` is a state. Still one step at a
time, forward or back, while the meet is `live` or in `review`.

* Forward, with scheduled quizzes of the stage that is ending missing or not counting: 409
  `{ error, missing: QuizRef[] }` unless `confirm` (FR-019a).
* Back, with quizzes of later stages stored: 409 `{ error, affected: QuizRef[] }` unless `confirm`;
  with it, the withdrawal records them and they are flagged (FR-019b, FR-019c).
* To `stats_break`: records the prelim order as confirmed. To `elim_running`, where the division has
  intermediates: records the re-rank as confirmed. Back from either: records the withdrawal.
* 200 `{ state, reversed, confirmed?: { what, by, at } }`.

### `GET /divisions/state` (admin), changed

Each division gains `ready: boolean`, `missing: QuizRef[]` for its next step, and
`confirmed: { prelims?: { by, at }, rerank?: { by, at } }`, which the settings page's division rows
read (FR-023c).
