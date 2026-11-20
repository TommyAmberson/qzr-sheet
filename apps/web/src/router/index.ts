import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'
import { authClient } from '../composables/useAuth'
import { joinedSession } from '@qzr/ui'
import { isFailedImport, pageLoaded, recoverFromStaleBuild } from '../staleBuild'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    { path: '/roadmap', name: 'roadmap', component: () => import('../views/RoadmapView.vue') },
    // Before the meet route: `account` is refused as a viewer code.
    {
      path: '/account',
      name: 'account',
      meta: { requiresAuth: true },
      component: () => import('../views/AccountView.vue'),
    },
    // Where a GitHub or Google sign-in lands when it needs the code step or
    // the choice; signed out, since that is how most arrive.
    {
      path: '/account/provider',
      name: 'account-provider',
      component: () => import('../views/AccountProviderView.vue'),
    },
    // The schedule builder needs no account. A top-level path can't also be a meet's slug: keep the
    // API's RESERVED_VIEWER_CODES (packages/api/src/routes/meets.ts) in step
    { path: '/builder', name: 'builder', component: () => import('../views/BuilderListView.vue') },
    {
      path: '/builder/:id',
      name: 'builder-schedule',
      component: () => import('../views/BuilderView.vue'),
      props: (route) => ({ id: route.params.id as string }),
    },
    {
      path: '/:slug',
      meta: { requiresAuth: true },
      children: [
        // The meet's page: the tab in the path, the division in `?division=` (specs/010-meet-day)
        {
          path: '',
          component: () => import('../views/MeetView.vue'),
          props: (route) => ({ slug: route.params.slug as string }),
          children: [
            {
              path: '',
              name: 'meet',
              // A guest who joined with the meet's code reads the schedule too
              meta: { guestAccess: true },
              component: () => import('../views/meet/ScheduleTab.vue'),
            },
            {
              path: 'quizzes',
              name: 'meet-quizzes',
              meta: { guestAccess: true },
              component: () => import('../views/meet/QuizzesTab.vue'),
            },
            {
              path: 'standings',
              name: 'meet-standings',
              meta: { guestAccess: true },
              component: () => import('../views/meet/StandingsTab.vue'),
            },
            {
              path: 'roster',
              name: 'meet-roster',
              component: () => import('../views/QuizMeetView.vue'),
              props: (route) => ({ slug: route.params.slug as string }),
            },
            {
              path: 'setup',
              name: 'meet-setup',
              component: () => import('../views/QuizMeetView.vue'),
              props: (route) => ({ slug: route.params.slug as string }),
            },
          ],
        },
        // The pages the tabs replace, kept as addresses (FR-020)
        {
          path: 'schedule',
          name: 'meet-schedule',
          redirect: (to) => ({ name: 'meet', params: to.params, query: to.query, hash: to.hash }),
        },
        {
          path: 'results',
          name: 'meet-results',
          redirect: (to) => ({
            name: 'meet-quizzes',
            params: to.params,
            query: to.query,
            hash: to.hash,
          }),
        },
        {
          path: 'stats',
          name: 'meet-stats',
          redirect: (to) => ({
            name: 'meet-standings',
            params: to.params,
            query: to.query,
            hash: to.hash,
          }),
        },
        // Before `stats/:division`, which would take `settings` for a division
        {
          path: 'stats/settings',
          name: 'meet-stats-settings',
          redirect: (to) => ({ name: 'meet-setup', params: to.params, hash: '#stats' }),
        },
        {
          path: 'stats/:division',
          name: 'meet-division-stats',
          redirect: (to) => ({
            name: 'meet-standings',
            params: { slug: to.params.slug },
            query: { ...to.query, division: to.params.division as string },
          }),
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
          path: 'results/:resultId',
          name: 'meet-result',
          // The quiz's room officials, guests among them, correct it here
          meta: { guestAccess: true },
          component: () => import('../views/ResultView.vue'),
          props: (route) => ({
            slug: route.params.slug as string,
            resultId: route.params.resultId as string,
          }),
        },
        {
          path: 'schedule/edit',
          name: 'meet-schedule-edit',
          component: () => import('../views/LinkedBuilderView.vue'),
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
  // A guest who joined this meet with a code may open its guest pages (`slug` is the meet's id then,
  // and only a value of digits is one: Number() would also read a code like 1e3)
  const slug = String(to.params.slug)
  if (/^\d+$/.test(slug) && joinedSession(Number(slug))) {
    if (to.matched.some((r) => r.meta.guestAccess)) return true
    // The meet's other tabs are for its members: a guest is shown its schedule
    if (to.name === 'meet-roster' || to.name === 'meet-setup') {
      return { name: 'meet', params: to.params, query: to.query }
    }
  }
  // Signed out: home, which asks them to sign in and then brings them back
  return { name: 'home', query: { next: to.fullPath } }
})

// Without this a page whose chunk is gone after a deploy aborts the navigation silently
router.onError((error, to) => {
  if (isFailedImport(error)) void recoverFromStaleBuild(router.resolve(to).href)
  // With a handler registered the router no longer logs navigation errors itself
  else console.error(error)
})
router.afterEach((_to, _from, failure) => {
  if (!failure) pageLoaded()
})

export default router
