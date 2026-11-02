import { describe, it, expect, vi } from 'vitest'

import { flushPromises, mount } from '@vue/test-utils'
import { socialSignInError, type SocialSignInError } from '@qzr/shared'
import { SignInForm } from '@qzr/ui'

function mountForm(oauthError: SocialSignInError | null = null, withoutProviders = false) {
  return mount(SignInForm, {
    props: {
      signInSocial: vi.fn(),
      signInEmail: vi.fn(),
      signUpEmail: vi.fn(),
      requestPasswordReset: vi.fn(),
      resetPassword: vi.fn(),
      sendVerificationCode: vi.fn(),
      verifyEmail: vi.fn(),
      oauthError,
      withoutProviders,
    },
  })
}

describe('SignInForm in the desktop app', () => {
  it('offers email only', () => {
    const wrapper = mountForm(null, true)
    expect(wrapper.text()).not.toContain('GitHub')
    expect(wrapper.text()).not.toContain('Google')
    expect(wrapper.text()).toContain('Sign in with email')
  })
})

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
        sendVerificationCode: vi.fn(),
        verifyEmail: vi.fn(),
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

  it('says a provider was disconnected before signing in', async () => {
    const resetPassword = vi.fn(async () => ({
      data: { success: true, providersDisconnected: ['github'] },
      error: null,
    }))
    const signInEmail = vi.fn(async () => ({ data: {}, error: null }))
    const wrapper = await openReset({ resetPassword, signInEmail })

    expect(wrapper.text()).toMatch(/GitHub was disconnected/)
    expect(signInEmail).not.toHaveBeenCalled()
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Continue')!
      .trigger('click')
    await flushPromises()
    expect(signInEmail).toHaveBeenCalledOnce()
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

describe('SignInForm after sign-up', () => {
  async function signUp(overrides: Record<string, unknown> = {}) {
    const wrapper = mount(SignInForm, {
      props: {
        signInSocial: vi.fn(),
        signInEmail: vi.fn(),
        signUpEmail: vi.fn(async () => ({ data: {}, error: null })),
        requestPasswordReset: vi.fn(),
        resetPassword: vi.fn(),
        sendVerificationCode: vi.fn(async () => ({ data: {}, error: null })),
        verifyEmail: vi.fn(async () => ({ data: {}, error: null })),
        ...overrides,
      },
    })
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Create account')!
      .trigger('click')
    await wrapper.find('input[type="email"]').setValue('new@example.com')
    await wrapper.find('input[type="password"]').setValue('correct-horse-battery')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    return wrapper
  }

  it('asks for the code while holding the form, then verifies and lets go', async () => {
    const verifyEmail = vi.fn(async () => ({ data: {}, error: null }))
    const wrapper = await signUp({ verifyEmail })

    expect(wrapper.emitted('hold')).toEqual([[true]])
    expect(wrapper.emitted('success')).toBeUndefined()
    await wrapper.find('input[autocomplete="one-time-code"]').setValue('123456')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(verifyEmail).toHaveBeenCalledWith('new@example.com', '123456')
    expect(wrapper.emitted('hold')).toEqual([[true], [false]])
    expect(wrapper.emitted('success')).toHaveLength(1)
  })

  it('lets go when the host closes it during the code step', async () => {
    const onHold = vi.fn()
    const wrapper = await signUp({ onHold })
    expect(onHold.mock.calls).toEqual([[true]])

    wrapper.unmount()

    expect(onHold.mock.calls).toEqual([[true], [false]])
  })

  it('can skip the code for now', async () => {
    const wrapper = await signUp()
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Skip for now')!
      .trigger('click')

    expect(wrapper.emitted('hold')).toEqual([[true], [false]])
    expect(wrapper.emitted('success')).toHaveLength(1)
  })
})
