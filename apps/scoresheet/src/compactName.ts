/**
 * A quizzer's name as the phone's narrow name column writes it, once the sheet is scrolled: the
 * first name, which an ellipsis may cut, and the last name's initial, which it never does, so
 * "Christopher Wiebe" still reads as someone's "Chris… W.". A name of one word is all first name.
 */
export function compactName(name: string): { first: string; initial: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length < 2) return { first: parts[0] ?? '', initial: '' }
  return { first: parts[0]!, initial: ` ${parts[parts.length - 1]![0]!.toUpperCase()}.` }
}
