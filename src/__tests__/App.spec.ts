import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import App from '../App.vue'
import Scoresheet from '../components/Scoresheet.vue'

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: Scoresheet }],
  })
}

describe('App', () => {
  it('mounts and renders the scoresheet', async () => {
    const router = makeRouter()
    router.push('/')
    await router.isReady()
    const wrapper = mount(App, { global: { plugins: [router] } })
    expect(wrapper.find('.scoresheet-wrapper').exists()).toBe(true)
  })
})
