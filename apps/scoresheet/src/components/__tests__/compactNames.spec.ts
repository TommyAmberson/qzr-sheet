import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { startTab } from '../../persistence/autoSave'
import Scoresheet from '../Scoresheet.vue'
import { useMeetSession, type MeetSessionData } from '../../composables/useMeetSession'

// The phone's name column, narrowed as the sheet scrolls away from its start. A test DOM lays
// nothing out, so the column measures nothing and is at its narrowest as soon as it scrolls, and
// names are measured by their length

const linked: MeetSessionData = {
  meetId: 3,
  meetName: 'Practice',
  slots: [undefined, undefined, undefined],
  teamList: [
    {
      id: 41,
      churchId: 7,
      churchName: 'Grace Fellowship',
      churchShortName: 'GF',
      division: '1',
      number: 2,
      consolation: false,
    },
  ],
  meetDivisions: ['1'],
  quizId: null,
  sender: { admin: false, rooms: [] },
}

/** A screen the phone's width, or wider */
function screen(phone: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: phone,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

/** Scroll the sheet sideways, as a finger does, and let it answer */
async function scrollTo(w: VueWrapper, left: number) {
  const sheet = w.find('.scoresheet-wrapper').element as HTMLElement
  Object.defineProperty(sheet, 'scrollLeft', { value: left, writable: true, configurable: true })
  sheet.dispatchEvent(new Event('scroll'))
  await vi.waitFor(() => new Promise((resolve) => requestAnimationFrame(resolve)))
  await flushPromises()
}

async function named(w: VueWrapper) {
  await w.findAll('input.editable-name--team')[0]!.setValue('Grace Fellowship 2')
  const seats = w.findAll('input.editable-name--quizzer')
  await seats[0]!.setValue('Christopher Wiebe')
  await seats[1]!.setValue('Eli Martens')
}

beforeEach(async () => {
  localStorage.clear()
  await startTab()
  useMeetSession().restoreSession(structuredClone(linked))
})

afterEach(() => vi.unstubAllGlobals())

describe('the name column on a phone', () => {
  it("narrows to the names that fit once scrolled: a team's short name, a first name and initial", async () => {
    screen(true)
    const w = mount(Scoresheet, { attachTo: document.body })
    await named(w)
    expect(w.find('table.scoresheet').classes()).not.toContain('compact')
    await scrollTo(w, 120)
    expect(w.find('table.scoresheet').classes()).toContain('compact')
    // A meet team's short name where its full one doesn't fit
    expect(w.find('.row--team-header .name-overlay').text()).toBe('GF 2')
    const [first, second] = w.findAll('.row--quizzer .name-overlay')
    expect(second!.find('.overlay-seat').text()).toBe('2')
    expect(second!.find('.overlay-text').text()).toBe('Eli M.')
    // A first name too long to leave room for an initial goes without, cut short as it must be
    expect(first!.find('.overlay-text').text()).toBe('Christopher')
    // The score stays under the last seat
    expect(w.find('.row--team-total .baseline-score').text()).toBe('20')
    w.unmount()
  })

  it('widens again at the start, and a tap on a short name goes back there to edit it', async () => {
    screen(true)
    const w = mount(Scoresheet, { attachTo: document.body })
    await named(w)
    await scrollTo(w, 120)
    await w.find('.row--quizzer .name-overlay').trigger('click')
    await flushPromises()
    expect((w.find('.scoresheet-wrapper').element as HTMLElement).scrollLeft).toBe(0)
    expect(w.find('table.scoresheet').classes()).not.toContain('compact')
    expect(document.activeElement).toBe(w.findAll('input.editable-name--quizzer')[0]!.element)
    w.unmount()
  })

  it('stays as it is on a wider screen, scrolled or not', async () => {
    screen(false)
    const w = mount(Scoresheet, { attachTo: document.body })
    await scrollTo(w, 120)
    expect(w.find('table.scoresheet').classes()).not.toContain('compact')
    w.unmount()
  })
})
