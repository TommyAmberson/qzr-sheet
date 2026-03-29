import { createRouter, createWebHistory } from 'vue-router'
import Scoresheet from '@/components/Scoresheet.vue'

export default createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [{ path: '/', component: Scoresheet }],
})
