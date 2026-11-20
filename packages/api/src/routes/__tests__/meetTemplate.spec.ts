import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { strToU8, zipSync } from 'fflate'
import { MeetRole, type MeetPhase } from '@qzr/shared'
import { eq } from 'drizzle-orm'
import type { Bindings } from '../../bindings'
import type { SessionUser } from '../../middleware/session'
import type { MeetsVariables } from '../meets'
import { meets } from '../meets'
import * as schema from '../../db/schema'
import { mockSession, mockDb, testSuperuser, testUser, jsonOf, seedMeet } from '../../test-utils'
import { createTestDb } from '../../test-db'
import type { Db } from '../../lib/db'
import type { GuestPayload } from '../../lib/jwt'

const env = { ENVIRONMENT: 'test' } as unknown as Bindings

function createApp(db: Db, user: SessionUser | null, guest: GuestPayload | null = null) {
  const app = new Hono<{ Bindings: Bindings; Variables: MeetsVariables }>()
  app.use('*', mockSession(user, guest))
  app.use('*', mockDb(db))
  app.route('/api/meets', meets)
  return app
}

/** A spreadsheet holding the given sheets, as LibreOffice would zip it */
function spreadsheet(sheetNames: string[]): Uint8Array {
  const tables = sheetNames.map((name) => `<table:table table:name="${name}"></table:table>`)
  const content =
    '<?xml version="1.0"?><office:document-content><office:body><office:spreadsheet>' +
    tables.join('') +
    '</office:spreadsheet></office:body></office:document-content>'
  return zipSync({
    mimetype: [strToU8('application/vnd.oasis.opendocument.spreadsheet-template'), { level: 0 }],
    'content.xml': strToU8(content),
  })
}

const template = spreadsheet(['Quiz', 'Calculations'])

let db: Db
let meetId: number

async function seed(phase: MeetPhase = 'live') {
  db = await createTestDb()
  meetId = (await seedMeet(db, 'Template Meet', { phase })).id
}

function put(user: SessionUser | null, bytes: Uint8Array = template, fileName = 'Scoresheet.ots') {
  return createApp(db, user).request(
    `/api/meets/${meetId}/template`,
    { method: 'PUT', headers: { 'X-File-Name': fileName }, body: bytes as Uint8Array<ArrayBuffer> },
    env,
  )
}

function get(user: SessionUser | null, guest: GuestPayload | null = null, method = 'GET') {
  return createApp(db, user, guest).request(`/api/meets/${meetId}/template`, { method }, env)
}

const guest = (
  role: MeetRole.Official | MeetRole.Viewer,
  forMeet = () => meetId,
): GuestPayload => ({
  meetId: forMeet(),
  role,
  label: role === MeetRole.Official ? 'Room 1' : 'Viewer',
})

beforeEach(() => seed())

