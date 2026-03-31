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
          component: () => import('../views/MeetAdminView.vue'),
          props: (route) => ({ id: Number(route.params.id) }),
        },
        {
          path: 'teams',
          name: 'meet-teams',
          component: () => import('../views/MeetTeamsView.vue'),
          props: (route) => ({ id: Number(route.params.id) }),
        },
      ],
    },
  ],
})

router.beforeEach(async (to) => {
  if (!to.matched.some((r) => r.meta.requiresAuth)) return true

  const { data } = await authClient.getSession()
  if (!data?.user) return { name: 'home' }

  return true
})

export default router
