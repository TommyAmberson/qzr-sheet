import { describe, it, expect, vi, beforeEach } from 'vitest'
import { type Router } from 'vue-router'
import { MeetRole } from '@qzr/shared'

const mockGetSession = vi.fn()

vi.mock('../../composables/useAuth', () => ({
  authClient: { getSession: (...args: unknown[]) => mockGetSession(...args) },
}))

// Stub the view components so we don't need the full Vue compile chain
vi.mock('../../views/HomeView.vue', () => ({ default: { template: '<div />' } }))
vi.mock('../../views/QuizMeetView.vue', () => ({ default: { template: '<div />' } }))
vi.mock('../../views/MeetTeamsView.vue', () => ({ default: { template: '<div />' } }))
vi.mock('../../views/NotFoundView.vue', () => ({ default: { template: '<div />' } }))
vi.mock('../../views/AccountView.vue', () => ({ default: { template: '<div />' } }))
vi.mock('../../views/MeetView.vue', () => ({ default: { template: '<div />' } }))
vi.mock('../../views/meet/ScheduleTab.vue', () => ({ default: { template: '<div />' } }))
vi.mock('../../views/meet/QuizzesTab.vue', () => ({ default: { template: '<div />' } }))
vi.mock('../../views/meet/StandingsTab.vue', () => ({ default: { template: '<div />' } }))

let router: Router

beforeEach(async () => {
  mockGetSession.mockReset()
  // Re-import the router fresh each test to avoid stale state
  vi.resetModules()
  const mod = await import('../index')
  router = mod.default
})

describe('router guard', () => {
  it('opens account settings, not a meet, for a signed-in user', async () => {
    mockGetSession.mockResolvedValue({ data: { user: { id: 'u1' } } })
    await router.push('/account')
    expect(router.currentRoute.value.name).toBe('account')
  })

  it('opens the provider step signed out, not a meet', async () => {
    mockGetSession.mockResolvedValue({ data: null })
    await router.push('/account/provider')
    expect(router.currentRoute.value.name).toBe('account-provider')
  })

  it('allows navigation to public routes without auth', async () => {
    await router.push('/')
    expect(router.currentRoute.value.name).toBe('home')
    expect(mockGetSession).not.toHaveBeenCalled()
  })

  it('redirects to home when navigating to a protected route without a session', async () => {
    mockGetSession.mockResolvedValue({ data: null })
    await router.push('/fall-2025')
    expect(router.currentRoute.value.name).toBe('home')
  })

  it('redirects to home when session exists but user is null', async () => {
    mockGetSession.mockResolvedValue({ data: { user: null } })
    await router.push('/fall-2025')
    expect(router.currentRoute.value.name).toBe('home')
  })

  it('allows navigation to a protected route with a valid session', async () => {
    mockGetSession.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@b.com' } } })
    await router.push('/fall-2025')
    expect(router.currentRoute.value.name).toBe('meet')
  })

  it('allows nested protected routes with a valid session', async () => {
    mockGetSession.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@b.com' } } })
    await router.push('/fall-2025/churches/3/teams')
    expect(router.currentRoute.value.name).toBe('meet-church-teams')
  })

  it('redirects nested protected routes to home without a session', async () => {
    mockGetSession.mockResolvedValue({ data: null })
    await router.push('/fall-2025/churches/3/teams')
    expect(router.currentRoute.value.name).toBe('home')
  })

  it('still logs a navigation error that is not a failed page load', async () => {
    const error = new Error('auth is down')
    mockGetSession.mockRejectedValue(error)
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    await router.push('/fall-2025').catch(() => {})
    expect(log).toHaveBeenCalledWith(error)
    log.mockRestore()
  })
})

