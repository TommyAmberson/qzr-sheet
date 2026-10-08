import { ref } from 'vue'
import { ApiError, MeetRole } from '@qzr/shared'

/**
 * Guest session state for visitors who don't have an account. Two entry points:
 *
 * 1. Shareable URL — `/qzr/scoresheet/?meet=<viewerCode>` auto-joins as viewer on
 *    page load. Restricted to viewer codes only (the URL is shareable, so we
 *    can't trust the recipient with an official code).
 * 2. "Have a code?" form in the meet picker — accepts viewer or official
 *    codes, the user is typing them in directly.
 *
 * The session keeps a list of every meet the user has joined this way and
 * tracks which one is currently active. The scoresheet and the portal share
 * one origin, so they share the stored session: a code joined in either app
 * works in both. Each app passes its own join call (`GuestJoin`). The API client's `request()` wrapper
 * reads a token through `withGuestToken()`: the joined session of the request's
 * meet or else the active one, and attaches it as `Authorization: Bearer`.
 * This module is a non-`use*` module so the API client can read state
 * synchronously without going through Vue's composable contract.
 */

export const STORAGE_KEY = 'qzr-guest-session'

/** A room of a meet, as a guest official's session keeps it */
export interface GuestRoom {
  id: number
  name: string
}

/** What POST /api/join/guest answers for a code */
export interface GuestJoinAnswer {
  token: string
  meet: { id: number; name: string }
  role: string
  /** The room a room code belongs to */
  room?: GuestRoom
}

/** An app's call to POST /api/join/guest: the answer for a code; a refused code throws `ApiError` */
export type GuestJoin = (code: string) => Promise<GuestJoinAnswer>
const URL_PARAM = 'meet'
/** Skew applied to the JWT exp claim — refresh if less than this remaining. */
const REFRESH_SKEW_MS = 5 * 60 * 1000

export interface GuestSessionData {
  token: string
  meetId: number
  meetName: string
  role: MeetRole.Viewer | MeetRole.Official
  /** A viewer's code (URL slug or typed in), kept to renew the session; never kept for an official */
  code?: string
  /** An official's room, from the join; absent on sessions saved by earlier releases */
  room?: GuestRoom
}

interface GuestState {
  /** meetId of the active session whose token is sent on requests. */
  active: number | null
  joined: GuestSessionData[]
}

const EMPTY_STATE: GuestState = { active: null, joined: [] }

export const guestStateRef = ref<GuestState>(loadFromStorage())

const MEET_PATH = /^\/api\/meets\/(\d+)(?:[/?]|$)/

/** What the apps tell the user about a guest session that ended on its own: shown, then dismissed */
export const guestNotice = ref<string | null>(null)

/**
 * Wrap an app's API client so each request carries the guest token for its meet (see
 * `requestMeetId`); pass `meetId` when the path doesn't name the meet. A signed-in user's cookie
 * takes precedence on the server, so they never need the header.
 *
 * A viewer session renews itself from its kept code: before a request when its token is known to
 * have expired, and once after a 401 to a request about its meet. A renewal the server rejects
 * removes the session and says so in `guestNotice`; one that fails otherwise (offline, the server
 * failing) leaves the request to go with the token it has, or the 401 it had. Officials are asked for their room code around the actions that need it instead
 * (`withRoomCode`), since that takes a person.
 */
export function withGuestToken(
  baseRequest: <T>(path: string, init?: RequestInit) => Promise<T>,
  join: GuestJoin,
): <T>(path: string, init?: RequestInit, meetId?: number) => Promise<T> {
  return async <T>(path: string, init?: RequestInit, meetId?: number) => {
    const send = (token: string | null) =>
      baseRequest<T>(
        path,
        token ? { ...init, headers: { ...init?.headers, Authorization: `Bearer ${token}` } } : init,
      )
    const id = requestMeetId(path, meetId)
    let session = id === undefined ? getActiveSession() : joinedSession(id)
    if (session?.role === MeetRole.Viewer && !tokenIsFresh(session.token)) {
      const stale = session
      session = await renewViewer(stale, join).catch(() => stale)
    }
    try {
      return await send(session?.token ?? null)
    } catch (e) {
      // A 401 to a request about no meet, such as the account's own meets, says nothing of the token
      if (id === undefined || session?.role !== MeetRole.Viewer || !isUnauthorized(e)) throw e
      const renewed = await renewViewer(session, join).catch(() => null)
      if (!renewed) throw e
      return send(renewed.token)
    }
  }
}

/**
 * The meet a request is about: `meetId` when given, else the one the path names. Its token is that
 * meet's joined session's, whichever meet is active, so a guest who has joined several meets never
 * sends one meet's token to another; a request about no meet carries the active session's.
 */
