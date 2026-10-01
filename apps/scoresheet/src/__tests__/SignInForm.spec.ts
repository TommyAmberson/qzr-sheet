import { describe, it, expect, vi } from 'vitest'

import { mount } from '@vue/test-utils'
import { socialSignInError, type SocialSignInError } from '@qzr/shared'
import { SignInForm } from '@qzr/ui'

function mountForm(oauthError: SocialSignInError | null = null) {
  return mount(SignInForm, {
    props: {
      signInSocial: vi.fn(),
      signInEmail: vi.fn(),
      signUpEmail: vi.fn(),
      oauthError,
    },
  })
}

describe('SignInForm with a social sign-in error', () => {
  it('opens email sign-in and explains a refused link', () => {
    const wrapper = mountForm(socialSignInError('?error=account_not_linked'))
    expect(wrapper.find('input[type="email"]').exists()).toBe(true)
    expect(wrapper.find('.error-msg').text()).toMatch(/already has an account/)
  })

  it('stays on the provider picker for other errors, with the message', () => {
    const wrapper = mountForm(socialSignInError('?error=invalid_code'))
    expect(wrapper.text()).toContain('Continue with Google')
    expect(wrapper.find('.error-msg').text()).toMatch(/try again/)
  })

  it('drops a social sign-in error on switching to the email form', async () => {
    const wrapper = mountForm(socialSignInError('?error=access_denied'))
    expect(wrapper.find('.error-msg').exists()).toBe(true)
    const toEmail = wrapper.findAll('button').find((b) => b.text() === 'Sign in with email')!
    await toEmail.trigger('click')
    expect(wrapper.find('input[type="email"]').exists()).toBe(true)
    expect(wrapper.find('.error-msg').exists()).toBe(false)
  })

  it('shows no error without one', () => {
    const wrapper = mountForm()
    expect(wrapper.text()).toContain('Continue with Google')
    expect(wrapper.find('.error-msg').exists()).toBe(false)
  })
})
