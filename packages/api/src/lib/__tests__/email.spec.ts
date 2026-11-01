import { describe, it, expect, vi } from 'vitest'
import { createEmailSender, resetCodeEmail } from '../email'

describe('email', () => {
  it('logs the email instead of sending when no key is set', () => {
    const log = vi.fn()
    const fetchImpl = vi.fn()
    createEmailSender({ apiKey: undefined, log, fetchImpl })(
      resetCodeEmail('a@example.com', '123456', 10),
    )
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(log.mock.calls[0]![0]).toContain('123456')
  })

  it('hands the send to waitUntil and logs a failure without the code', async () => {
    const log = vi.fn()
    const waits: Promise<unknown>[] = []
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 500 }))
    createEmailSender({ apiKey: 'key', waitUntil: (p) => waits.push(p), log, fetchImpl })(
      resetCodeEmail('a@example.com', '123456', 10),
    )
    expect(waits).toHaveLength(1)
    await waits[0]
    expect(log).toHaveBeenCalledOnce()
    expect(log.mock.calls[0]![0]).not.toContain('123456')
  })

  it('says why it was sent, for how long, not to share it, and what to do if unexpected', () => {
    const { text, html } = resetCodeEmail('a@example.com', '123456', 10)
    expect(text).toContain('123456')
    expect(text).toMatch(/reset the password/)
    expect(text).toMatch(/expires in 10 minutes/)
    expect(text).toMatch(/Don't share it/)
    expect(text).toMatch(/didn't ask for this/)
    expect(html).toContain('123456')
  })
})
