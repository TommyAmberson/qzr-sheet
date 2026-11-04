import { Hono, type Context } from 'hono'
import { eq, and, asc, desc, inArray, sql } from 'drizzle-orm'
import {
  checkSchedule,
  indexOfLetter,
  parseScheduleFile,
  serializeSchedule,
  type ScheduleDocument,
  teamDisplayName,
  type SheetView,
} from '@qzr/shared'
import type { Bindings } from '../bindings'
import type { SessionVariables } from '../middleware/session'
import { requireAuth, requireAuthOrGuest, getUser } from '../middleware/session'
import { asOne, createDb, inChunks, type Db } from '../lib/db'
import { isAdminOrSuperuser, isViewerOf } from '../lib/permissions'
import * as schema from '../db/schema'
import { jsonBody, meetIdOf } from '../lib/request'
import { documentFromLegacy, legacyFromDocument, type LegacySchedule } from '../lib/scheduleLegacy'

interface ScheduleVariables extends SessionVariables {
  db: Db
}

type Env = { Bindings: Bindings; Variables: ScheduleVariables }

export const schedule = new Hono<Env>()

schedule.use('*', requireAuth())
schedule.use('*', async (c, next) => {
  if (!c.get('db')) {
    c.set('db', createDb(c.env.DB) as unknown as Db)
  }
  await next()
})

function getDb(c: { get(key: 'db'): Db }): Db {
  return c.get('db')
}

async function requireAdmin(c: Context<Env>, meetId: number) {
  const user = getUser(c)
  const db = getDb(c)
  if (!(await isAdminOrSuperuser(db, user.id, user.role, meetId))) {
    return c.json({ error: 'Admin or superuser access required' }, 403)
  }
  return null
}

/**
 * Being signed in is not enough to read a meet's schedule: the caller must
 * be a member of that meet in any role, or a superuser.
 */
