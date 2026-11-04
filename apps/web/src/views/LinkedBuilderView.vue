<script setup lang="ts">
import '../builder/builder.css'
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  useTemplateRef,
} from 'vue'
import { useRouter } from 'vue-router'
import {
  ApiError,
  defaultElims,
  divisionName,
  setTeamCount,
  foldName,
  reflowSchedule,
  type Conflict,
  type ScheduleDocument,
} from '@qzr/shared'
import { ScheduleSheet, browserTimeZone, formatWhen } from '@qzr/ui'

import {
  getLinkedSchedule,
  getMeet,
  getScheduleVersion,
  listMeetRooms,
  listMeetTeams,
  listScheduleVersions,
  publishSchedule,
  restoreScheduleVersion,
  saveScheduleDraft,
  unlinkSchedule,
  type MeetRoom,
  type MeetTeamRow,
  type QuizMeet,
  type ScheduleVersion,
} from '../api'
import {
  comparable,
  forgetLink,
  readLink,
  reconcileTeams,
  teamName,
  startFromMeet,
  withMeetNames,
  writeLink,
} from '../builder/linked'
import { forgetSchedule, keepSchedule, listSchedules, loadSchedule } from '../builder/persistence'
import BuilderView from './BuilderView.vue'

/**
 * A meet's linked schedule in the builder (story 7): the draft is kept in this browser at once and
 * sent to the server shortly after each change (FR-048a); Publish adds it as the meet's next
 * version (FR-049, FR-049a).
 */
const props = defineProps<{ slug: string }>()
const router = useRouter()

const meet = ref<QuizMeet | null>(null)
const teams = ref<MeetTeamRow[]>([])
const rooms = ref<MeetRoom[]>([])
const results = ref<string[]>([])
const loadError = ref('')

/** The draft being edited, by id; `key` remounts the builder when the draft is replaced */
const docId = ref<string | null>(null)
const key = ref(0)
const current = shallowRef<ScheduleDocument | null>(null)
const published = shallowRef<ScheduleDocument | null>(null)
const version = ref<number | null>(null)
const builder = useTemplateRef<InstanceType<typeof BuilderView>>('builder')

type SaveState = 'saved' | 'unsent' | 'saving' | 'offline' | 'failed'
const saveState = ref<SaveState>('saved')
const saveError = ref('')
/**
 * A refusal because another admin saved the draft meanwhile, with their draft and revision (the
 * server's 409 for a stale base, as against a publish's hard conflicts); null for anything else
 */
function staleDraft(e: unknown): { draft: ScheduleDocument | null; draftRevision: number } | null {
  if (!(e instanceof ApiError) || e.status !== 409) return null
  const body = e.body as { draft?: ScheduleDocument | null; draftRevision?: number }
  return body.draftRevision === undefined
    ? null
    : { draft: body.draft ?? null, draftRevision: body.draftRevision }
}

/** The server's draft when another admin saved meanwhile, to keep mine or take theirs */
const conflict = shallowRef<{ draft: ScheduleDocument | null; draftRevision: number } | null>(null)

const meetId = computed(() => meet.value?.id ?? 0)

onMounted(load)

async function load() {
  try {
    const { meet: m } = await getMeet(props.slug)
    meet.value = m
    const [state, teamList, roomList] = await Promise.all([
      getLinkedSchedule(m.id, browserTimeZone()),
      listMeetTeams(m.id),
      listMeetRooms(m.id),
    ])
    teams.value = teamList.teams
    rooms.value = roomList.rooms
    results.value = state.results
    published.value = state.published
    version.value = state.version

    const link = readLink(m.id)
    const local = link ? loadSchedule(link.docId) : null
    if (link && local && link.unsent) {
      // Edits made here that never reached the server: send them, unless someone saved meanwhile
      open(local, link.baseRevision, true)
      // The same revision of a different draft (after an unlink and a new one) is still a conflict
      if (
        state.draftRevision !== link.baseRevision ||
        (state.draft !== null && state.draft.id !== link.docId)
      ) {
        conflict.value = { draft: state.draft, draftRevision: state.draftRevision }
      } else void send()
      return
    }
    if (state.draft) openFromServer(state.draft, state.draftRevision)
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : String(e)
  }
}

