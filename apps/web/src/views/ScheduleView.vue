<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

import ScheduleEditorV1 from './ScheduleEditorV1.vue'
import ScheduleEditorV2 from './ScheduleEditorV2.vue'

const props = defineProps<{ slug: string }>()
const route = useRoute()

/** ?v=2 opts into the typeset Studio rethink. V1 (modal-dialog grid) is
 *  the default until V2 reaches editing parity, then this chooser flips
 *  and V1 is deleted. */
const useV2 = computed(() => route.query.v === '2')
</script>

<template>
  <ScheduleEditorV2 v-if="useV2" :slug="props.slug" />
  <ScheduleEditorV1 v-else :slug="props.slug" />
</template>