async function requireViewer(c: Context<Env>, meetId: number) {
  if (!(await isViewerOf(c, getDb(c), meetId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  return null
}

/**
 * What a reader may see of the published schedule (FR-052): letters while the meet is in
 * registration or build, team names from live on; admins see teams and may ask for letters.
 */
async function readerView(c: Context<Env>, db: Db, meetId: number): Promise<SheetView> {
  const user = c.get('user')
  const [isAdmin, [meet]] = await Promise.all([
    user ? isAdminOrSuperuser(db, user.id, user.role, meetId) : false,
    db
      .select({ phase: schema.quizMeets.phase })
      .from(schema.quizMeets)
      .where(eq(schema.quizMeets.id, meetId)),
  ])
  if (isAdmin) return c.req.query('view') === 'letters' ? 'letters' : 'teams'
  return meet && (meet.phase === 'registration' || meet.phase === 'build') ? 'letters' : 'teams'
}

/** The meet's newest published version, the one readers see */
async function newestVersion(db: Db, meetId: number) {
  const [row] = await db
    .select()
    .from(schema.meetScheduleVersions)
    .where(eq(schema.meetScheduleVersions.meetId, meetId))
    .orderBy(desc(schema.meetScheduleVersions.version))
    .limit(1)
  return row ?? null
}

/**
 * The newest published version in the old routes' shapes, or null for a meet still on the old
 * tables. Installed scoresheets call the old routes for their picker (research R5).
 */
async function publishedLegacy(db: Db, meetId: number) {
  const [row, [meet]] = await Promise.all([
    newestVersion(db, meetId),
    db
      .select({
        id: schema.quizMeets.id,
        name: schema.quizMeets.name,
        dateFrom: schema.quizMeets.dateFrom,
      })
      .from(schema.quizMeets)
      .where(eq(schema.quizMeets.id, meetId)),
  ])
  if (!row || !meet) return null
  const doc = JSON.parse(row.document) as ScheduleDocument
  return { meet, ...legacyFromDocument(doc, meet, row.publishedAt) }
}

// ---- Rooms ----

schedule.get('/:id/rooms', async (c) => {
  const meetId = Number(c.req.param('id'))
  if (Number.isNaN(meetId)) return c.json({ error: 'Invalid meet ID' }, 400)

  const denied = await requireViewer(c, meetId)
  if (denied) return denied

  const db = getDb(c)
  const rooms = await db
    .select({
      id: schema.meetRooms.id,
      name: schema.meetRooms.name,
      sortOrder: schema.meetRooms.sortOrder,
      hasCode: sql<number>`(${schema.meetRooms.codeHash} IS NOT NULL)`,
    })
    .from(schema.meetRooms)
    .where(eq(schema.meetRooms.meetId, meetId))
    .orderBy(asc(schema.meetRooms.sortOrder), asc(schema.meetRooms.id))

  return c.json({
    rooms: rooms.map((r) => ({
      id: r.id,
      name: r.name,
      sortOrder: r.sortOrder,
      hasCode: Boolean(r.hasCode),
    })),
  })
})

schedule.patch('/:id/rooms/:roomId', async (c) => {
  const meetId = Number(c.req.param('id'))
  const roomId = Number(c.req.param('roomId'))
  if (Number.isNaN(meetId) || Number.isNaN(roomId)) {
    return c.json({ error: 'Invalid ID' }, 400)
  }

  const denied = await requireAdmin(c, meetId)
  if (denied) return denied

  const body = await c.req.json<{ name?: string; sortOrder?: number }>()
  const updates: Record<string, string | number> = {}
  if (typeof body.name === 'string' && body.name.trim()) updates.name = body.name.trim()
  if (typeof body.sortOrder === 'number') updates.sortOrder = body.sortOrder
  if (Object.keys(updates).length === 0) {
    return c.json({ error: 'No valid fields to update' }, 400)
  }

  const db = getDb(c)
  const [updated] = await db
    .update(schema.meetRooms)
    .set(updates)
    .where(and(eq(schema.meetRooms.id, roomId), eq(schema.meetRooms.meetId, meetId)))
    .returning({
      id: schema.meetRooms.id,
      name: schema.meetRooms.name,
      sortOrder: schema.meetRooms.sortOrder,
      codeHash: schema.meetRooms.codeHash,
    })

  if (!updated) return c.json({ error: 'Room not found' }, 404)
  return c.json({
    room: {
      id: updated.id,
      name: updated.name,
      sortOrder: updated.sortOrder,
      hasCode: updated.codeHash !== null,
    },
  })
})

// ---- Slots ----

schedule.get('/:id/slots', async (c) => {
  const meetId = Number(c.req.param('id'))
  if (Number.isNaN(meetId)) return c.json({ error: 'Invalid meet ID' }, 400)

  const denied = await requireViewer(c, meetId)
  if (denied) return denied

  const db = getDb(c)
  const published = await publishedLegacy(db, meetId)
  if (published) return c.json({ slots: published.slots })
  const slots = await db
    .select()
    .from(schema.meetSlots)
    .where(eq(schema.meetSlots.meetId, meetId))
    .orderBy(asc(schema.meetSlots.sortOrder), asc(schema.meetSlots.id))

  return c.json({ slots })
})

// ---- Scheduled quizzes + seats ----

schedule.get('/:id/quizzes', async (c) => {
  const meetId = Number(c.req.param('id'))
  if (Number.isNaN(meetId)) return c.json({ error: 'Invalid meet ID' }, 400)

  const denied = await requireViewer(c, meetId)
  if (denied) return denied

  const db = getDb(c)
  const published = await publishedLegacy(db, meetId)
  if (published) return c.json({ quizzes: published.quizzes })
  const quizzes = await db
    .select()
    .from(schema.scheduledQuizzes)
    .where(eq(schema.scheduledQuizzes.meetId, meetId))

  const seats =
    quizzes.length === 0
      ? []
      : await db
          .select()
          .from(schema.scheduledQuizSeats)
          .where(
            inArray(
              schema.scheduledQuizSeats.quizId,
              quizzes.map((q) => q.id),
            ),
          )

  const seatsByQuiz = new Map<number, schema.ScheduledQuizSeat[]>()
  for (const seat of seats) {
    const arr = seatsByQuiz.get(seat.quizId) ?? []
    arr.push(seat)
    seatsByQuiz.set(seat.quizId, arr)
  }

  return c.json({
    quizzes: quizzes.map((q) => ({ ...q, seats: seatsByQuiz.get(q.id) ?? [] })),
  })
})

/**
 * GET /api/meets/:id/quizzes/:quizId/teams
 *
 * Returns one scheduled quiz with its 3 seats resolved end-to-end:
 * each seat's `letter`/`seedRef`, the bound team (via
 * `prelim_assignments` or `seed_resolutions`), and that team's
 * roster. Unresolved seats (elim before #16 lands, prelim before
 * Roll-Teams) return `team: null` and `quizzers: []`.
 *
 * Used by the scoresheet to prefill division/quiz #/teams when a
 * user opens a scheduled quiz (issue #6).
 */
schedule.get('/:id/quizzes/:quizId/teams', async (c) => {
  const meetId = Number(c.req.param('id'))
  const quizId = Number(c.req.param('quizId'))
  if (Number.isNaN(meetId) || Number.isNaN(quizId)) {
    return c.json({ error: 'Invalid ID' }, 400)
  }

  const denied = await requireViewer(c, meetId)
  if (denied) return denied

  const db = getDb(c)
  const published = await publishedLegacy(db, meetId)
  if (published) {
    const q = published.quizzes.find((x) => x.id === quizId)
    if (!q) return c.json({ error: 'Quiz not found' }, 404)
    const slot = published.slots.find((x) => x.id === q.slotId)
    const [room] = await db
      .select({ name: schema.meetRooms.name })
      .from(schema.meetRooms)
      .where(and(eq(schema.meetRooms.id, q.roomId), eq(schema.meetRooms.meetId, meetId)))
    const view = await readerView(c, db, meetId)
    const letters = new Map(
      published.assignments
        .filter((a) => view === 'teams' && a.division === q.division)
        .map((a) => [a.letter, a.teamId]),
    )
    return quizWithTeams(
      c,
      meetId,
      {
        id: q.id,
        meetId,
        meetName: published.meet.name,
        slotId: q.slotId,
        roomId: q.roomId,
        division: q.division,
        phase: q.phase,
        lane: q.lane,
        label: q.label,
        bracketLabel: q.bracketLabel,
        slotStartAt: slot?.startAt ?? null,
        roomName: room?.name ?? '',
      },
      q.seats,
      letters,
    )
  }

  // Phase 1: quiz row + seats in parallel — seats only depend on quizId
  // (a route param), so they can race with the join. If quiz is missing
  // we discard the seats; cost is negligible vs. a serial extra round-trip.
  const [quizRows, seats] = await Promise.all([
    db
      .select({
        id: schema.scheduledQuizzes.id,
        meetId: schema.scheduledQuizzes.meetId,
        meetName: schema.quizMeets.name,
        slotId: schema.scheduledQuizzes.slotId,
        roomId: schema.scheduledQuizzes.roomId,
        division: schema.scheduledQuizzes.division,
        phase: schema.scheduledQuizzes.phase,
        lane: schema.scheduledQuizzes.lane,
        label: schema.scheduledQuizzes.label,
        bracketLabel: schema.scheduledQuizzes.bracketLabel,
        slotStartAt: schema.meetSlots.startAt,
        roomName: schema.meetRooms.name,
      })
      .from(schema.scheduledQuizzes)
      .innerJoin(schema.quizMeets, eq(schema.quizMeets.id, schema.scheduledQuizzes.meetId))
      .innerJoin(schema.meetSlots, eq(schema.meetSlots.id, schema.scheduledQuizzes.slotId))
      .innerJoin(schema.meetRooms, eq(schema.meetRooms.id, schema.scheduledQuizzes.roomId))
      .where(
        and(eq(schema.scheduledQuizzes.id, quizId), eq(schema.scheduledQuizzes.meetId, meetId)),
      ),
    db
      .select()
      .from(schema.scheduledQuizSeats)
      .where(eq(schema.scheduledQuizSeats.quizId, quizId))
      .orderBy(asc(schema.scheduledQuizSeats.seatNumber)),
  ])
  const quizRow = quizRows[0]
  if (!quizRow) return c.json({ error: 'Quiz not found' }, 404)

  const prelimLetters = seats
    .map((s) => s.letter)
    .filter((l): l is string => l !== null && l !== '')
  const prelimRows =
    prelimLetters.length === 0
      ? []
      : await db
          .select({
            letter: schema.prelimAssignments.letter,
            teamId: schema.prelimAssignments.teamId,
          })
          .from(schema.prelimAssignments)
          .where(
            and(
              eq(schema.prelimAssignments.meetId, meetId),
              eq(schema.prelimAssignments.division, quizRow.division),
              inArray(schema.prelimAssignments.letter, prelimLetters),
            ),
          )
  return quizWithTeams(
    c,
    meetId,
    quizRow,
    seats,
    new Map(prelimRows.map((r) => [r.letter, r.teamId])),
  )
})

/**
 * A quiz with its seats resolved to teams and rosters: prelim letters through `letters`, elim
 * seats through `seed_resolutions`. Unresolved seats get `team: null` and no quizzers.
 */
async function quizWithTeams(
  c: Context<Env>,
  meetId: number,
  quiz: Record<string, unknown> & { division: string },
  seats: { seatNumber: number; letter: string | null; seedRef: string | null }[],
  letters: Map<string, number>,
) {
  const db = getDb(c)
  const elimRefs = seats.map((s) => s.seedRef).filter((r): r is string => r !== null && r !== '')
  const elimRows =
    elimRefs.length === 0
      ? []
      : await db
          .select({
            seedRef: schema.seedResolutions.seedRef,
            teamId: schema.seedResolutions.teamId,
          })
          .from(schema.seedResolutions)
          .where(
            and(
              eq(schema.seedResolutions.meetId, meetId),
              inArray(schema.seedResolutions.seedRef, elimRefs),
            ),
          )
  const elimMap = new Map(elimRows.map((r) => [r.seedRef, r.teamId]))

  const seatTeamIds = seats.map((s) => {
    if (s.letter) return letters.get(s.letter) ?? null
    if (s.seedRef) return elimMap.get(s.seedRef) ?? null
    return null
  })
  const teamIds = Array.from(new Set(seatTeamIds.filter((t): t is number => t !== null)))
  const [teamRows, rosterRows] =
    teamIds.length === 0
      ? [[], []]
      : await Promise.all([
          db
            .select({
              id: schema.teams.id,
              churchId: schema.churches.id,
              churchName: schema.churches.name,
              churchShortName: schema.churches.shortName,
              division: schema.teams.division,
              number: schema.teams.number,
              consolation: schema.teams.consolation,
            })
            .from(schema.teams)
            .innerJoin(schema.churches, eq(schema.churches.id, schema.teams.churchId))
            .where(and(eq(schema.teams.meetId, meetId), inArray(schema.teams.id, teamIds))),
          db
            .select({
              teamId: schema.teamRosters.teamId,
              quizzerId: schema.teamRosters.quizzerId,
              name: schema.teamRosters.name,
            })
            .from(schema.teamRosters)
            .where(inArray(schema.teamRosters.teamId, teamIds)),
        ])

  const teamById = new Map(teamRows.map((t) => [t.id, t]))
  const rosterByTeam = new Map<number, { quizzerId: number; name: string }[]>()
  for (const r of rosterRows) {
    const arr = rosterByTeam.get(r.teamId) ?? []
    arr.push({ quizzerId: r.quizzerId, name: r.name })
    rosterByTeam.set(r.teamId, arr)
  }

  return c.json({
    quiz,
    seats: seats.map((s, i) => {
      const tid = seatTeamIds[i]
      const team = tid !== null && tid !== undefined ? (teamById.get(tid) ?? null) : null
      return {
        seatNumber: s.seatNumber,
        letter: s.letter,
        seedRef: s.seedRef,
        team,
        quizzers: tid !== null && tid !== undefined ? (rosterByTeam.get(tid) ?? []) : [],
      }
    }),
  })
}

/**
 * GET /api/meets/:id/prelim-assignments
 *
 * Returns the team→letter mapping for every division in the meet.
 * Readable by any member of the meet (`requireViewer`).
 */
schedule.get('/:id/prelim-assignments', async (c) => {
  const meetId = Number(c.req.param('id'))
  if (Number.isNaN(meetId)) return c.json({ error: 'Invalid meet ID' }, 400)

  const denied = await requireViewer(c, meetId)
  if (denied) return denied

  const db = getDb(c)
  const published = await publishedLegacy(db, meetId)
  if (published) {
    // The old route would otherwise show the draw that the published view hides
    const view = await readerView(c, db, meetId)
    return c.json({ assignments: view === 'teams' ? published.assignments : [] })
  }
  const rows = await db
    .select()
    .from(schema.prelimAssignments)
    .where(eq(schema.prelimAssignments.meetId, meetId))
    .orderBy(schema.prelimAssignments.division, schema.prelimAssignments.letter)
  return c.json({ assignments: rows })
})

// ---- Linked schedules (specs/005-schedule-redesign/contracts/api.md) ----

/** A document from a request body, or the reason it isn't one */
function documentOf(raw: unknown, meetId: number): ScheduleDocument | string {
  try {
    const doc = parseScheduleFile(JSON.stringify(raw))
    doc.link = { ...doc.link, meetId }
    return doc
  } catch (e) {
    return e instanceof Error ? e.message : 'Not a valid schedule'
  }
}

async function draftRow(db: Db, meetId: number) {
  const [row] = await db
    .select()
    .from(schema.meetSchedules)
    .where(eq(schema.meetSchedules.meetId, meetId))
  return row ?? null
}

async function addVersion(
  db: Db,
  meetId: number,
  doc: ScheduleDocument,
  by: { id: string | null; name: string },
) {
  const [row] = await versionInsert(db, meetId, doc, by)
  return row!
}

/** The insert that adds a version, to run alone or in a batch */
function versionInsert(
  db: Db,
  meetId: number,
  doc: ScheduleDocument,
  by: { id: string | null; name: string },
) {
  const v = schema.meetScheduleVersions
  // Numbered in the insert itself, so two publishes at once can't take the same number
  return db
    .insert(v)
    .values({
      meetId,
      version: sql<number>`(SELECT COALESCE(MAX(${v.version}), 0) + 1 FROM ${v} WHERE ${v.meetId} = ${meetId})`,
      document: serializeSchedule(doc),
      publishedAt: new Date(),
      publishedByAccountId: by.id,
      publishedByName: by.name,
    })
    .returning()
}

/** The meet's old schedule rows, or null when it has none to convert */
async function loadLegacy(db: Db, meetId: number): Promise<LegacySchedule | null> {
  const [meet] = await db.select().from(schema.quizMeets).where(eq(schema.quizMeets.id, meetId))
  if (!meet) return null
  const [slots, quizzes, rooms, assignments, teams] = await Promise.all([
    db.select().from(schema.meetSlots).where(eq(schema.meetSlots.meetId, meetId)),
    db.select().from(schema.scheduledQuizzes).where(eq(schema.scheduledQuizzes.meetId, meetId)),
    db
      .select({ id: schema.meetRooms.id, name: schema.meetRooms.name })
      .from(schema.meetRooms)
      .where(eq(schema.meetRooms.meetId, meetId))
      .orderBy(asc(schema.meetRooms.sortOrder), asc(schema.meetRooms.id)),
    db
      .select({
        division: schema.prelimAssignments.division,
        letter: schema.prelimAssignments.letter,
        teamId: schema.prelimAssignments.teamId,
      })
      .from(schema.prelimAssignments)
      .where(eq(schema.prelimAssignments.meetId, meetId)),
    db
      .select({
        id: schema.teams.id,
        division: schema.teams.division,
        lateness: schema.teams.lateness,
      })
      .from(schema.teams)
      .where(eq(schema.teams.meetId, meetId)),
  ])
  if (slots.length === 0 && quizzes.length === 0) return null
  const seats =
    quizzes.length === 0
      ? []
      : await db
          .select()
          .from(schema.scheduledQuizSeats)
          .where(
            inArray(
              schema.scheduledQuizSeats.quizId,
              quizzes.map((q) => q.id),
            ),
          )
  const divisions = JSON.parse(meet.divisions) as string[]
  return {
    meet: { id: meet.id, name: meet.name, divisions },
    rooms,
    slots,
    quizzes,
    seats,
    assignments,
    teams,
  }
}

/**
 * GET /api/meets/:id/schedule: the draft and the newest published version, for the builder.
 * A meet built with the old editor is converted on first open (research R5); `timeZone`, the
 * builder's, places the old slots' instants on the meet's days.
 */
schedule.get('/:id/schedule', async (c) => {
  const meetId = meetIdOf(c)
  if (meetId === null) return c.json({ error: 'Invalid meet ID' }, 400)
  const denied = await requireAdmin(c, meetId)
  if (denied) return denied
  const db = getDb(c)

  let row = await draftRow(db, meetId)
  // Only a meet that never had a document is converted: after unlinking, the old rows stay stale
  const legacy = row || (await newestVersion(db, meetId)) ? null : await loadLegacy(db, meetId)
  if (legacy) {
    const doc = documentFromLegacy(legacy, c.req.query('timeZone') || 'UTC')
    const inserted = await db
      .insert(schema.meetSchedules)
      .values({ meetId, draft: serializeSchedule(doc), draftRevision: 1, draftSavedAt: new Date() })
      .onConflictDoNothing()
      .returning({ id: schema.meetSchedules.id })
    // Another admin opening at the same moment converted it already
    if (inserted.length > 0) {
      await addVersion(db, meetId, doc, { id: null, name: 'Converted from the old schedule' })
    }
    row = await draftRow(db, meetId)
  }

  const [published, results] = await Promise.all([
    newestVersion(db, meetId),
    db
      .select({ quizKey: schema.quizResults.quizKey })
      .from(schema.quizResults)
      .where(eq(schema.quizResults.meetId, meetId)),
  ])
  return c.json({
    draft: row ? JSON.parse(row.draft) : null,
    draftRevision: row?.draftRevision ?? 0,
    draftSavedAt: row?.draftSavedAt ?? null,
    published: published ? JSON.parse(published.document) : null,
    publishedAt: published?.publishedAt ?? null,
    version: published?.version ?? null,
    results: results.map((r) => r.quizKey),
  })
})

/**
 * A team the draw names that isn't the meet's, or null. Readers are shown the draw's teams and
 * rosters, so a team from another meet would show that meet's quizzers.
 */
async function foreignTeam(db: Db, meetId: number, doc: ScheduleDocument): Promise<number | null> {
  const ids = [
    ...new Set(
      Object.values(doc.draw).flatMap((d) =>
        d.teams.flatMap((t) => (t.teamId === undefined ? [] : [t.teamId])),
      ),
    ),
  ]
  if (ids.length === 0) return null
  const own = await inChunks(ids, 2, (chunk) =>
    db
      .select({ id: schema.teams.id })
      .from(schema.teams)
      .where(and(eq(schema.teams.meetId, meetId), inArray(schema.teams.id, chunk))),
  )
  const owned = new Set(own.map((t) => t.id))
  return ids.find((id) => !owned.has(id)) ?? null
}

/** The 409 for a save or publish based on an older draft, carrying the newer one (FR-048a) */
function staleDraft(c: Context<Env>, row: schema.MeetSchedule | null) {
  return c.json(
    {
      error: 'The draft was changed since you opened it',
      draft: row ? JSON.parse(row.draft) : null,
      draftRevision: row?.draftRevision ?? 0,
    },
    409,
  )
}

/** Write the draft if `baseRevision` is the current one; otherwise the 409 with the newer draft */
async function saveDraft(
  c: Context<Env>,
  meetId: number,
  doc: ScheduleDocument,
  baseRevision: unknown,
  replace = false,
) {
  const db = getDb(c)
  const row = await draftRow(db, meetId)
  const current = row?.draftRevision ?? 0
  if (baseRevision !== current) return staleDraft(c, row)
  // Revisions restart after an unlink, so a matching revision of a different draft is still stale,
  // unless the director chose to replace it
  if (row && !replace && (JSON.parse(row.draft) as ScheduleDocument).id !== doc.id) {
    return staleDraft(c, row)
  }
  const draftSavedAt = new Date()
  const draftRevision = current + 1
  if (row) {
    // The revision in the WHERE makes a save that raced another one change nothing
    const updated = await db
      .update(schema.meetSchedules)
      .set({ draft: serializeSchedule(doc), draftRevision, draftSavedAt })
      .where(
        and(
          eq(schema.meetSchedules.meetId, meetId),
          eq(schema.meetSchedules.draftRevision, current),
        ),
      )
      .returning({ id: schema.meetSchedules.id })
    if (updated.length === 0) return staleDraft(c, await draftRow(db, meetId))
  } else {
    // Two first saves at once: the second finds the first's draft, as a stale save would
    const inserted = await db
      .insert(schema.meetSchedules)
      .values({ meetId, draft: serializeSchedule(doc), draftRevision, draftSavedAt })
      .onConflictDoNothing()
      .returning({ id: schema.meetSchedules.id })
    if (inserted.length === 0) return staleDraft(c, await draftRow(db, meetId))
  }
  return c.json({ draftRevision, draftSavedAt })
}

schedule.put('/:id/schedule/draft', async (c) => {
  const meetId = meetIdOf(c)
  if (meetId === null) return c.json({ error: 'Invalid meet ID' }, 400)
  const denied = await requireAdmin(c, meetId)
  if (denied) return denied

  const body = await jsonBody<{ document?: unknown; baseRevision?: unknown; replace?: unknown }>(c)
  if (!body) return c.json({ error: 'Expected a JSON body' }, 400)
  const doc = documentOf(body.document, meetId)
  if (typeof doc === 'string') return c.json({ error: doc }, 400)
  const foreign = await foreignTeam(getDb(c), meetId, doc)
  if (foreign !== null) return c.json({ error: `Team ${foreign} is not in this meet` }, 400)
  return saveDraft(c, meetId, doc, body.baseRevision, body.replace === true)
})

/**
 * Make the meet's rooms match the schedule's (FR-047): add the rooms without a meet room, rename
 * and reorder the rest, and remove a room the schedule no longer uses unless it has an official
 * code, officials or results, so nobody is locked out mid-meet. Fills in `meetRoomId` on the document.
 */
async function syncRooms(
  db: Db,
  meetId: number,
  doc: ScheduleDocument,
): Promise<{ statements: PromiseLike<unknown>[]; unusedRooms: { id: number; name: string }[] }> {
  // New rooms are added at once, for their ids; a publish that then fails leaves them unused, and
  // the next publish takes them back by name. Renames and removals are handed back to run with the
  // publish, so a publish that fails leaves the meet's existing rooms as they were
  const statements: PromiseLike<unknown>[] = []
  const current = await db
    .select()
    .from(schema.meetRooms)
    .where(eq(schema.meetRooms.meetId, meetId))
  const byId = new Map(current.map((r) => [r.id, r]))
  // Each meet room belongs to one schedule room; a second claim to it is treated as none
  const owner = new Map<number, string>()
  for (const r of doc.rooms) {
    if (r.meetRoomId !== undefined && byId.has(r.meetRoomId) && !owner.has(r.meetRoomId)) {
      owner.set(r.meetRoomId, r.id)
    }
  }
  const claimed = new Set(owner.keys())
  for (const [i, room] of doc.rooms.entries()) {
    if (room.meetRoomId !== undefined && owner.get(room.meetRoomId) !== room.id) {
      delete room.meetRoomId
    }
    // A room that lost its meet room (an undo, say) takes back an unclaimed one of the same name
    let existing = room.meetRoomId === undefined ? undefined : byId.get(room.meetRoomId)
    if (!existing) {
      existing = current.find((r) => r.name === room.name && !claimed.has(r.id))
      if (existing) {
        room.meetRoomId = existing.id
        claimed.add(existing.id)
      }
    }
    if (!existing) {
      const [added] = await db
        .insert(schema.meetRooms)
        .values({ meetId, name: room.name, sortOrder: i })
        .returning({ id: schema.meetRooms.id })
      room.meetRoomId = added!.id
      continue
    }
    if (existing.name !== room.name || existing.sortOrder !== i) {
      statements.push(
        db
          .update(schema.meetRooms)
          .set({ name: room.name, sortOrder: i })
          .where(eq(schema.meetRooms.id, existing.id)),
      )
    }
  }
  const used = new Set(doc.rooms.map((r) => r.meetRoomId))
  const unused = current.filter((r) => !used.has(r.id))
  if (unused.length === 0) return { statements, unusedRooms: [] }
  // Removing a room drops its officials' memberships and unlinks its results, so a room with
  // either, or with a code, stays
  const ids = unused.map((r) => r.id)
  const [officials, results] = await Promise.all([
    db
      .select({ roomId: schema.officialMemberships.roomId })
      .from(schema.officialMemberships)
      .where(inArray(schema.officialMemberships.roomId, ids)),
    db
      .select({ roomId: schema.quizResults.roomId })
      .from(schema.quizResults)
      .where(inArray(schema.quizResults.roomId, ids)),
  ])
  const inUse = new Set([...officials, ...results].map((r) => r.roomId))
  const kept = unused.filter((r) => r.codeHash !== null || inUse.has(r.id))
  const removable = unused.filter((r) => !kept.includes(r)).map((r) => r.id)
  if (removable.length > 0) {
    statements.push(db.delete(schema.meetRooms).where(inArray(schema.meetRooms.id, removable)))
  }
  return { statements, unusedRooms: kept.map((r) => ({ id: r.id, name: r.name })) }
}

schedule.post('/:id/schedule/publish', async (c) => {
  const meetId = meetIdOf(c)
  if (meetId === null) return c.json({ error: 'Invalid meet ID' }, 400)
  const denied = await requireAdmin(c, meetId)
  if (denied) return denied
  const db = getDb(c)

  const body = await jsonBody<{ baseRevision?: unknown; confirmConflicts?: unknown }>(c)
  if (!body) return c.json({ error: 'Expected a JSON body' }, 400)
  const row = await draftRow(db, meetId)
  if (!row) return c.json({ error: 'There is no draft to publish' }, 404)
  if (body.baseRevision !== row.draftRevision) return staleDraft(c, row)
  const doc = JSON.parse(row.draft) as ScheduleDocument
  // Checked as the builder checks it: the grid against the settings it was built with
  const conflicts = checkSchedule({ ...doc, settings: doc.applied }).filter((x) => !x.warning)
  if (conflicts.length > 0 && body.confirmConflicts !== true) {
    return c.json({ error: 'The schedule has hard conflicts', conflicts }, 409)
  }

  // Claim the next revision first, so a save landing meanwhile is refused as stale, not overwritten
  const draftSavedAt = new Date()
  const draftRevision = row.draftRevision + 1
  const claimed = await db
    .update(schema.meetSchedules)
    .set({ draftRevision, draftSavedAt })
    .where(
      and(
        eq(schema.meetSchedules.meetId, meetId),
        eq(schema.meetSchedules.draftRevision, row.draftRevision),
      ),
    )
    .returning({ id: schema.meetSchedules.id })
  if (claimed.length === 0) return staleDraft(c, await draftRow(db, meetId))

  let unusedRooms: { id: number; name: string }[]
  let version: schema.MeetScheduleVersion
  try {
    const rooms = await syncRooms(db, meetId, doc)
    unusedRooms = rooms.unusedRooms
    const user = getUser(c)
    // One batch: the rooms, the draft with its meet rooms, and the version, all or none
    const results = await asOne(db, [
      ...rooms.statements,
      db
        .update(schema.meetSchedules)
        .set({ draft: serializeSchedule(doc) })
        .where(
          and(
            eq(schema.meetSchedules.meetId, meetId),
            eq(schema.meetSchedules.draftRevision, draftRevision),
          ),
        ),
      versionInsert(db, meetId, doc, { id: user.id, name: user.name }),
    ])
    version = (results[results.length - 1] as schema.MeetScheduleVersion[])[0]!
  } catch (e) {
    // Nothing was published, so the claimed revision goes back and the director's next save fits
    await db
      .update(schema.meetSchedules)
      .set({ draftRevision: row.draftRevision })
      .where(
        and(
          eq(schema.meetSchedules.meetId, meetId),
          eq(schema.meetSchedules.draftRevision, draftRevision),
        ),
      )
    throw e
  }
  return c.json({
    version: version.version,
    publishedAt: version.publishedAt,
    draftRevision,
    draftSavedAt,
    rooms: doc.rooms,
    unusedRooms,
  })
})

schedule.get('/:id/schedule/versions', async (c) => {
  const meetId = meetIdOf(c)
  if (meetId === null) return c.json({ error: 'Invalid meet ID' }, 400)
  const denied = await requireAdmin(c, meetId)
  if (denied) return denied

  const rows = await getDb(c)
    .select({
      version: schema.meetScheduleVersions.version,
      publishedAt: schema.meetScheduleVersions.publishedAt,
      publishedBy: schema.meetScheduleVersions.publishedByName,
    })
    .from(schema.meetScheduleVersions)
    .where(eq(schema.meetScheduleVersions.meetId, meetId))
    .orderBy(desc(schema.meetScheduleVersions.version))
  return c.json(rows)
})

async function versionRow(db: Db, meetId: number, version: number) {
  const [row] = await db
    .select()
    .from(schema.meetScheduleVersions)
    .where(
      and(
        eq(schema.meetScheduleVersions.meetId, meetId),
        eq(schema.meetScheduleVersions.version, version),
      ),
    )
  return row ?? null
}

schedule.get('/:id/schedule/versions/:version', async (c) => {
  const meetId = meetIdOf(c)
  if (meetId === null) return c.json({ error: 'Invalid meet ID' }, 400)
  const denied = await requireAdmin(c, meetId)
  if (denied) return denied

  const row = await versionRow(getDb(c), meetId, Number(c.req.param('version')))
  if (!row) return c.json({ error: 'No such version' }, 404)
  return c.json({
    version: row.version,
    publishedAt: row.publishedAt,
    publishedBy: row.publishedByName,
    document: JSON.parse(row.document),
  })
})

schedule.post('/:id/schedule/versions/:version/restore', async (c) => {
  const meetId = meetIdOf(c)
  if (meetId === null) return c.json({ error: 'Invalid meet ID' }, 400)
  const denied = await requireAdmin(c, meetId)
  if (denied) return denied

  const row = await versionRow(getDb(c), meetId, Number(c.req.param('version')))
  if (!row) return c.json({ error: 'No such version' }, 404)
  const body = await jsonBody<{ baseRevision?: unknown }>(c)
  if (!body) return c.json({ error: 'Expected a JSON body' }, 400)
  // Restoring replaces the draft by choice, whichever draft it was
  return saveDraft(c, meetId, JSON.parse(row.document) as ScheduleDocument, body.baseRevision, true)
})

/** Unlink (FR-048): the draft goes; published versions stay as the record of what was out */
schedule.delete('/:id/schedule', async (c) => {
  const meetId = meetIdOf(c)
  if (meetId === null) return c.json({ error: 'Invalid meet ID' }, 400)
  const denied = await requireAdmin(c, meetId)
  if (denied) return denied

  await getDb(c).delete(schema.meetSchedules).where(eq(schema.meetSchedules.meetId, meetId))
  return c.json({ ok: true })
})

/**
 * The published schedule, open to a guest token for the meet as well as an account
 * (contracts/api.md). Its own router, with middleware scoped to its path like `results`, so it
 * can mount ahead of the account-only routers.
 */
export const publishedSchedule = new Hono<Env>()
publishedSchedule.use('/:id/schedule/published', requireAuthOrGuest())
publishedSchedule.use('/:id/schedule/published', async (c, next) => {
  if (!c.get('db')) c.set('db', createDb(c.env.DB) as unknown as Db)
  await next()
})

/**
 * GET /api/meets/:id/schedule/published: the newest version for anyone with access to the meet.
 * Letters while the meet is in registration or build, with the draw's teams removed; team names,
 * read from the meet, from live on (FR-052). Admins see teams and may ask for either.
 */
publishedSchedule.get('/:id/schedule/published', async (c) => {
  const meetId = meetIdOf(c)
  if (meetId === null) return c.json({ error: 'Invalid meet ID' }, 400)
  const denied = await requireViewer(c, meetId)
  if (denied) return denied
  const db = getDb(c)

  const [row, view, [meet]] = await Promise.all([
    newestVersion(db, meetId),
    readerView(c, db, meetId),
    db
      .select({ name: schema.quizMeets.name })
      .from(schema.quizMeets)
      .where(eq(schema.quizMeets.id, meetId)),
  ])
  let doc: ScheduleDocument
  let publishedAt: Date
  if (row) {
    doc = JSON.parse(row.document) as ScheduleDocument
    publishedAt = row.publishedAt
  } else {
    // A meet still on the old tables, until an admin opens it in the builder: its schedule, read
    // as the conversion would, in the reader's time zone, and stored by nobody
    const legacy = await loadLegacy(db, meetId)
    if (!legacy) return c.json({ error: 'Nothing is published yet' }, 404)
    doc = documentFromLegacy(legacy, c.req.query('timeZone') || 'UTC')
    publishedAt = new Date()
  }

  if (view === 'letters') {
    for (const draw of Object.values(doc.draw)) {
      // Letters only, in letter order: names, team ids, and late or absent marks a reader could
      // match to a known team would all give the draw away
      draw.teams = draw.teams
        .map((t) => ({ letter: t.letter, late: false, absent: false }))
        .sort((x, y) => indexOfLetter(x.letter ?? '') - indexOfLetter(y.letter ?? ''))
    }
  } else {
    const names = await teamNames(db, meetId)
    for (const draw of Object.values(doc.draw)) {
      for (const t of draw.teams) {
        const name = t.teamId === undefined ? undefined : names.get(t.teamId)
        if (name) t.name = name
      }
    }
  }
  return c.json({ document: doc, publishedAt, view, meetName: meet?.name ?? doc.name })
})

/** Each team's name as the portal shows it */
async function teamNames(db: Db, meetId: number) {
  const rows = await db
    .select({
      id: schema.teams.id,
      shortName: schema.churches.shortName,
      number: schema.teams.number,
    })
    .from(schema.teams)
    .innerJoin(schema.churches, eq(schema.churches.id, schema.teams.churchId))
    .where(eq(schema.teams.meetId, meetId))
  return new Map(rows.map((r) => [r.id, teamDisplayName(r)]))
}
