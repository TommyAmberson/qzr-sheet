import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { newScheduleDocument } from '@qzr/shared'

import TeamsSection from '../components/builder/TeamsSection.vue'

describe("the builder's division names", () => {
  it('shows the name again when its box is emptied, since a division needs one', async () => {
    const doc = newScheduleDocument('Meet')
    doc.settings.divisions = [{ id: 'd1', name: '1', teams: 0, elims: { lanes: [], lines: [] } }]
    const wrapper = mount(TeamsSection, { props: { doc } })
    await wrapper.find('input[aria-label="Division name"]').setValue('')
    expect(wrapper.emitted('change')).toBeUndefined()
    expect(
      (wrapper.find('input[aria-label="Division name"]').element as HTMLInputElement).value,
    ).toBe('1')
  })
})