function requestMeetId(path: string, meetId?: number): number | undefined {
  const pathMeetId = MEET_PATH.exec(path)?.[1]
  return meetId ?? (pathMeetId === undefined ? undefined : Number(pathMeetId))
}

/**
 * A code's join answer, or null when the server refuses the code. Anything else, a network failure
 * or a server error, is thrown, so a code that still works is never dropped.
 */
async function rejoin(join: GuestJoin, code: string): Promise<GuestJoinAnswer | null> {
  try {
    return await join(code)
  } catch (e) {
    if (isRefusal(e)) return null
    throw e
  }
}

/**
 * Whether the server answered that a code is no good, rather than failing, timing out, limiting the
 * rate, or finding the account signed out
 */
function isRefusal(e: unknown): boolean {
  return (
    e instanceof ApiError &&
    e.status >= 400 &&
    e.status < 500 &&
    ![401, 408, 429].includes(e.status)
  )
}

function isUnauthorized(e: unknown): boolean {
  return e instanceof ApiError && e.status === 401
}

/** Renewals in flight, by meet, so requests sent together renew a session once */
const renewing = new Map<number, Promise<GuestSessionData | null>>()

/** Renew a viewer session from its kept code, or remove it and say why when that no longer works */
function renewViewer(session: GuestSessionData, join: GuestJoin): Promise<GuestSessionData | null> {
  let renewal = renewing.get(session.meetId)
  if (!renewal) {
    renewal = doRenewViewer(session, join).finally(() => renewing.delete(session.meetId))
    renewing.set(session.meetId, renewal)
  }
  return renewal
}

async function doRenewViewer(
  session: GuestSessionData,
  join: GuestJoin,
): Promise<GuestSessionData | null> {
  const res = session.code ? await rejoin(join, session.code) : null
  // Left, signed out, upgraded, or joined again while the join was on its way: what's kept stands
  const current = joinedSession(session.meetId)
  if (current?.token !== session.token) return current
  const renewed = res?.meet.id === session.meetId ? sessionFrom(res, session.code!) : null
  if (renewed?.role === MeetRole.Viewer) {
    addJoinedSession(renewed, guestStateRef.value.active === session.meetId)
    return renewed
  }
  removeSession(session.meetId)
  noticeCodeEnded(session)
  return null
}

function noticeCodeEnded(session: GuestSessionData): void {
  guestNotice.value = `The code for ${session.meetName} is no longer valid. Join again with the new code.`
}

/** A room the room-code dialog asks about */
export interface RoomCodeRow {
  meetId: number
  label: string
}

/** What `withRoomCode` and the sign-in upgrade ask of the room-code dialog */
export interface RoomCodeRequest {
  title: string
  detail: string
  rows: RoomCodeRow[]
  /** Check a code entered for a row: null accepts it, a message refuses it and is shown on the row */
  onCode: (row: RoomCodeRow, code: string) => Promise<string | null>
  submitLabel: string
  closeLabel: string
  /** Whether each row can be skipped */
  skip: boolean
}

/** The room-code dialog (`RoomCodeDialog`): true when every row's code was accepted */
interface RoomCodeAsker {
  ask(request: RoomCodeRequest): Promise<boolean>
}

/** What renewing an official session needs from the app */
export interface RoomCodeOptions {
  join: GuestJoin
  dialog: RoomCodeAsker | null | undefined
  /** An account decides while signed in, so nothing is asked */
  signedIn: boolean
}

/**
 * Run an action that needs a guest official's room (sending or correcting a quiz). When the
 * official's session is known to have expired, ask for the room code first; when the action is
 * refused because the session isn't accepted (401), ask, re-join, and run it once more. Undefined
 * when the official cancels. Nothing is asked for a meet joined as a viewer or not at all, or while
 * an account is signed in, since the account decides then.
 */
export async function withRoomCode<T>(
  meetId: number,
  action: () => Promise<T>,
  opts: RoomCodeOptions,
): Promise<T | undefined> {
  const session = joinedSession(meetId)
  if (opts.signedIn || session?.role !== MeetRole.Official) return action()
  // Only once it has expired: asking early would send an official for a code they don't yet need
  if (tokenHasExpired(session.token) && !(await askRoomCode(session, opts))) return undefined
  try {
    return await action()
  } catch (e) {
    if (!isUnauthorized(e)) throw e
    if (!(await askRoomCode(session, opts))) return undefined
    return action()
  }
}