describe('route props', () => {
  it('meet route extracts slug from params', async () => {
    mockGetSession.mockResolvedValue({ data: { user: { id: 'u1' } } })
    await router.push('/fall-2025')

    const route = router.currentRoute.value
    // The meet's page, the shell around its tabs, takes the slug
    const matched = route.matched.find((r) => typeof r.props.default === 'function')!
    const propsFn = matched.props.default as (r: typeof route) => Record<string, unknown>
    expect(propsFn(route)).toEqual({ slug: 'fall-2025' })
  })

  it('meet-church-teams route extracts slug and numeric churchId', async () => {
    mockGetSession.mockResolvedValue({ data: { user: { id: 'u1' } } })
    await router.push('/fall-2025/churches/7/teams')

    const route = router.currentRoute.value
    const matched = route.matched.find((r) => r.name === 'meet-church-teams')!
    const propsFn = matched.props.default as (r: typeof route) => Record<string, unknown>
    expect(propsFn(route)).toEqual({ slug: 'fall-2025', churchId: 7 })
  })
})

describe('not-found route', () => {
  it('matches deep unknown paths', () => {
    expect(router.resolve('/a/b/c/d/e').name).toBe('not-found')
  })

  it.each([
    ['/fall-2025', 'meet'],
    ['/fall-2025/schedule', 'meet-schedule'],
    ['/roadmap', 'roadmap'],
  ])('still routes %s to %s', (path, name) => {
    expect(router.resolve(path).name).toBe(name)
  })
})

describe("the meet page's addresses (specs/010-meet-day, contracts/meet-day-api.md)", () => {
  const signedIn = () => mockGetSession.mockResolvedValue({ data: { user: { id: 'u1' } } })

  it.each([
    ['/fall', 'meet'],
    ['/fall/quizzes', 'meet-quizzes'],
    ['/fall/standings', 'meet-standings'],
    ['/fall/roster', 'meet-roster'],
    ['/fall/setup', 'meet-setup'],
  ])('opens %s on its tab', async (path, name) => {
    signedIn()
    await router.push(`${path}?division=2`)
    expect(router.currentRoute.value.name).toBe(name)
    expect(router.currentRoute.value.query.division).toBe('2')
  })

  it.each([
    ['/fall/schedule', 'meet', {}, ''],
    ['/fall/results?division=2', 'meet-quizzes', { division: '2' }, ''],
    ['/fall/stats', 'meet-standings', {}, ''],
    ['/fall/stats/2C', 'meet-standings', { division: '2C' }, ''],
    ['/fall/stats/settings', 'meet-setup', {}, '#stats'],
  ])('takes the old address %s to its tab', async (path, name, query, hash) => {
    signedIn()
    await router.push(path)
    const route = router.currentRoute.value
    expect(route.name).toBe(name)
    expect(route.params.slug).toBe('fall')
    expect(route.query).toEqual(query)
    expect(route.hash).toBe(hash)
  })

  it('asks a signed-out reader to sign in and brings them back to the tab and division (FR-005)', async () => {
    mockGetSession.mockResolvedValue({ data: null })
    await router.push('/fall/standings?division=2')
    expect(router.currentRoute.value.name).toBe('home')
    expect(router.currentRoute.value.query.next).toBe('/fall/standings?division=2')
  })

  it("keeps a guest who joined with the meet's code to its Schedule, Quizzes and Standings", async () => {
    mockGetSession.mockResolvedValue({ data: null })
    // The router's own copy of the guest sessions, fresh with the router
    const { setGuestState } = await import('@qzr/ui')
    setGuestState({
      active: 7,
      joined: [{ token: 't', meetId: 7, meetName: 'Fall', role: MeetRole.Viewer }],
    })
    for (const [path, name] of [
      ['/7', 'meet'],
      ['/7/quizzes', 'meet-quizzes'],
      ['/7/standings', 'meet-standings'],
      ['/7/roster', 'meet'],
      ['/7/setup', 'meet'],
    ]) {
      await router.push(path!)
      expect(router.currentRoute.value.name).toBe(name)
    }
  })
})
