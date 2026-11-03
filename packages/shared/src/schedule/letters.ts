/** Prelim letters run A to Z, then AA, AB, …, so any division size has a letter per team (H-10) */
export function letterOf(index: number): string {
  let n = index
  let letters = ''
  do {
    letters = String.fromCharCode(65 + (n % 26)) + letters
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return letters
}

/** The 0-based team index a letter stands for; the inverse of `letterOf` */
export function indexOfLetter(letter: string): number {
  let n = 0
  for (const ch of letter) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}