/** Make `doc` the draft being edited, based on the server's `baseRevision` */
function open(doc: ScheduleDocument, baseRevision: number, unsent: boolean) {
  // One kept copy per linked meet: a draft replaced by another goes
  const previous = readLink(meetId.value)?.docId
  if (previous && previous !== doc.id) forgetSchedule(previous)
  keepSchedule(doc)
  writeLink(meetId.value, { docId: doc.id, baseRevision, unsent })
  docId.value = doc.id
  current.value = doc
  saveState.value = unsent ? 'unsent' : 'saved'
  key.value++
  void followMeetTeams()
}

/**
 * Bring the opened draft up to the meet's teams through the builder, so the change can be undone,
 * holds quizzes with results (H-20), waits for Apply when Auto-apply is off, and is then saved
 */
async function followMeetTeams() {
  await nextTick()
  if (!current.value || !reconcileTeams(structuredClone(current.value), teams.value)) return
  builder.value?.changeSettings((d) => reconcileTeams(d, teams.value))
}

/**
 * Read the meet's teams again and follow them, as when the draft was opened; if that changes
 * nothing, the save's refusal stands
 */
async function catchUpWithTeams(refusal: string) {
  try {
    teams.value = (await listMeetTeams(meetId.value)).teams
  } catch {
    // Can't read the teams: the refusal stands
  }
  // Whether following them changes the draft, decided before the builder takes the change, since
  // it may wait for the director to confirm one touching quizzes with results
  const changes = !!current.value && reconcileTeams(structuredClone(current.value), teams.value)
  if (!changes) {
    saveState.value = 'failed'
    saveError.value = refusal
    return
  }
  await followMeetTeams()
}

/** The server's draft, with the meet's team names */
function openFromServer(draft: ScheduleDocument, revision: number) {
  open(withMeetNames(draft, teams.value), revision, false)
}

// ---- Starting a linked schedule ----

const keptSchedules = computed(() => listSchedules().filter((s) => !s.linked))
const linking = shallowRef<ScheduleDocument | null>(null)

function startNew() {
  open(startFromMeet(meet.value!, teams.value, rooms.value), 0, true)
  void send()
}

/** How a kept schedule's divisions and rooms match the meet's (FR-046) */
const matching = computed(() => {
  const doc = linking.value
  if (!doc) return null
  const count = (id: string) => teams.value.filter((t) => t.division === id).length
  const divisions = [
    ...doc.settings.divisions.map((d) => {
      const known = meet.value!.divisions.includes(d.id) || count(d.id) > 0
      return {
        name: d.name,
        teams: d.teams,
        meetCount: count(d.id),
        ok: known && count(d.id) === d.teams,
      }
    }),
    ...meetOnlyDivisions(doc).map((id) => ({
      name: divisionName(id),
      teams: 0,
      meetCount: count(id),
      ok: false,
    })),
  ]
  const roomRows = doc.rooms.map((r) => ({
    name: r.name,
    ok: rooms.value.some((m) => m.name === r.name),
  }))
  return { divisions, rooms: roomRows }
})

/** The meet's divisions with teams that the kept schedule doesn't have */
function meetOnlyDivisions(doc: ScheduleDocument): string[] {
  const have = new Set(doc.settings.divisions.map((d) => d.id))
  return [...new Set(teams.value.map((t) => t.division))].filter((id) => !have.has(id))
}

function chooseKept(event: Event) {
  const id = (event.target as HTMLSelectElement).value
  linking.value = id ? loadSchedule(id) : null
}

/** Link a copy of the kept schedule: its draw takes the meet's teams, its rooms the meet's rooms */
function confirmLink() {
  const source = linking.value
  if (!source) return
  const doc: ScheduleDocument = {
    ...structuredClone(source),
    id: crypto.randomUUID(),
    link: { meetId: meetId.value, timeZone: browserTimeZone() },
  }
  // The meet's teams decide each division's count, and divisions only the meet has are added
  for (const id of meetOnlyDivisions(doc)) {
    doc.settings.divisions.push({ id, name: divisionName(id), teams: 0, elims: defaultElims(0) })
  }
  let recount = false
  for (const d of doc.settings.divisions) {
    const meetTeams = teams.value.filter((t) => t.division === d.id)
    if (setTeamCount(doc, d.id, meetTeams.length)) recount = true
    const draw = (doc.draw[d.id] ??= { teams: [], stale: false })
    // A kept team carries its letter and marks to the meet team of the same name, never by position
    const fold = (name: string | undefined) => foldName(name ?? '')
    const kept = new Map(draw.teams.filter((t) => t.name).map((t) => [fold(t.name), t]))
    const wasDrawn = draw.teams.some((t) => t.letter)
    draw.teams = meetTeams.map((t) => {
      const match = kept.get(fold(teamName(t)))
      return {
        late: match?.late ?? t.lateness,
        absent: match?.absent ?? false,
        teamId: t.id,
        ...(match?.letter ? { letter: match.letter } : {}),
      }
    })
    // A draw that didn't carry over to every team needs redoing
    if (wasDrawn && draw.teams.some((t) => !t.letter)) draw.stale = true
  }
  for (const room of doc.rooms) {
    const meetRoom = rooms.value.find((m) => m.name === room.name)
    if (meetRoom) room.meetRoomId = meetRoom.id
  }
  linking.value = null
  // New counts rebuild the grid around anything pinned, as a settings change would
  const linked = recount ? reflowSchedule(doc) : doc
  open(withMeetNames(linked, teams.value), 0, true)
  void send()
}

