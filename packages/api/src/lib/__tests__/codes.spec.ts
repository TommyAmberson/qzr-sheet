import { Hono } from 'hono'
import { describe, it, expect } from 'vitest'
import { generateCode, hashCode, wantsClearMembers } from '../codes'

describe('generateCode', () => {
  it('returns a string of the requested length', () => {
    expect(generateCode(12)).toHaveLength(12)
    expect(generateCode(24)).toHaveLength(24)
  })

  it('defaults to 16 characters', () => {
    expect(generateCode()).toHaveLength(16)
  })

  it('uses only alphanumeric characters', () => {
    const code = generateCode(100)
    expect(code).toMatch(/^[A-Za-z0-9]+$/)
  })

  it('generates unique codes', () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateCode()))
    expect(codes.size).toBe(50)
  })
})

describe('hashCode', () => {
  it('returns a 64-character hex string', async () => {
    const hash = await hashCode('test')
    expect(hash).toHaveLength(64)
    expect(hash).toMatch(/^[0-9a-f]+$/)
  })

  it('is deterministic', async () => {
    const a = await hashCode('hello')
    const b = await hashCode('hello')
    expect(a).toBe(b)
  })

  it('produces different hashes for different inputs', async () => {
    const a = await hashCode('code-a')
    const b = await hashCode('code-b')
    expect(a).not.toBe(b)
  })

  it('matches known SHA-256 digest', async () => {
    // echo -n "test" | sha256sum
    const hash = await hashCode('test')
    expect(hash).toBe('9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08')
  })
})

describe('wantsClearMembers', () => {
  const app = new Hono().post('/', async (c) => c.json({ clear: await wantsClearMembers(c.req) }))
  const asks = async (body?: string) => {
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
    return ((await res.json()) as { clear: boolean }).clear
  }

  it('is true only for an explicit true', async () => {
    expect(await asks('{"clearMembers":true}')).toBe(true)
  })

  it.each([
    undefined,
    'null',
    'not json',
    '{}',
    '{"clearMembers":false}',
    '{"clearMembers":"true"}',
  ])('rotates only for a body of %s', async (body) => {
    expect(await asks(body)).toBe(false)
  })
})
