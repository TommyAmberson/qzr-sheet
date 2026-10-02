import { describe, it, expect, vi, afterEach } from 'vitest'
import { ref } from 'vue'

import { mount, type VueWrapper } from '@vue/test-utils'
import SignInWidget from '../components/SignInWidget.vue'

vi.mock('../composables/useAuth', () => ({
  useAuth: () => ({
    session: ref({ data: null }),
    signInSocial: vi.fn(),
    signInEmail: vi.fn(),
    signUpEmail: vi.fn(),
    signOut: vi.fn(),
  }),
}))
vi.mock('../composables/useMeetSession', () => ({
  useMeetSession: () => ({ clearSession: vi.fn() }),
}))

let wrapper: VueWrapper | undefined

function mountAt(search: string) {
  window.history.replaceState({ kept: true }, '', `/scoresheet/${search}`)
  wrapper = mount(SignInWidget, { attachTo: document.body })
  return wrapper
}

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  window.history.replaceState(null, '', '/')
})

describe('SignInWidget after a failed social sign-in', () => {
  it('opens on email sign-in with the reason and strips the error', async () => {
    mountAt('?keep=1&error=account_not_linked')
    await wrapper!.vm.$nextTick()

    const menu = document.body.querySelector('.sign-in-menu')
    expect(menu).not.toBeNull()
    expect(menu!.querySelector('input[type="email"]')).not.toBeNull()
    expect(menu!.textContent).toMatch(/already has an account/)
    expect(window.location.search).toBe('?keep=1')
    expect(window.history.state).toEqual({ kept: true })
  })

  it('stays closed without an error', async () => {
    mountAt('?keep=1')
    await wrapper!.vm.$nextTick()
    expect(document.body.querySelector('.sign-in-menu')).toBeNull()
    expect(window.location.search).toBe('?keep=1')
  })

  it('forgets the error once the menu is dismissed', async () => {
    mountAt('?error=invalid_code')
    await wrapper!.vm.$nextTick()
    ;(document.body.querySelector('.sign-in-backdrop') as HTMLElement).click()
    await wrapper!.vm.$nextTick()
    await wrapper!.find('button.meta-btn').trigger('click')
    expect(document.body.querySelector('.sign-in-menu .error-msg')).toBeNull()
  })
})