// ---- Saving (FR-048a) ----

let timer: ReturnType<typeof setTimeout> | undefined
let retry: ReturnType<typeof setInterval> | undefined
/** Changes made while a save was on its way, so that save doesn't mark them sent */
let changedSinceSend = false
let sending: Promise<void> | null = null
/**
 * While a publish or a restore is on its way, saves wait for it, so they don't race it for the
 * next revision
 */
let writeInFlight = false
/** The next save replaces the server's draft whichever it is: the director chose to keep their own */
let replaceNext = false

function onChanged(doc: ScheduleDocument) {
  if (doc.id !== docId.value) return
  current.value = doc
  const link = readLink(meetId.value)
  writeLink(meetId.value, { docId: doc.id, baseRevision: link?.baseRevision ?? 0, unsent: true })
  changedSinceSend = true
  if (saveState.value !== 'offline') saveState.value = 'unsent'
  clearTimeout(timer)
  timer = setTimeout(() => void send(), 800)
}

/** Send the kept draft if it has unsent changes; resolves when this and any queued save are done */
async function send(): Promise<void> {
  if (writeInFlight) return
  if (sending) {
    await sending
    if (readLink(meetId.value)?.unsent && !conflict.value) return send()
    return
  }
  const link = readLink(meetId.value)
  // The draft being edited is in memory; storage is only its copy for a reload
  const doc = link && (current.value?.id === link.docId ? current.value : loadSchedule(link.docId))
  if (!link?.unsent || !doc || conflict.value) return
  changedSinceSend = false
  saveState.value = 'saving'
  sending = (async () => {
    try {
      const replacing = replaceNext
      replaceNext = false
      const saved = await saveScheduleDraft(meetId.value, doc, link.baseRevision, replacing)
      writeLink(meetId.value, {
        docId: doc.id,
        baseRevision: saved.draftRevision,
        unsent: changedSinceSend,
      })
      saveState.value = changedSinceSend ? 'unsent' : 'saved'
    } catch (e) {
      const stale = staleDraft(e)
      if (stale) {
        conflict.value = stale
        saveState.value = 'unsent'
      } else if (e instanceof ApiError && (e.body as { teamId?: number }).teamId !== undefined) {
        // A team left the meet while this page was open: catch up with the meet's teams, which
        // changes the draft and saves it again
        saveState.value = 'unsent'
        void catchUpWithTeams(e.message)
      } else if (e instanceof ApiError) {
        saveState.value = 'failed'
        saveError.value = e.message
      } else {
        // No answer at all: offline, so try again when the connection is back
        saveState.value = 'offline'
      }
    } finally {
      sending = null
    }
  })()
  await sending
  if (changedSinceSend && (saveState.value as SaveState) === 'unsent' && !conflict.value)
    return send()
}

const resend = () => {
  if (readLink(meetId.value)?.unsent) void send()
}
onMounted(() => {
  window.addEventListener('online', resend)
  retry = setInterval(() => {
    if (saveState.value === 'offline') resend()
  }, 15_000)
})
onBeforeUnmount(() => {
  window.removeEventListener('online', resend)
  clearInterval(retry)
  clearTimeout(timer)
})

function keepMine() {
  const c = conflict.value
  const link = readLink(meetId.value)
  if (!c || !link) return
  conflict.value = null
  writeLink(meetId.value, { ...link, baseRevision: c.draftRevision, unsent: true })
  // Keeping mine replaces the server's draft, even when it's a different one
  replaceNext = true
  void send()
}

