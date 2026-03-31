import { sign, verify } from 'hono/jwt'

export interface JwtPayload {
  sub: number // account id
  role: string
  iat: number
  exp: number
}

const TTL = 60 * 60 // 1 hour

export async function signToken(accountId: number, role: string, secret: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  return sign({ sub: accountId, role, iat: now, exp: now + TTL }, secret)
}

export async function verifyToken(token: string, secret: string): Promise<JwtPayload> {
  return verify(token, secret, 'HS256') as Promise<unknown> as Promise<JwtPayload>
}
