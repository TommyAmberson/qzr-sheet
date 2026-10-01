import { describe, it, expect, vi, afterEach } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { useSocialSignInError } from '../useSocialSignInError'

async function routerAt(search: string) {
  window.history.replaceState(null, '', `/meet${search}`)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div />' } }],
  })
  await router.push(`/meet${search}`)
  return router
}

afterEach(() => {
  window.history.replaceState(null, '', '/')
})

describe('useSocialSignInError', () => {
  it('reports a refused link and strips only the error params', async () => {
    const router = await routerAt('?keep=1&error=account_not_linked&error_description=x')
    const { error } = useSocialSignInError(router)
    expect(error.value?.passwordAccount).toBe(true)
    await vi.waitFor(() => expect(router.currentRoute.value.query).toEqual({ keep: '1' }))
  })

  it('is null without an error and leaves the route alone', async () => {
    const router = await routerAt('?keep=1')
    const replace = vi.spyOn(router, 'replace')
    const { error } = useSocialSignInError(router)
    expect(error.value).toBeNull()
    expect(replace).not.toHaveBeenCalled()
  })

  it('forgets the error once cleared', async () => {
    const router = await routerAt('?error=invalid_code')
    const { error, clear } = useSocialSignInError(router)
    expect(error.value?.passwordAccount).toBe(false)
    clear()
    expect(error.value).toBeNull()
  })
})