/** Ask for the room code of an official session and re-join with it; false when cancelled */
async function askRoomCode(session: GuestSessionData, opts: RoomCodeOptions): Promise<boolean> {
  const room = session.room?.name
  return (
    (await opts.dialog?.ask({
      title: 'Room code needed',
      detail: `Your session for ${session.meetName} has ended. Enter ${room ? `${room}'s` : 'your room'} code to keep going.`,
      rows: [
        { meetId: session.meetId, label: room ? `${session.meetName}, ${room}` : session.meetName },
      ],
      onCode: async (_, code) => {
        let res
        try {
          res = await opts.join(code)
        } catch (e) {
          return isRefusal(e) ? "That isn't a room code." : "Couldn't reach the meet. Try again."
        }
        if (res.meet.id !== session.meetId) return 'That code is for another meet.'
        if (res.role !== MeetRole.Official) return "That's a viewer code; enter the room code."
        // The action is rerun for the room it was about, so another room's code can't stand in
        if (session.room && res.room?.id !== session.room.id) {
          return `That code is for ${res.room?.name ?? 'another room'}; enter ${session.room.name}'s code.`
        }
        addJoinedSession(sessionFrom(res, code)!, guestStateRef.value.active === session.meetId)
        return null
      },
      submitLabel: 'Join',
      closeLabel: 'Cancel',
      skip: false,
    })) ?? false
  )
}

/** The joined guest session for a meet, whichever meet is active */
export function joinedSession(meetId: number): GuestSessionData | null {
  return guestStateRef.value.joined.find((j) => j.meetId === meetId) ?? null
}

/** Active session (whose token would be attached to outgoing requests). */
export function getActiveSession(): GuestSessionData | null {
  const s = guestStateRef.value
  if (s.active === null) return null
  return s.joined.find((j) => j.meetId === s.active) ?? null
}

/** Replace the entire state. Pass null to clear everything (also drops the cached init promise). */
export function setGuestState(state: GuestState | null): void {
  guestStateRef.value = state ?? EMPTY_STATE
  persist()
  // Clearing also drops the cached init promise so the next initGuestSession()
  // call refetches a fresh token instead of resolving to the stale "previously
  // cleared" result.
  if (state === null) initPromise = null
}

/** Make a particular joined meet active. No-op if meetId isn't in the list (or null clears). */
export function setActiveSession(meetId: number | null): void {
  const state = guestStateRef.value
  if (meetId !== null && !state.joined.some((j) => j.meetId === meetId)) return
  guestStateRef.value = { ...state, active: meetId }
  persist()
}

/**
 * Add (or replace by meetId) a guest session in the joined list. The new
 * session is also made active when `makeActive` is true; the URL `?meet=` flow
 * passes true, the "Have a code?" form passes false.
 */
export function addJoinedSession(data: GuestSessionData, makeActive: boolean): void {
  const state = guestStateRef.value
  const filtered = state.joined.filter((j) => j.meetId !== data.meetId)
  guestStateRef.value = {
    active: makeActive ? data.meetId : state.active,
    joined: [...filtered, data],
  }
  persist()
}

/** Remove one meet's guest session, clearing the active marker if it pointed there */
function removeSession(meetId: number): void {
  const state = guestStateRef.value
  guestStateRef.value = {
    active: state.active === meetId ? null : state.active,
    joined: state.joined.filter((j) => j.meetId !== meetId),
  }
  persist()
}

/**
 * Cached promise from the first initGuestSession() call. Subsequent callers
 * await the same promise so the join round-trip happens once. App.vue kicks
 * this off at startup; consumers (e.g. MeetPickerDialog) await it before
 * branching on guest state to avoid a click-before-init race.
 */
let initPromise: Promise<GuestSessionData | null> | null = null

/**
 * Bootstrap from the URL: read `?meet=<slug>` and either reuse a fresh stored
 * session for that slug or call POST /api/join/guest. URL flow is restricted
 * to viewer codes — the link is shareable and we can't trust the recipient
 * with an official code. Safe and cheap to call multiple times — the first
 * call caches the in-flight promise and later calls await the same one.
 */
export function initGuestSession(join: GuestJoin): Promise<GuestSessionData | null> {
  if (!initPromise) initPromise = doInitGuestSession(join)
  return initPromise
}

async function doInitGuestSession(join: GuestJoin): Promise<GuestSessionData | null> {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  const slug = params.get(URL_PARAM)?.trim()
  if (!slug) return null

  const existing = guestStateRef.value.joined.find((j) => j.code === slug)
  if (existing && tokenIsFresh(existing.token)) {
    setActiveSession(existing.meetId)
    return existing
  }

  const res = await rejoin(join, slug)
  if (!res || res.role !== MeetRole.Viewer) return null
  const data = sessionFrom(res, slug)!
  addJoinedSession(data, true)
  return data
}