function takeTheirs() {
  const c = conflict.value
  if (!c) return
  conflict.value = null
  if (c.draft) {
    openFromServer(c.draft, c.draftRevision)
    return
  }
  // The meet's draft is gone (unlinked elsewhere): back to starting one, keeping no stale copy
  if (docId.value) forgetSchedule(docId.value)
  forgetLink(meetId.value)
  docId.value = null
  current.value = null
}

const saveText = computed(
  () =>
    ({
      saved: 'Saved',
      unsent: 'Not saved yet',
      saving: 'Saving…',
      offline: 'Not saved: offline',
      failed: `Not saved: ${saveError.value}`,
    })[saveState.value],
)

// ---- Publishing and history (FR-049, FR-049a) ----

// The published side only changes on load and publish, so it's compared in its own computed
const publishedForm = computed(() => published.value && comparable(published.value))
const unpublished = computed(
  () => !!current.value && comparable(current.value) !== publishedForm.value,
)
const publishing = ref(false)
const restoring = ref(false)
const unlinking = ref(false)
/** One write to the meet's draft at a time: publish, restore and unlink wait for each other */
const busy = computed(() => publishing.value || restoring.value || unlinking.value)
const hardConflicts = shallowRef<Conflict[] | null>(null)
const publishNote = ref('')

/** Who sees the published version, and how, by the meet's phase (FR-052) */
const audience = computed(() => {
  if (version.value === null) return 'The meet sees no schedule yet'
  const names = meet.value?.phase === 'live' || meet.value?.phase === 'done'
  return `The meet sees version ${version.value}, ${names ? 'with team names' : 'in letters until the meet is live'}`
})

/** The problems listed before publishing past them; the problem count lists them all */
const SHOWN_PROBLEMS = 10

async function publish(confirmConflicts = false) {
  if (busy.value) return
  publishing.value = true
  publishNote.value = ''
  try {
    // Publishing turns Auto-apply off, so later settings changes wait for Apply (FR-012a)
    if (current.value?.settings.autoApply) {
      builder.value?.setAutoApply(false)
      await nextTick()
    }
    clearTimeout(timer)
    await send()
    const link = readLink(meetId.value)
    if (!link || link.unsent || conflict.value) {
      if (!conflict.value) publishNote.value = `Not published: ${saveText.value.toLowerCase()}.`
      return
    }
    const sent = current.value!
    let res
    try {
      writeInFlight = true
      res = await publishSchedule(meetId.value, link.baseRevision, confirmConflicts)
    } finally {
      writeInFlight = false
      // Edits made while it was on its way waited for it, whatever its answer
      if (readLink(meetId.value)?.unsent) setTimeout(() => void send())
    }
    hardConflicts.value = null
    // Edits made while publishing stay unsent, now based on the revision the publish wrote
    const now = readLink(meetId.value) ?? link
    writeLink(meetId.value, { ...now, baseRevision: res.draftRevision })
    // Rooms the publish added now have their meet room; the draft on the server has them already
    const ids = new Map(res.rooms.map((r) => [r.id, r.meetRoomId]))
    const withIds = (d: ScheduleDocument) => {
      for (const r of d.rooms) r.meetRoomId = ids.get(r.id)
    }
    const publishedDoc = structuredClone(sent)
    withIds(publishedDoc)
    published.value = publishedDoc
    if (current.value?.rooms.some((r) => r.meetRoomId !== ids.get(r.id))) {
      builder.value?.change(withIds)
    }
    version.value = res.version
    publishNote.value =
      res.unusedRooms.length > 0
        ? `Published version ${res.version}. Kept ${res.unusedRooms.map((r) => r.name).join(', ')}, which the schedule doesn't use, because it has a room code, officials or results.`
        : `Published version ${res.version}.`
    if (history.value) await showHistory()
  } catch (e) {
    if (
      e instanceof ApiError &&
      e.status === 409 &&
      (e.body as { conflicts?: Conflict[] }).conflicts
    ) {
      hardConflicts.value = (e.body as { conflicts: Conflict[] }).conflicts
    } else if (staleDraft(e)) {
      // Another admin saved meanwhile: the same choice a save offers
      conflict.value = staleDraft(e)
    } else {
      publishNote.value = e instanceof Error ? `Not published: ${e.message}` : 'Not published'
    }
  } finally {
    publishing.value = false
  }
}

const history = ref<ScheduleVersion[] | null>(null)
const viewing = shallowRef<(ScheduleVersion & { document: ScheduleDocument }) | null>(null)

async function showHistory() {
  history.value = await listScheduleVersions(meetId.value)
}

