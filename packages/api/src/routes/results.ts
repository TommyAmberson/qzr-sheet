import { Hono, type Context } from 'hono'
import { and, asc, desc, eq, exists, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import {
  NewerFileVersionError,
  PlacementFormula,
  foldName,
  resultKey,
  isQuizFile,
  mayChangeQuizzes,
  parseQuizFile,
  quizName,
  quizProblems,
  resultKeyName,
  STAGE_CHOICES,
  tidyName,
  type DivisionTeamNames,
  type QuizFile,
  type ScoredQuiz,
  type StageChoice,
} from '@qzr/shared'
import type { Bindings } from '../bindings'
import type { SessionUser, SessionVariables } from '../middleware/session'
import { requireAuthOrGuest } from '../middleware/session'
import { asOne, chunksOf, createDb, inChunks, isUniqueViolation, type Db } from '../lib/db'
import {
  isAdminOrSuperuser,
  isOfficialOfRoom,
  isViewerOf,
  officialRoomsOf,
} from '../lib/permissions'
import * as schema from '../db/schema'
import { jsonBody, meetIdOf } from '../lib/request'
import {
  meetFacts,
  quizFacts,
  recordChanges,
  linkOf,
  linkTo,
  scheduledQuiz,
  type Changer,
  type MeetFacts,
  type QuizLink,
} from '../lib/quizFacts'
import { isCounted, latestRevision } from '../lib/resultsSql'
import { SHARED_VERSION, keepScores } from '../lib/scores'
import { otherFormulaCount, otherFormulaQuizzes, statsSettingsOf } from '../lib/statsSettings'

interface ResultsVariables extends SessionVariables {
  db: Db
}

type Env = { Bindings: Bindings; Variables: ResultsVariables }

/**
 * A meet's submitted quizzes. Its own router because officials submit with a guest token, and the
 * schedule routers require an account session. Its middleware is scoped to its own paths, so it
 * never answers for routes mounted after it.
 */
export const results = new Hono<Env>()

for (const path of ['/:id/results', '/:id/results/*', '/:id/team-names']) {
  results.use(path, requireAuthOrGuest())
  results.use(path, async (c, next) => {
    if (!c.get('db')) c.set('db', createDb(c.env.DB) as unknown as Db)
    await next()
  })
}

/** Who saved a revision, in the revision's own columns */
type Saver = Pick<
  typeof schema.quizResultRevisions.$inferInsert,
  'savedByAccountId' | 'savedByRoomId' | 'savedByName'
>

function adminSaver(user: SessionUser): Saver {
  return { savedByAccountId: user.id, savedByRoomId: null, savedByName: user.name }
}

async function isAdmin(c: Context<Env>, meetId: number): Promise<boolean> {
  const user = c.get('user')
  return !!user && (await isAdminOrSuperuser(c.get('db'), user.id, user.role, meetId))
}

/**
 * The response refusing a change to the meet's quizzes in its phase, or null when the phase allows
 * it: anyone who may change them does so while the meet is live, only an admin while it is in
 * review, and nobody before it is live or once it is done.
 */
async function refusedByPhase(
  c: Context<Env>,
  meetId: number,
  admin: boolean,
): Promise<Response | null> {
  const [meet] = await c
    .get('db')
    .select({ phase: schema.quizMeets.phase })
    .from(schema.quizMeets)
    .where(eq(schema.quizMeets.id, meetId))
  if (!meet) return c.json({ error: 'Meet not found' }, 404)
  if (mayChangeQuizzes(meet.phase, admin)) return null
  const error =
    meet.phase === 'review'
      ? 'Only an admin changes quizzes while the meet is in review'
      : 'Quizzes change only while the meet is live or in review'
  return c.json({ error, meetPhase: meet.phase }, 409)
}

/**
 * A save for a room of the meet, by a signed-in account ("Pat, Room 2") or the room's guest
 * official ("Room 2"); undefined when the meet has no such room
 */
async function roomSaver(
  db: Db,
  meetId: number,
  roomId: number,
  user: SessionUser | null | undefined,
): Promise<Saver | undefined> {
  const [room] = await db
    .select({ id: schema.meetRooms.id, name: schema.meetRooms.name })
    .from(schema.meetRooms)
    .where(and(eq(schema.meetRooms.id, roomId), eq(schema.meetRooms.meetId, meetId)))
  return room && roomSaverFor(room, user)
}

/** A save for a room, named as it is now: "Pat, Room 2" for an account, "Room 2" for a guest */
function roomSaverFor(
  room: { id: number; name: string },
  user: SessionUser | null | undefined,
): Saver {
  return {
    savedByAccountId: user?.id ?? null,
    savedByRoomId: room.id,
    savedByName: user ? `${user.name}, ${room.name}` : room.name,
  }
}

/** Who made a decision about a stored quiz, from who would save a change to it */
function changerOf(saver: Saver): Changer {
  return {
    changedByAccountId: saver.savedByAccountId,
    changedByRoomId: saver.savedByRoomId,
    changedByName: saver.savedByName,
  }
}

/** The stored quiz id in the path, or null when it isn't one */
function resultIdOf(c: Context<Env>): number | null {
  const id = Number(c.req.param('resultId'))
  return Number.isInteger(id) ? id : null
}

/**
 * Who may read and change a stored quiz of the meet, as the saver of a change: an admin, or an
 * official of a room the quiz already has, recorded for the first such room by room order so a
 * change never gives the quiz a new room. Otherwise the response refusing the caller: 404 when the
 * quiz isn't the meet's, 403 when the caller may not touch it.
 */
async function quizAccess(
  c: Context<Env>,
  meetId: number,
  resultId: number,
): Promise<{ saver: Saver; quizKey: string; admin: boolean } | Response> {
  const db = c.get('db')
  const [result] = await db
    .select({ quizKey: schema.quizResults.quizKey })
    .from(schema.quizResults)
    .where(and(eq(schema.quizResults.id, resultId), eq(schema.quizResults.meetId, meetId)))
  if (!result) return c.json({ error: 'Quiz not found' }, 404)
  const user = c.get('user')
  if (user && (await isAdmin(c, meetId)))
    return { saver: adminSaver(user), quizKey: result.quizKey, admin: true }

  const mine = await officialRoomsOf(c, db, meetId)
  const [shared] =
    mine.length === 0
      ? []
      : await db
          .selectDistinct({
            id: schema.meetRooms.id,
            name: schema.meetRooms.name,
            sortOrder: schema.meetRooms.sortOrder,
          })
          .from(schema.quizResultRevisions)
          .innerJoin(
            schema.meetRooms,
            eq(schema.meetRooms.id, schema.quizResultRevisions.savedByRoomId),
          )
          .where(
            and(
              eq(schema.quizResultRevisions.resultId, resultId),
              inArray(schema.quizResultRevisions.savedByRoomId, mine),
            ),
          )
          .orderBy(asc(schema.meetRooms.sortOrder), asc(schema.meetRooms.id))
          .limit(1)
  if (!shared) return c.json({ error: "Not an admin, or an official of this quiz's rooms" }, 403)
  return { saver: roomSaverFor(shared, user), quizKey: result.quizKey, admin: false }
}

/** The validated file to store, or the response refusing it */
function validFile(c: Context<Env>, quizFile: unknown): string | Response {
  const json = JSON.stringify(quizFile ?? null)
  try {
    parseQuizFile(json)
  } catch (e) {
    if (e instanceof NewerFileVersionError) return c.json({ error: e.message }, 422)
    return c.json({ error: e instanceof Error ? e.message : 'Invalid quiz file' }, 400)
  }
  // The parser converts loose values ("false" for false); the stored file must not need it
  if (!isQuizFile(quizFile)) return c.json({ error: 'Quiz file values have the wrong types' }, 400)
  return json
}

/** The revision a selecting revision points at, for its quiz file */
const source = alias(schema.quizResultRevisions, 'source')

/** Joins `source` to the revision a restoring revision restores */
const restoredSource = and(
  eq(source.resultId, schema.quizResultRevisions.resultId),
  eq(source.revision, schema.quizResultRevisions.restoredFrom),
)

/** A revision's quiz file: its own, or the file of the revision it restores (with `restoredSource`) */
const revisionFile = sql<string>`COALESCE(${schema.quizResultRevisions.quizFile}, ${source.quizFile})`

/** The revision whose file a revision shows: its own, or the one it restores */
function contentOf(revision: { revision: number; restoredFrom: number | null }): number {
  return revision.restoredFrom ?? revision.revision
}

/** A stored quiz's first revision: who sent it and how, which outlives a deleted room */
const first = alias(schema.quizResultRevisions, 'first')

/** Any revision of a stored quiz saved for one of an official's rooms, which gives them the quiz */
const savedForRoom = alias(schema.quizResultRevisions, 'saved_for_room')

/** A unique violation on a revision number: the race `addRevisions` retries, unlike a name clash */
function isRevisionClash(e: unknown): boolean {
  return isUniqueViolation(e, 'quiz_result_revisions')
}

/** The refusal of a change that would give a quiz another stored quiz's name */
function nameTaken(c: Context<Env>, file: QuizFile) {
  return c.json({ error: `Another quiz is already named ${quizName(file.quiz)}` }, 409)
}

/**
 * The statements moving a stored quiz to the name its new content has, for `addRevisions` to run
 * with the revision, so the name and the content change together; the 409 when another quiz of the
 * meet already has that name. A name taken in the moment between is caught as a unique violation.
 */
async function nameMove(
  c: Context<Env>,
  meetId: number,
  resultId: number,
  currentKey: string,
  file: QuizFile,
): Promise<(() => PromiseLike<unknown>[]) | Response> {
  const key = quizKey(file)
  if (key === currentKey) return () => []
  const db = c.get('db')
  const [clash] = await quizNamed(db, meetId, key)
  if (clash) return nameTaken(c, file)
  return () => [
    db.update(schema.quizResults).set({ quizKey: key }).where(eq(schema.quizResults.id, resultId)),
  ]
}

/** The meet's stored quiz with the name `key`: a select to run, or to use as a subquery */
function quizNamed(db: Db, meetId: number, key: string) {
  return db
    .select({ id: schema.quizResults.id })
    .from(schema.quizResults)
    .where(and(eq(schema.quizResults.meetId, meetId), eq(schema.quizResults.quizKey, key)))
}

/**
 * Keep the scores of revisions just saved. The save has already happened, so a failure here must
 * not fail it: the official would send the quiz again. A score that is missing is made when the
 * division's stats are next read.
 */
async function keepScoresOfSaved(db: Db, revisions: { id: number; quizFile: string }[]) {
  try {
    await keepScores(db, revisions)
  } catch (e) {
    console.error('Scores not kept for revisions', revisions.map((r) => r.id).join(', '), e)
  }
}

type RevisionRow = Saver &
  Pick<typeof schema.quizResultRevisions.$inferInsert, 'quizFile' | 'restoredFrom' | 'action'>

/** A stored quiz's newest revision, which is its current one */
async function newestRevision(db: Db, resultId: number) {
  const [newest] = await db
    .select({
      revision: schema.quizResultRevisions.revision,
      restoredFrom: schema.quizResultRevisions.restoredFrom,
      savedByName: schema.quizResultRevisions.savedByName,
      savedAt: schema.quizResultRevisions.savedAt,
    })
    .from(schema.quizResultRevisions)
    .where(eq(schema.quizResultRevisions.resultId, resultId))
    .orderBy(desc(schema.quizResultRevisions.revision))
    .limit(1)
  return newest
}

/**
 * Append revisions after the newest, in one statement, so a save can't leave the quiz
 * half-updated. A row with no file selects an earlier revision; `restoredFrom: 'current'` selects
 * whatever is current before this save. Two saves racing for the same numbers collide on the
 * unique key, and the later one takes the next.
 */
async function addRevisions(
  db: Db,
  resultId: number,
  rows: (Omit<RevisionRow, 'restoredFrom'> & { restoredFrom?: number | 'current' })[],
  /** Statements that must happen with the insert or not at all, built afresh for each try */
  together: () => PromiseLike<unknown>[] = () => [],
): Promise<number[]> {
  for (let attempt = 0; ; attempt++) {
    const newest = await newestRevision(db, resultId)
    const base = newest?.revision ?? 0
    // A selection always points at a revision with a file, never at another selection
    const currentContent = newest ? contentOf(newest) : base
    const savedAt = new Date()
    try {
      const insert = db
        .insert(schema.quizResultRevisions)
        .values(
          rows.map((row, i) => ({
            ...row,
            resultId,
            revision: base + 1 + i,
            restoredFrom: row.restoredFrom === 'current' ? currentContent : row.restoredFrom,
            savedAt,
          })),
        )
        .returning({
          id: schema.quizResultRevisions.id,
          revision: schema.quizResultRevisions.revision,
        })
      const results = await asOne(db, [...together(), insert])
      const added = results.at(-1) as { id: number; revision: number }[]
      await keepScoresOfSaved(
        db,
        added.flatMap(({ id }, i) => {
          const quizFile = rows[i]!.quizFile
          return quizFile ? [{ id, quizFile }] : []
        }),
      )
      return added.map((r) => r.revision)
    } catch (e) {
      if (attempt < 3 && isRevisionClash(e)) continue
      throw e
    }
  }
}

/** The name folded for case and spaces: the identity of a quiz, which a schedule quiz shares */
function quizKey(file: QuizFile): string {
  return resultKey(file.quiz)
}

/** The 409 for a name the meet already has, with its current revision so the caller can decide */
async function alreadySubmitted(c: Context<Env>, resultId: number, file: QuizFile) {
  const latest = await newestRevision(c.get('db'), resultId)
  return c.json(
    {
      error: `${quizName(file.quiz)} was already submitted`,
      existing: {
        id: resultId,
        name: quizName(file.quiz),
        revision: latest?.revision ?? 0,
        savedBy: latest ? { name: latest.savedByName } : null,
        savedAt: latest?.savedAt ?? null,
      },
    },
    409,
  )
}

results.post('/:id/results', async (c) => {
  const meetId = meetIdOf(c)
  if (meetId === null) return c.json({ error: 'Meet not found' }, 404)
  const body = await jsonBody<{
    quizFile?: unknown
    roomId?: unknown
    onExisting?: unknown
    upload?: unknown
    scheduleQuizId?: unknown
  }>(c)
  if (!body) return c.json({ error: 'Body must be JSON' }, 400)
  const user = c.get('user')
  // A guest whose send names no room (as released apps send it) sends for their token's room
  const roomId =
    (typeof body.roomId === 'number' ? body.roomId : null) ?? c.get('guest')?.roomId ?? null

  // An admin sends for any room of the meet, or none; anyone else is an official of the room
  const admin = await isAdmin(c, meetId)
  if (!admin) {
    if (roomId === null || !(await isOfficialOfRoom(c, c.get('db'), meetId, roomId))) {
      return c.json({ error: 'Not an official of this room' }, 403)
    }
  }
  const refused = await refusedByPhase(c, meetId, admin)
  if (refused) return refused
  // Only an admin gets here with no room: an official always sends for one
  const saver =
    roomId === null ? adminSaver(user!) : await roomSaver(c.get('db'), meetId, roomId, user)
  if (!saver) return c.json({ error: 'Room not found' }, 404)

  const json = validFile(c, body.quizFile)
  if (json instanceof Response) return json
  const file = body.quizFile as QuizFile
  const key = quizKey(file)
  const action =
    body.upload === true ? 'uploaded' : saver.savedByRoomId === null ? 'edited' : 'submitted'
  const revisionValues = { ...saver, quizFile: json, action } as const

  const db = c.get('db')
  // The scheduled quiz the sheet says this is. One the published schedule doesn't have (it was
  // republished, or the sheet holds an id from before) is let go: nothing an official scored is
  // turned away, and the quiz is linked by its name
  // Read once, and only on the paths that need it
  let facts: MeetFacts | undefined
  const factsOf = async () => (facts ??= await meetFacts(db, meetId))
  let sentFor = typeof body.scheduleQuizId === 'string' ? body.scheduleQuizId : null
  if (sentFor !== null && !(await factsOf()).schedule?.quizzes.has(sentFor)) sentFor = null
  /**
   * The quiz's link once it is stored. The sheet's scheduled quiz is recorded as its link, unless
   * another quiz's explicit link holds that one, in which case the submission is kept all the
   * same, or someone linked or unlinked this quiz by hand, which the sheet doesn't undo. Any other
   * quiz is linked by its name.
   */
  const linkOnSubmit = async (resultId: number): Promise<QuizLink | null> => {
    const facts = await factsOf()
    const decided = facts.decisions.get(resultId)
    // A link made or removed by hand is kept against the sheet, which may hold the wrong quiz
    if (
      sentFor !== null &&
      decided?.link?.scheduleQuizId !== sentFor &&
      decided?.linkBy !== 'hand'
    ) {
      const linked = await linkTo(db, facts, resultId, sentFor, 'sheet', changerOf(saver))
      if ('link' in linked) return linked.link
    }
    return linkOf(facts, resultId, key)
  }

  // A name the meet already has is the same quiz: say so, or add a revision when asked to
  const existingId = async () => (await quizNamed(db, meetId, key))[0]?.id
  let resultId = await existingId()
  if (resultId === undefined) {
    try {
      // The quiz and its first revision are saved together, so a failed save can't leave a quiz
      // with no revision. The revision finds the new quiz by its name, which is unique in the meet.
      const now = new Date()
      const createdQuiz = db
        .insert(schema.quizResults)
        .values({ meetId, roomId: saver.savedByRoomId ?? null, quizKey: key, createdAt: now })
        .returning({ id: schema.quizResults.id })
      const firstRevision = db
        .insert(schema.quizResultRevisions)
        .values({
          ...revisionValues,
          resultId: sql`(${quizNamed(db, meetId, key)})`,
          revision: 1,
          savedAt: now,
        })
        .returning({
          id: schema.quizResultRevisions.id,
          revision: schema.quizResultRevisions.revision,
        })
      const [quizRows, revisionRows] = (await asOne(db, [createdQuiz, firstRevision])) as [
        { id: number }[],
        { id: number; revision: number }[],
      ]
      await keepScoresOfSaved(db, [{ id: revisionRows[0]!.id, quizFile: json }])
      const id = quizRows[0]!.id
      return c.json(
        { id, revision: revisionRows[0]!.revision, created: true, link: await linkOnSubmit(id) },
        201,
      )
    } catch (e) {
      // Another submission of the same name won the race; treat it as already submitted
      if (!isUniqueViolation(e)) throw e
      resultId = await existingId()
      if (resultId === undefined) throw e
    }
  }
  // The submitter decides: make it the current revision, or store it and keep the current one
  if (body.onExisting !== 'newRevision' && body.onExisting !== 'keepCurrent') {
    return alreadySubmitted(c, resultId, file)
  }
  // Keeping the current revision stores the submission, then a revision selecting what was current
  const keptCurrent = body.onExisting === 'keepCurrent'
  const [revision] = await addRevisions(
    db,
    resultId,
    keptCurrent
      ? [revisionValues, { ...saver, action: 'restored', restoredFrom: 'current' }]
      : [revisionValues],
  )
  // A submission kept behind the current revision changes neither the quiz's name nor its link
  const link = keptCurrent ? linkOf(await factsOf(), resultId, key) : await linkOnSubmit(resultId)
  return c.json({ id: resultId, revision, created: false, keptCurrent, link })
})

results.put('/:id/results/:resultId', async (c) => {
  const meetId = meetIdOf(c)
  const resultId = resultIdOf(c)
  if (meetId === null || resultId === null) return c.json({ error: 'Quiz not found' }, 404)
  const access = await quizAccess(c, meetId, resultId)
  if (access instanceof Response) return access
  const refused = await refusedByPhase(c, meetId, access.admin)
  if (refused) return refused
  const body = await jsonBody<{ quizFile?: unknown; action?: unknown }>(c)
  if (!body) return c.json({ error: 'Body must be JSON' }, 400)
  const db = c.get('db')

  const json = validFile(c, body.quizFile)
  if (json instanceof Response) return json
  const file = body.quizFile as QuizFile

  // A changed name must stay unique in the meet, and changes with the revision or not at all
  const move = await nameMove(c, meetId, resultId, access.quizKey, file)
  if (move instanceof Response) return move
  try {
    const [revision] = await addRevisions(
      db,
      resultId,
      [{ ...access.saver, quizFile: json, action: body.action === 'merged' ? 'merged' : 'edited' }],
      move,
    )
    return c.json({ id: resultId, revision })
  } catch (e) {
    if (isUniqueViolation(e) && !isRevisionClash(e)) return nameTaken(c, file)
    throw e
  }
})

/** A stored quiz's history, newest first: its saves, the decisions made about it, and its old counting records */
results.get('/:id/results/:resultId/revisions', async (c) => {
  const meetId = meetIdOf(c)
  const resultId = resultIdOf(c)
  if (meetId === null || resultId === null) return c.json({ error: 'Quiz not found' }, 404)
  const access = await quizAccess(c, meetId, resultId)
  if (access instanceof Response) return access
  const db = c.get('db')

  const rows = await db
    .select({
      revision: schema.quizResultRevisions.revision,
      action: schema.quizResultRevisions.action,
      restoredFrom: schema.quizResultRevisions.restoredFrom,
      savedByName: schema.quizResultRevisions.savedByName,
      savedAt: schema.quizResultRevisions.savedAt,
      quizFile: revisionFile,
    })
    .from(schema.quizResultRevisions)
    .leftJoin(source, restoredSource)
    .where(eq(schema.quizResultRevisions.resultId, resultId))
    .orderBy(desc(schema.quizResultRevisions.revision))
  // The newest save is current; every save showing the same file shows the current content
  const current = rows[0] && contentOf(rows[0])
  const saves = rows.map(({ restoredFrom, savedByName, quizFile, ...save }) => ({
    kind: 'revision' as const,
    ...save,
    ...(restoredFrom === null ? {} : { restoredFrom }),
    savedBy: { name: savedByName },
    current: contentOf({ ...save, restoredFrom }) === current,
    quizFile: JSON.parse(quizFile) as QuizFile,
  }))
  const counts = (
    await db
      .select({
        counted: schema.quizResultCountChanges.counted,
        changedByName: schema.quizResultCountChanges.changedByName,
        changedAt: schema.quizResultCountChanges.changedAt,
      })
      .from(schema.quizResultCountChanges)
      .where(eq(schema.quizResultCountChanges.resultId, resultId))
      .orderBy(desc(schema.quizResultCountChanges.id))
  ).map(({ changedByName, ...count }) => ({
    kind: 'counting' as const,
    ...count,
    changedBy: { name: changedByName },
  }))

  const changes = (
    await db
      .select({
        what: schema.quizResultChanges.kind,
        stage: schema.quizResultChanges.stage,
        scheduleQuizId: schema.quizResultChanges.scheduleQuizId,
        how: schema.quizResultChanges.how,
        revision: schema.quizResultChanges.revision,
        accepted: schema.quizResultChanges.accepted,
        changedByName: schema.quizResultChanges.changedByName,
        changedAt: schema.quizResultChanges.changedAt,
      })
      .from(schema.quizResultChanges)
      .where(eq(schema.quizResultChanges.resultId, resultId))
      .orderBy(desc(schema.quizResultChanges.id))
  ).map(({ changedByName, what, stage, scheduleQuizId, how, revision, accepted, changedAt }) => ({
    kind: 'change' as const,
    what,
    ...(what === 'stage' ? { stage } : {}),
    ...(what === 'link' ? { scheduleQuizId, how } : {}),
    ...(what === 'acceptance' ? { revision, accepted } : {}),
    changedBy: { name: changedByName },
    changedAt,
  }))

  // Newest first. A decision recorded in the same millisecond as a save is taken to follow it, as
  // counting or linking a quiz follows saving it; the sort keeps each list's own order
  const at = (entry: (typeof history)[number]) =>
    (entry.kind === 'revision' ? entry.savedAt : entry.changedAt).getTime()
  const history = [...changes, ...counts, ...saves]
  history.sort((a, b) => at(b) - at(a))
  return c.json(history)
})

/** One revision's file, for the scoresheet to open; a restoring revision gives the file it restores */
results.get('/:id/results/:resultId/revisions/:revision', async (c) => {
  const meetId = meetIdOf(c)
  const resultId = resultIdOf(c)
  const revision = Number(c.req.param('revision'))
  if (meetId === null || resultId === null || !Number.isInteger(revision)) {
    return c.json({ error: 'Revision not found' }, 404)
  }
  const access = await quizAccess(c, meetId, resultId)
  if (access instanceof Response) return access

  const [row] = await c
    .get('db')
    .select({ quizFile: revisionFile })
    .from(schema.quizResultRevisions)
    .leftJoin(source, restoredSource)
    .where(
      and(
        eq(schema.quizResultRevisions.resultId, resultId),
        eq(schema.quizResultRevisions.revision, revision),
      ),
    )
  if (!row) return c.json({ error: 'Revision not found' }, 404)
  return c.json({ quizFile: JSON.parse(row.quizFile) })
})

/**
 * Make an earlier revision current again by adding a revision that restores it (FR-005a). It
 * points at the revision with the file, so content is never more than one step away, and adds
 * nothing when that content is already current.
 */
results.post('/:id/results/:resultId/restore', async (c) => {
  const meetId = meetIdOf(c)
  const resultId = resultIdOf(c)
  if (meetId === null || resultId === null) return c.json({ error: 'Quiz not found' }, 404)
  const access = await quizAccess(c, meetId, resultId)
  if (access instanceof Response) return access
  const refused = await refusedByPhase(c, meetId, access.admin)
  if (refused) return refused
  const body = await jsonBody<{ revision?: unknown }>(c)
  if (!body || !Number.isInteger(body.revision)) {
    return c.json({ error: 'Expected { revision: number }' }, 400)
  }
  const db = c.get('db')

  const [target] = await db
    .select({
      revision: schema.quizResultRevisions.revision,
      restoredFrom: schema.quizResultRevisions.restoredFrom,
      quizFile: revisionFile,
    })
    .from(schema.quizResultRevisions)
    .leftJoin(source, restoredSource)
    .where(
      and(
        eq(schema.quizResultRevisions.resultId, resultId),
        eq(schema.quizResultRevisions.revision, body.revision as number),
      ),
    )
  if (!target) return c.json({ error: 'Revision not found' }, 404)

  const content = contentOf(target)
  const newest = (await newestRevision(db, resultId))!
  if (content === contentOf(newest)) {
    return c.json({ id: resultId, revision: newest.revision })
  }
  // The restored content's name becomes the quiz's again, as an edit's would
  const file = JSON.parse(target.quizFile) as QuizFile
  const move = await nameMove(c, meetId, resultId, access.quizKey, file)
  if (move instanceof Response) return move
  try {
    const [revision] = await addRevisions(
      db,
      resultId,
      [{ ...access.saver, action: 'restored', restoredFrom: content }],
      move,
    )
    return c.json({ id: resultId, revision })
  } catch (e) {
    if (isUniqueViolation(e) && !isRevisionClash(e)) return nameTaken(c, file)
    throw e
  }
})

/**
 * Set the stage of stored quizzes of the meet: what each counts for. `null` removes the admin's
 * choice, so a quiz follows its link again. Each quiz whose choice changes gets a record.
 */
results.patch('/:id/results/stage', async (c) => {
  const meetId = meetIdOf(c)
  if (meetId === null) return c.json({ error: 'Meet not found' }, 404)
  const user = c.get('user')
  if (!user || !(await isAdmin(c, meetId))) return c.json({ error: 'Admin access required' }, 403)
  const refused = await refusedByPhase(c, meetId, true)
  if (refused) return refused

  const body = await jsonBody<{ ids?: unknown; stage?: unknown }>(c)
  const ids = body?.ids
  const stage = body?.stage
  const isStage = stage === null || STAGE_CHOICES.includes(stage as StageChoice)
  if (!Array.isArray(ids) || !ids.every(Number.isInteger) || !isStage) {
    return c.json({ error: 'Expected { ids: number[], stage }' }, 400)
  }

  const db = c.get('db')
  const requested = [...new Set(ids as number[])]
  const stored = await inChunks(requested, 1, (chunk) =>
    db
      .select({ id: schema.quizResults.id })
      .from(schema.quizResults)
      .where(and(eq(schema.quizResults.meetId, meetId), inArray(schema.quizResults.id, chunk))),
  )
  if (stored.length !== requested.length) return c.json({ error: 'Quiz not found' }, 404)

  const { decisions } = await meetFacts(db, meetId)
  const changed = requested.filter((id) => (decisions.get(id)?.stage ?? null) !== stage)
  await recordChanges(
    db,
    changed.map((resultId) => ({
      resultId,
      kind: 'stage' as const,
      stage: stage as StageChoice | null,
      ...changerOf(adminSaver(user)),
    })),
  )
  return c.json({ changed })
})

/** Link a stored quiz to a scheduled quiz by hand, change its link, or with `null` remove it */
results.put('/:id/results/:resultId/link', async (c) => {
  const meetId = meetIdOf(c)
  const resultId = resultIdOf(c)
  if (meetId === null || resultId === null) return c.json({ error: 'Quiz not found' }, 404)
  const access = await quizAccess(c, meetId, resultId)
  if (access instanceof Response) return access
  const refused = await refusedByPhase(c, meetId, access.admin)
  if (refused) return refused
  const body = await jsonBody<{ scheduleQuizId?: unknown }>(c)
  const scheduleQuizId = body?.scheduleQuizId
  if (scheduleQuizId !== null && typeof scheduleQuizId !== 'string') {
    return c.json({ error: 'Expected { scheduleQuizId: string | null }' }, 400)
  }

  const db = c.get('db')
  if (scheduleQuizId === null) {
    await recordChanges(db, [
      { resultId, kind: 'link', scheduleQuizId, how: 'hand', ...changerOf(access.saver) },
    ])
    return c.json({ link: null })
  }
  const facts = await meetFacts(db, meetId)
  if (!facts.schedule?.quizzes.has(scheduleQuizId)) {
    return c.json({ error: 'Not a quiz of the published schedule' }, 400)
  }
  const linked = await linkTo(db, facts, resultId, scheduleQuizId, 'hand', changerOf(access.saver))
  if ('link' in linked) return c.json({ link: linked.link })
  const [other] = await db
    .select({ quizKey: schema.quizResults.quizKey })
    .from(schema.quizResults)
    .where(eq(schema.quizResults.id, linked.heldBy))
  return c.json(
    {
      error: `${scheduledQuiz(facts, scheduleQuizId)!.name} is already linked to ${resultKeyName(other?.quizKey ?? '')}`,
      existing: { id: linked.heldBy },
    },
    409,
  )
})

/**
 * Accept a stored quiz as scored at a revision, so that it counts in spite of its errors, or
 * withdraw that. An acceptance is of a revision's content, so a revision restoring accepted
 * content is accepted, and a later revision in error needs its own.
 */
results.put('/:id/results/:resultId/acceptance', async (c) => {
  const meetId = meetIdOf(c)
  const resultId = resultIdOf(c)
  if (meetId === null || resultId === null) return c.json({ error: 'Quiz not found' }, 404)
  const user = c.get('user')
  if (!user || !(await isAdmin(c, meetId))) return c.json({ error: 'Admin access required' }, 403)
  const refused = await refusedByPhase(c, meetId, true)
  if (refused) return refused
  const body = await jsonBody<{ revision?: unknown; accepted?: unknown }>(c)
  if (!body || !Number.isInteger(body.revision) || typeof body.accepted !== 'boolean') {
    return c.json({ error: 'Expected { revision: number, accepted: boolean }' }, 400)
  }

  const db = c.get('db')
  const [target] = await db
    .select({
      revision: schema.quizResultRevisions.revision,
      restoredFrom: schema.quizResultRevisions.restoredFrom,
    })
    .from(schema.quizResultRevisions)
    .innerJoin(schema.quizResults, eq(schema.quizResults.id, schema.quizResultRevisions.resultId))
    .where(
      and(
        eq(schema.quizResults.meetId, meetId),
        eq(schema.quizResultRevisions.resultId, resultId),
        eq(schema.quizResultRevisions.revision, body.revision as number),
      ),
    )
  if (!target) return c.json({ error: 'Revision not found' }, 404)
  // An admin accepts only what they are looking at: the quiz as it is now
  const newest = (await newestRevision(db, resultId))!
  if (body.accepted && target.revision !== newest.revision) {
    return c.json({ error: 'The quiz has changed since', revision: newest.revision }, 409)
  }
  await recordChanges(db, [
    {
      resultId,
      kind: 'acceptance',
      revision: contentOf(target),
      accepted: body.accepted,
      ...changerOf(adminSaver(user)),
    },
  ])
  return c.json({ revision: target.revision, accepted: body.accepted })
})

/**
 * How many quizzes one request sets to the meet's way of scoring level teams. Each takes a few
 * queries, and the Workers free plan allows 50 a request, so the caller asks again for the rest.
 */
const FORMULA_EDITS_PER_REQUEST = 8

/**
 * Set every stored quiz whose own way of scoring level teams differs from the meet's to the meet's
 * way (FR-023b): one `edited` revision each, carrying any acceptance it had to the new revision
 */
results.post('/:id/results/formula', async (c) => {
  const meetId = meetIdOf(c)
  if (meetId === null) return c.json({ error: 'Meet not found' }, 404)
  const user = c.get('user')
  if (!user || !(await isAdmin(c, meetId))) return c.json({ error: 'Admin access required' }, 403)
  const refused = await refusedByPhase(c, meetId, true)
  if (refused) return refused
  const db = c.get('db')
  const { settings } = await statsSettingsOf(db, meetId)
  const now = await otherFormulaQuizzes(db, meetId, settings.levelTeams, FORMULA_EDITS_PER_REQUEST)
  // Which of these quizzes' content revisions an admin accepted as scored, by its newest decision
  const accepted = new Set<string>()
  if (now.length > 0) {
    const decisions = await db
      .select({
        resultId: schema.quizResultChanges.resultId,
        revision: schema.quizResultChanges.revision,
        accepted: schema.quizResultChanges.accepted,
      })
      .from(schema.quizResultChanges)
      .where(
        and(
          eq(schema.quizResultChanges.kind, 'acceptance'),
          inArray(
            schema.quizResultChanges.resultId,
            now.map((quiz) => quiz.id),
          ),
        ),
      )
      .orderBy(asc(schema.quizResultChanges.id))
    for (const { resultId, revision, accepted: yes } of decisions) {
      const key = `${resultId}|${revision}`
      if (yes) accepted.add(key)
      else accepted.delete(key)
    }
  }
  for (const { id, quizFile, contentRevision } of now) {
    const file = JSON.parse(quizFile!) as QuizFile
    const edited = { ...file, quiz: { ...file.quiz, placementFormula: settings.levelTeams } }
    const [revision] = await addRevisions(db, id, [
      { ...adminSaver(user), quizFile: JSON.stringify(edited), action: 'edited' },
    ])
    // Only the way level teams are scored changed, which the admin passed nothing about
    if (accepted.has(`${id}|${contentRevision}`)) {
      await recordChanges(db, [
        {
          resultId: id,
          kind: 'acceptance',
          revision,
          accepted: true,
          ...changerOf(adminSaver(user)),
        },
      ])
    }
  }
  const remaining = await otherFormulaCount(db, meetId, settings.levelTeams)
  return c.json({ changed: now.length, remaining })
})

/**
 * Keep a quiz as it is after an order it was seated from was withdrawn, clearing its flag
 * (FR-019b). Setting its stage to not counted clears it the other way.
 */
results.post('/:id/results/:resultId/keep', async (c) => {
  const meetId = meetIdOf(c)
  const resultId = resultIdOf(c)
  if (meetId === null || resultId === null) return c.json({ error: 'Quiz not found' }, 404)
  const user = c.get('user')
  if (!user || !(await isAdmin(c, meetId))) return c.json({ error: 'Admin access required' }, 403)
  const refused = await refusedByPhase(c, meetId, true)
  if (refused) return refused
  const db = c.get('db')
  const [quiz] = await db
    .select({ id: schema.quizResults.id })
    .from(schema.quizResults)
    .where(and(eq(schema.quizResults.meetId, meetId), eq(schema.quizResults.id, resultId)))
  if (!quiz) return c.json({ error: 'Quiz not found' }, 404)
  await recordChanges(db, [{ resultId, kind: 'kept', ...changerOf(adminSaver(user)) }])
  return c.json({ kept: true })
})

/** Who the caller is when sending to the meet: an admin, for any of its rooms; an official, for theirs */
results.get('/:id/results/sender', async (c) => {
  const meetId = meetIdOf(c)
  if (meetId === null) return c.json({ error: 'Meet not found' }, 404)
  const db = c.get('db')
  const admin = await isAdmin(c, meetId)
  const roomIds = admin ? null : await officialRoomsOf(c, db, meetId)
  if (roomIds?.length === 0) return c.json({ error: 'Admin or official access required' }, 403)
  const rooms = await db
    .select({ id: schema.meetRooms.id, name: schema.meetRooms.name })
    .from(schema.meetRooms)
    .where(
      and(
        eq(schema.meetRooms.meetId, meetId),
        roomIds === null ? undefined : inArray(schema.meetRooms.id, roomIds),
      ),
    )
    .orderBy(asc(schema.meetRooms.sortOrder), asc(schema.meetRooms.id))
  return c.json({ admin, rooms })
})

results.get('/:id/results', async (c) => {
  const meetId = meetIdOf(c)
  if (meetId === null) return c.json({ error: 'Meet not found' }, 404)
  const db = c.get('db')
  // An admin sees every quiz; an official, the quizzes their rooms have saved
  let rooms: number[] | null = null
  if (!(await isAdmin(c, meetId))) {
    rooms = await officialRoomsOf(c, db, meetId)
    if (rooms.length === 0) return c.json({ error: 'Admin or official access required' }, 403)
  }

  const [rows, facts, { settings }] = await Promise.all([
    db
      .select({
        id: schema.quizResults.id,
        originAction: first.action,
        originName: first.savedByName,
        quizKey: schema.quizResults.quizKey,
        counted: isCounted,
        revision: schema.quizResultRevisions.revision,
        restoredFrom: schema.quizResultRevisions.restoredFrom,
        sharedVersion: schema.quizResultScores.sharedVersion,
        scored: schema.quizResultScores.scored,
        savedAt: schema.quizResultRevisions.savedAt,
        savedByName: schema.quizResultRevisions.savedByName,
        action: schema.quizResultRevisions.action,
        quizFile: revisionFile,
      })
      .from(schema.quizResults)
      .innerJoin(
        schema.quizResultRevisions,
        and(
          eq(schema.quizResultRevisions.resultId, schema.quizResults.id),
          eq(schema.quizResultRevisions.revision, latestRevision),
        ),
      )
      .leftJoin(source, restoredSource)
      // The score kept for the revision whose content is current
      .leftJoin(
        schema.quizResultScores,
        eq(
          schema.quizResultScores.revisionId,
          sql`COALESCE(${source.id}, ${schema.quizResultRevisions.id})`,
        ),
      )
      .innerJoin(first, and(eq(first.resultId, schema.quizResults.id), eq(first.revision, 1)))
      .where(
        and(
          eq(schema.quizResults.meetId, meetId),
          rooms === null
            ? undefined
            : exists(
                db
                  .select({ id: savedForRoom.id })
                  .from(savedForRoom)
                  .where(
                    and(
                      eq(savedForRoom.resultId, schema.quizResults.id),
                      inArray(savedForRoom.savedByRoomId, rooms),
                    ),
                  ),
              ),
        ),
      ),
    meetFacts(db, meetId),
    statsSettingsOf(db, meetId),
  ])
  return c.json(
    rows.map(
      ({
        originAction,
        originName,
        savedByName,
        quizFile,
        quizKey,
        counted,
        restoredFrom,
        sharedVersion,
        scored,
        ...row
      }) => {
        const file = JSON.parse(quizFile) as QuizFile
        const held = quizFacts(facts, {
          id: row.id,
          quizKey,
          counted,
          contentRevision: restoredFrom ?? row.revision,
        })
        // What is wrong with it is read from its kept score; the list never waits for one to be
        // made, since quizzes are corrected from it
        const problems =
          scored !== null && sharedVersion === SHARED_VERSION
            ? quizProblems(JSON.parse(scored) as ScoredQuiz, {
                stage: held.stage,
                key: quizKey,
                linked: held.linked,
                roster: held.roster,
                schedulePublished: held.schedulePublished,
                prelimsWithoutOvertime: settings.prelimsWithoutOvertime,
              })
            : null
        return {
          ...row,
          origin: { action: originAction, name: originName },
          savedBy: { name: savedByName },
          stage: held.stage,
          stageFrom: held.stageFrom,
          link: held.link,
          problems,
          accepted: held.accepted,
          ...(held.withdrawnOrder ? { withdrawnOrder: true } : {}),
          // Its scoresheet shows other placement points than the tables, which use the meet's
          ...((file.quiz.placementFormula ?? PlacementFormula.Rules) !== settings.levelTeams
            ? { otherFormula: true }
            : {}),
          quizFile: file,
        }
      },
    ),
  )
})

/** The meet's team names, division by division, in the order they were given */
async function teamNamesOf(db: Db, meetId: number): Promise<DivisionTeamNames[]> {
  const rows = await db
    .select({ division: schema.meetTeamNames.division, name: schema.meetTeamNames.name })
    .from(schema.meetTeamNames)
    .where(eq(schema.meetTeamNames.meetId, meetId))
    .orderBy(asc(schema.meetTeamNames.sortOrder))
  const divisions = new Map<string, string[]>()
  for (const { division, name } of rows) {
    const names = divisions.get(division) ?? []
    names.push(name)
    divisions.set(division, names)
  }
  return [...divisions].map(([division, names]) => ({ division, names }))
}

/**
 * The team names a PUT sends, tidied, with blank names dropped; or why they can't be stored. A
 * division may be listed once, and a name once in its division, ignoring case and spaces.
 */
function teamNamesFrom(body: unknown): DivisionTeamNames[] | string {
  const shape = 'Expected [{ division: string, names: string[] }]'
  if (!Array.isArray(body)) return shape
  const divisions = new Set<string>()
  const lists: DivisionTeamNames[] = []
  for (const entry of body as { division?: unknown; names?: unknown }[]) {
    const { division: given, names } = entry ?? {}
    if (typeof given !== 'string' || !Array.isArray(names)) return shape
    if (!names.every((name): name is string => typeof name === 'string')) return shape
    const division = tidyName(given)
    if (division === '') return 'Each list needs its division'
    const divisionKey = foldName(division)
    if (divisions.has(divisionKey)) return `Division ${division} is listed twice`
    divisions.add(divisionKey)
    const keys = new Set<string>()
    const tidied = names.map(tidyName).filter((name) => name !== '')
    for (const name of tidied) {
      const key = foldName(name)
      if (keys.has(key)) return `${name} is listed twice in division ${division}`
      keys.add(key)
    }
    lists.push({ division, names: tidied })
  }
  return lists
}

/** The meet's team names, for anyone who may view the meet: officials' scoresheets offer them */
results.get('/:id/team-names', async (c) => {
  const meetId = meetIdOf(c)
  if (meetId === null) return c.json({ error: 'Meet not found' }, 404)
  const db = c.get('db')
  if (!(await isViewerOf(c, db, meetId))) return c.json({ error: 'Forbidden' }, 403)
  return c.json(await teamNamesOf(db, meetId))
})

/** Replace the meet's team names, as one change */
results.put('/:id/team-names', async (c) => {
  const meetId = meetIdOf(c)
  if (meetId === null) return c.json({ error: 'Meet not found' }, 404)
  if (!(await isAdmin(c, meetId))) return c.json({ error: 'Admin access required' }, 403)
  const lists = teamNamesFrom(await jsonBody<unknown>(c))
  if (typeof lists === 'string') return c.json({ error: lists }, 400)

  const db = c.get('db')
  const [meet] = await db
    .select({ id: schema.quizMeets.id })
    .from(schema.quizMeets)
    .where(eq(schema.quizMeets.id, meetId))
  if (!meet) return c.json({ error: 'Meet not found' }, 404)

  const rows = lists
    .flatMap(({ division, names }) => names.map((name) => ({ division, name })))
    .map(({ division, name }, sortOrder) => ({
      meetId,
      division,
      name,
      nameKey: foldName(name),
      sortOrder,
    }))
  await asOne(db, [
    db.delete(schema.meetTeamNames).where(eq(schema.meetTeamNames.meetId, meetId)),
    ...chunksOf(rows, 5).map((chunk) => db.insert(schema.meetTeamNames).values(chunk)),
  ])
  // As stored, which a division left with no names drops out of
  return c.json(lists.filter(({ names }) => names.length > 0))
})