/**
 * Join a meet via a typed-in code (called from the "Have a code?" form).
 * Accepts viewer and official codes — the user is typing them in directly so
 * passing an official code is informed consent. Adds to the joined list but
 * does NOT switch the active session; the user picks the row to load it.
 */
export async function joinByCode(code: string, join: GuestJoin): Promise<GuestSessionData | null> {
  const trimmed = code.trim()
  if (!trimmed) return null
  const data = sessionFrom(await join(trimmed), trimmed)
  if (!data) return null
  addJoinedSession(data, false)
  return data
}

/**
 * The session a join answer gives: a viewer's keeps the code it was joined with, an official's keeps
 * the room instead and never the code. Null for any other role.
 */
function sessionFrom(res: GuestJoinAnswer, code: string): GuestSessionData | null {
  const base = { token: res.token, meetId: res.meet.id, meetName: res.meet.name }
  if (res.role === MeetRole.Viewer) return { ...base, role: MeetRole.Viewer, code }
  if (res.role !== MeetRole.Official) return null
  return { ...base, role: MeetRole.Official, ...(res.room ? { room: res.room } : {}) }
}

/**
 * Return true if the JWT is more than REFRESH_SKEW_MS away from expiring. We
 * never trust the exp claim for security (the server re-verifies), only to
 * decide when to skip a refresh round-trip.
 */
function tokenIsFresh(token: string): boolean {
  return tokenTimeLeftMs(token) > REFRESH_SKEW_MS
}

/** Whether the JWT's exp has passed, or it can't be read; like `tokenIsFresh`, never for security */
function tokenHasExpired(token: string): boolean {
  return tokenTimeLeftMs(token) <= 0
}

/** Milliseconds until the JWT's exp; zero when it has none or can't be read */
function tokenTimeLeftMs(token: string): number {
  try {
    const segments = token.split('.')
    if (segments.length < 2) return 0
    // JWT uses unpadded base64url; atob is strict about padding in some
    // engines (notably WebKit), so re-pad before decoding.
    const seg = segments[1]!.replace(/-/g, '+').replace(/_/g, '/')
    const padded = seg + '='.repeat((4 - (seg.length % 4)) % 4)
    const payload = JSON.parse(atob(padded)) as { exp?: number }
    if (typeof payload.exp !== 'number') return 0
    return payload.exp * 1000 - Date.now()
  } catch {
    return 0
  }
}

function persist(): void {
  const s = guestStateRef.value
  if (s.active === null && s.joined.length === 0) {
    localStorage.removeItem(STORAGE_KEY)
  } else {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
  }
}

function loadFromStorage(): GuestState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return EMPTY_STATE
    const data = JSON.parse(raw) as unknown
    if (!data || typeof data !== 'object') return EMPTY_STATE

    // New shape: { active, joined[] }
    if ('joined' in data && Array.isArray((data as GuestState).joined)) {
      const s = data as GuestState
      let droppedCode = false
      const joined = s.joined.filter(isValidSession).map((j) => {
        if (j.role !== MeetRole.Official || j.code === undefined) return j
        // Earlier releases kept an official's room code; it isn't needed after joining
        droppedCode = true
        const { code: _code, ...rest } = j
        return rest
      })
      const active = s.active && joined.some((j) => j.meetId === s.active) ? s.active : null
      // A room code an earlier release saved leaves storage at once, not at the next change
      if (droppedCode) {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify({ active, joined }))
        } catch {
          // Storage can't be written: the sessions just read are kept, and saved at the next change
        }
      }
      return { active, joined }
    }

    // Legacy shape: a single session at the top level. Wrap it as the only
    // joined entry. Pre-multi-meet sessions only ever held viewer tokens.
    const legacy = data as Partial<GuestSessionData & { slug?: string }>
    if (legacy.token && legacy.meetId && legacy.meetName) {
      return {
        active: legacy.meetId,
        joined: [
          {
            token: legacy.token,
            meetId: legacy.meetId,
            meetName: legacy.meetName,
            role: MeetRole.Viewer,
            code: legacy.code ?? legacy.slug ?? '',
          },
        ],
      }
    }
    return EMPTY_STATE
  } catch {
    return EMPTY_STATE
  }
}

function isValidSession(j: unknown): j is GuestSessionData {
  return (
    !!j &&
    typeof j === 'object' &&
    typeof (j as GuestSessionData).token === 'string' &&
    typeof (j as GuestSessionData).meetId === 'number' &&
    typeof (j as GuestSessionData).meetName === 'string'
  )
}
