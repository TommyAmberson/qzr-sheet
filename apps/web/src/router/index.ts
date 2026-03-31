import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'
import { authClient } from '../composables/useAuth'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    {
      path: '/coach',
      meta: { requiresAuth: true },
      children: [
        {
          path: 'meets',
          name: 'coach-meets',
          component: () => import('../views/CoachMeetsView.vue'),
        },
        {
          path: 'meets/:id',
          name: 'coach-meet',
          component: () => import('../views/CoachMeetView.vue'),
          props: (route) => ({ id: Number(route.params.id) }),
        },
      ],
    },
    {
      path: '/admin',
      redirect: '/admin/meets',
      meta: { requiresAdmin: true },
      children: [
        {
          path: 'meets',
          name: 'admin-meets',
          component: () => import('../views/AdminMeetsView.vue'),
        },
        {
          path: 'meets/:id',
          name: 'admin-meet-detail',
          component: () => import('../views/AdminMeetDetailView.vue'),
          props: (route) => ({ id: Number(route.params.id) }),
        },
      ],
    },
  ],
})

router.beforeEach(async (to) => {
  if (!to.matched.some((r) => r.meta.requiresAuth || r.meta.requiresAdmin)) return true

  const { data } = await authClient.getSession()
  if (!data?.user) return { name: 'home' }

  if (to.matched.some((r) => r.meta.requiresAdmin)) {
    const role = (data.user as Record<string, unknown>).role
    if (role !== 'admin') return { name: 'home' }
  }

  return true
})

export default router
