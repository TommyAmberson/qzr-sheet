<script setup lang="ts">
import { computed, provide, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ApiError, findDivision, MeetRole, sameDivision, viewersSeeStats } from '@qzr/shared'
import type { Sender } from '@qzr/ui'

import { getMeet, getMyMeets, getPublishedSchedule, getSender, type MeetDetail } from '../api'
import { useAuth } from '../composables/useAuth'
import { useMeetDay } from '../composables/useMeetDay'
import { useRoomCode } from '../composables/useRoomCode'
import { coachChurchIds as coachChurchIdsOf } from '../meetAccess'
import { MEET_TABS, meetPageKey, type MeetPage, type PublishedOnPage } from '../meetPage'
import UploadQuizzes from '../components/UploadQuizzes.vue'

/**
 * A meet's page (specs/010-meet-day): its header, the tabs Schedule, Quizzes, Standings, Roster and
 * Setup, the division picker and Refresh. The tab is the path and the division `?division=`, so
 * both survive a reload and a shared link (FR-005). The page reads the meet, who the reader is in
 * it and the published schedule once, for every tab; each tab reads its own data on the page's
 * beat.
 */
const props = defineProps<{ slug: string }>()
const route = useRoute()
const router = useRouter()
const { session } = useAuth()
const { renew } = useRoomCode()

declare const __SCORESHEET_URL__: string

const detail = ref<MeetDetail | null>(null)
const meet = computed(() => detail.value?.meet ?? null)
const sender = ref<Sender | null>(null)
const isSuperuser = ref(false)
const coachChurchIds = ref(new Set<number>())
const published = shallowRef<PublishedOnPage | null | undefined>(undefined)

/** The meet day's version and phase the held schedule was read for; null when read without one */
let heldFor: string | null | undefined
/** The same for a read on its way, so a second meet day naming it doesn't read it twice */
let askedFor: string | null | undefined
/** The newest read; an older one, or one for a meet the page has left, must not show */
let publishedReads = 0

const loading = ref(true)
const error = ref('')

const meetId = computed(() => meet.value?.id ?? null)
const { day, error: dayError, beat, answered, refresh } = useMeetDay(meetId)

const isAdmin = computed(() => sender.value?.admin ?? false)
// The API answers who may send quizzes only for the meet's admins and its rooms' officials
const scores = computed(() => sender.value !== null)
/**
 * Viewers and coaches see nothing of results and standings before the meet is under way; admins and
 * officials, who score it, see them as they come
 */
const statsHidden = computed(
  () => !scores.value && day.value !== null && !viewersSeeStats(day.value.phase),
)
// Signed out once the session says so; while it is still being read, a member isn't a guest
const isGuest = computed(() => !session.value?.isPending && !session.value?.data?.user)

/** The address's division, the one part of it every tab shares (a viewer preview is Standings') */
const divisionQuery = computed(() =>
  route.query.division === undefined ? {} : { division: route.query.division },
)
/** The division asked for, as the meet spells it; one the meet doesn't have is every division */
const division = computed(() => {
  const asked = route.query.division
  if (typeof asked !== 'string' || !meet.value) return null
  return findDivision(meet.value.divisions, asked) ?? null
})
const inDivision = (name: string) => division.value === null || sameDivision(name, division.value)
/** A schedule quiz's division as the meet names it: a linked schedule's ids are the meet's names */
const inScheduleDivision = (divisionId: string) =>
  inDivision(
    published.value?.document.settings.divisions.find((d) => d.id === divisionId)?.name ??
      divisionId,
  )

function setDivision(name: string | null) {
  const query = { ...route.query }
  if (name) query.division = name
  else delete query.division
  return router.replace({ query, hash: route.hash })
}

// The routes say which tabs a guest may open, as the router enforces it
const tabs = computed(() =>
  MEET_TABS.filter((tab) => {
    if (isGuest.value && !router.resolve({ name: tab.name, params: route.params }).meta.guestAccess)
      return false
    return tab.name !== 'meet-setup' || isAdmin.value
  }),
)

/** Who may send quizzes to the meet: its admins and its rooms' officials; null for anyone else */
async function senderOf(id: number): Promise<Sender | null> {
  try {
    return await getSender(id)
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return null
    throw e
  }
}

/** A signed-in reader's place in the meet: a superuser, and the churches they coach */
async function membershipOf(id: number) {
  // Asked whatever the session shows, which may still be pending just after a reload
  const mine = await getMyMeets().catch((e: unknown) => {
    if (e instanceof ApiError && e.status === 401) return null
    throw e
  })
  const memberships = mine?.memberships ?? []
  return {
    superuser: memberships.some((m) => m.meetId === id && m.role === MeetRole.Superuser),
    coaches: coachChurchIdsOf(memberships, id),
  }
}

