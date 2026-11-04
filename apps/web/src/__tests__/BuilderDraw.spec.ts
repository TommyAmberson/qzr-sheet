import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import { listSchedules, loadSchedule } from '../builder/persistence'
import BuilderView from '../views/BuilderView.vue'

beforeEach(() => localStorage.clear())

async function withNineTeams() {
  const w = mount(BuilderView, { attachTo: document.body })
  const count = w.find('[aria-label="Number of divisions"]')
  await count.setValue('1')
  await count.trigger('change')
  const teams = w.find('[aria-label$="team count"]')
  await teams.setValue('9')
  await teams.trigger('change')
  return w
}

const button = (w: ReturnType<typeof mount>, text: string) =>
  w.findAll('button').find((b) => b.text() === text)!

const saved = () => loadSchedule(listSchedules()[0]!.id)!

describe('the draw in the builder (FR-039 to FR-042b)', () => {
  it('draws with two late teams and moves no quiz', async () => {
    const w = await withNineTeams()
    await w
      .findAll('.section-head')
      .find((h) => h.text().includes('Prelim'))!
      .trigger('click')
    await w.find('.disclose').trigger('click')
    await w.find('[aria-label="Div 1 Team 3 late"]').setValue(true)
    await w.find('[aria-label="Div 1 Team 6 late"]').setValue(true)
    const before = structuredClone(saved().quizzes)

    await button(w, 'Draw').trigger('click')
    const doc = saved()
    const id = doc.settings.divisions[0]!.id
    expect(doc.quizzes).toEqual(before)
    const letters = doc.draw[id]!.teams.map((t) => t.letter)
    expect(new Set(letters).size).toBe(9)
    expect(doc.draw[id]!.teams.filter((t) => t.late)).toHaveLength(2)
    expect(w.find(`[data-draw="${id}"]`).text()).toMatch(/Drawn/)

    await button(w, 'Clear').trigger('click')
    expect(saved().draw[id]!.teams.every((t) => !t.letter)).toBe(true)
    w.unmount()
  })

  it('says how many quizzes Sort will move before it moves them (FR-042a)', async () => {
    const w = await withNineTeams()
    await w
      .findAll('.section-head')
      .find((h) => h.text().includes('Prelim'))!
      .trigger('click')
    await button(w, 'Sort all prelims').trigger('click')
    expect(w.find('.moves').text()).toMatch(/\d+ quizz?(es)? will move/)
    await button(w, 'Cancel').trigger('click')
    expect(w.find('.moves').exists()).toBe(false)
    w.unmount()
  })
})
