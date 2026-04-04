import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'
import { authClient } from '../composables/useAuth'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    { path: '/roadmap', name: 'roadmap', component: () => import('../views/RoadmapView.vue') },
    {
      path: '/:slug',
      meta: { requiresAuth: true },
      children: [
        {
          path: '',
          name: 'meet',
          component: () => import('../views/QuizMeetView.vue'),
          props: (route) => ({ slug: route.params.slug as string }),
        },
        {
          path: 'churches/:churchId/teams',
          name: 'meet-church-teams',
          component: () => import('../views/MeetTeamsView.vue'),
          props: (route) => ({
            slug: route.params.slug as string,
            churchId: Number(route.params.churchId),
          }),
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
