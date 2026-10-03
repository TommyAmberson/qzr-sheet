import { Hono, type Context } from 'hono'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import {
  MeetRole,
  NewerFileVersionError,
  foldName,
  isQuizFile,
  parseQuizFile,
  quizName,
  type QuizFile,
} from '@qzr/shared'
import type { Bindings } from '../bindings'
import type { SessionUser, SessionVariables } from '../middleware/session'
import { requireAuthOrGuest } from '../middleware/session'
import { createDb, inChunks, type Db } from '../lib/db'
import { isAdminOrSuperuser, isOfficialOfRoom } from '../lib/permissions'
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

for (const path of ['/:id/results', '/:id/results/*']) {
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

/** The room an official saves from, or the response refusing them */
async function officialSaver(
  c: Context<Env>,
  meetId: number,
  roomId: number | null | undefined,
): Promise<Saver | Response> {
  const guest = c.get('guest')
  const db = c.get('db')
  if (typeof roomId !== 'number' || !(await isOfficialOfRoom(c, db, meetId, roomId))) {
    // An official token from before rooms were on it, or from a since-rotated code, needs a new one
    const rejoin = guest?.role === MeetRole.Official && guest.meetId === meetId
    return c.json(
      { error: rejoin ? 'Rejoin with your room code' : 'Not an official of this room' },
      403,
    )
  }
  const [room] = await db
    .select({ name: schema.meetRooms.name })
    .from(schema.meetRooms)
    .where(eq(schema.meetRooms.id, roomId))
  const roomName = room?.name ?? `Room ${roomId}`
  const user = c.get('user')
  return {
    savedByAccountId: user?.id ?? null,
    savedByRoomId: roomId,
    savedByName: user ? `${user.name}, ${roomName}` : roomName,
  }
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

/** A stored quiz's first revision: who sent it and how, which outlives a deleted room */
const first = alias(schema.quizResultRevisions, 'first')

function isUniqueViolation(e: unknown): boolean {
  const text = e instanceof Error ? `${e.message} ${String(e.cause ?? '')}` : String(e)
  return text.includes('UNIQUE constraint failed')
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
): Promise<number[]> {
  for (let attempt = 0; ; attempt++) {
    const newest = await newestRevision(db, resultId)
    const base = newest?.revision ?? 0
    // A selection always points at a revision with a file, never at another selection
    const currentContent = newest?.restoredFrom ?? base
    const savedAt = new Date()
    try {
      const inserted = await db
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
      return inserted.map((r) => r.revision)
    } catch (e) {
      if (attempt < 3 && isUniqueViolation(e)) continue
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
  const body = await jsonBody<{ quizFile?: unknown; roomId?: unknown; onExisting?: unknown }>(c)
  if (!body) return c.json({ error: 'Body must be JSON' }, 400)
  const guest = c.get('guest')
  const user = c.get('user')

  // A guest, or anyone naming a room, is an official submitting; otherwise an admin uploading
  const asOfficial = !!guest || body.roomId !== undefined
  let saver: Saver
  if (asOfficial) {
    const roomId = guest ? guest.roomId : typeof body.roomId === 'number' ? body.roomId : null
    const official = await officialSaver(c, meetId, roomId)
    if (official instanceof Response) return official
    saver = official
  } else {
    if (!user || !(await isAdmin(c, meetId))) {
      return c.json({ error: 'Admin or official access required' }, 403)
    }
    saver = adminSaver(user)
  }

  const json = validFile(c, body.quizFile)
  if (json instanceof Response) return json
  const file = body.quizFile as QuizFile
  const key = quizKey(file)
  const revisionValues = {
    ...saver,
    quizFile: json,
    action: asOfficial ? ('submitted' as const) : ('uploaded' as const),
  }

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
  const resultId = Number(c.req.param('resultId'))
  if (meetId === null || !Number.isInteger(resultId)) {
    return c.json({ error: 'Quiz not found' }, 404)
  }
  // Officials resubmit by name through POST; editing a stored quiz is for admins
  const user = c.get('user')
  if (!user || !(await isAdmin(c, meetId))) {
    return c.json({ error: 'Admin access required' }, 403)
  }
  const body = await jsonBody<{ quizFile?: unknown; action?: unknown }>(c)
  if (!body) return c.json({ error: 'Body must be JSON' }, 400)
  const db = c.get('db')

  const [result] = await db
    .select()
    .from(schema.quizResults)
    .where(and(eq(schema.quizResults.id, resultId), eq(schema.quizResults.meetId, meetId)))
  if (!result) return c.json({ error: 'Quiz not found' }, 404)

  const json = validFile(c, body.quizFile)
  if (json instanceof Response) return json
  const file = body.quizFile as QuizFile

  // A changed name must stay unique in the meet
  const key = quizKey(file)
  if (key !== result.quizKey) {
    try {
      await db
        .update(schema.quizResults)
        .set({ quizKey: key })
        .where(eq(schema.quizResults.id, resultId))
    } catch (e) {
      if (!isUniqueViolation(e)) throw e
      return c.json({ error: `Another quiz is already named ${quizName(file.quiz)}` }, 409)
    }
  }

  const [revision] = await addRevisions(db, resultId, [
    { ...adminSaver(user), quizFile: json, action: body.action === 'merged' ? 'merged' : 'edited' },
  ])
  return c.json({ id: resultId, revision })
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

results.get('/:id/results', async (c) => {
  const meetId = meetIdOf(c)
  if (meetId === null) return c.json({ error: 'Meet not found' }, 404)
  if (!(await isAdmin(c, meetId))) return c.json({ error: 'Admin access required' }, 403)

  const rows = await c
    .get('db')
    .select({
      id: schema.quizResults.id,
      originAction: first.action,
      originName: first.savedByName,
      counted: isCounted,
      revision: schema.quizResultRevisions.revision,
      savedAt: schema.quizResultRevisions.savedAt,
      savedByName: schema.quizResultRevisions.savedByName,
      action: schema.quizResultRevisions.action,
      quizFile: sql<string>`COALESCE(${schema.quizResultRevisions.quizFile}, ${source.quizFile})`,
    })
    .from(schema.quizResults)
    .innerJoin(
      schema.quizResultRevisions,
      and(
        eq(schema.quizResultRevisions.resultId, schema.quizResults.id),
        eq(schema.quizResultRevisions.revision, latestRevision),
      ),
    )
    .leftJoin(
      source,
      and(
        eq(source.resultId, schema.quizResultRevisions.resultId),
        eq(source.revision, schema.quizResultRevisions.restoredFrom),
      ),
    )
    .innerJoin(first, and(eq(first.resultId, schema.quizResults.id), eq(first.revision, 1)))
    .where(eq(schema.quizResults.meetId, meetId))

  return c.json(
    rows.map(({ originAction, originName, savedByName, quizFile, ...row }) => ({
      ...row,
      origin: { action: originAction, name: originName },
      savedBy: { name: savedByName },
      quizFile: JSON.parse(quizFile),
    })),
  )
})
