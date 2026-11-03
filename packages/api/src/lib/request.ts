import type { Context } from 'hono'

/** The meet id in the path, or null when it isn't one */
export function meetIdOf(c: Context): number | null {
  const id = Number(c.req.param('id'))
  return Number.isInteger(id) ? id : null
}

/** The request body, or null when it isn't JSON */
export async function jsonBody<T>(c: Context): Promise<T | null> {
  try {
    return await c.req.json<T>()
  } catch {
    return null
  }
}
