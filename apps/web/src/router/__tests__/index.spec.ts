import { describe, it, expect, vi, beforeEach } from 'vitest'
import { type Router } from 'vue-router'

const mockGetSession = vi.fn()

vi.mock('../../composables/useAuth', () => ({
  authClient: { getSession: (...args: unknown[]) => mockGetSession(...args) },
}))

// Stub the view components so we don't need the full Vue compile chain
vi.mock('../../views/HomeView.vue', () => ({ default: { template: '<div />' } }))
vi.mock('../../views/QuizMeetView.vue', () => ({ default: { template: '<div />' } }))
vi.mock('../../views/MeetTeamsView.vue', () => ({ default: { template: '<div />' } }))

let router: Router

beforeEach(async () => {
  mockGetSession.mockReset()
  // Re-import the router fresh each test to avoid stale state
  vi.resetModules()
  const mod = await import('../index')
  router = mod.default
})

describe('router guard', () => {
  it('allows navigation to public routes without auth', async () => {
    await router.push('/')
    expect(router.currentRoute.value.name).toBe('home')
    expect(mockGetSession).not.toHaveBeenCalled()
  })

  it('redirects to home when navigating to a protected route without a session', async () => {
    mockGetSession.mockResolvedValue({ data: null })
    await router.push('/meets/1')
    expect(router.currentRoute.value.name).toBe('home')
  })

  it('redirects to home when session exists but user is null', async () => {
    mockGetSession.mockResolvedValue({ data: { user: null } })
    await router.push('/meets/1')
    expect(router.currentRoute.value.name).toBe('home')
  })

  it('allows navigation to a protected route with a valid session', async () => {
    mockGetSession.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@b.com' } } })
    await router.push('/meets/1')
    expect(router.currentRoute.value.name).toBe('meet')
  })

  it('allows nested protected routes with a valid session', async () => {
    mockGetSession.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@b.com' } } })
    await router.push('/meets/5/churches/3/teams')
    expect(router.currentRoute.value.name).toBe('meet-church-teams')
  })

  it('redirects nested protected routes to home without a session', async () => {
    mockGetSession.mockResolvedValue({ data: null })
    await router.push('/meets/5/churches/3/teams')
    expect(router.currentRoute.value.name).toBe('home')
  })
})

describe('route props', () => {
  it('meet route extracts numeric id from params', async () => {
    mockGetSession.mockResolvedValue({ data: { user: { id: 'u1' } } })
    await router.push('/meets/42')

    const route = router.currentRoute.value
    const matched = route.matched.find((r) => r.name === 'meet')!
    const propsFn = matched.props.default as (r: typeof route) => Record<string, unknown>
    expect(propsFn(route)).toEqual({ id: 42 })
  })

  it('meet-church-teams route extracts numeric id and churchId', async () => {
    mockGetSession.mockResolvedValue({ data: { user: { id: 'u1' } } })
    await router.push('/meets/10/churches/7/teams')

    const route = router.currentRoute.value
    const matched = route.matched.find((r) => r.name === 'meet-church-teams')!
    const propsFn = matched.props.default as (r: typeof route) => Record<string, unknown>
    expect(propsFn(route)).toEqual({ id: 10, churchId: 7 })
  })
})
