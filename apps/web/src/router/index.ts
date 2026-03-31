import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'
import { authClient } from '../composables/useAuth'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    {
      path: '/meets/:id',
      meta: { requiresAuth: true },
      children: [
        {
          path: '',
          name: 'meet',
          component: () => import('../views/QuizMeetView.vue'),
          props: (route) => ({ id: Number(route.params.id) }),
        },
        {
          path: 'admin',
          name: 'meet-admin',
          meta: { requiresAdmin: true },
          component: () => import('../views/MeetAdminView.vue'),
          props: (route) => ({ id: Number(route.params.id) }),
        },
        {
          path: 'teams',
          name: 'meet-teams',
          meta: { requiresCoach: true },
          component: () => import('../views/MeetTeamsView.vue'),
          props: (route) => ({ id: Number(route.params.id) }),
        },
      ],
    },
  ],
})

router.beforeEach(async (to) => {
  const needsAuth = to.matched.some(
    (r) => r.meta.requiresAuth || r.meta.requiresAdmin || r.meta.requiresCoach,
  )
  if (!needsAuth) return true

  const { data } = await authClient.getSession()
  if (!data?.user) return { name: 'home' }

  const accountRole = (data.user as Record<string, unknown>).role

  if (to.matched.some((r) => r.meta.requiresAdmin)) {
    if (accountRole !== 'admin') return { name: 'meet', params: to.params }
  }

  if (to.matched.some((r) => r.meta.requiresCoach)) {
    // coaches and admins can access team management
    if (accountRole !== 'admin' && accountRole !== 'normal')
      return { name: 'meet', params: to.params }
  }

  return true
})

export default router
