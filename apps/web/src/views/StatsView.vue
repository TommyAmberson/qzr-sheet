<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ApiError, divisionTitle, type DivisionStateValue } from '@qzr/shared'

import { getMeet, getStatsDivisions, type MeetDetail } from '../api'
import { stepNames } from '../stats'

/** A meet's stats: its divisions to open, for every member, and the settings for its admins */
const props = defineProps<{ slug: string }>()
const router = useRouter()

const meet = ref<MeetDetail['meet'] | null>(null)
const divisions = ref<{ division: string; state: DivisionStateValue }[]>([])
const admin = ref(false)
const loading = ref(true)
const error = ref('')

/** A guest's slug is the meet's id; a signed-in member's is its viewer code */
const signedIn = computed(() => !/^\d+$/.test(props.slug))

async function load() {
  loading.value = true
  error.value = ''
  try {
    const { meet: detail } = await getMeet(props.slug)
    const read = await getStatsDivisions(detail.id)
    meet.value = detail
    divisions.value = read.divisions
    admin.value = read.admin
  } catch (e) {
    error.value =
      e instanceof ApiError && e.status === 403
        ? "Only the meet's members can see its stats."
        : (e as Error).message
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(() => props.slug, load)
</script>

<template>
  <div class="container">
    <button
      v-if="signedIn"
      class="back-link"
      @click="router.push({ name: 'meet', params: { slug } })"
    >
      ← Meet
    </button>
    <button v-else class="back-link" @click="router.push({ name: 'home' })">← Home</button>

    <p v-if="loading" class="state-msg">Loading…</p>
    <p v-else-if="error" class="state-msg state-msg--error">{{ error }}</p>

    <template v-else-if="meet">
      <div class="title-row">
        <h2 class="page-title">Stats: {{ meet.name }}</h2>
        <router-link v-if="admin" class="settings-link" :to="{ name: 'meet-stats-settings' }">
          Stats settings →
        </router-link>
      </div>
      <p v-if="divisions.length === 0" class="state-msg">
        Nothing to see yet: stats show once the meet is under way.
      </p>
      <ul v-else class="divisions">
        <li v-for="d in divisions" :key="d.division">
          <router-link
            :to="{ name: 'meet-division-stats', params: { slug, division: d.division } }"
          >
            {{ divisionTitle(d.division) }}
          </router-link>
          <span class="note">{{ stepNames([])[d.state] }}</span>
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.container {
  max-width: 40rem;
  margin: 0 auto;
  padding: 2rem 1.5rem;
}

.back-link {
  background: none;
  border: none;
  padding: 0;
  font-size: 0.8rem;
  color: var(--color-text-faint);
  cursor: pointer;
  font-family: inherit;
  margin-bottom: 1.5rem;
  display: inline-block;
}

.back-link:hover {
  color: var(--color-text-muted);
}

.title-row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem 1rem;
  margin-bottom: 1.25rem;
}

.page-title {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--color-heading);
}

.settings-link {
  font-size: 0.85rem;
}

.state-msg {
  font-size: 0.875rem;
  color: var(--color-text-faint);
}

.state-msg--error {
  color: var(--palette-error);
}

.divisions {
  list-style: none;
  padding: 0;
  margin: 0;
}

.divisions li {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--color-border);
  font-weight: 600;
}

.note {
  color: var(--color-text-faint);
  font-size: 0.8rem;
  font-weight: 400;
}
</style>