async function viewVersion(v: number) {
  const res = await getScheduleVersion(meetId.value, v)
  viewing.value = { ...res, document: withMeetNames(res.document, teams.value) }
}

async function restore(v: number) {
  if (busy.value) return
  restoring.value = true
  try {
    await restoreVersion(v)
  } finally {
    restoring.value = false
  }
}

async function restoreVersion(v: number) {
  clearTimeout(timer)
  await send()
  const link = readLink(meetId.value)
  // Restoring replaces the draft, so edits that haven't reached the server would be lost
  if (!link || link.unsent || conflict.value) {
    if (!conflict.value) publishNote.value = `Not restored: ${saveText.value.toLowerCase()}.`
    return
  }
  try {
    writeInFlight = true
    // The version first, so a failed fetch leaves nothing restored on the server
    const { document } = await getScheduleVersion(meetId.value, v)
    const saved = await restoreScheduleVersion(meetId.value, v, link.baseRevision)
    viewing.value = null
    // The restored version replaces the draft, edits made while it was on its way included
    openFromServer(document, saved.draftRevision)
  } catch (e) {
    const stale = staleDraft(e)
    if (stale?.draft) {
      // Another admin saved meanwhile. Nothing here was unsent (restore waits for that), so their
      // draft opens, and the director can restore again over it
      openFromServer(stale.draft, stale.draftRevision)
      publishNote.value =
        'Not restored: another admin saved the draft meanwhile. Theirs is open now.'
    } else {
      publishNote.value = `Not restored: ${e instanceof Error ? e.message : String(e)}`
    }
  } finally {
    writeInFlight = false
    if (readLink(meetId.value)?.unsent) setTimeout(() => void send())
  }
}

// ---- Unlinking (FR-048) ----

const confirmingUnlink = ref(false)

async function unlink() {
  if (busy.value) return
  unlinking.value = true
  try {
    await unlinkNow()
  } finally {
    unlinking.value = false
  }
}

async function unlinkNow() {
  const doc = current.value
  if (!doc) return
  // A save still on its way would write the link back after it's forgotten
  clearTimeout(timer)
  while (sending) await sending
  // The schedule lives on in this browser, so it must be kept there before the meet lets it go
  const standalone = { ...structuredClone(doc), id: crypto.randomUUID() }
  delete standalone.link
  if (!keepSchedule(standalone)) {
    confirmingUnlink.value = false
    publishNote.value =
      "Not unlinked: this browser can't keep the schedule. Save it to a file first, then unlink."
    return
  }
  try {
    await unlinkSchedule(meetId.value)
  } catch (e) {
    confirmingUnlink.value = false
    publishNote.value = `Not unlinked: ${e instanceof Error ? e.message : String(e)}`
    return
  }
  // The linked copy goes; the schedule lives on as the standalone one
  forgetSchedule(doc.id)
  forgetLink(meetId.value)
  await router.push({ name: 'builder-schedule', params: { id: standalone.id } })
}
</script>

