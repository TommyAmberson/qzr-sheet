<script setup lang="ts">
import { computed, provide, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ApiError, foldName } from '@qzr/shared'
import type { Sender } from '@qzr/ui'

import { getMeet, getSender, type MeetDetail } from '../api'
import { useAuth } from '../composables/useAuth'
import { useMeetDay } from '../composables/useMeetDay'
import { useRoomCode } from '../composables/useRoomCode'
import { MEET_TABS, meetPageKey, type MeetPage } from '../meetPage'
import UploadQuizzes from '../components/UploadQuizzes.vue'

/**
 * A meet's page (specs/010-meet-day): its header, the tabs Schedule, Quizzes, Standings, Roster and
 * Setup, the division picker and Refresh. The tab is the path and the division `?division=`, so
 * both survive a reload and a shared link (FR-005). Each tab reads its own data on the page's beat.
 */
const props = defineProps<{ slug: string }>()
const route = useRoute()
const router = useRouter()
const { session } = useAuth()
const { renew } = useRoomCode()

const meet = ref<MeetDetail['meet'] | null>(null)
const sender = ref<Sender | null>(null)
const loading = ref(true)
const error = ref('')

const meetId = computed(() => meet.value?.id ?? null)
const { day, error: dayError, beat, refresh } = useMeetDay(meetId)

const isAdmin = computed(() => sender.value?.admin ?? false)
const isGuest = computed(() => !session.value?.data?.user)

/** The division asked for, as the meet spells it; one the meet doesn't have is every division */
const division = computed(() => {
  const asked = route.query.division
  if (typeof asked !== 'string' || !meet.value) return null
  return meet.value.divisions.find((d) => foldName(d) === foldName(asked)) ?? null
})

const tabs = computed(() =>
  MEET_TABS.filter((tab) => {
    if (tab.guests) return true
    if (isGuest.value) return false
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

async function load() {
  loading.value = true
  error.value = ''
  try {
    // A guest official's slug is the meet's id; their ended session is renewed on opening the page
    const loaded = await renew(Number(props.slug), async () => {
      const { meet: detail } = await getMeet(props.slug)
      return { detail, who: await senderOf(detail.id) }
    })
    if (!loaded) {
      error.value = 'Join the meet again with its code to see it.'
      return
    }
    meet.value = loaded.detail
    sender.value = loaded.who
  } catch (e) {
    error.value =
      e instanceof ApiError && (e.status === 401 || e.status === 403)
        ? 'Join the meet again with its code to see it.'
        : (e as Error).message
  } finally {
    loading.value = false
  }
}

watch(() => props.slug, load, { immediate: true })

// Switching tabs reads the meet again, so the tab opened is current (FR-022)
watch(
  () => route.name,
  (name, was) => {
    if (was !== undefined && name !== was) void refresh()
  },
)

function pickDivision(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  const query = { ...route.query }
  if (value) query.division = value
  else delete query.division
  void router.replace({ query, hash: route.hash })
}

const page: MeetPage = {
  slug: computed(() => props.slug),
  meet,
  sender,
  isAdmin,
  isGuest,
  division,
  day,
  dayError,
  beat,
  refresh,
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
        <UploadQuizzes
          v-if="sender"
          v-model:sender="sender"
          class="no-print"
          :meet-id="meet.id"
          :meet-name="meet.name"
          @sent="refresh"
        />
      </header>

      <div class="meet-bar no-print">
        <nav class="tabs" aria-label="Meet">
          <RouterLink
            v-for="tab in tabs"
            :key="tab.name"
            class="tab"
            :to="{ name: tab.name, params: { slug }, query: route.query }"
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
            @change="pickDivision"
          >
            <option value="">Every division</option>
            <option v-for="d in meet.divisions" :key="d" :value="d">Division {{ d }}</option>
          </select>
          <button
            type="button"
            class="btn btn--secondary btn--sm"
            :disabled="loading"
            title="Read the meet again"
            @click="refresh"
          >
            Refresh
          </button>
        </div>
      </div>
      <p v-if="dayError" class="state-msg state-msg--error no-print">{{ dayError }}</p>

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

.state-msg {
  color: var(--color-text-faint);
  font-size: 0.875rem;
}

.state-msg--error {
  color: var(--palette-error);
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

.btn {
  display: inline-flex;
  align-items: center;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
  font-family: inherit;
  white-space: nowrap;
  transition:
    background 0.15s,
    color 0.15s,
    border-color 0.15s;
}

.btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.btn--sm {
  padding: 0.25rem 0.6rem;
  font-size: 0.75rem;
}

.btn--secondary {
  background: transparent;
  color: var(--color-text-muted);
  border-color: var(--color-border);
}

.btn--secondary:hover:not(:disabled) {
  border-color: var(--color-text-muted);
  color: var(--color-text);
}

@media (max-width: 600px) {
  .container {
    padding: 1.25rem 0.75rem;
  }
}
</style>
