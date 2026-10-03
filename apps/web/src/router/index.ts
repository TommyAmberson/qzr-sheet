import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'
import { authClient } from '../composables/useAuth'
import { joinedSession } from '@qzr/ui'

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
        {
          path: 'schedule',
          name: 'meet-schedule',
          component: () => import('../views/ScheduleView.vue'),
          props: (route) => ({ slug: route.params.slug as string }),
        },
        {
          path: 'results',
          name: 'meet-results',
          // A guest official who joined with a code may open it
          meta: { guestAccess: true },
          component: () => import('../views/ResultsView.vue'),
          props: (route) => ({ slug: route.params.slug as string }),
        },
        {
          path: 'schedule/edit',
          name: 'meet-schedule-edit',
          component: () => import('../views/ScheduleEditView.vue'),
          props: (route) => ({ slug: route.params.slug as string }),
        },
      ],
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('../views/NotFoundView.vue'),
    },
  ],
})

router.beforeEach(async (to) => {
  if (!to.matched.some((r) => r.meta.requiresAuth)) return true

  const { data } = await authClient.getSession()
  if (data?.user) return true
  // A guest who joined this meet with a code may open its guest pages (`slug` is the meet's id then)
  if (to.matched.some((r) => r.meta.guestAccess) && joinedSession(Number(to.params.slug)))
    return true
  return { name: 'home' }
})

export default router
