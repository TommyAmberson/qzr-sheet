import { Hono, type Context } from 'hono'
import { and, asc, desc, eq, exists, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import {
  NewerFileVersionError,
  foldName,
  isQuizFile,
  parseQuizFile,
  quizName,
  tidyName,
  type DivisionTeamNames,
  type QuizFile,
} from '@qzr/shared'
import type { Bindings } from '../bindings'
import type { SessionUser, SessionVariables } from '../middleware/session'
import { requireAuthOrGuest } from '../middleware/session'
import { asOne, chunksOf, createDb, inChunks, type Db } from '../lib/db'
import {
  isAdminOrSuperuser,
  isOfficialOfRoom,
  isViewerOf,
  officialRoomsOf,
} from '../lib/permissions'
import * as schema from '../db/schema'

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

/** The meet id in the path, or null when it isn't one */
function meetIdOf(c: Context<Env>): number | null {
  const id = Number(c.req.param('id'))
  return Number.isInteger(id) ? id : null
}

/** The request body, or null when it isn't JSON */
async function jsonBody<T>(c: Context<Env>): Promise<T | null> {
  try {
    return await c.req.json<T>()
  } catch {
    return null
  }
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
): Promise<{ saver: Saver; quizKey: string } | Response> {
  const db = c.get('db')
  const [result] = await db
    .select({ quizKey: schema.quizResults.quizKey })
    .from(schema.quizResults)
    .where(and(eq(schema.quizResults.id, resultId), eq(schema.quizResults.meetId, meetId)))
  if (!result) return c.json({ error: 'Quiz not found' }, 404)
  const user = c.get('user')
  if (user && (await isAdmin(c, meetId)))
    return { saver: adminSaver(user), quizKey: result.quizKey }

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
  return { saver: roomSaverFor(shared, user), quizKey: result.quizKey }
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

/**
 * The enclosing query's stored quiz, for a subquery. Always qualified: drizzle leaves a column
 * unqualified in a one-table select, where inside a subquery it would name the subquery's own.
 */
const storedQuizId = sql`${schema.quizResults}.${sql.identifier('id')}`

/** The newest revision of the stored quiz in the enclosing query, which is its current one */
const latestRevision = sql<number>`(
  SELECT MAX(latest.revision) FROM quiz_result_revisions latest
  WHERE latest.result_id = ${storedQuizId}
)`

/** Whether the stored quiz in the enclosing query counts: its newest counting record says so */
const isCounted = sql`COALESCE((
  SELECT newest.counted FROM quiz_result_count_changes newest
  WHERE newest.result_id = ${storedQuizId}
  ORDER BY newest.id DESC LIMIT 1
), 0)`.mapWith(Boolean)

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

function isUniqueViolation(e: unknown): boolean {
  return errorText(e).includes('UNIQUE constraint failed')
}

/** A unique violation on a revision number: the race `addRevisions` retries, unlike a name clash */
function isRevisionClash(e: unknown): boolean {
  return isUniqueViolation(e) && errorText(e).includes('quiz_result_revisions')
}

function errorText(e: unknown): string {
  return e instanceof Error ? `${e.message} ${String(e.cause ?? '')}` : String(e)
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
  const [clash] = await db
    .select({ id: schema.quizResults.id })
    .from(schema.quizResults)
    .where(and(eq(schema.quizResults.meetId, meetId), eq(schema.quizResults.quizKey, key)))
  if (clash) return nameTaken(c, file)
  return () => [
    db.update(schema.quizResults).set({ quizKey: key }).where(eq(schema.quizResults.id, resultId)),
  ]
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
        .returning({ revision: schema.quizResultRevisions.revision })
      const results = await asOne(db, [...together(), insert])
      return (results.at(-1) as { revision: number }[]).map((r) => r.revision)
    } catch (e) {
      if (attempt < 3 && isRevisionClash(e)) continue
      throw e
    }
  }
}