describe('PUT /api/meets/:id/template', () => {
  it("stores the admin's template and replaces it on a second upload", async () => {
    expect((await put(testSuperuser)).status).toBe(200)
    const second = spreadsheet(['Quiz', 'Summaries'])
    const res = await put(testSuperuser, second, 'Scoresheet 2026.ots')
    expect(res.status).toBe(200)
    expect(await jsonOf(res)).toMatchObject({ fileName: 'Scoresheet 2026.ots' })

    const rows = await db.select().from(schema.meetTemplates)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.fileName).toBe('Scoresheet 2026.ots')
    expect(new Uint8Array(rows[0]!.bytes)).toEqual(second)
  })

  it('stores a meet admin’s upload', async () => {
    await db.insert(schema.adminMemberships).values({ accountId: testUser.id, meetId })
    expect((await put(testUser)).status).toBe(200)
  })

  it('refuses a spreadsheet with no Quiz sheet', async () => {
    const res = await put(testSuperuser, spreadsheet(['Sheet1']))
    expect(res.status).toBe(400)
    expect((await jsonOf<{ error: string }>(res)).error).toMatch(/scoring template/)
    expect(await db.select().from(schema.meetTemplates)).toEqual([])
  })

  it('refuses a filled sheet, whose marks would show through every fill', async () => {
    const filled = zipSync({
      'content.xml': strToU8(
        '<office:document-content><office:body><office:spreadsheet><table:table table:name="Quiz">' +
          '<table:table-row/><table:table-row/><table:table-row/><table:table-row/>' +
          '<table:table-row><table:table-cell/><table:table-cell office:value-type="string"><text:p>Calgary 1</text:p></table:table-cell></table:table-row>' +
          '</table:table></office:spreadsheet></office:body></office:document-content>',
      ),
    })
    const res = await put(testSuperuser, filled)
    expect(res.status).toBe(400)
    expect((await jsonOf<{ error: string }>(res)).error).toMatch(/filled in/)
  })

  it('refuses a sheet with only quizzer names filled in', async () => {
    const named = zipSync({
      'content.xml': strToU8(
        '<office:document-content><office:body><office:spreadsheet><table:table table:name="Quiz">' +
          '<table:table-row/><table:table-row/><table:table-row/><table:table-row/><table:table-row/>' +
          '<table:table-row><table:table-cell/><table:table-cell office:value-type="string"><text:p>Ann</text:p></table:table-cell></table:table-row>' +
          '</table:table></office:spreadsheet></office:body></office:document-content>',
      ),
    })
    expect((await put(testSuperuser, named)).status).toBe(400)
  })

  it('refuses a declared size over the limit without reading the body', async () => {
    const res = await createApp(db, testSuperuser).request(
      `/api/meets/${meetId}/template`,
      {
        method: 'PUT',
        headers: { 'Content-Length': '5000000' },
        body: template as Uint8Array<ArrayBuffer>,
      },
      env,
    )
    expect(res.status).toBe(400)
  })

  it('keeps a file name sent encoded, as the portal sends it', async () => {
    await put(testSuperuser, template, encodeURIComponent('Scoresheet – 2026.ots'))
    const [row] = await db.select().from(schema.meetTemplates)
    expect(row!.fileName).toBe('Scoresheet – 2026.ots')
  })

  it('refuses a file that is not a spreadsheet', async () => {
    expect((await put(testSuperuser, strToU8('not a zip'))).status).toBe(400)
  })

  it('refuses a file over 2 MB', async () => {
    const res = await put(testSuperuser, new Uint8Array(2 * 1024 * 1024 + 1))
    expect(res.status).toBe(400)
    expect((await jsonOf<{ error: string }>(res)).error).toMatch(/1.9 MB/)
  })

  it('refuses anyone but an admin', async () => {
    expect((await put(testUser)).status).toBe(403)
    expect((await put(null)).status).toBe(401)
  })

  it('refuses an upload once the meet is done', async () => {
    await db.update(schema.quizMeets).set({ phase: 'done' }).where(eq(schema.quizMeets.id, meetId))
    expect((await put(testSuperuser)).status).toBe(409)
  })
})

describe('GET /api/meets/:id/template', () => {
  it('answers 404 while the meet has no template', async () => {
    expect((await get(testSuperuser)).status).toBe(404)
  })

  it('serves the bytes, named and dated, to the meet’s viewers, officials and admins', async () => {
    await put(testSuperuser)
    for (const res of [
      await get(null, guest(MeetRole.Viewer)),
      await get(null, guest(MeetRole.Official)),
      await get(testSuperuser),
    ]) {
      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Disposition')).toContain('Scoresheet.ots')
      expect(res.headers.get('Last-Modified')).toBeTruthy()
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(template)
    }
  })

  it('refuses anyone without access to the meet', async () => {
    await put(testSuperuser)
    const otherMeet = (await seedMeet(db, 'Other Meet')).id
    expect(
      (
        await get(
          null,
          guest(MeetRole.Viewer, () => otherMeet),
        )
      ).status,
    ).toBe(403)
    expect((await get(testUser)).status).toBe(403)
  })

  it('answers HEAD with the headers and no body', async () => {
    await put(testSuperuser)
    const res = await get(testSuperuser, null, 'HEAD')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Disposition')).toContain('Scoresheet.ots')
    expect((await res.arrayBuffer()).byteLength).toBe(0)
  })
})
