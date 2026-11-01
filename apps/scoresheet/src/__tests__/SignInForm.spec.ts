import { describe, it, expect, vi } from 'vitest'

import { flushPromises, mount } from '@vue/test-utils'
import { socialSignInError, type SocialSignInError } from '@qzr/shared'
import { SignInForm } from '@qzr/ui'

function mountForm(oauthError: SocialSignInError | null = null) {
  return mount(SignInForm, {
    props: {
      signInSocial: vi.fn(),
      signInEmail: vi.fn(),
      signUpEmail: vi.fn(),
      requestPasswordReset: vi.fn(),
      resetPassword: vi.fn(),
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

describe('SignInForm forgot password', () => {
  async function openReset(overrides: Record<string, unknown>) {
    const wrapper = mount(SignInForm, {
      props: {
        signInSocial: vi.fn(),
        signInEmail: vi.fn(async () => ({ data: {}, error: null })),
        signUpEmail: vi.fn(),
        requestPasswordReset: vi.fn(async () => ({ data: { success: true }, error: null })),
        resetPassword: vi.fn(async () => ({ data: { success: true }, error: null })),
        ...overrides,
      },
    })
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Sign in with email')!
      .trigger('click')
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Forgot password?')!
      .trigger('click')
    await wrapper.find('input[type="email"]').setValue('coach@example.com')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    await wrapper.find('input[autocomplete="one-time-code"]').setValue('123456')
    await wrapper.find('input[type="password"]').setValue('another-good-password')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    return wrapper
  }

  it('sends a code, sets the new password with it, then signs in', async () => {
    const requestPasswordReset = vi.fn(async () => ({ data: { success: true }, error: null }))
    const resetPassword = vi.fn(async () => ({ data: { success: true }, error: null }))
    const signInEmail = vi.fn(async () => ({ data: {}, error: null }))
    const wrapper = await openReset({ requestPasswordReset, resetPassword, signInEmail })

    expect(requestPasswordReset).toHaveBeenCalledWith('coach@example.com')
    expect(resetPassword).toHaveBeenCalledWith(
      'coach@example.com',
      '123456',
      'another-good-password',
    )
    expect(signInEmail).toHaveBeenCalledWith('coach@example.com', 'another-good-password')
    expect(wrapper.emitted('success')).toHaveLength(1)
  })

  it('says a provider was disconnected before leaving', async () => {
    const resetPassword = vi.fn(async () => ({
      data: { success: true, providersDisconnected: ['github'] },
      error: null,
    }))
    const wrapper = await openReset({ resetPassword })

    expect(wrapper.text()).toMatch(/GitHub was disconnected/)
    expect(wrapper.emitted('success')).toBeUndefined()
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Continue')!
      .trigger('click')
    expect(wrapper.emitted('success')).toHaveLength(1)
  })

  it('explains a wrong code instead of showing a raw error', async () => {
    const resetPassword = vi.fn(async () => ({
      data: null,
      error: { code: 'INVALID_OTP', status: 400 },
    }))
    const wrapper = await openReset({ resetPassword })

    expect(wrapper.find('.error-msg').text()).toMatch(/isn't valid/)
  })
})
