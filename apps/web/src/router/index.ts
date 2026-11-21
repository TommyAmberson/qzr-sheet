import {
  createRouter,
  createWebHistory,
  type RouteLocation,
  type RouteLocationRaw,
} from 'vue-router'
import HomeView from '../views/HomeView.vue'
import { settledSession } from '../composables/useAuth'
import { guestSessionFor, joinByLink, LINK_REFUSED, notifyGuest } from '@qzr/ui'
import { joinMeetGuest } from '../api'
import { isFailedImport, pageLoaded, recoverFromStaleBuild } from '../staleBuild'

/** A page the meet's tabs replace, sent to its tab with its address's division and hash */
const toTab =
  (name: string, hash?: string) =>
  (to: RouteLocation): RouteLocationRaw => ({
    name,
    params: to.params,
    query: to.query,
    hash: hash ?? to.hash,
  })

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
          name: 'meet-tabs',
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
              component: () => import('../views/meet/RosterTab.vue'),
            },
            {
              path: 'setup',
              name: 'meet-setup',
              component: () => import('../views/meet/SetupTab.vue'),
            },
          ],
        },
        // The pages the tabs replace, kept as addresses (FR-020)
        {
          path: 'schedule',
          name: 'meet-schedule',
          redirect: toTab('meet'),
        },
        {
          path: 'results',
          name: 'meet-results',
          redirect: toTab('meet-quizzes'),
        },
        {
          path: 'stats',
          name: 'meet-stats',
          redirect: toTab('meet-standings'),
        },
        // Before `stats/:division`, which would take `settings` for a division
        {
          path: 'stats/settings',
          name: 'meet-stats-settings',
          redirect: toTab('meet-setup', '#stats'),
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

/** Join with an address's viewer code, saying why when it can't, as the scoresheet's link does */
async function joinFrom(code: string) {
  try {
    const joined = await joinByLink(code, joinMeetGuest, false)
    if (!joined) notifyGuest(LINK_REFUSED)
    return joined
  } catch {
    notifyGuest("The meet couldn't be opened just now. Open the link again in a moment.")
    return null
  }
}

router.beforeEach(async (to) => {
  if (!to.matched.some((r) => r.meta.requiresAuth)) return true

  // The session the app's store reads, so the page's opening asks for it once
  const data = await settledSession()
  if (data?.user) return true
  // A meet's address names it by its viewer code, so opening it joins a signed-out visitor as a
  // viewer, keeping the address. A guest official keeps no code, so goes by the meet's id.
  const slug = to.params.slug
  // Only a page a guest may see joins: a members' page, such as an admin's bookmarked Setup, sends
  // them to sign in as it is
  const forGuests = !!to.matched[to.matched.length - 1]?.meta.guestAccess
  if (typeof slug === 'string') {
    const joinable = forGuests && !/^\d+$/.test(slug)
    const guest = guestSessionFor(slug) ?? (joinable ? await joinFrom(slug) : null)
    if (guest && !guest.code && slug !== String(guest.meetId)) {
      return {
        name: to.name,
        params: { ...to.params, slug: String(guest.meetId) },
        query: to.query,
      }
    }
    if (guest) {
      if (to.matched.some((r) => r.meta.guestAccess)) return true
      // The meet's other tabs are for its members: a guest is shown its schedule
      if (to.matched.some((r) => r.name === 'meet-tabs')) {
        return { name: 'meet', params: to.params, query: to.query }
      }
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