<template>
  <div class="linked">
    <p v-if="loadError" class="message" role="alert">{{ loadError }}</p>

    <section v-else-if="meet && !docId" class="start">
      <h2>{{ meet.name }}: schedule</h2>
      <p>This meet has no schedule yet.</p>
      <button type="button" class="primary" @click="startNew">Start from the meet</button>
      <p class="hint">
        Uses the meet's {{ meet.divisions.length }} divisions, {{ teams.length }} teams and
        {{ rooms.length }} rooms.
      </p>
      <template v-if="keptSchedules.length > 0">
        <label>
          Or link a schedule kept in this browser
          <select aria-label="Schedule to link" @change="chooseKept">
            <option value="">Choose…</option>
            <option v-for="s in keptSchedules" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
        </label>
        <div v-if="matching" class="matching">
          <table>
            <thead>
              <tr>
                <th>Division</th>
                <th>Schedule</th>
                <th>Meet</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="d in matching.divisions" :key="d.name" :class="{ mismatch: !d.ok }">
                <td>{{ d.name }}</td>
                <td>{{ d.teams }} teams</td>
                <td>{{ d.meetCount }} teams</td>
              </tr>
            </tbody>
          </table>
          <p v-for="r in matching.rooms.filter((x) => !x.ok)" :key="r.name" class="mismatch">
            {{ r.name }} isn't one of the meet's rooms; publishing adds it.
          </p>
          <p v-if="matching.divisions.some((d) => !d.ok)" class="mismatch">
            Divisions that don't match the meet's teams need their draw redone after linking.
          </p>
          <button type="button" class="primary" @click="confirmLink">Link this schedule</button>
          <button type="button" @click="linking = null">Cancel</button>
        </div>
      </template>
    </section>

    <BuilderView
      v-else-if="docId"
      :id="docId"
      ref="builder"
      :key="key"
      :initial="current ?? undefined"
      :results="results"
      @changed="onChanged"
    >
      <template #bar>
        <span class="save-state" role="status">{{ saveText }}</span>
        <span v-if="unpublished" class="unpublished">Unpublished changes</span>
        <span class="audience">{{ audience }}</span>
        <button
          type="button"
          class="primary"
          :disabled="busy"
          title="Everyone with access to the meet, and the scoresheet's schedule picker, will see this version"
          @click="publish()"
        >
          Publish
        </button>
        <button type="button" @click="history ? (history = null) : showHistory()">History</button>
        <button type="button" :disabled="busy" @click="confirmingUnlink = true">Unlink</button>
      </template>
      <template #notices>
        <div v-if="conflict" class="message" role="alert">
          <p>
            Another admin saved this schedule while you were editing. Keep yours, replacing theirs,
            or take theirs, dropping your unsent changes?
          </p>
          <button type="button" @click="keepMine">Keep mine</button>
          <button type="button" @click="takeTheirs">Take theirs</button>
        </div>
        <div v-if="hardConflicts" class="message" role="alert">
          <p>
            The schedule has {{ hardConflicts.length }}
            {{ hardConflicts.length === 1 ? 'problem' : 'problems' }}. It can be published as it is,
            while it's still being worked on.
          </p>
          <button type="button" @click="publish(true)">
            Publish with {{ hardConflicts.length }}
            {{ hardConflicts.length === 1 ? 'problem' : 'problems' }}
          </button>
          <button type="button" @click="hardConflicts = null">Cancel</button>
          <ul>
            <li v-for="(c, i) in hardConflicts.slice(0, SHOWN_PROBLEMS)" :key="i">
              {{ c.rule }}: {{ c.reason }}
            </li>
          </ul>
          <p v-if="hardConflicts.length > SHOWN_PROBLEMS" class="hint">
            And {{ hardConflicts.length - SHOWN_PROBLEMS }} more, listed under the problem count.
          </p>
        </div>
        <p v-if="publishNote" class="message" role="status">{{ publishNote }}</p>
        <div v-if="confirmingUnlink" class="message" role="alert">
          <p>
            Unlink the schedule from {{ meet?.name }}? It stays in this browser as a schedule of its
            own; published versions stay with the meet.
          </p>
          <button type="button" :disabled="busy" @click="unlink">Unlink</button>
          <button type="button" @click="confirmingUnlink = false">Cancel</button>
        </div>
        <section v-if="history" class="history" aria-label="Published versions">
          <p v-if="history.length === 0">Nothing published yet.</p>
          <ol>
            <li v-for="v in history" :key="v.version">
              Version {{ v.version }}, {{ formatWhen(v.publishedAt) }}, {{ v.publishedBy }}
              <button type="button" @click="viewVersion(v.version)">View</button>
              <button type="button" :disabled="busy" @click="restore(v.version)">
                Restore as the draft
              </button>
            </li>
          </ol>
          <div v-if="viewing" class="viewing">
            <p>
              Version {{ viewing.version }}, read-only
              <button type="button" @click="viewing = null">Close</button>
            </p>
            <ScheduleSheet :doc="viewing.document" view="teams" />
          </div>
        </section>
      </template>
    </BuilderView>
  </div>
</template>

<style scoped>
.start {
  max-width: 40rem;
  margin: 2rem auto;
  padding: 0 1rem;
  display: grid;
  gap: 0.75rem;
}

.hint,
.save-state,
.audience {
  font-size: 0.85rem;
  color: var(--color-text-muted, #666);
}

.unpublished {
  font-size: 0.8rem;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  background: var(--color-warn-bg, #fff3d6);
  color: var(--color-warn, #a60);
}

.mismatch {
  color: var(--color-warn, #a60);
}

.matching table {
  border-collapse: collapse;
}

.matching th,
.matching td {
  padding: 0.25rem 0.75rem;
  text-align: left;
}

.history {
  margin: 0.5rem 0;
  padding: 0.75rem;
  border: 1px solid var(--color-border, #ddd);
  border-radius: 8px;
}

.history ol {
  margin: 0;
  padding-left: 1.25rem;
}

.message {
  margin: 0.5rem 0;
}
</style>
