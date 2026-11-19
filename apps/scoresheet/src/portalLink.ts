/** What a portal link asks the scoresheet to open */
export type PortalLink =
  | { meetId: number; quizId: string }
  | { meetId: number; resultId: number; revision: number }

const isId = (n: number) => n > 0 && Number.isInteger(n)

/**
 * The quiz a link from the portal names: `?meetId=&quiz=`, set by the portal's schedule view when
 * the user clicks a quiz cell, or `?meetId=&result=&revision=`, set by the portal's quiz page to
 * open a stored quiz (`meet` in links shared before). Null for any other address.
 */
export function portalLink(search: string): PortalLink | null {
  const params = new URLSearchParams(search)
  const meetId = Number(params.get('meetId') ?? params.get('meet'))
  if (!isId(meetId)) return null
  const quizId = params.get('quiz') ?? ''
  if (quizId !== '') return { meetId, quizId }
  const resultId = Number(params.get('result'))
  const revision = Number(params.get('revision'))
  return isId(resultId) && isId(revision) ? { meetId, resultId, revision } : null
}