/** The published schedule; none published is null */
async function publishedOf(id: number): Promise<PublishedOnPage | null> {
  try {
    const answer = await getPublishedSchedule(id)
    return { document: answer.document, view: answer.view }
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 404) throw e
    return null
  }
}

/** The newest load; an older one still waiting, for a meet left behind, must not overwrite it */
let loads = 0

async function load() {
  const current = ++loads
  loading.value = true
  error.value = ''
  // Another meet starts afresh: nothing of the last one shows, or is read, while it loads
  detail.value = null
  sender.value = null
  // The schedule follows the new meet's day (research R7, rule 4)
  published.value = undefined
  heldFor = undefined
  askedFor = undefined
  publishedReads++
  try {
    // A guest official's slug is the meet's id; their ended session is renewed on opening the page
    const loaded = await renew(Number(props.slug), async () => {
      const read = await getMeet(props.slug)
      const id = read.meet.id
      const [who, membership] = await Promise.all([senderOf(id), membershipOf(id)])
      return { read, who, membership }
    })
    if (current !== loads) return
    if (!loaded) {
      error.value = 'Join the meet again with its code to see it.'
      return
    }
    detail.value = loaded.read
    sender.value = loaded.who
    isSuperuser.value = loaded.membership.superuser
    coachChurchIds.value = loaded.membership.coaches
  } catch (e) {
    if (current !== loads) return
    // A signed-in reader who isn't one of the meet's members is shown their own meets
    if (e instanceof ApiError && e.status === 403 && !isGuest.value) {
      void router.replace({ name: 'home' })
      return
    }
    error.value =
      e instanceof ApiError && (e.status === 401 || e.status === 403)
        ? 'Join the meet again with its code to see it.'
        : (e as Error).message
  } finally {
    if (current === loads) loading.value = false
  }
}

/** A background read that failed, shown under the tab bar rather than in place of the page */
const readError = ref('')

async function reloadMeet() {
  const slug = props.slug
  try {
    const read = await getMeet(slug)
    // A read for a meet the page has since left must not show
    if (slug !== props.slug) return
    detail.value = read
    readError.value = ''
  } catch (e) {
    readError.value = `The meet couldn't be read again: ${(e as Error).message}`
  }
}

watch(() => props.slug, load, { immediate: true })

// A tab that moves the meet's phase reads the meet again, and the meet day follows at once, so what
// viewers see and the schedule's letters or names don't wait
watch(
  () => meet.value?.phase,
  (phase, was) => {
    if (was !== undefined && phase !== was) void refresh('check')
  },
)

// Switching tabs reads the meet again (FR-022), and the tab opened reads again if the meet changed
watch(
  () => route.name,
  (name, was) => {
    if (was !== undefined && name !== was) void refresh('check')
  },
)

// ---- The published schedule (research R7, rule 4) ----

async function readPublished(id: number, forDay: string | null) {
  const mine = ++publishedReads
  askedFor = forDay
  try {
    const schedule = await publishedOf(id)
    if (mine !== publishedReads) return
    published.value = schedule
    heldFor = forDay
    readError.value = ''
  } catch (e) {
    if (mine !== publishedReads) return
    readError.value = `The schedule couldn't be read: ${(e as Error).message}`
  } finally {
    if (mine === publishedReads) askedFor = undefined
  }
}

// The schedule is read as soon as the meet is known, held for no version, so a meet day the API is
// still preparing doesn't hold the Schedule tab up; the first meet day then reads it for its version
watch(meetId, (id) => {
  if (id !== null && published.value === undefined && askedFor === undefined) {
    void readPublished(id, null)
  }
})

// Read for each version and phase a meet day names, the phase deciding letters or team names, on
// every answer so a read that failed is tried again; with no meet day to go by, read anyway so the
// Schedule tab isn't left waiting
watch([answered, dayError], () => {
  const id = meet.value?.id
  if (id === undefined) return
  if (day.value) {
    const forDay = `${day.value.scheduleVersion}|${day.value.phase}`
    if (forDay !== heldFor && forDay !== askedFor) void readPublished(id, forDay)
  } else if (dayError.value && published.value === undefined && askedFor === undefined) {
    void readPublished(id, null)
  }
})

function scoresheetHref(scheduleQuizId: string): string {
  if (!meet.value) return '#'
  return `${__SCORESHEET_URL__}?meetId=${meet.value.id}&quiz=${encodeURIComponent(scheduleQuizId)}`
}