/** The name folded for case and spaces: the identity of a quiz not tied to the schedule */
function quizKey(file: QuizFile): string {
  return [
    foldName(file.quiz.division),
    file.quiz.consolation ? 'c' : '',
    foldName(file.quiz.quizNumber),
  ].join('|')
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
  }>(c)
  if (!body) return c.json({ error: 'Body must be JSON' }, 400)
  const user = c.get('user')
  // A guest whose send names no room (as released apps send it) sends for their token's room
  const roomId =
    (typeof body.roomId === 'number' ? body.roomId : null) ?? c.get('guest')?.roomId ?? null

  // An admin sends for any room of the meet, or none; anyone else is an official of the room
  if (!user || !(await isAdmin(c, meetId))) {
    if (roomId === null || !(await isOfficialOfRoom(c, c.get('db'), meetId, roomId))) {
      return c.json({ error: 'Not an official of this room' }, 403)
    }
  }
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

  // A name the meet already has is the same quiz: say so, or add a revision when asked to
  const db = c.get('db')
  const existingId = async () => {
    const [row] = await db
      .select({ id: schema.quizResults.id })
      .from(schema.quizResults)
      .where(and(eq(schema.quizResults.meetId, meetId), eq(schema.quizResults.quizKey, key)))
    return row?.id
  }
  let resultId = await existingId()
  if (resultId === undefined) {
    try {
      const [created] = await db
        .insert(schema.quizResults)
        .values({
          meetId,
          roomId: saver.savedByRoomId ?? null,
          quizKey: key,
          createdAt: new Date(),
        })
        .returning({ id: schema.quizResults.id })
      const [revision] = await addRevisions(db, created!.id, [revisionValues])
      return c.json({ id: created!.id, revision, created: true }, 201)
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
  return c.json({ id: resultId, revision, created: false, keptCurrent })
})

results.put('/:id/results/:resultId', async (c) => {
  const meetId = meetIdOf(c)
  const resultId = resultIdOf(c)
  if (meetId === null || resultId === null) return c.json({ error: 'Quiz not found' }, 404)
  const access = await quizAccess(c, meetId, resultId)
  if (access instanceof Response) return access
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

/** A stored quiz's history, newest first: its saves and its counting records */
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

  // Both lists are newest first; a count saved in the same millisecond as
  // a save is taken to follow it, as counting a quiz follows saving it
  const history: ((typeof saves)[number] | (typeof counts)[number])[] = []
  while (saves.length > 0 || counts.length > 0) {
    const takeCount =
      counts.length > 0 &&
      (saves.length === 0 || counts[0]!.changedAt.getTime() >= saves[0]!.savedAt.getTime())
    history.push(takeCount ? counts.shift()! : saves.shift()!)
  }
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
 * Count or uncount quizzes of the meet. Each quiz whose value changes gets a counting record, and
 * its newest record is its value, so a quiz and its record always agree, even if a large change is
 * cut short between the chunks D1's parameter limit needs.
 */
results.patch('/:id/results/counted', async (c) => {
  const meetId = meetIdOf(c)
  if (meetId === null) return c.json({ error: 'Meet not found' }, 404)
  const user = c.get('user')
  if (!user || !(await isAdmin(c, meetId))) return c.json({ error: 'Admin access required' }, 403)

  const body = await jsonBody<{ ids?: unknown; counted?: unknown }>(c)
  const ids = body?.ids
  const counted = body?.counted
  if (!Array.isArray(ids) || !ids.every(Number.isInteger) || typeof counted !== 'boolean') {
    return c.json({ error: 'Expected { ids: number[], counted: boolean }' }, 400)
  }

  const db = c.get('db')
  const requested = [...new Set(ids as number[])]
  const stored = await inChunks(requested, 1, (chunk) =>
    db
      .select({ id: schema.quizResults.id, counted: isCounted })
      .from(schema.quizResults)
      .where(and(eq(schema.quizResults.meetId, meetId), inArray(schema.quizResults.id, chunk))),
  )
  if (stored.length !== requested.length) return c.json({ error: 'Quiz not found' }, 404)

  const changed = stored.filter((quiz) => quiz.counted !== counted).map((quiz) => quiz.id)
  const changedAt = new Date()
  const records = changed.map((resultId) => ({
    resultId,
    counted,
    changedByAccountId: user.id,
    changedByName: user.name,
    changedAt,
  }))
  await inChunks(records, 5, (chunk) =>
    db
      .insert(schema.quizResultCountChanges)
      .values(chunk)
      .returning({ id: schema.quizResultCountChanges.id }),
  )
  return c.json({ changed })
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

  const rows = await db
    .select({
      id: schema.quizResults.id,
      originAction: first.action,
      originName: first.savedByName,
      counted: isCounted,
      revision: schema.quizResultRevisions.revision,
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
    )

  return c.json(
    rows.map(({ originAction, originName, savedByName, quizFile, ...row }) => ({
      ...row,
      origin: { action: originAction, name: originName },
      savedBy: { name: savedByName },
      quizFile: JSON.parse(quizFile),
    })),
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