const page: MeetPage = {
  slug: computed(() => props.slug),
  detail,
  meet,
  sender,
  isAdmin,
  scores,
  statsHidden,
  isSuperuser,
  coachChurchIds,
  division,
  inDivision,
  inScheduleDivision,
  setDivision,
  published,
  day,
  dayError,
  beat,
  refresh,
  reloadMeet,
  scoresheetHref,
}
provide(meetPageKey, page)

const dates = computed(() => {
  if (!meet.value) return ''
  const { dateFrom, dateTo } = meet.value
  return dateTo && dateTo !== dateFrom ? `${dateFrom} – ${dateTo}` : dateFrom
})
</script>

<template>
  <div class="container meet-page">
    <button v-if="!isGuest" class="back-link no-print" @click="router.push({ name: 'home' })">
      ← QuizMeets
    </button>

    <p v-if="loading && !meet" class="state-msg">Loading…</p>
    <p v-else-if="error" class="state-msg state-msg--error">{{ error }}</p>

    <template v-else-if="meet">
      <header class="meet-head">
        <div class="meet-info">
          <h2 class="page-title">{{ meet.name }}</h2>
          <span class="meet-meta">{{ dates }}</span>
        </div>
        <div v-if="sender" class="no-print"><UploadQuizzes /></div>
      </header>

      <div class="meet-bar no-print">
        <nav class="tabs" aria-label="Meet">
          <RouterLink
            v-for="tab in tabs"
            :key="tab.name"
            class="tab"
            :to="{ name: tab.name, params: { slug }, query: divisionQuery }"
            :aria-current="route.name === tab.name ? 'page' : undefined"
            >{{ tab.label
            }}<span
              v-if="tab.name === 'meet-quizzes' && isAdmin && day?.attention"
              class="tab-count"
              :title="`${day.attention} need${day.attention === 1 ? 's' : ''} attention`"
              >{{ day.attention }}</span
            ></RouterLink
          >
        </nav>
        <div class="bar-tools">
          <select
            v-if="meet.divisions.length > 1"
            class="division-pick"
            aria-label="Division"
            :value="division ?? ''"
            @change="setDivision(($event.target as HTMLSelectElement).value || null)"
          >
            <option value="">Every division</option>
            <option v-for="d in meet.divisions" :key="d" :value="d">Division {{ d }}</option>
          </select>
          <button
            type="button"
            class="btn btn--secondary btn--sm"
            :disabled="loading"
            title="Read the meet again"
            @click="refresh()"
          >
            Refresh
          </button>
        </div>
      </div>
      <p v-if="dayError" class="state-msg state-msg--error no-print">{{ dayError }}</p>
      <p v-if="readError" class="state-msg state-msg--error no-print">{{ readError }}</p>

      <RouterView />
    </template>
  </div>
</template>

<style scoped>
/* As wide as the window, since a meet's rooms rarely fit the portal's usual column */
.container {
  margin: 0 auto;
  padding: 2rem 1.5rem;
}

.back-link {
  display: inline-block;
  margin-bottom: 1.25rem;
  padding: 0;
  border: none;
  background: none;
  color: var(--color-text-faint);
  font-family: inherit;
  font-size: 0.8rem;
  cursor: pointer;
}

.back-link:hover {
  color: var(--color-text-muted);
}

.page-title {
  color: var(--color-heading);
  font-size: 1.1rem;
  font-weight: 700;
}

.meet-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.meet-info {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.75rem;
}

.meet-meta {
  color: var(--color-text-muted);
  font-size: 0.85rem;
}

.meet-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 1.25rem;
}

/* The builder's segmented look, one link per tab */
.tabs {
  display: inline-flex;
  gap: 1px;
  max-width: 100%;
  padding: 1px;
  overflow-x: auto;
  border: 1px solid var(--color-meta-accent);
  border-radius: 6px;
}

.tab {
  padding: 0.3rem 0.8rem;
  border: 1px solid transparent;
  border-radius: 5px;
  color: var(--color-text-muted);
  font-size: 0.9rem;
  text-decoration: none;
  white-space: nowrap;
}

.tab:hover {
  color: var(--color-heading);
}

.tab[aria-current='page'] {
  border-color: var(--color-meta-accent);
  background: var(--color-bg);
  color: var(--color-heading);
}

.tab-count {
  display: inline-block;
  min-width: 1.2rem;
  margin-left: 0.35rem;
  padding: 0 0.3rem;
  border-radius: 999px;
  background: var(--color-warn);
  color: var(--color-bg);
  font-weight: 700;
  font-size: 0.75rem;
  text-align: center;
}

.bar-tools {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.division-pick {
  padding: 0.3rem 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: 5px;
  background: var(--color-bg);
  color: var(--color-text);
  font: inherit;
  font-size: 0.9rem;
}

@media (max-width: 600px) {
  .container {
    padding: 1.25rem 0.75rem;
  }
}
</style>
